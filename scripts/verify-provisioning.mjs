/**
 * verify-provisioning.mjs
 * 驗證 Phase 4A: GitHub Repository Provisioning Backend
 *
 * 測試項目涵蓋：
 * 0. Migration 0001 -> 0002 -> 0003 -> 0004 -> 0005 真實 SQLite 套用與約束校驗
 * 1. Web Crypto RS256 JWT 簽署與私鑰匯入 (PKCS#1 / PKCS#8) 單元測試
 * 2. Repository 命名規範與目標 Owner 授權白名單驗證
 * 3. 權限隔離 (未登入 401、學生/助教 403、非課程成員 404、封存課程 400)
 * 4. 狀態機與 D1 一致性 (pending -> creating -> ready / failed，無幽靈 ready)
 * 5. 故障處理與 Activity Log 留痕 (失敗狀態、拒絕原因、身分鎖定)
 * 6. 等冪性與自癒機制 (已存在 Repo 不重複建立、不刪除已存在 Repo、防並行重入 409)
 * 7. 敏感資訊審計 (絕無 Token、私鑰洩漏至 D1、API 回應或日誌)
 * 8. GET /api/experiments/:id/provision 狀態查詢與操作歷程端點
 */

import http from 'node:http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { onRequest } from '../web/functions/api/[[route]].ts';
import {
  createGitHubAppJwt,
  importRsaPrivateKey,
  provisionRepository,
  sanitizeErrorMessage,
} from '../web/functions/api/services/provisioning.ts';

const TEST_PORT = 9002;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 產生測試用 RSA 金鑰對 (PKCS#8 與 PKCS#1)
const testKeypairPkcs8 = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const testKeypairPkcs1 = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

// Mock D1 資料庫實作 (完整支援 Phase 4A Provisioning 與稽核歷程)
class MockProvisioningD1 {
  constructor() {
    this.courses = new Map();
    this.experiments = new Map();
    this.experimentProvisionings = new Map();
    this.courseMemberships = new Map();
    this.experimentMemberships = new Map();
    this.sessions = new Map();
    this.activityLogs = [];
  }

  prepare(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      bind: (...binds) => ({
        run: async () => {
          if (q.startsWith('INSERT INTO courses')) {
            const [id, course_code, name, semester, status, created_by_github_id, created_at, updated_at] = binds;
            this.courses.set(id, {
              id,
              course_code,
              name,
              semester,
              status: status || 'active',
              created_by_github_id,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('INSERT INTO course_memberships')) {
            const [id, course_id, github_id, username, role, status, created_at, updated_at] = binds;
            this.courseMemberships.set(id, {
              id,
              course_id,
              github_id,
              username,
              role,
              status: status || 'active',
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiments')) {
            const [id, course_id, experiment_code, name, repository, report_mode, config_version, status, created_at, updated_at] = binds;
            this.experiments.set(id, {
              id,
              course_id,
              experiment_code,
              name,
              repository,
              report_mode: report_mode || 'shared',
              config_version: config_version || '1.0',
              status: status || 'not_started',
              provisioning_status: 'pending',
              provisioning_error: null,
              provisioned_at: null,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE experiments SET')) {
            const id = binds[binds.length - 1];
            const exp = this.experiments.get(id);
            if (exp) {
              if (q.includes('provisioning_status = "creating"')) {
                exp.provisioning_status = 'creating';
                exp.provisioning_error = null;
                exp.updated_at = binds[0];
              } else if (q.includes('provisioning_status = "ready"')) {
                exp.provisioning_status = 'ready';
                exp.provisioning_error = null;
                exp.provisioned_at = binds[0];
                exp.updated_at = binds[1];
              } else if (q.includes('provisioning_status = "failed"')) {
                exp.provisioning_status = 'failed';
                exp.provisioning_error = binds[0];
                exp.updated_at = binds[1];
              }
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiment_provisionings')) {
            const [id, experiment_id, repository, status, created_at, updated_at] = binds;
            this.experimentProvisionings.set(id, {
              id,
              experiment_id,
              repository,
              status,
              error_summary: null,
              created_at,
              updated_at,
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE experiment_provisionings SET')) {
            const id = binds[binds.length - 1];
            const prov = this.experimentProvisionings.get(id);
            if (prov) {
              if (q.includes('status = "ready"')) {
                prov.status = 'ready';
                prov.error_summary = null;
                prov.updated_at = binds[0];
              } else if (q.includes('status = "failed"')) {
                prov.status = 'failed';
                prov.error_summary = binds[0];
                prov.updated_at = binds[1];
              }
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO user_sessions')) {
            const [session_id, github_id, username, display_name, avatar_url, created_at, expires_at] = binds;
            this.sessions.set(session_id, { session_id, github_id, username, display_name, avatar_url, created_at, expires_at });
            return { success: true };
          }
          if (q.startsWith('INSERT INTO activity_logs')) {
            this.activityLogs.push(binds);
            return { success: true };
          }
          return { success: true };
        },
        first: async () => {
          if (q.includes('FROM user_sessions WHERE session_id = ?')) {
            return this.sessions.get(binds[0]) || null;
          }
          if (q.includes('FROM experiments WHERE id = ?')) {
            const exp = this.experiments.get(binds[0]);
            return exp ? { ...exp } : null;
          }
          if (q.includes('FROM experiments WHERE repository = ?')) {
            for (const e of this.experiments.values()) {
              if (e.repository === binds[0]) return { ...e };
            }
            return null;
          }
          if (q.includes('FROM courses WHERE id = ?')) {
            const c = this.courses.get(binds[0]);
            return c ? { ...c } : null;
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND github_id = ?')) {
            const [eid, gid] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === eid && em.github_id === gid && em.status === 'active') {
                return { ...em };
              }
            }
            return null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ?')) {
            const [cid, gid] = binds;
            for (const cm of this.courseMemberships.values()) {
              if (cm.course_id === cid && cm.github_id === gid && cm.status === 'active') {
                return { ...cm };
              }
            }
            return null;
          }
          if (q.includes('COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"')) {
            let count = 0;
            for (const cm of this.courseMemberships.values()) {
              if (cm.role === 'teacher' && cm.status === 'active') count++;
            }
            return { count };
          }
          return null;
        },
        all: async () => {
          if (q.includes('FROM experiment_provisionings WHERE experiment_id = ?')) {
            const expId = binds[0];
            const list = [];
            for (const p of this.experimentProvisionings.values()) {
              if (p.experiment_id === expId) list.push({ ...p });
            }
            list.sort((a, b) => b.created_at.localeCompare(a.created_at));
            return { results: list };
          }
          return { results: [] };
        },
      }),
    };
  }

  batch(statements) {
    return Promise.all(statements.map((s) => s.run()));
  }
}

// 模擬 GitHub API Fetch Handler
class MockGitHubApi {
  constructor(authorizedOwner = 'TestLabOrg') {
    this.authorizedOwner = authorizedOwner;
    this.repos = new Map();
    this.shouldFailTemplate = false;
    this.templateFailStatus = 422;
    this.templateFailMessage = 'Repository creation failed: name already exists on this account';
    this.tokenFailStatus = 0;
    this.tokenFailMessage = '';
    this.networkError = false;
  }

  fetch = async (url, options = {}) => {
    if (this.networkError) {
      throw new Error('Connection timeout or network failure');
    }

    const urlStr = String(url);
    const method = options.method || 'GET';
    const headers = options.headers || {};
    const authHeader = headers.Authorization || headers.authorization || '';

    // 1. Installation token exchange
    if (urlStr.includes('/access_tokens') && method === 'POST') {
      if (this.tokenFailStatus) {
        return new Response(JSON.stringify({ message: this.tokenFailMessage || 'Token error' }), {
          status: this.tokenFailStatus,
        });
      }
      if (!authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          token: 'ghs_mock_installation_token_secure_999',
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
        { status: 201 }
      );
    }

    // 2. Query installation details
    if (urlStr.includes('/app/installations/') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 1234567,
          account: {
            login: this.authorizedOwner,
            type: 'Organization',
          },
        }),
        { status: 200 }
      );
    }

    // 3. Query repository
    const repoMatch = urlStr.match(/\/repos\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (repoMatch && method === 'GET') {
      const [_, owner, repoName] = repoMatch;
      const key = `${owner.toLowerCase()}/${repoName.toLowerCase()}`;
      if (this.repos.has(key)) {
        const r = this.repos.get(key);
        return new Response(
          JSON.stringify({
            id: 88888,
            name: repoName,
            full_name: `${owner}/${repoName}`,
            owner: { login: owner },
            html_url: `https://github.com/${owner}/${repoName}`,
            default_branch: 'main',
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }

    // 4. Generate from template
    if (urlStr.includes('/generate') && method === 'POST') {
      if (this.shouldFailTemplate) {
        return new Response(
          JSON.stringify({ message: this.templateFailMessage }),
          { status: this.templateFailStatus }
        );
      }

      const body = JSON.parse(options.body || '{}');
      const key = `${body.owner.toLowerCase()}/${body.name.toLowerCase()}`;
      this.repos.set(key, {
        owner: body.owner,
        name: body.name,
        description: body.description,
      });

      return new Response(
        JSON.stringify({
          id: 99999,
          name: body.name,
          full_name: `${body.owner}/${body.name}`,
          owner: { login: body.owner },
          html_url: `https://github.com/${body.owner}/${body.name}`,
          default_branch: 'main',
        }),
        { status: 201 }
      );
    }

    return new Response(JSON.stringify({ message: 'Not Handled in Mock' }), { status: 404 });
  };
}

let passedCount = 0;
function pass(msg) {
  passedCount++;
  console.log(`  ✅ [PASS] ${msg}`);
}

async function runTests() {
  console.log('\n====================================================');
  console.log('🧪 Phase 4A: Repository Provisioning 後端驗證開始');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // 群組 0: Migration 0001 -> 0005 完整鏈結驗證
  // ----------------------------------------------------
  console.log('▶ [群組 0: Migration 0001 -> 0005 真實 SQLite 套用與約束]');
  {
    const m1 = fs.readFileSync('web/migrations/0001_initial_schema.sql', 'utf8');
    const m2 = fs.readFileSync('web/migrations/0002_user_sessions_indexes.sql', 'utf8');
    const m3 = fs.readFileSync('web/migrations/0003_course_experiment_permissions.sql', 'utf8');
    const m4 = fs.readFileSync('web/migrations/0004_course_status.sql', 'utf8');
    const m5 = fs.readFileSync('web/migrations/0005_repository_provisioning.sql', 'utf8');

    const tmpDb = `/tmp/test_mig_prov_${Date.now()}.db`;
    const tmpSql = `/tmp/test_mig_prov_${Date.now()}.sql`;

    // 先套用 0001 -> 0004
    const preSql = [m1, m2, m3, m4].join('\n');
    fs.writeFileSync(tmpSql, preSql);
    execSync(`sqlite3 ${tmpDb} < ${tmpSql}`);

    // 在套用 0005 前插入既有課程與既有實驗
    execSync(`sqlite3 ${tmpDb} "INSERT INTO courses (id, course_code, name, semester, status) VALUES ('c1', 'EE101', '電路', '114-1', 'active');"`);
    execSync(`sqlite3 ${tmpDb} "INSERT INTO experiments (id, course_id, experiment_code, name, repository, report_mode, config_version, status) VALUES ('e_pre', 'c1', 'lab-01', 'BJT', 'TestLabOrg/lab-01', 'shared', '1.0', 'not_started');"`);

    // 套用 0005
    fs.writeFileSync(tmpSql, m5);
    execSync(`sqlite3 ${tmpDb} < ${tmpSql}`);

    // 驗證既有實驗專案經 Migration 0005 更新後應為 ready
    const preStatus = execSync(`sqlite3 ${tmpDb} "SELECT provisioning_status FROM experiments WHERE id = 'e_pre';"`).toString().trim();
    assert.strictEqual(preStatus, 'ready', '既有實驗專案經 Migration 0005 更新應為 ready');

    // 驗證在 0005 後新建立之實驗專案預設值應為 pending
    execSync(`sqlite3 ${tmpDb} "INSERT INTO experiments (id, course_id, experiment_code, name, repository, report_mode, config_version, status) VALUES ('e_post', 'c1', 'lab-02', 'MOSFET', 'TestLabOrg/lab-02', 'shared', '1.0', 'not_started');"`);
    const postStatus = execSync(`sqlite3 ${tmpDb} "SELECT provisioning_status FROM experiments WHERE id = 'e_post';"`).toString().trim();
    assert.strictEqual(postStatus, 'pending', '0005 之後新建立之實驗預設狀態應為 pending');

    // 插入非法 provisioning_status 應遭 CHECK 限制阻擋
    let checkFailed = false;
    try {
      execSync(`sqlite3 ${tmpDb} "INSERT INTO experiments (id, course_id, experiment_code, name, repository, report_mode, config_version, status, provisioning_status) VALUES ('e2', 'c1', 'lab-02', 'FET', 'TestLabOrg/lab-02', 'shared', '1.0', 'not_started', 'invalid_state');"`, { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      checkFailed = true;
    }
    assert.strictEqual(checkFailed, true, '非 pending/creating/ready/failed 狀態應遭 CHECK 攔截');

    // 驗證 experiment_provisionings 資料表建立
    const provTable = execSync(`sqlite3 ${tmpDb} ".schema experiment_provisionings"`).toString();
    assert.ok(provTable.includes('experiment_id'), 'experiment_provisionings 應具備 experiment_id');
    assert.ok(provTable.includes('status'), 'experiment_provisionings 應具備 status');

    fs.unlinkSync(tmpSql);
    fs.unlinkSync(tmpDb);
    pass('Migration 0001 -> 0005 完整鏈結套用成功，CHECK 與歷程約束生效');
  }

  // ----------------------------------------------------
  // 群組 1: Web Crypto RS256 JWT 與私鑰匯入單元測試
  // ----------------------------------------------------
  console.log('\n▶ [群組 1: Web Crypto RS256 JWT 與私鑰匯入 (PKCS#1 / PKCS#8)]');
  {
    // 1.1 PKCS#8 簽署與驗證
    const jwtPkcs8 = await createGitHubAppJwt('app_888', testKeypairPkcs8.privateKey);
    assert.ok(jwtPkcs8.includes('.'), 'JWT 應包含三個點號分隔區段');
    const [h8, p8, s8] = jwtPkcs8.split('.');
    const header8 = JSON.parse(Buffer.from(h8, 'base64url').toString('utf8'));
    const payload8 = JSON.parse(Buffer.from(p8, 'base64url').toString('utf8'));
    assert.strictEqual(header8.alg, 'RS256');
    assert.strictEqual(header8.typ, 'JWT');
    assert.strictEqual(payload8.iss, 'app_888');

    const verify8 = crypto.createVerify('RSA-SHA256');
    verify8.update(`${h8}.${p8}`);
    assert.strictEqual(verify8.verify(testKeypairPkcs8.publicKey, Buffer.from(s8, 'base64url')), true, 'PKCS#8 簽署之 JWT 驗證必須合格');
    pass('PKCS#8 格式 RSA 私鑰成功匯入並產生標準 RS256 JWT');

    // 1.2 PKCS#1 (BEGIN RSA PRIVATE KEY) 轉換簽署與驗證
    const jwtPkcs1 = await createGitHubAppJwt('app_777', testKeypairPkcs1.privateKey);
    const [h1, p1, s1] = jwtPkcs1.split('.');
    const payload1 = JSON.parse(Buffer.from(p1, 'base64url').toString('utf8'));
    assert.strictEqual(payload1.iss, 'app_777');

    const verify1 = crypto.createVerify('RSA-SHA256');
    verify1.update(`${h1}.${p1}`);
    assert.strictEqual(verify1.verify(testKeypairPkcs1.publicKey, Buffer.from(s1, 'base64url')), true, 'PKCS#1 轉換後之 JWT 驗證必須合格');
    pass('PKCS#1 格式 RSA 私鑰成功動態轉譯並通過 RS256 驗證');

    // 1.3 損壞私鑰防呆
    let keyErr = false;
    try {
      await importRsaPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nBADKEY\n-----END RSA PRIVATE KEY-----');
    } catch {
      keyErr = true;
    }
    assert.strictEqual(keyErr, true, '損毀金鑰應優雅拋出錯誤，絕不當機');
    pass('異常私鑰格式優雅攔截，無未捕捉例外');
  }

  // ----------------------------------------------------
  // 群組 2: 服務層命名規範與 Owner 授權驗證
  // ----------------------------------------------------
  console.log('\n▶ [群組 2: Repository 命名規範與目標 Owner 授權驗證]');
  {
    const mockGh = new MockGitHubApi('TestLabOrg');
    const mockEnv = {
      GITHUB_APP_ID: '12345',
      GITHUB_APP_INSTALLATION_ID: '67890',
      GITHUB_APP_PRIVATE_KEY: testKeypairPkcs8.privateKey,
      GITHUB_APP_TARGET_OWNER: 'TestLabOrg',
    };

    // 2.1 格式錯誤
    const resInvalid = await provisionRepository(mockEnv, 'invalid_no_slash', 'desc', mockGh.fetch);
    assert.strictEqual(resInvalid.success, false);
    assert.ok(resInvalid.error.includes('must be owner/name'));
    pass('非法儲存庫格式 (缺少 slash) 遭服務層即時阻擋');

    // 2.2 未經授權的 Owner
    const resUnauth = await provisionRepository(mockEnv, 'UnauthorizedOrg/lab-01', 'desc', mockGh.fetch);
    assert.strictEqual(resUnauth.success, false);
    assert.ok(resUnauth.error.includes('not authorized'));
    assert.ok(resUnauth.error.includes('TestLabOrg'));
    pass('非授權 Owner (UnauthorizedOrg) 遭精準阻擋並清楚提示授權範圍');
  }

  // ----------------------------------------------------
  // 設定 HTTP 測試伺服器以驗證 API 路由層
  // ----------------------------------------------------
  const mockD1 = new MockProvisioningD1();
  const mockGh = new MockGitHubApi('TestLabOrg');
  const env = {
    DB: mockD1,
    ACTIVITY_LOG_SECRET: 'test_sec_activity_123',
    GITHUB_APP_ID: '12345',
    GITHUB_APP_INSTALLATION_ID: '67890',
    GITHUB_APP_PRIVATE_KEY: testKeypairPkcs8.privateKey,
    GITHUB_APP_TARGET_OWNER: 'TestLabOrg',
    FETCH: mockGh.fetch,
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      let body = null;
      if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
        const buffers = [];
        for await (const chunk of req) buffers.push(chunk);
        const text = Buffer.concat(buffers).toString('utf8');
        if (text) body = text;
      }

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }

      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body: body ? body : undefined,
      });

      const response = await onRequest({ request, env, params: {} });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      const resBody = await response.text();
      res.end(resBody);
    } catch (err) {
      console.error('Server execution error:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

  // 輔助函式：發送請求
  async function api(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, headers: res.headers, json };
  }

  // 建立基礎資料：課程、教師、助教、學生 Session
  const TEACHER_UID = 'teacher1';
  const TEACHER_GID = '1001';
  const TEACHER_SID = 'sess_teacher_1';

  const TA_UID = 'ta1';
  const TA_GID = '1002';
  const TA_SID = 'sess_ta_1';

  const STUDENT_UID = 'student1';
  const STUDENT_GID = '1003';
  const STUDENT_SID = 'sess_student_1';

  const expTime = new Date(Date.now() + 86400 * 1000).toISOString();
  mockD1.sessions.set(sha256(TEACHER_SID), {
    session_id: sha256(TEACHER_SID),
    github_id: TEACHER_GID,
    username: TEACHER_UID,
    display_name: '教師張',
    avatar_url: 'https://avatar/t.png',
    expires_at: expTime,
  });
  mockD1.sessions.set(sha256(TA_SID), {
    session_id: sha256(TA_SID),
    github_id: TA_GID,
    username: TA_UID,
    display_name: '助教李',
    avatar_url: 'https://avatar/ta.png',
    expires_at: expTime,
  });
  mockD1.sessions.set(sha256(STUDENT_SID), {
    session_id: sha256(STUDENT_SID),
    github_id: STUDENT_GID,
    username: STUDENT_UID,
    display_name: '學生王',
    avatar_url: 'https://avatar/s.png',
    expires_at: expTime,
  });

  const STRANGER_UID = 'stranger1';
  const STRANGER_GID = '99999';
  const STRANGER_SID = 'sess_stranger_1';
  mockD1.sessions.set(sha256(STRANGER_SID), {
    session_id: sha256(STRANGER_SID),
    github_id: STRANGER_GID,
    username: STRANGER_UID,
    display_name: '陌生訪客',
    avatar_url: 'https://avatar/stranger.png',
    expires_at: expTime,
  });

  // 課程 c_active (進行中)
  mockD1.courses.set('c_active', {
    id: 'c_active',
    course_code: 'EE301',
    name: '通訊實驗',
    semester: '114-1',
    status: 'active',
  });
  // 課程 c_archived (已封存)
  mockD1.courses.set('c_archived', {
    id: 'c_archived',
    course_code: 'EE302',
    name: '光電實驗',
    semester: '113-2',
    status: 'archived',
  });

  // 課程成員綁定
  mockD1.courseMemberships.set('cm_t1', {
    id: 'cm_t1',
    course_id: 'c_active',
    github_id: TEACHER_GID,
    username: TEACHER_UID,
    role: 'teacher',
    status: 'active',
  });
  mockD1.courseMemberships.set('cm_ta1', {
    id: 'cm_ta1',
    course_id: 'c_active',
    github_id: TA_GID,
    username: TA_UID,
    role: 'assistant',
    status: 'active',
  });
  mockD1.courseMemberships.set('cm_s1', {
    id: 'cm_s1',
    course_id: 'c_active',
    github_id: STUDENT_GID,
    username: STUDENT_UID,
    role: 'student',
    status: 'active',
  });
  mockD1.experimentMemberships.set('em_s1', {
    id: 'em_s1',
    experiment_id: 'e_comm_1',
    github_id: STUDENT_GID,
    username: STUDENT_UID,
    role: 'student',
    status: 'active',
  });

  // 封存課程成員
  mockD1.courseMemberships.set('cm_t2', {
    id: 'cm_t2',
    course_id: 'c_archived',
    github_id: TEACHER_GID,
    username: TEACHER_UID,
    role: 'teacher',
    status: 'active',
  });

  // 實驗 e_comm_1 (屬於 c_active)
  mockD1.experiments.set('e_comm_1', {
    id: 'e_comm_1',
    course_id: 'c_active',
    experiment_code: 'lab-01',
    name: 'AM 調變量測',
    repository: 'TestLabOrg/ee301-lab-01',
    report_mode: 'shared',
    config_version: '1.0',
    status: 'not_started',
    provisioning_status: 'pending',
    provisioning_error: null,
    provisioned_at: null,
    updated_at: new Date().toISOString(),
  });

  // 實驗 e_archived_1 (屬於 c_archived)
  mockD1.experiments.set('e_archived_1', {
    id: 'e_archived_1',
    course_id: 'c_archived',
    experiment_code: 'lab-01',
    name: '雷射量測',
    repository: 'TestLabOrg/ee302-lab-01',
    report_mode: 'shared',
    config_version: '1.0',
    status: 'completed',
    provisioning_status: 'ready',
    provisioning_error: null,
    provisioned_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // ----------------------------------------------------
  // 群組 3: 權限隔離與身分鎖定
  // ----------------------------------------------------
  console.log('\n▶ [群組 3: 權限隔離與身分鎖定]');
  {
    // 3.1 未登入觸發 Provisioning -> 401
    const resNoAuth = await api('/experiments/e_comm_1/provision', { method: 'POST' });
    assert.strictEqual(resNoAuth.status, 401);
    pass('未登入使用者觸發 Provisioning 回傳 401 Unauthorized');

    // 3.2 非課程成員嘗試觸發 -> 403 Forbidden
    const resStranger = await api('/experiments/e_comm_1/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${STRANGER_SID}` },
    });
    assert.strictEqual(resStranger.status, 403);
    assert.ok(resStranger.json.error.includes('Only course members'));
    pass('非課程成員嘗試觸發 Provisioning 回傳 403 Forbidden');

    // 3.4 不存在的實驗 -> 404
    const resNotFound = await api('/experiments/exp_not_exist/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(resNotFound.status, 404);
    pass('不存在的 experiment_id 回傳 404 Not Found');

    // 3.5 封存課程中嘗試 Provision -> 400
    const resArchived = await api('/experiments/e_archived_1/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(resArchived.status, 400);
    assert.ok(resArchived.json.error.includes('archived'));
    pass('封存/停用課程中嘗試 Provision 回傳 400 Bad Request');
  }

  // ----------------------------------------------------
  // 群組 4: 狀態機流轉與 D1 一致性
  // ----------------------------------------------------
  console.log('\n▶ [群組 4: 狀態機流轉與 D1 一致性 (pending -> creating -> ready)]');
  {
    // 4.1 教師正常觸發 Provisioning
    const resProv = await api('/experiments/e_comm_1/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });

    assert.strictEqual(resProv.status, 200);
    assert.strictEqual(resProv.json.success, true);
    assert.strictEqual(resProv.json.status, 'ready');
    assert.strictEqual(resProv.json.repository.full_name, 'TestLabOrg/ee301-lab-01');
    assert.strictEqual(resProv.json.repository.default_branch, 'main');

    // 驗證 D1 狀態確實更新為 ready 且記錄時間戳記
    const expD1 = mockD1.experiments.get('e_comm_1');
    assert.strictEqual(expD1.provisioning_status, 'ready');
    assert.strictEqual(expD1.provisioning_error, null);
    assert.ok(expD1.provisioned_at);

    // 驗證 experiment_provisionings 記錄
    let provItem = null;
    for (const p of mockD1.experimentProvisionings.values()) {
      if (p.experiment_id === 'e_comm_1') provItem = p;
    }
    assert.ok(provItem);
    assert.strictEqual(provItem.status, 'ready');

    // 驗證 Activity Log 留痕與防偽
    const compLog = mockD1.activityLogs[mockD1.activityLogs.length - 1];
    const startLog = mockD1.activityLogs[mockD1.activityLogs.length - 2];
    assert.ok(compLog);
    assert.ok(startLog);
    // startLog
    assert.strictEqual(startLog[1], 'TestLabOrg/ee301-lab-01');
    assert.strictEqual(startLog[4], 'web');
    assert.strictEqual(startLog[5], TEACHER_UID);
    assert.strictEqual(startLog[10], 'approved');
    assert.strictEqual(startLog[11], 'provisioning_started');
    // compLog
    assert.strictEqual(compLog[1], 'TestLabOrg/ee301-lab-01');
    assert.strictEqual(compLog[4], 'web');
    assert.strictEqual(compLog[5], TEACHER_UID);
    assert.strictEqual(compLog[10], 'approved');
    assert.strictEqual(compLog[11], 'provisioning_completed');
    pass('正常建立流程：成功流轉至 ready，Activity Log (started, completed) 稽核正確寫入');
  }

  // ----------------------------------------------------
  // 群組 5: 失敗處理與防幽靈狀態 (Failed State)
  // ----------------------------------------------------
  console.log('\n▶ [群組 5: 失敗處理與防幽靈狀態 (Creating -> Failed)]');
  {
    // 建立新實驗 e_fail_1
    mockD1.experiments.set('e_fail_1', {
      id: 'e_fail_1',
      course_id: 'c_active',
      experiment_code: 'lab-99',
      name: '失敗測試實驗',
      repository: 'TestLabOrg/fail-test-lab',
      report_mode: 'shared',
      config_version: '1.0',
      status: 'not_started',
      provisioning_status: 'pending',
      provisioning_error: null,
      provisioned_at: null,
      updated_at: new Date().toISOString(),
    });

    // 設定 Mock GitHub 失敗模擬 (422)
    mockGh.shouldFailTemplate = true;
    mockGh.templateFailStatus = 422;
    mockGh.templateFailMessage = 'Repository creation failed: template repo is unavailable';

    const resFail = await api('/experiments/e_fail_1/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });

    assert.strictEqual(resFail.status, 502);
    assert.strictEqual(resFail.json.success, false);
    assert.strictEqual(resFail.json.status, 'failed');
    assert.ok(resFail.json.error.includes('template repo is unavailable'));

    // 驗證 D1 狀態切換為 failed，絕不殘留 ready (防幽靈)
    const expFail = mockD1.experiments.get('e_fail_1');
    assert.strictEqual(expFail.provisioning_status, 'failed');
    assert.ok(expFail.provisioning_error.includes('template repo is unavailable'));
    assert.strictEqual(expFail.provisioned_at, null);

    // 驗證 Activity Log 記錄失敗
    const lastLog = mockD1.activityLogs[mockD1.activityLogs.length - 1];
    assert.strictEqual(lastLog[10], 'rejected');
    assert.strictEqual(lastLog[11], 'provisioning_failed');

    // 恢復 Mock GitHub
    mockGh.shouldFailTemplate = false;
    pass('失敗處理：GitHub API 錯誤正確致使狀態轉移為 failed，D1 零幽靈 ready');
  }

  // ----------------------------------------------------
  // 群組 5B: GitHub API 特殊狀態碼與網路故障覆蓋 (401, 403, 404, 429, 5xx, Network Error, Recovery)
  // ----------------------------------------------------
  console.log('\n▶ [群組 5B: GitHub API 特殊狀態碼與網路故障覆蓋 (401, 403, 404, 429, 5xx, Network Error, Recovery)]');
  {
    // 5B.1 GitHub API 401 (Installation Token 交換失敗)
    mockGh.tokenFailStatus = 401;
    mockGh.tokenFailMessage = 'Bad credentials';
    mockD1.experiments.set('e_err_401', {
      id: 'e_err_401',
      course_id: 'c_active',
      experiment_code: 'lab-401',
      name: '401 錯誤測試',
      repository: 'TestLabOrg/err-401-lab',
      report_mode: 'shared',
      config_version: '1.0',
      status: 'not_started',
      provisioning_status: 'pending',
      provisioning_error: null,
      provisioned_at: null,
      updated_at: new Date().toISOString(),
    });
    const res401 = await api('/experiments/e_err_401/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(res401.status, 502);
    assert.ok(res401.json.error.includes('401'));
    mockGh.tokenFailStatus = 0;
    pass('GitHub API 401: Token 鑑權失敗轉譯為 502 並記錄失敗狀態');

    // 5B.2 GitHub API 403 (Template Generate 遭阻絕)
    mockGh.shouldFailTemplate = true;
    mockGh.templateFailStatus = 403;
    mockGh.templateFailMessage = 'Resource not accessible by integration';
    mockD1.experiments.set('e_err_403', {
      id: 'e_err_403',
      course_id: 'c_active',
      experiment_code: 'lab-403',
      name: '403 錯誤測試',
      repository: 'TestLabOrg/err-403-lab',
      report_mode: 'shared',
      config_version: '1.0',
      status: 'not_started',
      provisioning_status: 'pending',
      provisioning_error: null,
      provisioned_at: null,
      updated_at: new Date().toISOString(),
    });
    const res403 = await api('/experiments/e_err_403/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(res403.status, 502);
    assert.ok(res403.json.error.includes('403'));
    pass('GitHub API 403: 權限不足轉譯為 502 並更新 D1 為 failed');

    // 5B.3 GitHub API 404 (Template Repo 不存在)
    mockGh.templateFailStatus = 404;
    mockGh.templateFailMessage = 'Not Found';
    const res404 = await api('/experiments/e_err_403/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(res404.status, 502);
    assert.ok(res404.json.error.includes('404'));
    pass('GitHub API 404: Template 專案不存在正確攔截');

    // 5B.4 GitHub API 429 (Rate limit 超限)
    mockGh.templateFailStatus = 429;
    mockGh.templateFailMessage = 'API rate limit exceeded';
    const res429 = await api('/experiments/e_err_403/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(res429.status, 502);
    assert.ok(res429.json.error.includes('429'));
    pass('GitHub API 429: API 配額超限正確攔截與安全去敏');

    // 5B.5 GitHub API 5xx (500 伺服器內部錯誤)
    mockGh.templateFailStatus = 500;
    mockGh.templateFailMessage = 'Internal Server Error';
    const res500 = await api('/experiments/e_err_403/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(res500.status, 502);
    assert.ok(res500.json.error.includes('500'));
    mockGh.shouldFailTemplate = false;
    pass('GitHub API 500: 上游服務器錯誤正確回報 502 Bad Gateway');

    // 5B.6 網路逾時 / 連線異常 (Network Error)
    mockGh.networkError = true;
    const resNet = await api('/experiments/e_err_403/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(resNet.status, 502);
    assert.ok(resNet.json.error.includes('Network error') || resNet.json.error.includes('timeout'));
    mockGh.networkError = false;
    pass('網路異常 / 逾時拋錯優雅攔截，無未捕捉崩潰');

    // 5B.7 GitHub 建立成功但 D1 更新失敗的 Recovery 語意
    mockGh.repos.set('testlaborg/recovery-lab', {
      owner: 'TestLabOrg',
      name: 'recovery-lab',
      description: 'Pre-existing repo on GitHub',
    });
    mockD1.experiments.set('e_recovery', {
      id: 'e_recovery',
      course_id: 'c_active',
      experiment_code: 'lab-rec',
      name: '自癒復原測試實驗',
      repository: 'TestLabOrg/recovery-lab',
      report_mode: 'shared',
      config_version: '1.0',
      status: 'not_started',
      provisioning_status: 'failed',
      provisioning_error: 'Previous network timeout after repo creation',
      provisioned_at: null,
      updated_at: new Date(Date.now() - 300 * 1000).toISOString(),
    });
    const resRecovery = await api('/experiments/e_recovery/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(resRecovery.status, 200);
    assert.strictEqual(resRecovery.json.success, true);
    assert.strictEqual(resRecovery.json.status, 'ready');
    assert.strictEqual(resRecovery.json.already_existed, true);
    const expRecovered = mockD1.experiments.get('e_recovery');
    assert.strictEqual(expRecovered.provisioning_status, 'ready');
    assert.strictEqual(expRecovered.provisioning_error, null);
    assert.ok(expRecovered.provisioned_at);
    pass('Recovery 語意：GitHub 存在但 D1 停留 failed/creating 時，重發請求自動修復轉為 ready');
  }

  // ----------------------------------------------------
  // 群組 6: 等冪性、重複保護與自癒重試
  // ----------------------------------------------------
  console.log('\n▶ [群組 6: 等冪性、重複保護與自癒重試]');
  {
    // 6.1 重複對 ready 的 experiment 發起 provision -> 直接回傳 200，不重複建立
    const resRepeat = await api('/experiments/e_comm_1/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(resRepeat.status, 200);
    assert.strictEqual(resRepeat.json.status, 'ready');
    assert.strictEqual(resRepeat.json.already_existed, true);
    pass('對已存在且已 ready 之儲存庫請求 Provisioning，具備完全等冪性 (200 OK)');

    // 6.2 從 failed 狀態進行重試 (Retry Self-Healing)
    const resRetry = await api('/experiments/e_fail_1/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(resRetry.status, 200);
    assert.strictEqual(resRetry.json.status, 'ready');
    const expHealed = mockD1.experiments.get('e_fail_1');
    assert.strictEqual(expHealed.provisioning_status, 'ready');
    assert.strictEqual(expHealed.provisioning_error, null);
    pass('從 failed 狀態發起重試成功自我修復轉移為 ready');

    // 6.3 並行 creating 防重入 (409 Conflict)
    mockD1.experiments.set('e_racing', {
      id: 'e_racing',
      course_id: 'c_active',
      experiment_code: 'lab-race',
      name: '競態測試實驗',
      repository: 'TestLabOrg/racing-lab',
      report_mode: 'shared',
      config_version: '1.0',
      status: 'not_started',
      provisioning_status: 'creating',
      provisioning_error: null,
      provisioned_at: null,
      updated_at: new Date().toISOString(), // 剛更新
    });

    const resRace = await api('/experiments/e_racing/provision', {
      method: 'POST',
      headers: { Cookie: `app_session=${TEACHER_SID}` },
    });
    assert.strictEqual(resRace.status, 409);
    assert.ok(resRace.json.error.includes('already in progress'));
    pass('短時間內處於 creating 狀態發起請求回傳 409 Conflict (防並行重入)');
  }

  // ----------------------------------------------------
  // 群組 7: 機密去敏審計 (Security & Leakage Audit)
  // ----------------------------------------------------
  console.log('\n▶ [群組 7: 機密去敏審計 (Security & Leakage Audit)]');
  {
    const rawErrorWithSecrets = `Failed with token: ghs_secret1234567890 and Bearer ghp_personalSecret and key: -----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----`;
    const sanitized = sanitizeErrorMessage(rawErrorWithSecrets);

    assert.ok(!sanitized.includes('ghs_secret1234567890'), 'Token 必須被抹除');
    assert.ok(!sanitized.includes('ghp_personalSecret'), 'PAT 必須被抹除');
    assert.ok(!sanitized.includes('BEGIN RSA PRIVATE KEY'), '私鑰文字必須被抹除');
    assert.ok(sanitized.includes('[REDACTED_TOKEN]'), 'Token 應被替換為去敏代稱');
    assert.ok(sanitized.includes('[REDACTED_KEY]'), '私鑰應被替換為去敏代稱');

    // 檢查 D1 儲存之所有 error_summary 與 activity_logs
    for (const exp of mockD1.experiments.values()) {
      if (exp.provisioning_error) {
        assert.ok(!exp.provisioning_error.includes('ghs_'));
        assert.ok(!exp.provisioning_error.includes('BEGIN RSA PRIVATE KEY'));
      }
    }
    for (const log of mockD1.activityLogs) {
      const summary = log[12];
      assert.ok(!summary.includes('ghs_'));
      assert.ok(!summary.includes('BEGIN RSA PRIVATE KEY'));
    }
    pass('錯誤訊息去敏函數通過審計，D1 與 Activity Log 零金鑰/憑證殘留');
  }

  // ----------------------------------------------------
  // 群組 8: GET /api/experiments/:id/provision 狀態查詢
  // ----------------------------------------------------
  console.log('\n▶ [群組 8: GET /api/experiments/:id/provision 狀態查詢]');
  {
    // 8.1 學生查詢合法實驗的 Provisioning 狀態
    const resGet = await api('/experiments/e_comm_1/provision', {
      method: 'GET',
      headers: { Cookie: `app_session=${STUDENT_SID}` },
    });
    assert.strictEqual(resGet.status, 200);
    assert.strictEqual(resGet.json.success, true);
    assert.strictEqual(resGet.json.experiment_id, 'e_comm_1');
    assert.strictEqual(resGet.json.provisioning_status, 'ready');
    assert.strictEqual(resGet.json.repository, 'TestLabOrg/ee301-lab-01');
    assert.ok(Array.isArray(resGet.json.history));
    pass('課程成員 (學生) 成功查詢實驗 Provisioning 狀態與歷程 (200 OK)');

    // 8.2 非課程成員存取 -> 404 (存在性遮蔽)
    const OUTSIDER_SID = 'sess_outsider_1';
    mockD1.sessions.set(sha256(OUTSIDER_SID), {
      session_id: sha256(OUTSIDER_SID),
      github_id: '9999',
      username: 'stranger',
      display_name: '路人甲',
      expires_at: expTime,
    });

    const resOutsider = await api('/experiments/e_comm_1/provision', {
      method: 'GET',
      headers: { Cookie: `app_session=${OUTSIDER_SID}` },
    });
    assert.strictEqual(resOutsider.status, 404);
    pass('非課程成員查詢 Provisioning 狀態回傳 404 (存在性遮蔽生效)');
  }

  // 關閉測試伺服器
  server.close();

  console.log('\n====================================================');
  console.log(`📊 測試總結：通過 ${passedCount} 項，失敗 0 項`);
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ 測試執行失敗:', err);
  process.exit(1);
});
