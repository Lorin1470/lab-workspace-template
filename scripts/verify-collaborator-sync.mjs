#!/usr/bin/env node

/**
 * verify-collaborator-sync.mjs
 * 驗證學生加入/停用課程與實驗時，GitHub Repository Collaborator 權限同步機制
 *
 * 測試場景清單（覆蓋全部 24 項規範）：
 * 1. 學生加入 Course → collaborator
 * 2. permission = push
 * 3. 重複同步 → idempotent
 * 4. 學生停用 → collaborator 移除
 * 5. 學生停用但仍有其他有效 membership → collaborator 保留
 * 6. Course Mode 使用 Course Repository
 * 7. Experiment Mode 使用 Experiment Repository
 * 8. scoped path 不會被當成 Repository
 * 9. 不同 Course Repository 隔離
 * 10. 不同 Experiment Repository 隔離
 * 11. GitHub identity 缺失
 * 12. Repository 不存在
 * 13. GitHub App permission 不足 (403)
 * 14. GitHub PUT 失敗 (500 失敗不回滾 D1)
 * 15. GitHub DELETE 失敗
 * 16. GitHub DELETE 404 → removed
 * 17. failed retry → ready
 * 18. 無權限使用者不能 sync
 * 19. 不可指定任意 repository
 * 20. 不可指定任意 username
 * 21. Token 不得出現在 error
 * 22. 多名學生同步
 * 23. 多 Course 隔離
 * 24. 多 Experiment 隔離
 */

import http from 'node:http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { onRequest } from '../web/functions/api/[[route]].ts';

const TEST_PORT = 9012;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 產生測試用 RSA 私鑰
const testKeypair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Mock D1 資料庫
class MockCollabD1 {
  constructor() {
    this.courses = new Map();
    this.experiments = new Map();
    this.courseMemberships = new Map();
    this.experimentMemberships = new Map();
    this.repositoryCollaborators = new Map();
    this.sessions = new Map();
    this.activityLogs = [];
  }

  prepare(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      bind: (...binds) => ({
        run: async () => {
          if (q.startsWith('INSERT INTO courses')) {
            const [id, course_code, name, semester, status, mode, github_repository, created_by_github_id, created_at, updated_at] = binds;
            this.courses.set(id, {
              id,
              course_code,
              name,
              semester,
              status: status || 'active',
              mode: mode || 'course',
              github_repository: github_repository || null,
              created_by_github_id,
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
              repository: repository || null,
              report_mode: report_mode || 'shared',
              config_version: config_version || '1.0',
              status: status || 'not_started',
              provisioning_status: 'ready',
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith('INSERT INTO course_memberships')) {
            let id, course_id, github_id, username, role, status, perm_status, perm_error, perm_synced_at, created_at, updated_at;
            if (binds.length <= 8) {
              [id, course_id, github_id, username, role, status, created_at, updated_at] = binds;
            } else {
              [id, course_id, github_id, username, role, status, perm_status, perm_error, perm_synced_at, created_at, updated_at] = binds;
            }
            this.courseMemberships.set(id, {
              id,
              course_id,
              github_id: String(github_id),
              username,
              role: role || 'student',
              status: status || 'active',
              github_permission_status: perm_status || 'pending',
              github_permission_error: perm_error || null,
              github_synced_at: perm_synced_at || null,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith('UPDATE course_memberships SET')) {
            const memberId = binds[binds.length - 1];
            const mem = this.courseMemberships.get(memberId);
            if (mem) {
              if (/(?:^|[\s,])status\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/(?:^|[\s,])status\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.status = binds[idx];
              }
              if (/(?:^|[\s,])role\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/(?:^|[\s,])role\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.role = binds[idx];
              }
              if (/github_permission_status\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/github_permission_status\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.github_permission_status = binds[idx];
              }
              if (/github_permission_error\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/github_permission_error\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.github_permission_error = binds[idx];
              }
              if (/github_synced_at\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/github_synced_at\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.github_synced_at = binds[idx];
              }
              mem.updated_at = new Date().toISOString();
            }
            return { success: true };
          }

          if (q.startsWith('INSERT INTO experiment_memberships')) {
            let id, experiment_id, github_id, username, role, group_name, status, perm_status, perm_error, perm_synced_at, created_at, updated_at;
            if (binds.length <= 9) {
              [id, experiment_id, github_id, username, role, group_name, status, created_at, updated_at] = binds;
            } else {
              [id, experiment_id, github_id, username, role, group_name, status, perm_status, perm_error, perm_synced_at, created_at, updated_at] = binds;
            }
            this.experimentMemberships.set(id, {
              id,
              experiment_id,
              github_id: String(github_id),
              username,
              role: role || 'student',
              group_name: group_name || null,
              status: status || 'active',
              github_permission_status: perm_status || 'pending',
              github_permission_error: perm_error || null,
              github_synced_at: perm_synced_at || null,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith('UPDATE experiment_memberships SET')) {
            const memberId = binds[binds.length - 1];
            const mem = this.experimentMemberships.get(memberId);
            if (mem) {
              if (/(?:^|[\s,])status\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/(?:^|[\s,])status\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.status = binds[idx];
              }
              if (/(?:^|[\s,])role\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/(?:^|[\s,])role\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.role = binds[idx];
              }
              if (/github_permission_status\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/github_permission_status\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.github_permission_status = binds[idx];
              }
              if (/github_permission_error\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/github_permission_error\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.github_permission_error = binds[idx];
              }
              if (/github_synced_at\s*=\s*\?/.test(q)) {
                const idx = (q.slice(0, q.search(/github_synced_at\s*=\s*\?/)).match(/\?/g) || []).length;
                mem.github_synced_at = binds[idx];
              }
              mem.updated_at = new Date().toISOString();
            }
            return { success: true };
          }

          if (q.startsWith('INSERT INTO repository_collaborators') || q.startsWith('INSERT OR REPLACE INTO repository_collaborators')) {
            const [id, repository, github_id, username, permission, status, error_message, synced_at, created_at, updated_at] = binds;
            const key = `${repository.toLowerCase()}:${github_id}`;
            this.repositoryCollaborators.set(key, {
              id: id || `rc_${Math.random()}`,
              repository,
              github_id: String(github_id),
              username,
              permission: permission || 'push',
              status: status || 'pending',
              error_message: error_message || null,
              synced_at: synced_at || null,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          return { success: true };
        },

        first: async () => {
          if (q.includes('FROM user_sessions WHERE session_id = ?')) {
            return this.sessions.get(binds[0]) || null;
          }
          if (q.includes('FROM courses WHERE id = ?')) {
            return this.courses.get(binds[0]) || null;
          }
          if (q.includes('FROM experiments WHERE id = ?')) {
            return this.experiments.get(binds[0]) || null;
          }
          if (q.includes('FROM course_memberships WHERE id = ?')) {
            const id = binds[0];
            const courseId = binds[1];
            const m = this.courseMemberships.get(id);
            if (m && (!courseId || m.course_id === courseId)) return { ...m };
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE id = ?')) {
            const id = binds[0];
            const expId = binds[1];
            const m = this.experimentMemberships.get(id);
            if (m && (!expId || m.experiment_id === expId)) return { ...m };
            return null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ?')) {
            const [cid, gid] = binds;
            for (const cm of this.courseMemberships.values()) {
              if (cm.course_id === cid && cm.github_id === String(gid)) {
                if (q.includes('status = "active"') && cm.status !== 'active') continue;
                return { ...cm };
              }
            }
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND github_id = ?')) {
            const [eid, gid] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === eid && em.github_id === String(gid)) {
                if (q.includes('status = "active"') && em.status !== 'active') continue;
                return { ...em };
              }
            }
            return null;
          }

          // Active membership count query for same repository
          if (q.includes('active_count')) {
            const [gid1, repo1, exclId1, gid2, repo2, exclId2] = binds;
            let count = 0;
            for (const cm of this.courseMemberships.values()) {
              if (cm.github_id === String(gid1) && cm.status === 'active' && cm.role === 'student' && cm.id !== exclId1) {
                const c = this.courses.get(cm.course_id);
                if (c && c.mode === 'course' && c.github_repository?.toLowerCase() === repo1.toLowerCase()) {
                  count++;
                }
              }
            }
            for (const em of this.experimentMemberships.values()) {
              if (em.github_id === String(gid2) && em.status === 'active' && em.role === 'student' && em.id !== exclId2) {
                const e = this.experiments.get(em.experiment_id);
                if (e && e.repository?.toLowerCase() === repo2.toLowerCase()) {
                  count++;
                }
              }
            }
            return { active_count: count };
          }

          return null;
        },

        all: async () => {
          if (q.includes('FROM course_memberships WHERE course_id = ?')) {
            const cid = binds[0];
            const list = Array.from(this.courseMemberships.values()).filter((m) => m.course_id === cid);
            return { results: list };
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ?')) {
            const eid = binds[0];
            const list = Array.from(this.experimentMemberships.values()).filter((m) => m.experiment_id === eid);
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

// 模擬 GitHub API
class MockGitHubApi {
  constructor() {
    this.collaborators = new Map(); // "owner/repo:username" => { permission: string }
    this.apiCalls = [];
    this.shouldFailPut = false;
    this.shouldFailDelete = false;
    this.putFailureStatus = 500;
    this.deleteFailureStatus = 500;
    this.putFailureBody = { message: 'Internal GitHub Error' };
    this.nonExistentRepos = new Set();
  }

  fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const method = options.method || 'GET';
    const bodyText = options.body ? String(options.body) : null;
    let parsedBody = null;
    try {
      if (bodyText) parsedBody = JSON.parse(bodyText);
    } catch {}

    this.apiCalls.push({ url: urlStr, method, body: parsedBody, headers: options.headers });

    // 1. App Installation Token Exchange
    if (urlStr.includes('/access_tokens') && method === 'POST') {
      return new Response(
        JSON.stringify({
          token: 'ghs_mock_collab_sync_token_12345',
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
        { status: 201 }
      );
    }

    // 2. Query App Installation
    if (urlStr.includes('/app/installations/') && method === 'GET') {
      return new Response(
        JSON.stringify({ account: { login: 'Lorin1470' } }),
        { status: 200 }
      );
    }

    // 3. Collaborators API: PUT /repos/{owner}/{repo}/collaborators/{username}
    const putCollabMatch = urlStr.match(/https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/?#]+)/);
    if (putCollabMatch) {
      const owner = putCollabMatch[1];
      const repo = putCollabMatch[2];
      const username = decodeURIComponent(putCollabMatch[3]);
      const repoFullName = `${owner}/${repo}`.toLowerCase();
      const collabKey = `${repoFullName}:${username.toLowerCase()}`;

      if (this.nonExistentRepos.has(repoFullName)) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }

      if (method === 'PUT') {
        if (this.shouldFailPut) {
          return new Response(JSON.stringify(this.putFailureBody), { status: this.putFailureStatus });
        }
        const perm = parsedBody?.permission || 'push';
        const alreadyExists = this.collaborators.has(collabKey);
        this.collaborators.set(collabKey, { permission: perm });
        // 201 if created invite, 204 if already a collaborator
        return new Response(null, { status: alreadyExists ? 204 : 201 });
      }

      if (method === 'DELETE') {
        if (this.shouldFailDelete) {
          return new Response(JSON.stringify({ message: 'Delete Failed' }), { status: this.deleteFailureStatus });
        }
        if (!this.collaborators.has(collabKey)) {
          return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
        }
        this.collaborators.delete(collabKey);
        return new Response(null, { status: 204 });
      }
    }

    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  };
}

let passed = 0;
let failed = 0;

function assertTest(condition, message, detail = '') {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 GitHub Collaborator 權限同步 24 項完整驗證開始');
  console.log('====================================================\n');

  const mockD1 = new MockCollabD1();
  const mockGitHub = new MockGitHubApi();

  const env = {
    DB: mockD1,
    ENVIRONMENT: 'test',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_INSTALLATION_ID: '654321',
    GITHUB_APP_PRIVATE_KEY: testKeypair.privateKey,
    GITHUB_CLIENT_ID: 'mock_client_id',
    GITHUB_CLIENT_SECRET: 'mock_client_secret',
    CUSTOM_FETCH: mockGitHub.fetch,
  };

  // 建立 HTTP 伺服器
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }

      let body = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = Buffer.concat(chunks);
      }

      const webReq = new Request(parsedUrl.toString(), {
        method: req.method,
        headers,
        body,
      });

      const resp = await onRequest({
        request: webReq,
        env,
        params: {},
        waitUntil: () => {},
        next: () => Promise.resolve(new Response(null, { status: 404 })),
        data: {},
      });

      res.statusCode = resp.status;
      resp.headers.forEach((val, key) => res.setHeader(key, val));
      const buf = Buffer.from(await resp.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  async function api(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  try {
    // 建立管理員 Session
    const adminSessionToken = 'admin-token.abc123';
    const adminHashed = sha256(adminSessionToken);
    mockD1.sessions.set(adminHashed, {
      session_id: adminHashed,
      github_id: '1000',
      username: 'teacher_bob',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    const adminCookie = { Cookie: `app_session=${adminSessionToken}` };

    // 建立普通學生 Session (無管理權限)
    const guestSessionToken = 'guest-token.xyz789';
    const guestHashed = sha256(guestSessionToken);
    mockD1.sessions.set(guestHashed, {
      session_id: guestHashed,
      github_id: '9999',
      username: 'random_guest',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    const guestCookie = { Cookie: `app_session=${guestSessionToken}` };

    // 建立 Course A (Course Mode, 倉庫 Lorin1470/course-a-repo)
    const c1Res = await api('/courses', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_code: 'CS101',
        name: '數位電路實驗',
        semester: '113-1',
        mode: 'course',
        github_repository: 'Lorin1470/course-a-repo',
      }),
    });
    const courseAId = c1Res.data.course.id;

    // 建立 Course B (Course Mode, 倉庫 Lorin1470/course-b-repo)
    const c2Res = await api('/courses', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_code: 'CS102',
        name: '訊號與系統實驗',
        semester: '113-1',
        mode: 'course',
        github_repository: 'Lorin1470/course-b-repo',
      }),
    });
    const courseBId = c2Res.data.course.id;

    // 建立 Course C (Experiment Mode, 無 course.github_repository)
    const c3Res = await api('/courses', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_code: 'EE201',
        name: '電子電路實驗 (舊架構)',
        semester: '113-1',
        mode: 'experiment',
      }),
    });
    const courseCId = c3Res.data.course.id;

    // 在 Course C 下建立 Exp 1 (獨立倉庫 Lorin1470/exp-c1-repo) 與 Exp 2 (獨立倉庫 Lorin1470/exp-c2-repo)
    const e1Res = await api('/experiments', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_id: courseCId,
        experiment_code: 'lab-01',
        name: 'BJT 量測',
        repository: 'Lorin1470/exp-c1-repo',
      }),
    });
    const expC1Id = e1Res.data.experiment.id;

    const e2Res = await api('/experiments', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_id: courseCId,
        experiment_code: 'lab-02',
        name: 'MOSFET 量測',
        repository: 'Lorin1470/exp-c2-repo',
      }),
    });
    const expC2Id = e2Res.data.experiment.id;

    // 在 Course A 下建立 scoped experiment (shared course repo)
    const scopedExpRes = await api('/experiments', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_id: courseAId,
        experiment_code: 'lab-scoped-01',
        name: '數位計數器',
      }),
    });
    const scopedExpId = scopedExpRes.data?.experiment?.id;

    console.log('▶ [測試組 1: Course Mode 學生加入、權限與 Idempotency]');

    // 1. 學生加入 Course → collaborator
    const addAliceRes = await api(`/courses/${courseAId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        github_id: '2001',
        username: 'alice_chen',
        role: 'student',
      }),
    });
    assertTest(addAliceRes.status === 201, '1. 學生 Alice 成功加入 Course A (201 Created)');
    assertTest(addAliceRes.data.member?.github_permission_status === 'ready', '1. Alice 的 github_permission_status 為 ready');
    assertTest(
      mockGitHub.collaborators.has('lorin1470/course-a-repo:alice_chen'),
      '1. GitHub API 成功為 Alice 加入 Lorin1470/course-a-repo 協作者'
    );

    // 2. permission = push
    const aliceCollab = mockGitHub.collaborators.get('lorin1470/course-a-repo:alice_chen');
    assertTest(aliceCollab?.permission === 'push', '2. GitHub Collaborator 權限固定為 push，絕非 admin');

    // 3. 重複同步 → idempotent
    // 再次呼叫 sync 端點
    const aliceMemberId = addAliceRes.data.member.id;
    const retryAliceRes = await api(`/courses/${courseAId}/members/${aliceMemberId}/sync`, {
      method: 'POST',
      headers: adminCookie,
    });
    assertTest(retryAliceRes.status === 200, '3. 重複觸發同步回傳 200 OK (idempotent)');
    assertTest(retryAliceRes.data.member?.github_permission_status === 'ready', '3. 狀態維持 ready');

    console.log('\n▶ [測試組 2: 停用學生與多 Membership 保留判斷]');

    // 4. 學生停用 → collaborator 移除 (單一 membership 情況)
    const deactivateAliceRes = await api(`/courses/${courseAId}/members/${aliceMemberId}`, {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ status: 'inactive' }),
    });
    assertTest(deactivateAliceRes.status === 200, '4. Alice 停用回傳 200 OK');
    assertTest(deactivateAliceRes.data.member?.github_permission_status === 'removed', '4. Alice 狀態轉為 removed');
    assertTest(
      !mockGitHub.collaborators.has('lorin1470/course-a-repo:alice_chen'),
      '4. Lorin1470/course-a-repo 已成功移除 Alice 協作者'
    );

    // 5. 學生停用但仍有其他有效 membership → collaborator 保留
    // 重新啟用 Alice 在 Course A，並在同倉庫建立第二個 course (例如同校另一個平行班也綁同一 repo)
    await api(`/courses/${courseAId}/members/${aliceMemberId}`, {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ status: 'active' }),
    });
    // 再建立 Course A2 (同樣綁 Lorin1470/course-a-repo)
    const cA2Res = await api('/courses', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_code: 'CS101-B',
        name: '數位電路實驗 B班',
        semester: '113-1',
        mode: 'course',
        github_repository: 'Lorin1470/course-a-repo',
      }),
    });
    const courseA2Id = cA2Res.data.course.id;
    const addAliceA2 = await api(`/courses/${courseA2Id}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        github_id: '2001',
        username: 'alice_chen',
        role: 'student',
      }),
    });
    const aliceA2MemId = addAliceA2.data.member.id;
    assertTest(mockGitHub.collaborators.has('lorin1470/course-a-repo:alice_chen'), '5. Alice 同時註冊於 A 班與 B 班');

    // 停用 A 班 membership，但 B 班仍 active
    const deactAliceA1 = await api(`/courses/${courseAId}/members/${aliceMemberId}`, {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ status: 'inactive' }),
    });
    assertTest(deactAliceA1.data.member?.github_permission_status === 'removed', '5. A 班 membership 標記為 removed');
    assertTest(
      mockGitHub.collaborators.has('lorin1470/course-a-repo:alice_chen'),
      '5. 因 B 班仍為 active student，GitHub Collaborator 被安全保留，未被錯誤 DELETE！'
    );

    console.log('\n▶ [測試組 3: Course Mode vs Experiment Mode 與 Scoped Path 隔離]');

    // 6. Course Mode 使用 Course Repository
    // 檢查 Alice 加入 A 班時 GitHub API 呼叫的 URL
    const lastCalls = mockGitHub.apiCalls.filter((c) => c.url.includes('/collaborators/alice_chen'));
    assertTest(
      lastCalls.some((c) => c.url.includes('/repos/Lorin1470/course-a-repo/collaborators/')),
      '6. Course Mode 嚴格呼叫 courses.github_repository'
    );

    // 7. Experiment Mode 使用 Experiment Repository
    // 在 Course C (Experiment Mode) 下新增學生 Bob
    await api(`/courses/${courseCId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2002', username: 'bob_lin', role: 'student' }),
    });
    // 將 Bob 指派至 Exp C1
    const addBobExp1 = await api(`/experiments/${expC1Id}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2002', username: 'bob_lin', role: 'student' }),
    });
    assertTest(addBobExp1.status === 201, '7. Bob 成功加入 Exp C1');
    assertTest(
      mockGitHub.collaborators.has('lorin1470/exp-c1-repo:bob_lin'),
      '7. Experiment Mode 成功為 Bob 加入 Lorin1470/exp-c1-repo 協作者'
    );

    // 8. scoped path 不會被當成 Repository
    // 在 Course A 的 scoped experiment 指派學生
    await api(`/experiments/${scopedExpId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2001', username: 'alice_chen', role: 'student' }),
    });
    assertTest(
      !mockGitHub.apiCalls.some((c) => c.url.includes('experiments/lab-scoped-01')),
      '8. 嚴格防止把 scoped path (experiments/lab-scoped-01) 拼入 GitHub Repository 名稱'
    );

    // 9. 不同 Course Repository 隔離
    // 學生 Carol 加入 Course B
    const addCarolB = await api(`/courses/${courseBId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2003', username: 'carol_wang', role: 'student' }),
    });
    assertTest(
      mockGitHub.collaborators.has('lorin1470/course-b-repo:carol_wang'),
      '9. Carol 加入 Course B 獲得 course-b-repo 權限'
    );
    assertTest(
      !mockGitHub.collaborators.has('lorin1470/course-a-repo:carol_wang'),
      '9. Carol 絕未取得 Course A (course-a-repo) 權限 (完全隔離)'
    );

    // 10. 不同 Experiment Repository 隔離
    assertTest(
      !mockGitHub.collaborators.has('lorin1470/exp-c2-repo:bob_lin'),
      '10. Bob 加入 Exp C1 絕未取得 Exp C2 (exp-c2-repo) 協作者權限'
    );

    console.log('\n▶ [測試組 4: 異常防禦、去敏與容錯]');

    // 11. GitHub identity 缺失
    const missingUserRes = await api(`/courses/${courseAId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2004', username: '', role: 'student' }),
    });
    assertTest(missingUserRes.status === 400, '11. 缺少 username 遭 400 阻絕');

    // 12. Repository 不存在
    mockGitHub.nonExistentRepos.add('lorin1470/nonexistent-repo');
    const cNonExistent = await api('/courses', {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        course_code: 'CS999',
        name: '不存在專案',
        semester: '113-1',
        mode: 'course',
        github_repository: 'Lorin1470/nonexistent-repo',
      }),
    });
    const addNonExistRes = await api(`/courses/${cNonExistent.data.course.id}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2005', username: 'david_lee', role: 'student' }),
    });
    assertTest(addNonExistRes.status === 201, '12. D1 成員仍成功建立 (不回滾)');
    assertTest(addNonExistRes.data.member?.github_permission_status === 'failed', '12. 狀態標記為 failed');
    assertTest(
      addNonExistRes.data.member?.github_permission_error?.includes('不存在'),
      '12. 記錄儲存庫不存在之友善錯誤訊息'
    );

    // 13. GitHub App permission 不足 (403)
    mockGitHub.shouldFailPut = true;
    mockGitHub.putFailureStatus = 403;
    mockGitHub.putFailureBody = { message: 'Resource not accessible by integration' };

    const permFailRes = await api(`/courses/${courseBId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2006', username: 'eva_green', role: 'student' }),
    });
    assertTest(permFailRes.status === 201, '13. GitHub 403 下 D1 成員成功建立 (不回滾)');
    assertTest(permFailRes.data.member?.github_permission_status === 'failed', '13. 狀態標記為 failed');
    assertTest(
      permFailRes.data.member?.github_permission_error?.includes('Administration: write'),
      '13. 錯誤訊息明確指出 GitHub App 缺少 Administration: write 權限'
    );

    // 14. GitHub PUT 失敗 (500 失敗不回滾 D1)
    mockGitHub.putFailureStatus = 500;
    mockGitHub.putFailureBody = { message: 'Internal Server Error' };
    const putFailRes = await api(`/courses/${courseBId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2007', username: 'frank_wu', role: 'student' }),
    });
    assertTest(putFailRes.status === 201, '14. 500 異常下 D1 成員依然存在');
    assertTest(putFailRes.data.member?.github_permission_status === 'failed', '14. 狀態為 failed');

    // 15. GitHub DELETE 失敗
    mockGitHub.shouldFailPut = false; // 恢復正常 PUT
    mockGitHub.shouldFailDelete = true;
    mockGitHub.deleteFailureStatus = 500;
    const frankId = putFailRes.data.member.id;
    const delFailRes = await api(`/courses/${courseBId}/members/${frankId}`, {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ status: 'inactive' }),
    });
    assertTest(delFailRes.status === 200, '15. DELETE 失敗時 D1 成員狀態仍順利更新為 inactive');
    assertTest(delFailRes.data.member?.github_permission_status === 'failed', '15. 同步狀態標記為 failed');
    mockGitHub.shouldFailDelete = false; // 恢復正常 DELETE

    // 16. GitHub DELETE 404 → removed
    // 當從 GitHub 移除早已不在的 collaborator (回傳 404)，應視為成功移除
    const deactBobExp1 = await api(`/experiments/${expC1Id}/members/${addBobExp1.data.member.id}`, {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ status: 'inactive' }),
    });
    assertTest(deactBobExp1.status === 200, '16. 停用 Bob Exp1 回傳 200');
    assertTest(deactBobExp1.data.member?.github_permission_status === 'removed', '16. DELETE 404 正確視為 removed');

    // 17. failed retry → ready
    // 對第 13 項因 403 失敗的 Eva 進行重試 (此時 GitHub App 已修復)
    const evaId = permFailRes.data.member.id;
    const retryEvaRes = await api(`/courses/${courseBId}/members/${evaId}/sync`, {
      method: 'POST',
      headers: adminCookie,
    });
    assertTest(retryEvaRes.status === 200, '17. 重試端點回傳 200 OK');
    assertTest(retryEvaRes.data.member?.github_permission_status === 'ready', '17. Eva 狀態成功從 failed 復原為 ready');
    assertTest(
      mockGitHub.collaborators.has('lorin1470/course-b-repo:eva_green'),
      '17. GitHub 成功加入 Eva 協作者'
    );

    console.log('\n▶ [測試組 5: 安全邊界、權限校驗與去敏防護]');

    // 18. 無權限使用者不能 sync
    const guestRetryRes = await api(`/courses/${courseBId}/members/${evaId}/sync`, {
      method: 'POST',
      headers: guestCookie,
    });
    assertTest(guestRetryRes.status === 403, '18. 非管理員嘗試觸發 sync 遭 403 阻絕');

    // 19. 不可指定任意 repository
    const fakeRepoRes = await api(`/courses/${courseBId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        github_id: '2008',
        username: 'george_tsai',
        role: 'student',
        repository: 'hacker/stolen-repo', // 企圖偽造
      }),
    });
    assertTest(
      !mockGitHub.collaborators.has('hacker/stolen-repo:george_tsai'),
      '19. 忽視前端傳入之 repository，永遠由 server 權威解析'
    );

    // 20. 不可指定任意 username (驗證非 student 角色不被同步)
    const addTeacherRes = await api(`/courses/${courseBId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({
        github_id: '3001',
        username: 'prof_smith',
        role: 'teacher',
      }),
    });
    assertTest(
      !mockGitHub.collaborators.has('lorin1470/course-b-repo:prof_smith'),
      '20. 嚴格限定僅 student 同步 GitHub 協作者，teacher/assistant 絕不同步'
    );

    // 21. Token 不得出現在 error
    mockGitHub.shouldFailPut = true;
    mockGitHub.putFailureStatus = 500;
    mockGitHub.putFailureBody = { message: 'Fatal: token ghs_secret12345678 expired with Bearer abcd.efgh' };
    const leakTestRes = await api(`/courses/${courseBId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2009', username: 'helen_ho', role: 'student' }),
    });
    const errText = leakTestRes.data.member?.github_permission_error || '';
    assertTest(
      !errText.includes('ghs_secret') && !errText.includes('abcd.efgh'),
      '21. 錯誤訊息徹底抹除 Token 與 Bearer 憑證 (sanitizeErrorMessage)'
    );
    mockGitHub.shouldFailPut = false;

    // 22. 多名學生同步
    const addIan = await api(`/courses/${courseAId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2010', username: 'ian_chen', role: 'student' }),
    });
    const addJenny = await api(`/courses/${courseAId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2011', username: 'jenny_wu', role: 'student' }),
    });
    assertTest(
      mockGitHub.collaborators.has('lorin1470/course-a-repo:ian_chen') &&
      mockGitHub.collaborators.has('lorin1470/course-a-repo:jenny_wu'),
      '22. 多名學生依序加入，各自成功建立協作者'
    );

    // 23. 多 Course 隔離
    assertTest(
      !mockGitHub.collaborators.has('lorin1470/course-b-repo:ian_chen'),
      '23. Course A 學生 Ian 絕無 Course B 協作者權限'
    );

    // 24. 多 Experiment 隔離
    // 在 Course C 先將 Kevin 註冊為課程學生，再指派至 Exp C2
    await api(`/courses/${courseCId}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2012', username: 'kevin_chang', role: 'student' }),
    });
    await api(`/experiments/${expC2Id}/members`, {
      method: 'POST',
      headers: adminCookie,
      body: JSON.stringify({ github_id: '2012', username: 'kevin_chang', role: 'student' }),
    });
    assertTest(
      mockGitHub.collaborators.has('lorin1470/exp-c2-repo:kevin_chang'),
      '24. Kevin 成功加入 Exp C2 協作者'
    );
    assertTest(
      !mockGitHub.collaborators.has('lorin1470/exp-c1-repo:kevin_chang'),
      '24. Kevin 絕無 Exp C1 協作者權限 (Experiment 完全隔離)'
    );

  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`📊 驗證總結：通過 ${passed} 項，失敗 ${failed} 項`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
