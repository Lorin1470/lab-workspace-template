#!/usr/bin/env node

/**
 * verify-auth-session.mjs
 * 獨立驗證 GitHub OAuth、Opaque Session、伺服器端身分覆寫 (Anti-Spoofing) 與生命週期
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { onRequest } from '../web/functions/api/[[route]].ts';

const TEST_SECRET = 'test-activity-secret-token-xyz';
const TEST_CLIENT_ID = 'test_github_client_id_123';
const TEST_CLIENT_SECRET = 'test_github_client_secret_abc';

// 輔助函式：計算 SHA-256 Hex
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 模擬 D1 資料庫
class MockAuthD1 {
  constructor() {
    this.sessions = new Map(); // key: hashed session_id
    this.activityLogs = [];
  }

  prepare(query) {
    return {
      bind: (...binds) => ({
        run: async () => {
          const q = query.trim();
          if (q.startsWith('INSERT INTO user_sessions')) {
            const [session_id, github_id, username, display_name, avatar_url, created_at, expires_at] = binds;
            this.sessions.set(session_id, {
              session_id,
              github_id,
              username,
              display_name,
              avatar_url,
              created_at,
              expires_at,
            });
            return { success: true };
          }
          if (q.startsWith('DELETE FROM user_sessions WHERE session_id = ?')) {
            const [session_id] = binds;
            this.sessions.delete(session_id);
            return { success: true };
          }
          if (q.startsWith('INSERT INTO activity_logs')) {
            const record = {
              id: binds[0],
              repo_name: binds[1],
              experiment_id: binds[2],
              timestamp: binds[3],
              actor_type: binds[4],
              actor_id: binds[5],
              actor_name: binds[6],
              actor_avatar: binds[7],
              requested_by: binds[8],
              approved_by: binds[9],
              approval_status: binds[10],
              action: binds[11],
              target: binds[12],
              summary: binds[13],
              files_changed: binds[14],
              commit_sha: binds[15],
              details_json: binds[16],
            };
            this.activityLogs.push(record);
            return { success: true };
          }
          return { success: true };
        },
        first: async () => {
          const q = query.trim();
          if (q.includes('FROM user_sessions WHERE session_id = ?')) {
            const [session_id] = binds;
            return this.sessions.get(session_id) || null;
          }
          if (q.includes('SELECT 1 as ping')) {
            return { ping: 1 };
          }
          if (q.includes("name='activity_logs'")) {
            return { name: 'activity_logs' };
          }
          return null;
        },
        all: async () => {
          if (query.includes('FROM activity_logs')) {
            return { results: [...this.activityLogs] };
          }
          return { results: [] };
        },
      }),
    };
  }
}

const mockD1 = new MockAuthD1();

function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const fullUrl = `http://${req.headers.host || 'localhost'}${req.url}`;
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const bodyBuffer = Buffer.concat(chunks);
        const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : bodyBuffer;

        const cfRequest = new Request(fullUrl, {
          method: req.method,
          headers: req.headers,
          body,
        });

        const response = await onRequest({
          request: cfRequest,
          env: {
            DB: mockD1,
            ACTIVITY_LOG_SECRET: TEST_SECRET,
            GITHUB_CLIENT_ID: TEST_CLIENT_ID,
            GITHUB_CLIENT_SECRET: TEST_CLIENT_SECRET,
          },
        });

        res.statusCode = response.status;
        for (const [k, v] of response.headers.entries()) {
          res.setHeader(k, v);
        }
        const respText = await response.text();
        res.end(respText);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

let passed = 0;
let failed = 0;

function assert(cond, desc, detail = '') {
  if (cond) {
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${desc} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function run() {
  console.log('====================================================');
  console.log('🧪 GitHub OAuth & Session 安全驗證測試開始');
  console.log('====================================================\n');

  const { server, port } = await startTestServer();
  const base = `http://127.0.0.1:${port}/api`;

  try {
    // ----------------------------------------------------
    // 群組 A: OAuth State 與登入重導向防護
    // ----------------------------------------------------
    console.log('▶ [群組 A: OAuth State 與登入導向防護]');

    // A1: /api/auth/login 產生 state 與安全導向
    const loginRes = await fetch(`${base}/auth/login?return_to=/labs/exp-1`, { redirect: 'manual' });
    assert(loginRes.status === 302, 'GET /api/auth/login 回傳 302 重導向');
    const location = loginRes.headers.get('Location') || '';
    assert(location.startsWith('https://github.com/login/oauth/authorize'), '導向至 GitHub OAuth 網址');
    assert(location.includes(`client_id=${TEST_CLIENT_ID}`), '包含正確 GITHUB_CLIENT_ID');
    assert(location.includes('scope=read%3Auser') || location.includes('scope=read:user'), 'Scope 限制為 read:user');

    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert(setCookie.includes('oauth_state='), '設定 oauth_state Cookie');
    // 安全性備註：HttpOnly 可阻止前端 JavaScript 直接讀取 Cookie，降低 Session Cookie 被 XSS 直接竊取的風險；
    // 但 HttpOnly 並不能阻止 XSS 以使用者瀏覽器的既有 Session 發送請求，因此仍需維持 XSS 防護、CSRF 防護與 server-side authorization。
    assert(setCookie.includes('HttpOnly'), 'oauth_state 具備 HttpOnly');
    assert(setCookie.includes('SameSite=Lax'), 'oauth_state 具備 SameSite=Lax');

    // 擷取 state 供後續比對
    const stateMatch = location.match(/state=([^&]+)/);
    const generatedState = stateMatch ? stateMatch[1] : '';
    assert(!!generatedState && generatedState.length >= 32, '產生足夠長度的高熵 state 隨機碼');

    // A2: Callback 缺少 state 或 code 阻絕 (400)
    const noCodeRes = await fetch(`${base}/auth/callback?state=${generatedState}`);
    assert(noCodeRes.status === 400, 'Callback 缺少 code 回傳 400 Bad Request');

    const noStateRes = await fetch(`${base}/auth/callback?code=fake_code`);
    assert(noStateRes.status === 400, 'Callback 缺少 state 回傳 400 Bad Request');

    // A3: Callback state 不一致 (CSRF 攻擊模擬) 阻絕 (403)
    const mismatchedRes = await fetch(`${base}/auth/callback?code=fake_code&state=attacker_state`, {
      headers: { Cookie: `oauth_state=${encodeURIComponent(`${generatedState}:/`)}` },
    });
    assert(mismatchedRes.status === 403, 'Callback state 與 Cookie 不符回傳 403 (防範 CSRF)');

    // A4: Callback 缺少 oauth_state Cookie 阻絕 (400)
    const noCookieRes = await fetch(`${base}/auth/callback?code=fake_code&state=${generatedState}`);
    assert(noCookieRes.status === 400, 'Callback 遺失 Cookie 回傳 400');

    // ----------------------------------------------------
    // 群組 B: Opaque Session 與生命週期
    // ----------------------------------------------------
    console.log('\n▶ [群組 B: Opaque Session 與生命週期]');

    // 模擬已建立的 Session：
    // Token 在客戶端 Cookie 為 rawToken，D1 中儲存 sha256(rawToken)
    const rawStudentToken = `session_token_${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const hashedStudentId = sha256(rawStudentToken);
    const now = new Date().toISOString();
    const futureExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    mockD1.sessions.set(hashedStudentId, {
      session_id: hashedStudentId,
      github_id: '10001',
      username: 'studentA',
      display_name: '學生A',
      avatar_url: 'https://avatars.githubusercontent.com/u/10001',
      created_at: now,
      expires_at: futureExpires,
    });

    // B1: 帶入有效 session Cookie 查詢 /api/auth/me
    const meRes = await fetch(`${base}/auth/me`, {
      headers: { Cookie: `app_session=${rawStudentToken}` },
    });
    assert(meRes.status === 200, 'GET /api/auth/me 回傳 200 OK');
    const meData = await meRes.json();
    assert(meData.authenticated === true, '認證狀態為 true');
    assert(meData.user?.username === 'studentA', '解析出正確 username: studentA');
    assert(meData.user?.github_id === '10001', '解析出正確 github_id: 10001');
    assert(meData.user?.display_name === '學生A', '解析出正確 display_name: 學生A');

    // B2: 未知 session token 查詢 /api/auth/me
    const unknownRes = await fetch(`${base}/auth/me`, {
      headers: { Cookie: 'app_session=unknown_nonexistent_token' },
    });
    const unknownData = await unknownRes.json();
    assert(unknownData.authenticated === false, '未知 Session 回傳 authenticated: false');
    assert(unknownData.user === null, '未知 Session 之 user 為 null');

    // B3: 過期 session 驗證 (過期自動判定無效並自 D1 移除)
    const expiredRawToken = `expired_token_${crypto.randomUUID()}`;
    const expiredHashedId = sha256(expiredRawToken);
    const pastExpires = new Date(Date.now() - 3600000).toISOString(); // 1 小時前過期

    mockD1.sessions.set(expiredHashedId, {
      session_id: expiredHashedId,
      github_id: '10002',
      username: 'expiredStudent',
      display_name: '過期學生',
      avatar_url: null,
      created_at: pastExpires,
      expires_at: pastExpires,
    });

    const expiredRes = await fetch(`${base}/auth/me`, {
      headers: { Cookie: `app_session=${expiredRawToken}` },
    });
    const expiredData = await expiredRes.json();
    assert(expiredData.authenticated === false, '過期 Session 回傳 authenticated: false');
    assert(!mockD1.sessions.has(expiredHashedId), '過期 Session 遭到自動清理自 D1');

    // B4: 登出 /api/auth/logout (D1 移除並清除 Cookie)
    const logoutRes = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `app_session=${rawStudentToken}` },
    });
    assert(logoutRes.status === 200, 'POST /api/auth/logout 回傳 200 OK');
    const logoutCookie = logoutRes.headers.get('set-cookie') || '';
    assert(logoutCookie.includes('app_session=;') || logoutCookie.includes('Max-Age=0'), '登出清除 app_session Cookie (Max-Age=0)');
    assert(!mockD1.sessions.has(hashedStudentId), '登出後 D1 中對應 session 實體刪除');

    // B5: 登出後再次查詢 /api/auth/me 應為未認證
    const afterLogoutMe = await fetch(`${base}/auth/me`, {
      headers: { Cookie: `app_session=${rawStudentToken}` },
    });
    const afterLogoutData = await afterLogoutMe.json();
    assert(afterLogoutData.authenticated === false, '登出後再次查詢回傳 authenticated: false');

    // ----------------------------------------------------
    // 群組 C: Activity Log 雙軌鑑權與伺服器端身分防偽 (Anti-Spoofing)
    // ----------------------------------------------------
    console.log('\n▶ [群組 C: 伺服器端身分防偽 (Anti-Spoofing)]');

    // 重新為 studentA 頒發有效 Session
    const activeStudentRawToken = `active_token_${crypto.randomUUID()}`;
    const activeStudentHashedId = sha256(activeStudentRawToken);
    mockD1.sessions.set(activeStudentHashedId, {
      session_id: activeStudentHashedId,
      github_id: '10001',
      username: 'studentA',
      display_name: '學生A',
      avatar_url: 'https://avatars.githubusercontent.com/u/10001',
      created_at: now,
      expires_at: futureExpires,
    });

    // C1: 前端試圖冒充 studentB (傳入偽造之 actor_id, actor_name, requested_by)
    const spoofAttemptRes = await fetch(`${base}/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `app_session=${activeStudentRawToken}`, // 實體身分為 studentA
      },
      body: JSON.stringify({
        repo_name: 'Lorin1470/electronics-lab-01',
        experiment_id: 'lab-01',
        action: 'request_proposal',
        actor_type: 'user',
        actor_id: 'studentB',          // 企圖偽造他人帳號
        actor_name: '惡意冒充者',       // 企圖偽造姓名
        requested_by: 'studentB',      // 企圖偽造發起人
        summary: '測試前端冒充他人身分寫入 Activity Log',
      }),
    });

    assert(spoofAttemptRes.status === 201, 'Web Session 成功發起 Activity Log 寫入 (201 Created)');
    const spoofResData = await spoofAttemptRes.json();
    assert(!!spoofResData.id, '回傳有效日誌 UUID');

    // 檢驗 D1 實體落盤紀錄：必須被伺服器強制覆蓋為 studentA
    const writtenLog = mockD1.activityLogs.find((l) => l.id === spoofResData.id);
    assert(!!writtenLog, '日誌實體存在於資料庫');
    assert(writtenLog?.actor_type === 'web', 'actor_type 自動校正為 web');
    assert(writtenLog?.actor_id === 'studentA', 'actor_id 被伺服器端強制鎖定為 studentA (防偽成功)');
    assert(writtenLog?.actor_name === '學生A', 'actor_name 被伺服器端強制鎖定為學生A (防偽成功)');
    assert(writtenLog?.requested_by === 'studentA', 'requested_by 被伺服器端強制覆蓋為 studentA (防偽成功)');
    assert(writtenLog?.actor_avatar === 'https://avatars.githubusercontent.com/u/10001', 'actor_avatar 由 session 自動帶入');

    // C2: 無 Bearer Token 且無 Session Cookie 的寫入請求 (401)
    const unauthorizedRes = await fetch(`${base}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_name: 'Lorin1470/electronics-lab-01',
        action: 'request_proposal',
        actor_type: 'user',
        actor_id: 'anonymous',
        actor_name: '匿名者',
        summary: '無認證寫入測試',
      }),
    });
    assert(unauthorizedRes.status === 401, '無 Token 且無 Session 之寫入遭阻斷 (401 Unauthorized)');

    // ----------------------------------------------------
    // 群組 D: CLI Bearer Token 既有相容性
    // ----------------------------------------------------
    console.log('\n▶ [群組 D: CLI Bearer Token 相容性]');

    // D1: CLI 使用 Bearer Token 依舊允許自訂 Agent 屬性
    const bearerCliRes = await fetch(`${base}/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: 'Lorin1470/electronics-lab-01',
        experiment_id: 'lab-01',
        action: 'request_proposal',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        requested_by: 'studentA',
        summary: 'Agent 輔助分析提案',
      }),
    });
    assert(bearerCliRes.status === 201, 'CLI Bearer Token 寫入維持相容 (201 Created)');
    const bearerLog = mockD1.activityLogs.find((l) => l.actor_id === 'agent:antigravity');
    assert(bearerLog?.actor_type === 'agent', 'CLI 模式保留自定義 agent actor_type');
    assert(bearerLog?.actor_id === 'agent:antigravity', 'CLI 模式保留 agent:antigravity');
  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`📊 測試總結：通過 ${passed} 項，失敗 ${failed} 項`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run();
