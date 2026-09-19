/**
 * verify-management.mjs
 * 驗證 Phase 2: Course / Experiment / Membership Management API (零外部依賴)
 *
 * 測試項目涵蓋：
 * 0. Migration 0001 -> 0002 -> 0003 -> 0004 真實 SQLite 套用與約束
 * 1. 課程管理 (建立、查詢、修改、封存、重複衝突 409、越權 403)
 * 2. 實驗管理 (建立、查詢、修改、狀態流轉、儲存庫唯一性 409、課程 FK 400、越權 403)
 * 3. 課程成員管理 (新增、修改角色、停用、唯一性 409、越權 403)
 * 4. 實驗成員配置 (指派組員、修改組別、非課程成員阻絕 400、助教無配置權 403)
 * 5. Bootstrap Admin 初始提權與自動失效
 * 6. 不可變身份 (github_id 改名免疫性) 與 HTTP 語意 (401/403/404/409/400)
 */

import http from 'node:http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { onRequest } from '../web/functions/api/[[route]].ts';

const TEST_PORT = 9001;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;
const BOOTSTRAP_ADMIN_ID = '99999';

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 記憶體 D1 模擬實作 (支援 Phase 2 所有 CRUD 操作)
class MockManagementD1 {
  constructor() {
    this.courses = new Map();
    this.experiments = new Map();
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
            for (const c of this.courses.values()) {
              if (c.course_code === course_code && c.semester === semester) {
                throw new Error(`UNIQUE constraint failed: courses.course_code, courses.semester`);
              }
            }
            this.courses.set(id, { id, course_code, name, semester, status: status || 'active', created_by_github_id, created_at: created_at || new Date().toISOString(), updated_at: updated_at || new Date().toISOString() });
            return { success: true };
          }
          if (q.startsWith('UPDATE courses SET')) {
            const id = binds[binds.length - 1];
            const course = this.courses.get(id);
            if (course) {
              if (q.includes('name = ?')) course.name = binds[0];
              if (q.includes('semester = ?')) {
                const sIndex = q.indexOf('semester = ?');
                // 找出 semester 索引
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                course.semester = binds[idx];
              }
              if (q.includes('status = ?')) {
                const sIndex = q.indexOf('status = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                course.status = binds[idx];
              }
              if (q.includes('updated_at = ?')) {
                const sIndex = q.indexOf('updated_at = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                course.updated_at = binds[idx];
              }
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiments')) {
            const [id, course_id, experiment_code, name, repository, report_mode, config_version, status, created_at, updated_at] = binds;
            for (const e of this.experiments.values()) {
              if (e.repository === repository) {
                throw new Error(`UNIQUE constraint failed: experiments.repository`);
              }
              if (e.course_id === course_id && e.experiment_code === experiment_code) {
                throw new Error(`UNIQUE constraint failed: experiments.course_id, experiments.experiment_code`);
              }
            }
            this.experiments.set(id, {
              id,
              course_id,
              experiment_code,
              name,
              repository,
              report_mode: report_mode || 'shared',
              config_version: '1.0',
              status: 'not_started',
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE experiments SET')) {
            const id = binds[binds.length - 1];
            const exp = this.experiments.get(id);
            if (exp) {
              if (q.includes('name = ?')) {
                const sIndex = q.indexOf('name = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                exp.name = binds[idx];
              }
              if (q.includes('report_mode = ?')) {
                const sIndex = q.indexOf('report_mode = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                exp.report_mode = binds[idx];
              }
              if (q.includes('status = ?')) {
                const sIndex = q.indexOf('status = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                exp.status = binds[idx];
              }
              if (q.includes('updated_at = ?')) {
                const sIndex = q.indexOf('updated_at = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                exp.updated_at = binds[idx];
              }
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO course_memberships')) {
            const [id, course_id, github_id, username, role, status, created_at, updated_at] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === course_id && m.github_id === github_id) {
                throw new Error(`UNIQUE constraint failed: course_memberships.course_id, course_memberships.github_id`);
              }
            }
            this.courseMemberships.set(id, { id, course_id, github_id, username, role, status: status || 'active', created_at: created_at || new Date().toISOString(), updated_at: updated_at || new Date().toISOString() });
            return { success: true };
          }
          if (q.startsWith('UPDATE course_memberships SET')) {
            const id = binds[binds.length - 1];
            const mem = this.courseMemberships.get(id);
            if (mem) {
              if (q.includes('role = ?')) {
                const sIndex = q.indexOf('role = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                mem.role = binds[idx];
              }
              if (q.includes('username = ?')) {
                const sIndex = q.indexOf('username = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                mem.username = binds[idx];
              }
              if (q.includes('status = ?')) {
                const sIndex = q.indexOf('status = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                mem.status = binds[idx];
              }
              if (q.includes('updated_at = ?')) {
                const sIndex = q.indexOf('updated_at = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                mem.updated_at = binds[idx];
              }
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiment_memberships')) {
            const [id, experiment_id, github_id, username, role, group_name, status, created_at, updated_at] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === experiment_id && em.github_id === github_id) {
                throw new Error(`UNIQUE constraint failed: experiment_memberships.experiment_id, experiment_memberships.github_id`);
              }
            }
            this.experimentMemberships.set(id, { id, experiment_id, github_id, username, role, group_name: group_name || null, status: status || 'active', created_at: created_at || new Date().toISOString(), updated_at: updated_at || new Date().toISOString() });
            return { success: true };
          }
          if (q.startsWith('UPDATE experiment_memberships SET')) {
            const id = binds[binds.length - 1];
            const em = this.experimentMemberships.get(id);
            if (em) {
              if (q.includes('role = ?')) {
                const sIndex = q.indexOf('role = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                em.role = binds[idx];
              }
              if (q.includes('group_name = ?')) {
                const sIndex = q.indexOf('group_name = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                em.group_name = binds[idx];
              }
              if (q.includes('status = ?')) {
                const sIndex = q.indexOf('status = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                em.status = binds[idx];
              }
              if (q.includes('updated_at = ?')) {
                const sIndex = q.indexOf('updated_at = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                em.updated_at = binds[idx];
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
          if (q.startsWith('DELETE FROM user_sessions WHERE session_id = ?')) {
            this.sessions.delete(binds[0]);
            return { success: true };
          }
          return { success: true };
        },
        first: async () => {
          if (q.includes('FROM user_sessions WHERE session_id = ?')) {
            return this.sessions.get(binds[0]) || null;
          }
          if (q.includes('FROM courses WHERE course_code = ? AND semester = ? AND id != ?')) {
            const [cc, sem, id] = binds;
            for (const c of this.courses.values()) {
              if (c.course_code === cc && c.semester === sem && c.id !== id) return { ...c };
            }
            return null;
          }
          if (q.includes('FROM courses WHERE course_code = ? AND semester = ?')) {
            const [cc, sem] = binds;
            for (const c of this.courses.values()) {
              if (c.course_code === cc && c.semester === sem) return { ...c };
            }
            return null;
          }
          if (q.includes('FROM courses WHERE id = ?')) {
            return this.courses.get(binds[0]) || null;
          }
          if (q.includes('FROM experiments WHERE repository = ?')) {
            const repo = binds[0];
            for (const exp of this.experiments.values()) {
              if (exp.repository === repo) return { ...exp };
            }
            return null;
          }
          if (q.includes('FROM experiments WHERE course_id = ? AND experiment_code = ?')) {
            const [cid, code] = binds;
            for (const exp of this.experiments.values()) {
              if (exp.course_id === cid && exp.experiment_code === code) return { ...exp };
            }
            return null;
          }
          if (q.includes('FROM experiments WHERE id = ?')) {
            return this.experiments.get(binds[0]) || null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"')) {
            const [cid, gid] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid && m.github_id === gid && m.status === 'active') return { ...m };
            }
            return null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ?')) {
            const [cid, gid] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid && m.github_id === gid) return { ...m };
            }
            return null;
          }
          if (q.includes('FROM course_memberships WHERE id = ? AND course_id = ?')) {
            const [id, cid] = binds;
            const m = this.courseMemberships.get(id);
            if (m && m.course_id === cid) return { ...m };
            return null;
          }
          if (q.includes('FROM course_memberships WHERE id = ?')) {
            return this.courseMemberships.get(binds[0]) || null;
          }
          if (q.includes('FROM course_memberships WHERE github_id = ? AND role = "teacher" AND status = "active"')) {
            const gid = binds[0];
            for (const m of this.courseMemberships.values()) {
              if (m.github_id === gid && m.role === 'teacher' && m.status === 'active') return { ...m };
            }
            return null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND role = "teacher" AND status = "active"')) {
            const cid = binds[0];
            let count = 0;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid && m.role === 'teacher' && m.status === 'active') count++;
            }
            return { count };
          }
          if (q.includes('COUNT(*) as count FROM course_memberships WHERE role = "teacher"') ||
              q.includes("COUNT(*) as count FROM course_memberships WHERE role = 'teacher'")) {
            let count = 0;
            for (const m of this.courseMemberships.values()) {
              if (m.role === 'teacher' && m.status === 'active') count++;
            }
            return { count };
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND github_id = ? AND status = "active"')) {
            const [expId, gid] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === expId && em.github_id === gid && em.status === 'active') return { ...em };
            }
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND github_id = ?')) {
            const [expId, gid] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === expId && em.github_id === gid) return { ...em };
            }
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE id = ? AND experiment_id = ?')) {
            const [id, expId] = binds;
            const em = this.experimentMemberships.get(id);
            if (em && em.experiment_id === expId) return { ...em };
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE id = ?')) {
            return this.experimentMemberships.get(binds[0]) || null;
          }
          return null;
        },
        all: async () => {
          if (q.includes('FROM courses c JOIN course_memberships cm ON c.id = cm.course_id WHERE cm.github_id = ?')) {
            const gid = binds[0];
            const results = [];
            for (const cm of this.courseMemberships.values()) {
              if (cm.github_id === gid && cm.status === 'active') {
                const c = this.courses.get(cm.course_id);
                if (c) {
                  if (cm.role === 'teacher' || cm.role === 'assistant' || c.status !== 'inactive') {
                    results.push({ ...c, role: cm.role });
                  }
                }
              }
            }
            return { results };
          }
          if (q.includes('FROM courses ORDER BY')) {
            return { results: Array.from(this.courses.values()) };
          }
          if (q.includes('FROM experiments WHERE course_id = ? ORDER BY')) {
            const cid = binds[0];
            const results = Array.from(this.experiments.values()).filter((e) => e.course_id === cid);
            return { results };
          }
          if (q.includes('JOIN experiment_memberships em ON e.id = em.experiment_id WHERE e.course_id = ? AND em.github_id = ?')) {
            const [cid, gid] = binds;
            const results = [];
            for (const em of this.experimentMemberships.values()) {
              if (em.github_id === gid && em.status === 'active') {
                const e = this.experiments.get(em.experiment_id);
                if (e && e.course_id === cid) {
                  results.push({ ...e, group_name: em.group_name });
                }
              }
            }
            return { results };
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? ORDER BY')) {
            const cid = binds[0];
            const results = Array.from(this.courseMemberships.values()).filter((m) => m.course_id === cid);
            return { results };
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND status = "active"')) {
            const expId = binds[0];
            const results = Array.from(this.experimentMemberships.values()).filter((m) => m.experiment_id === expId && m.status === 'active');
            return { results };
          }
          return { results: [] };
        },
      }),
      first: async () => {
        if (q.includes('COUNT(*) as count FROM course_memberships WHERE role = "teacher"') ||
            q.includes("COUNT(*) as count FROM course_memberships WHERE role = 'teacher'")) {
          let count = 0;
          for (const m of this.courseMemberships.values()) {
            if (m.role === 'teacher' && m.status === 'active') count++;
          }
          return { count };
        }
        return null;
      },
    };
  }

  async batch(statements) {
    this.batchCount = (this.batchCount || 0) + 1;
    const backupCourses = new Map(this.courses);
    const backupMembers = new Map(this.courseMemberships);
    try {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    } catch (err) {
      this.courses = backupCourses;
      this.courseMemberships = backupMembers;
      throw err;
    }
  }
}

const mockD1 = new MockManagementD1();

function createSession(user) {
  const rawToken = crypto.randomUUID() + '.' + crypto.randomUUID();
  const hashed = sha256(rawToken);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  mockD1.sessions.set(hashed, {
    session_id: hashed,
    github_id: user.github_id,
    username: user.username,
    display_name: user.display_name || user.username,
    avatar_url: user.avatar_url || null,
    created_at: now,
    expires_at: expiresAt,
  });

  return `app_session=${rawToken}`;
}

const USERS = {
  teacher: { github_id: '1001', username: 'teacher_smith', display_name: '史密斯老師' },
  assistant: { github_id: '2001', username: 'ta_alex', display_name: '亞歷克斯助教' },
  studentA: { github_id: '3001', username: 'studentA', display_name: '學生A' },
  studentB: { github_id: '3002', username: 'studentB', display_name: '學生B' },
  studentC: { github_id: '3003', username: 'studentC', display_name: '未加課學生C' },
  stranger: { github_id: '8888', username: 'stranger', display_name: '陌生人' },
  bootstrapAdmin: { github_id: BOOTSTRAP_ADMIN_ID, username: 'root_admin', display_name: '初始管理員' },
};

let COOKIES = {};

function startServer() {
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
          body: body,
        });

        const response = await onRequest({
          request: cfRequest,
          env: {
            DB: mockD1,
            INITIAL_ADMIN_GITHUB_ID: BOOTSTRAP_ADMIN_ID,
          },
        });

        res.statusCode = response.status;
        for (const [k, v] of response.headers.entries()) {
          res.setHeader(k, v);
        }
        const respBody = await response.text();
        res.end(respBody);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    server.listen(TEST_PORT, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

let passCount = 0;
let failCount = 0;

function pass(name) {
  passCount++;
  console.log(`  ✅ [PASS] ${name}`);
}

function fail(name, reason) {
  failCount++;
  console.error(`  ❌ [FAIL] ${name}: ${reason}`);
}

function runSqlMigrationSmokeTest() {
  console.log('▶ [群組 0: Migration 0001 -> 0002 -> 0003 -> 0004 真實 SQLite 套用與約束測試]');
  const m1 = fs.readFileSync('web/migrations/0001_initial_schema.sql', 'utf8');
  const m2 = fs.readFileSync('web/migrations/0002_user_sessions_indexes.sql', 'utf8');
  const m3 = fs.readFileSync('web/migrations/0003_course_experiment_permissions.sql', 'utf8');
  const m4 = fs.readFileSync('web/migrations/0004_course_status.sql', 'utf8');

  function runSql(dbCommands) {
    const full = `PRAGMA foreign_keys = ON;\n${m1}\n${m2}\n${m3}\n${m4}\n${dbCommands}`;
    return execSync('sqlite3 :memory:', { input: full, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  }

  function expectConstraintError(name, sql, expectedErrorSnippet) {
    try {
      runSql(sql);
      fail(name, '預期應拋出約束違規錯誤，但成功執行');
    } catch (err) {
      const stderr = (err.stderr || err.message || '').toString();
      assert(stderr.includes(expectedErrorSnippet), `錯誤訊息應包含 "${expectedErrorSnippet}"，實際: ${stderr}`);
      pass(name);
    }
  }

  // 1. 驗證資料表與 status 欄位建立
  const tableCheck = runSql('INSERT INTO courses (id, course_code, name, semester) VALUES ("c1", "EE101", "電路學", "114-1"); SELECT id, status FROM courses;');
  assert.strictEqual(tableCheck.trim(), 'c1|active');
  pass('Migration 0004 套用成功，courses.status 預設值為 active');

  // 2. CHECK 約束測試: courses.status
  expectConstraintError(
    'CHECK(courses.status IN ("active", "archived", "inactive")) 生效',
    'INSERT INTO courses (id, course_code, name, semester, status) VALUES ("c2", "EE102", "電路學2", "114-1", "invalid_status");',
    'CHECK constraint failed'
  );
  console.log('');
}

async function run() {
  console.log('====================================================');
  console.log('🧪 D1 Course / Experiment / Membership Management 驗證開始');
  console.log('====================================================\n');

  runSqlMigrationSmokeTest();

  // 為使用者建立 Session
  for (const [k, u] of Object.entries(USERS)) {
    COOKIES[k] = createSession(u);
  }

  const server = await startServer();

  try {
    let createdCourseId = '';
    let courseBId = '';
    let createdExpId = '';
    let studentMemberId = '';
    let expMemberId = '';

    // ----------------------------------------------------
    // 群組 1: Bootstrap Admin 初始建置與自動失效
    // ----------------------------------------------------
    console.log('▶ [群組 1: Bootstrap Admin 初始提權建置與自動退場]');
    {
      // 1.1 目前全系統 0 Teacher，陌生人不可建立課程
      const resStranger = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.stranger },
        body: JSON.stringify({ course_code: 'EE101', name: '電路學', semester: '114-1' }),
      });
      assert.strictEqual(resStranger.status, 403);
      pass('全系統無 Teacher 時，一般陌生訪客建立課程遭拒絕 (403)');

      // 1.2 Bootstrap Admin 建立系統第一門課程 (EE201)
      const resBootstrap = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.bootstrapAdmin },
        body: JSON.stringify({ course_code: 'EE201', name: '電子學實驗', semester: '114-1' }),
      });
      assert.strictEqual(resBootstrap.status, 201);
      const data = await resBootstrap.json();
      assert(data.success);
      assert.strictEqual(data.course.course_code, 'EE201');
      assert.strictEqual(data.course.status, 'active');
      assert.strictEqual(data.membership.role, 'teacher');
      createdCourseId = data.course.id;
      pass('Bootstrap Admin 成功建立首門課程，並自動建立 teacher 角色成員 (201)');

      // 1.3 現在系統已有 Teacher，Bootstrap Admin 提權通道立即自動關閉
      // 建立另一位不是 teacher 的臨時使用者測試
      const tempUserCookie = createSession({ github_id: '99998', username: 'temp_user' });
      const resTemp = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: tempUserCookie },
        body: JSON.stringify({ course_code: 'CS101', name: '計算機概論', semester: '114-1' }),
      });
      assert.strictEqual(resTemp.status, 403);
      pass('系統具備有效 Teacher 後，非教師使用者建立課程均遭 403 阻絕 (無提權後門)');
    }

    // ----------------------------------------------------
    // 群組 2: 課程管理 CRUD (Course CRUD & Lifecycle)
    // ----------------------------------------------------
    console.log('\n▶ [群組 2: 課程管理 CRUD 與衝突/邊界測試]');
    {
      // 2.1 未登入存取 POST /api/courses 回傳 401
      const resNoAuth = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_code: 'EE301', name: '訊號與系統', semester: '114-1' }),
      });
      assert.strictEqual(resNoAuth.status, 401);
      pass('未登入建立課程回傳 401 Unauthorized');

      // 2.2 將 teacher_smith 加入 EE201 作為 Teacher
      mockD1.prepare('INSERT INTO course_memberships VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
        'cm_t1', createdCourseId, '1001', 'teacher_smith', 'teacher', 'active', new Date().toISOString(), new Date().toISOString()
      ).run();

      // 2.3 Teacher 建立另一門課程 EE202 成功
      const resTeacher = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ course_code: 'EE202', name: '電子學實驗(二)', semester: '114-2' }),
      });
      assert.strictEqual(resTeacher.status, 201);
      pass('既有 Teacher 成功建立新課程 EE202 (201)');

      // 2.4 重複 (course_code, semester) 衝突測試 -> 409 Conflict
      const resDup = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ course_code: 'EE201', name: '重複之電子學', semester: '114-1' }),
      });
      assert.strictEqual(resDup.status, 409);
      pass('重複之 (course_code, semester) 建立遭阻絕 (409 Conflict)');

      // 2.5 查詢單一課程詳情 (限成員)
      const resGetCourse = await fetch(`${BASE_URL}/courses/${createdCourseId}`, {
        headers: { Cookie: COOKIES.teacher },
      });
      assert.strictEqual(resGetCourse.status, 200);
      const courseData = await resGetCourse.json();
      assert.strictEqual(courseData.course.id, createdCourseId);
      assert.strictEqual(courseData.course.role, 'teacher');
      pass('Teacher 成功查詢課程詳情 (200)');

      // 2.6 非成員查詢該課程 -> 404 (存在性遮蔽)
      const resStrangerGet = await fetch(`${BASE_URL}/courses/${createdCourseId}`, {
        headers: { Cookie: COOKIES.stranger },
      });
      assert.strictEqual(resStrangerGet.status, 404);
      pass('非成員查詢課程詳情回傳 404 (存在性遮蔽)');

      // 2.7 Teacher 修改課程名稱與封存狀態 (PATCH)
      const resPatch = await fetch(`${BASE_URL}/courses/${createdCourseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ name: '電子學實驗(改)', status: 'archived' }),
      });
      assert.strictEqual(resPatch.status, 200);
      const patchData = await resPatch.json();
      assert.strictEqual(patchData.course.name, '電子學實驗(改)');
      assert.strictEqual(patchData.course.status, 'archived');
      pass('Teacher 成功修改課程名稱並將課程狀態更新為 archived (200)');

      // 恢復為 active 方便後續測試
      await fetch(`${BASE_URL}/courses/${createdCourseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ status: 'active' }),
      });
    }

    // ----------------------------------------------------
    // 群組 3: 課程成員管理 (Course Membership API)
    // ----------------------------------------------------
    console.log('\n▶ [群組 3: 課程成員新增、修改、停用與權限防偽]');
    {
      // 3.1 學生企圖新增成員至課程 -> 403 Forbidden
      const resStudentAdd = await fetch(`${BASE_URL}/courses/${createdCourseId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({ github_id: '3002', username: 'studentB', role: 'student' }),
      });
      assert.strictEqual(resStudentAdd.status, 403);
      pass('學生企圖新增課程成員遭阻絕 (403)');

      // 3.2 Teacher 新增學生 A 至課程
      const resTeacherAdd = await fetch(`${BASE_URL}/courses/${createdCourseId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '3001', username: 'studentA', role: 'student' }),
      });
      assert.strictEqual(resTeacherAdd.status, 201);
      const addData = await resTeacherAdd.json();
      studentMemberId = addData.member.id;
      assert.strictEqual(addData.member.github_id, '3001');
      assert.strictEqual(addData.member.role, 'student');
      pass('Teacher 成功將學生 A 加入課程 (201)');

      // 3.3 Teacher 新增助教 Alex 至課程
      const resAddTa = await fetch(`${BASE_URL}/courses/${createdCourseId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '2001', username: 'ta_alex', role: 'assistant' }),
      });
      assert.strictEqual(resAddTa.status, 201);
      pass('Teacher 成功將助教 Alex 加入課程 (201)');

      // 3.4 重複加入同一成員 -> 409 Conflict
      const resDupMember = await fetch(`${BASE_URL}/courses/${createdCourseId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '3001', username: 'studentA', role: 'student' }),
      });
      assert.strictEqual(resDupMember.status, 409);
      pass('重複加入課程成員回傳 409 Conflict');

      // 3.5 學生企圖自行提升權限為 teacher (Self-Escalation) -> 403 Forbidden
      const resEscalate = await fetch(`${BASE_URL}/courses/${createdCourseId}/members/${studentMemberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({ role: 'teacher' }),
      });
      assert.strictEqual(resEscalate.status, 403);
      pass('學生企圖竄改成員角色自我提權遭阻絕 (403)');

      // 3.6 Teacher 更新學生 A 角色與暱稱
      const resUpdateMem = await fetch(`${BASE_URL}/courses/${createdCourseId}/members/${studentMemberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ username: 'studentA_updated' }),
      });
      assert.strictEqual(resUpdateMem.status, 200);
      pass('Teacher 成功更新成員快取資訊 (200)');

      // 3.7 查詢課程成員清單
      const resListMem = await fetch(`${BASE_URL}/courses/${createdCourseId}/members`, {
        headers: { Cookie: COOKIES.studentA },
      });
      assert.strictEqual(resListMem.status, 200);
      const listData = await resListMem.json();
      assert(listData.course_members.length >= 3);
      pass('課程成員 (學生 A) 允許檢視全課成員名冊 (200)');
    }

    // ----------------------------------------------------
    // 群組 4: 實驗管理 API (Experiment Management API)
    // ----------------------------------------------------
    console.log('\n▶ [群組 4: 實驗建立、查詢、修改與儲存庫唯一性]');
    {
      // 4.1 助教企圖建立實驗 -> 403 Forbidden (Phase 2 嚴格限制僅 Teacher 具建立權)
      const resTaExp = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.assistant },
        body: JSON.stringify({
          course_id: createdCourseId,
          experiment_code: 'lab-01',
          name: '二極體特性量測',
          repository: 'Lorin1470/ee201-lab-01-ta',
        }),
      });
      assert.strictEqual(resTaExp.status, 403);
      pass('助教企圖建立實驗遭阻絕 (403，僅 Teacher 具備管理權)');

      // 4.2 建立實驗帶入不存在的 course_id -> 400 Bad Request
      const resBadCourse = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          course_id: 'nonexistent_course_id',
          experiment_code: 'lab-01',
          name: '二極體特性量測',
          repository: 'Lorin1470/ee201-lab-01',
        }),
      });
      assert.strictEqual(resBadCourse.status, 400);
      pass('帶入不存在的 course_id 建立實驗回傳 400 Bad Request');

      // 4.3 Teacher 成功建立實驗 lab-01 (shared 模式)
      const resCreateExp = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          course_id: createdCourseId,
          experiment_code: 'lab-01',
          name: '二極體特性量測',
          repository: 'Lorin1470/ee201-lab-01-repo',
          report_mode: 'shared',
        }),
      });
      assert.strictEqual(resCreateExp.status, 201);
      const expData = await resCreateExp.json();
      createdExpId = expData.experiment.id;
      assert.strictEqual(expData.experiment.experiment_code, 'lab-01');
      assert.strictEqual(expData.experiment.status, 'not_started');
      pass('Teacher 成功建立實驗 lab-01 (201)');

      // 4.4 重複 Repository 綁定測試 -> 409 Conflict (防範一儲存庫跨實驗重複註冊)
      const resDupRepo = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          course_id: createdCourseId,
          experiment_code: 'lab-02',
          name: '重複綁定之實驗',
          repository: 'Lorin1470/ee201-lab-01-repo', // 重複使用同個 Repo
        }),
      });
      assert.strictEqual(resDupRepo.status, 409);
      pass('重複之 Repository 綁定遭阻絕 (409 Conflict)');

      // 4.5 同課程重複 experiment_code -> 409 Conflict
      const resDupCode = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          course_id: createdCourseId,
          experiment_code: 'lab-01', // 重複代號
          name: '同代號實驗',
          repository: 'Lorin1470/ee201-lab-01-diff',
        }),
      });
      assert.strictEqual(resDupCode.status, 409);
      pass('同課程重複 experiment_code 遭阻絕 (409 Conflict)');

      // 4.6 Teacher 修改實驗狀態 (status 流轉至 in_progress)
      const resPatchExp = await fetch(`${BASE_URL}/experiments/${createdExpId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ status: 'in_progress', name: '二極體特性與整流電路' }),
      });
      assert.strictEqual(resPatchExp.status, 200);
      const patchedExp = await resPatchExp.json();
      assert.strictEqual(patchedExp.experiment.status, 'in_progress');
      assert.strictEqual(patchedExp.experiment.name, '二極體特性與整流電路');
      pass('Teacher 成功更新實驗狀態為 in_progress (200)');
    }

    // ----------------------------------------------------
    // 群組 5: 實驗組員配置 (Experiment Membership API)
    // ----------------------------------------------------
    console.log('\n▶ [群組 5: 實驗組別配置與課程前置條件驗證]');
    {
      // 5.1 助教企圖配置組員 -> 403 Forbidden (明確符合：Teacher 才能進行成員配置；Assistant 不取得管理權)
      const resTaAssign = await fetch(`${BASE_URL}/experiments/${createdExpId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.assistant },
        body: JSON.stringify({ github_id: '3001', username: 'studentA', role: 'student', group_name: '第 1 組' }),
      });
      assert.strictEqual(resTaAssign.status, 403);
      pass('助教企圖配置實驗組員遭阻絕 (403，助教不具備配置權)');

      // 5.2 企圖將「未加入課程」的學生 C 配置至實驗 -> 400 Bad Request
      const resNonEnrolled = await fetch(`${BASE_URL}/experiments/${createdExpId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '3003', username: 'studentC', role: 'student', group_name: '第 1 組' }),
      });
      assert.strictEqual(resNonEnrolled.status, 400);
      pass('企圖將未註冊該課程之使用者指派至實驗回傳 400 Bad Request (前置約束健全)');

      // 5.3 Teacher 成功指派學生 A 至實驗 lab-01 第 1 組
      const resAssignA = await fetch(`${BASE_URL}/experiments/${createdExpId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '3001', username: 'studentA', role: 'student', group_name: '第 1 組' }),
      });
      assert.strictEqual(resAssignA.status, 201);
      const assignData = await resAssignA.json();
      expMemberId = assignData.member.id;
      assert.strictEqual(assignData.member.github_id, '3001');
      assert.strictEqual(assignData.member.group_name, '第 1 組');
      pass('Teacher 成功指派學生 A 至實驗第 1 組 (201)');

      // 5.4 重複指派同組員至同實驗 -> 409 Conflict
      const resDupAssign = await fetch(`${BASE_URL}/experiments/${createdExpId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '3001', username: 'studentA', role: 'student' }),
      });
      assert.strictEqual(resDupAssign.status, 409);
      pass('重複指派同一使用者至同實驗回傳 409 Conflict');

      // 5.5 Teacher 修改組別名稱 (PATCH)
      const resPatchGroup = await fetch(`${BASE_URL}/experiments/${createdExpId}/members/${expMemberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ group_name: '第 1 組 (進階組)' }),
      });
      assert.strictEqual(resPatchGroup.status, 200);
      const groupData = await resPatchGroup.json();
      assert.strictEqual(groupData.member.group_name, '第 1 組 (進階組)');
      pass('Teacher 成功更新組員之組別名稱 (200)');

      // 5.6 查詢實驗成員名單
      const resGetExpMems = await fetch(`${BASE_URL}/experiments/${createdExpId}/members`, {
        headers: { Cookie: COOKIES.studentA },
      });
      assert.strictEqual(resGetExpMems.status, 200);
      const expMemsData = await resGetExpMems.json();
      assert(expMemsData.experiment_members.length >= 1);
      pass('已分組學生 A 成功檢視實驗成員名單 (200)');
    }

    // ----------------------------------------------------
    // 群組 6: 權限隔離與身份改名免疫性
    // ----------------------------------------------------
    console.log('\n▶ [群組 6: 實驗分組隔離與 github_id 改名免疫性]');
    {
      // 6.1 將學生 B 加入課程，但「未分配至實驗 lab-01」
      mockD1.prepare('INSERT INTO course_memberships VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
        'cm_sb', createdCourseId, '3002', 'studentB', 'student', 'active', new Date().toISOString(), new Date().toISOString()
      ).run();

      // 6.2 學生 B 直接查詢實驗詳情 -> 404 (存在性遮蔽，隔離未指派學生)
      const resBGetExp = await fetch(`${BASE_URL}/experiments/${createdExpId}`, {
        headers: { Cookie: COOKIES.studentB },
      });
      assert.strictEqual(resBGetExp.status, 404);
      pass('修習該課程但未被指派至該實驗之學生 B，查詢實驗回傳 404 (分組隔離有效)');

      // 6.3 學生 A 變更 GitHub username 為 studentA_super_new_name
      const renamedSession = createSession({
        github_id: '3001',
        username: 'studentA_super_new_name',
        display_name: '新暱稱學生A',
      });
      const resRenamed = await fetch(`${BASE_URL}/experiments/${createdExpId}`, {
        headers: { Cookie: renamedSession },
      });
      assert.strictEqual(resRenamed.status, 200);
      pass('學生更換 GitHub username 後，依舊對所屬實驗具備合法存取權 (不可變 ID 綁定)');
    }

    // ----------------------------------------------------
    // 群組 7: Membership IDOR 防護測試 (URL 與 ID 交叉校驗)
    // ----------------------------------------------------
    console.log('\n▶ [群組 7: Membership IDOR 防護 (跨課程/跨實驗隔離與 404 遮蔽)]');
    {
      // 建立第二門獨立課程 EE203
      const resCourseB = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ course_code: 'EE203', name: '超大型積體電路', semester: '114-1' }),
      });
      assert.strictEqual(resCourseB.status, 201);
      const courseBData = await resCourseB.json();
      courseBId = courseBData.course.id;

      // 7.1 IDOR 測試：以 Course B 的 URL 企圖修改 Course A 的學生成員 -> 404 Not Found
      const resIdorCourse = await fetch(`${BASE_URL}/courses/${courseBId}/members/${studentMemberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ username: 'hacked_name' }),
      });
      assert.strictEqual(resIdorCourse.status, 404);
      pass('以課程 B 的 URL 企圖修改課程 A 之成員，回傳 404 Not Found (IDOR 防護有效)');

      // 建立第二個實驗 lab-02 於 Course A
      const resExp2 = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          course_id: createdCourseId,
          experiment_code: 'lab-02',
          name: '運算放大器量測',
          repository: 'Lorin1470/ee201-lab-02-repo',
          report_mode: 'shared',
        }),
      });
      assert.strictEqual(resExp2.status, 201);
      const exp2Data = await resExp2.json();
      const exp2Id = exp2Data.experiment.id;

      // 7.2 IDOR 測試：以 Exp 2 的 URL 企圖修改 Exp 1 的成員配置 -> 404 Not Found
      const resIdorExp = await fetch(`${BASE_URL}/experiments/${exp2Id}/members/${expMemberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ group_name: '第 99 組' }),
      });
      assert.strictEqual(resIdorExp.status, 404);
      pass('以實驗 2 的 URL 企圖修改實驗 1 之組員配置，回傳 404 Not Found (IDOR 防護有效)');
    }

    // ----------------------------------------------------
    // 群組 8: Last Teacher Protection (最後教師保護)
    // ----------------------------------------------------
    console.log('\n▶ [群組 8: Last Teacher Protection (不可降級或停用唯一教師)]');
    {
      // 在 EE203 (courseBId) 中，teacher_smith 是唯一 active teacher
      let teacherSmithMemId = null;
      for (const m of mockD1.courseMemberships.values()) {
        if (m.course_id === courseBId && m.github_id === '1001' && m.role === 'teacher') {
          teacherSmithMemId = m.id;
          break;
        }
      }
      assert(teacherSmithMemId, '必須能找到 teacher_smith 在 EE203 的 membership');

      // 8.1 企圖將唯一 Teacher 降級為 student -> 400 Bad Request
      const resDemote = await fetch(`${BASE_URL}/courses/${courseBId}/members/${teacherSmithMemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ role: 'student' }),
      });
      assert.strictEqual(resDemote.status, 400);
      const demoteErr = await resDemote.json();
      assert(demoteErr.error.includes('Cannot demote'));
      pass('企圖降級唯一 Active Teacher 遭阻絕 (400 Bad Request)');

      // 8.2 企圖將唯一 Teacher 停用 (status = inactive) -> 400 Bad Request
      const resDeactivate = await fetch(`${BASE_URL}/courses/${courseBId}/members/${teacherSmithMemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ status: 'inactive' }),
      });
      assert.strictEqual(resDeactivate.status, 400);
      const deactErr = await resDeactivate.json();
      assert(deactErr.error.includes('Cannot deactivate'));
      pass('企圖停用唯一 Active Teacher 遭阻絕 (400 Bad Request)');

      // 8.3 加入第二位 Teacher (teacher_jones)
      const teacherJonesSession = createSession({ github_id: '1002', username: 'teacher_jones', display_name: '瓊斯老師' });
      const resAddT2 = await fetch(`${BASE_URL}/courses/${courseBId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '1002', username: 'teacher_jones', role: 'teacher' }),
      });
      assert.strictEqual(resAddT2.status, 201);
      const t2Data = await resAddT2.json();
      const t2MemberId = t2Data.member.id;
      pass('成功加入第二位 Teacher (201)');

      // 8.4 現在有兩位 Teacher，停用 teacher_smith 應成功
      const resDeactWithTwo = await fetch(`${BASE_URL}/courses/${courseBId}/members/${teacherSmithMemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: teacherJonesSession },
        body: JSON.stringify({ status: 'inactive' }),
      });
      assert.strictEqual(resDeactWithTwo.status, 200);
      pass('課程存在其他 Active Teacher 時，允許停用教師成員 (200)');

      // 復原 teacher_smith 為 active teacher
      await fetch(`${BASE_URL}/courses/${courseBId}/members/${teacherSmithMemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: teacherJonesSession },
        body: JSON.stringify({ status: 'active' }),
      });
    }

    // ----------------------------------------------------
    // 群組 9: HTTP DELETE 端點安全禁用 (405 Method Not Allowed)
    // ----------------------------------------------------
    console.log('\n▶ [群組 9: HTTP DELETE 端點禁用 (405 Method Not Allowed)]');
    {
      // 9.1 DELETE /api/courses/:id -> 405
      const resDelCourse = await fetch(`${BASE_URL}/courses/${createdCourseId}`, { method: 'DELETE', headers: { Cookie: COOKIES.teacher } });
      assert.strictEqual(resDelCourse.status, 405);
      pass('DELETE /api/courses/:id 回傳 405 Method Not Allowed');

      // 9.2 DELETE /api/experiments/:id -> 405
      const resDelExp = await fetch(`${BASE_URL}/experiments/${createdExpId}`, { method: 'DELETE', headers: { Cookie: COOKIES.teacher } });
      assert.strictEqual(resDelExp.status, 405);
      pass('DELETE /api/experiments/:id 回傳 405 Method Not Allowed');

      // 9.3 DELETE /api/courses/:id/members/:memberId -> 405
      const resDelCM = await fetch(`${BASE_URL}/courses/${createdCourseId}/members/${studentMemberId}`, { method: 'DELETE', headers: { Cookie: COOKIES.teacher } });
      assert.strictEqual(resDelCM.status, 405);
      pass('DELETE /api/courses/:id/members/:memberId 回傳 405 Method Not Allowed');

      // 9.4 DELETE /api/experiments/:id/members/:memberId -> 405
      const resDelEM = await fetch(`${BASE_URL}/experiments/${createdExpId}/members/${expMemberId}`, { method: 'DELETE', headers: { Cookie: COOKIES.teacher } });
      assert.strictEqual(resDelEM.status, 405);
      pass('DELETE /api/experiments/:id/members/:memberId 回傳 405 Method Not Allowed');
    }

    // ----------------------------------------------------
    // 群組 10: D1 批次原子性 (Atomic Batch) 與約束防護
    // ----------------------------------------------------
    console.log('\n▶ [群組 10: D1 批次原子性與約束防護]');
    {
      // 10.1 驗證 mockD1.batch 在課程建立時有被成功調用
      assert(mockD1.batchCount > 0, 'POST /api/courses 必須使用 env.DB.batch 原子化執行');
      pass('課程建立時確認使用 D1 batch 交易保證原子性 (Course + Teacher Membership)');

      // 10.2 先建立 EE201 (114-2)，再嘗試將其 semester PATCH 改為 114-1 -> 409 Conflict
      const resEE201_2 = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ course_code: 'EE201', name: '電子學(進階)', semester: '114-2' }),
      });
      assert.strictEqual(resEE201_2.status, 201);
      const ee201_2_data = await resEE201_2.json();

      const resSemConflict = await fetch(`${BASE_URL}/courses/${ee201_2_data.course.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ semester: '114-1' }), // 與 createdCourseId (EE201, 114-1) 衝突
      });
      assert.strictEqual(resSemConflict.status, 409);
      pass('PATCH 課程學期導致 (course_code, semester) 重複回傳 409 Conflict');

      // 10.3 POST /api/experiments 使用無效 repository 格式 -> 400 Bad Request
      const resBadRepo = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          course_id: createdCourseId,
          experiment_code: 'lab-99',
          name: '無效Repo實驗',
          repository: 'invalid_repo_format_no_slash',
        }),
      });
      assert.strictEqual(resBadRepo.status, 400);
      pass('實驗 repository 格式不符 (缺少 owner/repo) 回傳 400 Bad Request');
    }

    // ----------------------------------------------------
    // 群組 11: 課程狀態語意 (Archived / Inactive 讀寫與列表過濾)
    // ----------------------------------------------------
    console.log('\n▶ [群組 11: 課程狀態語意 (Archived / Inactive 存取控制)]');
    {
      // 11.1 將課程設為 archived
      await fetch(`${BASE_URL}/courses/${createdCourseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ status: 'archived' }),
      });

      // 學生檢視課程列表：archived 課程可見
      const resCoursesArchived = await fetch(`${BASE_URL}/courses`, { headers: { Cookie: COOKIES.studentA } });
      assert.strictEqual(resCoursesArchived.status, 200);
      const cArchivedData = await resCoursesArchived.json();
      assert(cArchivedData.courses.some(c => c.id === createdCourseId && c.status === 'archived'));
      pass('學生檢視課程清單可看見 archived 課程 (唯讀歷史檢視)');

      // 學生對 archived 課程嘗試發起寫入活動紀錄 -> 403 Forbidden
      const resWriteArchived = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-repo',
          action: 'request_proposal',
          target: 'report/report-3001.md',
          summary: '嘗試在已封存課程中提交提議',
        }),
      });
      assert.strictEqual(resWriteArchived.status, 403);
      const writeArchivedErr = await resWriteArchived.json();
      assert(writeArchivedErr.error.includes('Course is archived'));
      pass('學生對 archived 課程發起寫入操作 (request_proposal) 遭阻絕 (403 Forbidden)');

      // 11.2 將課程設為 inactive
      await fetch(`${BASE_URL}/courses/${createdCourseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ status: 'inactive' }),
      });

      // 學生檢視課程列表：inactive 課程自動過濾消失
      const resCoursesInactive = await fetch(`${BASE_URL}/courses`, { headers: { Cookie: COOKIES.studentA } });
      assert.strictEqual(resCoursesInactive.status, 200);
      const cInactiveData = await resCoursesInactive.json();
      assert(!cInactiveData.courses.some(c => c.id === createdCourseId));
      pass('學生檢視課程清單時，inactive 課程已被自動過濾隱藏');

      // 老師檢視課程列表：仍可看見 inactive 課程以便維護
      const resTeacherCourses = await fetch(`${BASE_URL}/courses`, { headers: { Cookie: COOKIES.teacher } });
      const tCoursesData = await resTeacherCourses.json();
      assert(tCoursesData.courses.some(c => c.id === createdCourseId && c.status === 'inactive'));
      pass('教師檢視課程清單時，保留對 inactive 課程之檢視與維護權限');

      // 學生直接查詢該 inactive 課程詳情 -> 404 (存在性遮蔽)
      const resStudentInactiveCourse = await fetch(`${BASE_URL}/courses/${createdCourseId}`, { headers: { Cookie: COOKIES.studentA } });
      assert.strictEqual(resStudentInactiveCourse.status, 404);
      pass('學生直接查詢 inactive 課程詳情回傳 404 (存在性遮蔽)');

      // 學生查詢 inactive 課程下之實驗清單 -> 404
      const resStudentInactiveExps = await fetch(`${BASE_URL}/experiments?course_id=${createdCourseId}`, { headers: { Cookie: COOKIES.studentA } });
      assert.strictEqual(resStudentInactiveExps.status, 404);
      pass('學生查詢 inactive 課程下之實驗清單回傳 404');

      // 教師嘗試在 inactive 課程中新增實驗 -> 400 Bad Request
      const resAddExpInactive = await fetch(`${BASE_URL}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          course_id: createdCourseId,
          experiment_code: 'lab-inactive',
          name: '停用課程實驗',
          repository: 'Lorin1470/ee201-inactive-repo',
        }),
      });
      assert.strictEqual(resAddExpInactive.status, 400);
      pass('教師企圖在 inactive 課程中建立實驗遭拒絕 (400 Bad Request)');

      // 教師嘗試在 inactive 課程中新增成員 -> 400 Bad Request
      const resAddMemInactive = await fetch(`${BASE_URL}/courses/${createdCourseId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ github_id: '3088', username: 'student88', role: 'student' }),
      });
      assert.strictEqual(resAddMemInactive.status, 400);
      pass('教師企圖在 inactive 課程中新增成員遭拒絕 (400 Bad Request)');

      // 復原為 active
      await fetch(`${BASE_URL}/courses/${createdCourseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({ status: 'active' }),
      });
    }

    // ----------------------------------------------------
    // 群組 12: 操作者身份防偽 (Anti-Spoofing)
    // ----------------------------------------------------
    console.log('\n▶ [群組 12: 操作者身份防偽 (Anti-Spoofing)]');
    {
      // 12.1 學生企圖在 Request Body 偽造身份欄位提權建立課程
      const resSpoofCourse = await fetch(`${BASE_URL}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          course_code: 'HACK101',
          name: '偽造課程',
          semester: '114-1',
          role: 'teacher',
          github_id: '1001', // 假冒 teacher_smith 的 github_id
          username: 'teacher_smith',
        }),
      });
      assert.strictEqual(resSpoofCourse.status, 403);
      pass('學生在 body 偽造 teacher github_id/role 企圖建立課程遭阻絕 (身分鎖定有效)');

      // 12.2 學生企圖偽造身份新增成員
      const resSpoofAddMember = await fetch(`${BASE_URL}/courses/${createdCourseId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          role: 'teacher',
          caller_role: 'teacher',
          github_id: '3009',
          username: 'new_student',
        }),
      });
      assert.strictEqual(resSpoofAddMember.status, 403);
      pass('學生在 body 偽造管理權限企圖新增成員遭阻絕 (身分由 Session 決定)');
    }

    console.log('\n====================================================');
    console.log(`📊 測試總結：通過 ${passCount} 項，失敗 ${failCount} 項`);
    console.log('====================================================\n');

    if (failCount > 0) {
      process.exit(1);
    }
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('測試套件執行失敗:', err);
  process.exit(1);
});
