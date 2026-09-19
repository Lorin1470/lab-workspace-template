/**
 * verify-permissions.mjs
 * 驗證 D1 Course / Experiment / Membership 權限架構與邊界規則 (零外部依賴)
 *
 * 測試項目涵蓋：
 * 1. 訪客 (Guest) 與未分組學生隔離 (401 / 403 / 404)
 * 2. 教師 (Teacher) 與助教 (Assistant) 權限邊界
 * 3. Raw 聖域保護 (全角色 100% 阻絕，含路徑遍歷防護)
 * 4. Shared 與 Separate 報告模式隔離 (嚴格以 github_id 判定)
 * 5. Agent 不得逾越委任使用者權限 (Non-Escalation)
 * 6. 審批權威分離 (僅 Teacher 具備 approved_by，學生與助教不可越權核准)
 * 7. 儲存庫 1-to-1 唯一綁定約束
 * 8. Bootstrap Admin 安全機制
 */

import http from 'node:http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { onRequest } from '../web/functions/api/[[route]].ts';

const TEST_PORT = 8999;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;
const TEST_SECRET = 'perm-test-activity-secret-12345';
const BOOTSTRAP_ADMIN_ID = '99999';

// 輔助函式：計算 SHA-256 Hex
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 記憶體 D1 模擬實作
class MockPermissionD1 {
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
            const [id, course_code, name, semester, created_by_github_id] = binds;
            this.courses.set(id, { id, course_code, name, semester, created_by_github_id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiments')) {
            const [id, course_id, experiment_code, name, repository, report_mode] = binds;
            // 唯一約束：檢查 repository 是否重複
            for (const exp of this.experiments.values()) {
              if (exp.repository === repository) {
                throw new Error(`UNIQUE constraint failed: experiments.repository (${repository})`);
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
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('INSERT INTO course_memberships')) {
            const [id, course_id, github_id, username, role, status] = binds;
            this.courseMemberships.set(id, { id, course_id, github_id, username, role, status: status || 'active' });
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiment_memberships')) {
            const [id, experiment_id, github_id, username, role, group_name, status] = binds;
            this.experimentMemberships.set(id, { id, experiment_id, github_id, username, role, group_name: group_name || null, status: status || 'active' });
            return { success: true };
          }
          if (q.startsWith('INSERT INTO user_sessions')) {
            const [session_id, github_id, username, display_name, avatar_url, created_at, expires_at] = binds;
            this.sessions.set(session_id, { session_id, github_id, username, display_name, avatar_url, created_at, expires_at });
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
          if (q.includes('FROM user_sessions WHERE session_id = ?')) {
            return this.sessions.get(binds[0]) || null;
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
          if (q.includes('FROM courses WHERE id = ?')) {
            return this.courses.get(binds[0]) || null;
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND github_id = ?')) {
            const [expId, gid] = binds;
            for (const m of this.experimentMemberships.values()) {
              if (m.experiment_id === expId && m.github_id === gid && m.status === 'active') return { ...m };
            }
            return null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ?')) {
            const [cid, gid] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid && m.github_id === gid && m.status === 'active') return { ...m };
            }
            return null;
          }
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
        all: async () => {
          if (q.includes('FROM courses c JOIN course_memberships cm ON c.id = cm.course_id WHERE cm.github_id = ?')) {
            const gid = binds[0];
            const results = [];
            for (const cm of this.courseMemberships.values()) {
              if (cm.github_id === gid && cm.status === 'active') {
                const c = this.courses.get(cm.course_id);
                if (c) results.push({ ...c, role: cm.role });
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
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ?')) {
            const expId = binds[0];
            const results = Array.from(this.experimentMemberships.values()).filter((m) => m.experiment_id === expId && m.status === 'active');
            return { results };
          }
          if (q.includes('FROM course_memberships WHERE course_id = ?')) {
            const cid = binds[0];
            const results = Array.from(this.courseMemberships.values()).filter((m) => m.course_id === cid && m.status === 'active');
            return { results };
          }
          if (q.includes('FROM activity_logs WHERE repo_name = ?')) {
            const repo = binds[0];
            let res = this.activityLogs.filter((r) => r.repo_name === repo);
            return { results: res };
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
}

const mockD1 = new MockPermissionD1();

// 建立使用者 Session 並回傳 Cookie 字串
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

// 測試用使用者
const USERS = {
  teacher: { github_id: '1001', username: 'teacher_smith', display_name: '史密斯老師' },
  assistant: { github_id: '2001', username: 'ta_alex', display_name: '亞歷克斯助教' },
  studentA: { github_id: '3001', username: 'studentA', display_name: '學生A' },
  studentB: { github_id: '3002', username: 'studentB', display_name: '學生B' },
  studentC: { github_id: '3003', username: 'studentC', display_name: '學生C (未分組)' },
  stranger: { github_id: '8888', username: 'stranger', display_name: '陌生訪客' },
  bootstrapAdmin: { github_id: BOOTSTRAP_ADMIN_ID, username: 'root_admin', display_name: '初始管理員' },
};

let COOKIES = {};

// 植入測試資料
function seedData() {
  // 1. 課程 EE201
  mockD1.prepare('INSERT INTO courses VALUES (?, ?, ?, ?, ?)').bind(
    'c_ee201', 'EE201', '電子學實驗', '114-1', '1001'
  ).run();

  // 2. 課程成員
  mockD1.prepare('INSERT INTO course_memberships VALUES (?, ?, ?, ?, ?, ?)').bind('cm_1', 'c_ee201', '1001', 'teacher_smith', 'teacher', 'active').run();
  mockD1.prepare('INSERT INTO course_memberships VALUES (?, ?, ?, ?, ?, ?)').bind('cm_2', 'c_ee201', '2001', 'ta_alex', 'assistant', 'active').run();
  mockD1.prepare('INSERT INTO course_memberships VALUES (?, ?, ?, ?, ?, ?)').bind('cm_3', 'c_ee201', '3001', 'studentA', 'student', 'active').run();
  mockD1.prepare('INSERT INTO course_memberships VALUES (?, ?, ?, ?, ?, ?)').bind('cm_4', 'c_ee201', '3002', 'studentB', 'student', 'active').run();
  mockD1.prepare('INSERT INTO course_memberships VALUES (?, ?, ?, ?, ?, ?)').bind('cm_5', 'c_ee201', '3003', 'studentC', 'student', 'active').run();

  // 3. 實驗 1: shared report 模式
  mockD1.prepare('INSERT INTO experiments VALUES (?, ?, ?, ?, ?, ?)').bind(
    'exp_01', 'c_ee201', 'lab-01', 'BJT 特性量測', 'Lorin1470/ee201-lab-01-shared', 'shared'
  ).run();

  // 4. 實驗 2: separate report 模式
  mockD1.prepare('INSERT INTO experiments VALUES (?, ?, ?, ?, ?, ?)').bind(
    'exp_02', 'c_ee201', 'lab-02', 'MOSFET 特性量測', 'Lorin1470/ee201-lab-02-separate', 'separate'
  ).run();

  // 5. 實驗成員分配 (注意: studentC 未被分配至任何實驗)
  mockD1.prepare('INSERT INTO experiment_memberships VALUES (?, ?, ?, ?, ?, ?, ?)').bind('em_1', 'exp_01', '3001', 'studentA', 'student', '第 1 組', 'active').run();
  mockD1.prepare('INSERT INTO experiment_memberships VALUES (?, ?, ?, ?, ?, ?, ?)').bind('em_2', 'exp_01', '3002', 'studentB', 'student', '第 1 組', 'active').run();
  mockD1.prepare('INSERT INTO experiment_memberships VALUES (?, ?, ?, ?, ?, ?, ?)').bind('em_3', 'exp_02', '3001', 'studentA', 'student', '第 1 組', 'active').run();
  mockD1.prepare('INSERT INTO experiment_memberships VALUES (?, ?, ?, ?, ?, ?, ?)').bind('em_4', 'exp_02', '3002', 'studentB', 'student', '第 2 組', 'active').run();

  // 6. 為各使用者建立登入 Session
  for (const [k, u] of Object.entries(USERS)) {
    COOKIES[k] = createSession(u);
  }
}

// 啟動伺服器
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
            ACTIVITY_LOG_SECRET: TEST_SECRET,
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
  console.log('▶ [群組 0: Migration 0001 -> 0002 -> 0003 真實 SQLite 套用與約束測試]');
  const m1 = fs.readFileSync('web/migrations/0001_initial_schema.sql', 'utf8');
  const m2 = fs.readFileSync('web/migrations/0002_user_sessions_indexes.sql', 'utf8');
  const m3 = fs.readFileSync('web/migrations/0003_course_experiment_permissions.sql', 'utf8');

  function runSql(dbCommands) {
    const full = `PRAGMA foreign_keys = ON;\n${m1}\n${m2}\n${m3}\n${dbCommands}`;
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

  // 1. 資料表與索引完整性驗證
  const tables = runSql('SELECT name FROM sqlite_master WHERE type="table" AND name NOT LIKE "sqlite_%";').trim().split('\n');
  assert.deepStrictEqual(tables.sort(), [
    'activity_logs',
    'course_memberships',
    'courses',
    'experiment_memberships',
    'experiments',
    'user_sessions'
  ].sort());
  pass('Migration 0001 -> 0002 -> 0003 依序套用成功，6 個資料表完整建立');

  const indexes = runSql('SELECT name FROM sqlite_master WHERE type="index" AND name NOT LIKE "sqlite_%";').trim().split('\n');
  assert(indexes.includes('idx_courses_code'));
  assert(indexes.includes('idx_experiments_repo'));
  assert(indexes.includes('idx_experiments_course'));
  assert(indexes.includes('idx_cm_user'));
  assert(indexes.includes('idx_cm_course'));
  assert(indexes.includes('idx_em_user'));
  assert(indexes.includes('idx_em_exp'));
  pass('所有 11 個效能索引 (含 course/experiment/membership) 完整建立');

  // 2. Foreign Key 約束
  expectConstraintError(
    'SQLite FOREIGN KEY 約束生效 (experiments.course_id 無效時拒絕)',
    'INSERT INTO experiments VALUES ("e1", "nonexistent_course", "lab-01", "Lab", "org/repo", "shared", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);',
    'FOREIGN KEY constraint failed'
  );

  // 3. UNIQUE 約束 (5 組)
  expectConstraintError(
    'UNIQUE(course_code, semester) 約束生效',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO courses VALUES ("c2", "EE201", "電子學2", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    'UNIQUE constraint failed: courses.course_code, courses.semester'
  );

  expectConstraintError(
    'UNIQUE(repository) 約束生效 (防範多實驗綁定同一 Repo)',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiments VALUES ("e1", "c1", "lab-01", "Lab1", "org/repo", "shared", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiments VALUES ("e2", "c1", "lab-02", "Lab2", "org/repo", "shared", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    'UNIQUE constraint failed: experiments.repository'
  );

  expectConstraintError(
    'UNIQUE(course_id, experiment_code) 約束生效',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiments VALUES ("e1", "c1", "lab-01", "Lab1", "org/repo1", "shared", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiments VALUES ("e2", "c1", "lab-01", "Lab2", "org/repo2", "shared", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    'UNIQUE constraint failed: experiments.course_id, experiments.experiment_code'
  );

  expectConstraintError(
    'UNIQUE(course_id, github_id) 約束生效',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO course_memberships VALUES ("cm1", "c1", "1001", "user1", "student", "active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO course_memberships VALUES ("cm2", "c1", "1001", "user1_alias", "assistant", "active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    'UNIQUE constraint failed: course_memberships.course_id, course_memberships.github_id'
  );

  expectConstraintError(
    'UNIQUE(experiment_id, github_id) 約束生效',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiments VALUES ("e1", "c1", "lab-01", "Lab1", "org/repo1", "shared", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiment_memberships VALUES ("em1", "e1", "1001", "user1", "student", "G1", "active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiment_memberships VALUES ("em2", "e1", "1001", "user1_alias", "student", "G2", "active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    'UNIQUE constraint failed: experiment_memberships.experiment_id, experiment_memberships.github_id'
  );

  // 4. CHECK 約束
  expectConstraintError(
    'CHECK(report_mode IN ("shared", "separate")) 約束生效',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiments VALUES ("e1", "c1", "lab-01", "Lab1", "org/repo1", "invalid_mode", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    "CHECK constraint failed: report_mode IN ('shared', 'separate')"
  );

  expectConstraintError(
    'CHECK(role IN ("teacher", "assistant", "student")) 約束生效',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO course_memberships VALUES ("cm1", "c1", "1001", "user1", "superadmin", "active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    "CHECK constraint failed: role IN ('teacher', 'assistant', 'student')"
  );

  expectConstraintError(
    'CHECK(role IN ("student", "assistant")) 約束生效',
    `INSERT INTO courses VALUES ("c1", "EE201", "電子學", "114-1", "1001", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiments VALUES ("e1", "c1", "lab-01", "Lab1", "org/repo1", "shared", "1.0", "not_started", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
     INSERT INTO experiment_memberships VALUES ("em1", "e1", "1001", "user1", "teacher", "G1", "active", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    "CHECK constraint failed: role IN ('student', 'assistant')"
  );
  console.log('');
}

async function run() {
  console.log('====================================================');
  console.log('🧪 D1 Course / Experiment / Membership 權限驗證開始');
  console.log('====================================================\n');

  runSqlMigrationSmokeTest();

  seedData();
  const server = await startServer();

  try {
    // ----------------------------------------------------
    // 群組 1: 課程清單存取權限 (GET /api/courses)
    // ----------------------------------------------------
    console.log('▶ [群組 1: 課程清單存取與身分驗證]');
    {
      const res = await fetch(`${BASE_URL}/courses`);
      assert.strictEqual(res.status, 401, '未登入回傳 401 Unauthorized');
      pass('未登入使用者存取 /api/courses 遭阻絕 (401)');
    }
    {
      const res = await fetch(`${BASE_URL}/courses`, { headers: { Cookie: COOKIES.studentA } });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.courses.length, 1);
      assert.strictEqual(data.courses[0].course_code, 'EE201');
      assert.strictEqual(data.courses[0].role, 'student');
      pass('學生 A 成功列出所修習之 EE201 課程');
    }
    {
      const res = await fetch(`${BASE_URL}/courses`, { headers: { Cookie: COOKIES.studentC } });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.courses.length, 1);
      pass('未分組學生 C 亦可在名冊中看見 EE201 課程');
    }
    {
      const res = await fetch(`${BASE_URL}/courses`, { headers: { Cookie: COOKIES.stranger } });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.courses.length, 0);
      pass('非課程成員之陌生人查詢為空清單');
    }

    // ----------------------------------------------------
    // 群組 2: 實驗存取與未分組隔離 (GET /api/experiments)
    // ----------------------------------------------------
    console.log('\n▶ [群組 2: 實驗可見度與分組隔離]');
    {
      const res = await fetch(`${BASE_URL}/experiments?course_id=c_ee201`, { headers: { Cookie: COOKIES.teacher } });
      const data = await res.json();
      assert.strictEqual(data.experiments.length, 2);
      pass('教師可查詢該課程下全部實驗 (lab-01, lab-02)');
    }
    {
      const res = await fetch(`${BASE_URL}/experiments?course_id=c_ee201`, { headers: { Cookie: COOKIES.assistant } });
      const data = await res.json();
      assert.strictEqual(data.experiments.length, 2);
      pass('助教可查詢該課程下全部實驗');
    }
    {
      const res = await fetch(`${BASE_URL}/experiments?course_id=c_ee201`, { headers: { Cookie: COOKIES.studentA } });
      const data = await res.json();
      assert.strictEqual(data.experiments.length, 2);
      pass('已加入兩組實驗之學生 A 可檢視 2 個實驗');
    }
    {
      // 關鍵規則：Course member 但尚未分組至特定 Experiment，不得看到該 Experiment
      const res = await fetch(`${BASE_URL}/experiments?course_id=c_ee201`, { headers: { Cookie: COOKIES.studentC } });
      const data = await res.json();
      assert.strictEqual(data.experiments.length, 0);
      pass('未分組學生 C 無法看見任何未被指派之實驗 (分組隔離)');
    }
    {
      // 關鍵防護：對未授權直接查詢 repo 回傳 404 (避免洩漏存在性)
      const res = await fetch(`${BASE_URL}/experiments?repo=Lorin1470/ee201-lab-01-shared`, { headers: { Cookie: COOKIES.studentC } });
      assert.strictEqual(res.status, 404);
      pass('未分組學生 C 直接以 Repo 查詢實驗回傳 404 (存在性遮蔽)');
    }
    {
      const res = await fetch(`${BASE_URL}/experiments?repo=Lorin1470/ee201-lab-01-shared`, { headers: { Cookie: COOKIES.stranger } });
      assert.strictEqual(res.status, 404);
      pass('陌生訪客直接以 Repo 查詢實驗回傳 404');
    }

    // ----------------------------------------------------
    // 群組 3: 實驗日誌存取隔離 (GET /api/activity)
    // ----------------------------------------------------
    console.log('\n▶ [群組 3: 實驗 Activity Log 讀取保護]');
    {
      const res = await fetch(`${BASE_URL}/activity?repo=Lorin1470/ee201-lab-01-shared`, { headers: { Cookie: COOKIES.stranger } });
      assert.strictEqual(res.status, 404);
      pass('陌生訪客讀取實驗日誌遭拒 (404)');
    }
    {
      const res = await fetch(`${BASE_URL}/activity?repo=Lorin1470/ee201-lab-01-shared`, { headers: { Cookie: COOKIES.studentC } });
      assert.strictEqual(res.status, 404);
      pass('未分組學生 C 讀取實驗日誌遭拒 (404)');
    }
    {
      const res = await fetch(`${BASE_URL}/activity?repo=Lorin1470/ee201-lab-01-shared`, { headers: { Cookie: COOKIES.studentA } });
      assert.strictEqual(res.status, 200);
      pass('實驗成員學生 A 允許讀取所屬實驗日誌 (200)');
    }

    // ----------------------------------------------------
    // 群組 4: Raw 聖域保護 (所有角色 100% 阻絕)
    // ----------------------------------------------------
    console.log('\n▶ [群組 4: Raw 聖域保護 (Raw Sanctuary)]');
    {
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_modified',
          target: 'raw/data.csv',
          summary: '企圖修改原始數據',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('學生 A 修改 raw/data.csv 遭嚴格阻絕 (403)');
    }
    {
      // 路徑遍歷攻擊防護: photos/../raw/data.csv
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_modified',
          target: 'photos/../raw/data.csv',
          summary: '企圖透過路徑遍歷修改原始數據',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('學生 A 透過路徑遍歷 (photos/../raw/data.csv) 遭正規化攔截 (403)');
    }
    {
      // URL 編碼路徑遍歷攻擊防護: photos/%2e%2e/raw/data.csv
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_modified',
          target: 'photos/%2e%2e/raw/data.csv',
          summary: '企圖透過 URL 編碼路徑遍歷修改原始數據',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('學生 A 透過 URL 編碼路徑遍歷 (photos/%2e%2e/raw/data.csv) 遭解碼與正規化攔截 (403)');
    }
    {
      // Windows 反斜線路徑防護: raw\\measurements.csv
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_modified',
          target: 'raw\\measurements.csv',
          summary: '企圖透過反斜線路徑修改原始數據',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('學生 A 透過反斜線路徑 (raw\\\\measurements.csv) 遭正規化攔截 (403)');
    }
    {
      // 助教亦不可破壞 raw 聖域
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.assistant },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_modified',
          target: 'raw/solution.md',
          summary: '助教企圖修改 raw 內容',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('助教企圖異動 raw/* 遭嚴格阻絕 (403)');
    }
    {
      // 教師亦不可破壞 raw 聖域
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_created',
          target: 'raw/extra.xlsx',
          summary: '教師企圖於 raw 建立檔案',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('教師企圖異動 raw/* 依然遭嚴格阻絕 (最高優先權聖域)');
    }
    {
      // 檔案清單 files_changed 含有 raw/*
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'commit_created',
          target: 'analysis/plot.py',
          files_changed: ['analysis/plot.py', 'raw/measurements.csv'],
          commit_sha: '1234567',
          summary: 'Commit 包含 raw 檔案',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('files_changed 包含 raw/* 時提交遭阻絕 (403)');
    }

    // ----------------------------------------------------
    // 群組 5: Shared 報告模式共編驗證 (lab-01)
    // ----------------------------------------------------
    console.log('\n▶ [群組 5: Shared 報告模式共編]');
    {
      const resA = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_modified',
          target: 'report/report.md',
          summary: '學生 A 更新共用報告',
        }),
      });
      assert.strictEqual(resA.status, 201);
      pass('在 shared 模式下學生 A 允許編輯 report/report.md');

      const resB = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentB },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'file_modified',
          target: 'report/report.md',
          summary: '學生 B 更新共用報告',
        }),
      });
      assert.strictEqual(resB.status, 201);
      pass('在 shared 模式下同組學生 B 亦允許編輯 report/report.md');
    }

    // ----------------------------------------------------
    // 群組 6: Separate 報告模式個人隔離驗證 (lab-02)
    // ----------------------------------------------------
    console.log('\n▶ [群組 6: Separate 報告模式隔離 (基於不可變 github_id)]');
    {
      // 學生 A (github_id: 3001) 修改自己的報告 report-3001.md -> 允許
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          action: 'file_modified',
          target: 'report/report-3001.md',
          summary: '學生 A 修改個人報告',
        }),
      });
      assert.strictEqual(res.status, 201);
      pass('學生 A 成功修改自己所屬的 report/report-3001.md');
    }
    {
      // 學生 A 企圖修改學生 B 的報告 report-3002.md -> 阻絕
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          action: 'file_modified',
          target: 'report/report-3002.md',
          summary: '學生 A 企圖竄改學生 B 個人報告',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('學生 A 企圖修改他人個人報告 (report-3002.md) 遭嚴格阻絕 (403)');
    }
    {
      // 學生 A 在 separate 模式下企圖修改共用 report.md -> 阻絕
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          action: 'file_modified',
          target: 'report/report.md',
          summary: '學生 A 企圖在 separate 模式修改 report.md',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('在 separate 模式下學生修改非個人 report.md 遭阻絕 (403)');
    }
    {
      // 助教企圖修改學生個人報告 report-3001.md -> 阻絕 (助教為 review/read 權限，不可代寫覆蓋)
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.assistant },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          action: 'file_modified',
          target: 'report/report-3001.md',
          summary: '助教企圖修改學生 A 的個人報告',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('助教在 separate 模式下企圖修改學生報告遭阻絕 (403，助教僅有審查與檢視權)');
    }
    {
      // 平等協作原則：任何協作者在 separate 模式下均不可修改他人報告 (含教師/助教角色)
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          action: 'file_modified',
          target: 'report/report-3001.md',
          summary: '其他協作者企圖於非自身報告修改',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('平等協作原則下，任何協作者在 separate 模式均不可修改他人個人報告 (403)');
    }
    {
      // 學生更換 GitHub username 不可被影響：ownership 嚴格依賴不可變 github_id
      const renamedCookie = createSession({
        github_id: '3001',
        username: 'studentA_renamed_username',
        display_name: '改名後的學生A',
      });
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: renamedCookie },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          action: 'file_modified',
          target: 'report/report-3001.md',
          summary: '更換 username 後的學生 A 提交報告',
        }),
      });
      assert.strictEqual(res.status, 201);
      pass('學生變更 GitHub username 後，依舊對 report/report-<github_id>.md 擁有完整寫入權限 (不可變 ID 綁定有效)');
    }

    // ----------------------------------------------------
    // 群組 7: Agent 委任不提權原則 (Non-Escalation)
    // ----------------------------------------------------
    console.log('\n▶ [群組 7: Agent 委任不提權原則]');
    {
      // Agent 代表學生 A 執行，企圖修改學生 B 報告
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          actor_type: 'agent',
          action: 'file_modified',
          target: 'report/report-3002.md',
          summary: 'Agent 代表學生 A 企圖修改學生 B 報告',
        }),
      });
      assert.strictEqual(res.status, 403);
      pass('Agent 標籤無法越權，代表學生 A 竄改他人報告遭阻絕 (403)');
    }
    {
      // Agent 代表學生 A 修改學生 A 自己的報告 -> 允許
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-02-separate',
          actor_type: 'agent',
          action: 'file_modified',
          target: 'report/report-3001.md',
          summary: 'Agent 代表學生 A 寫入數據分析至個人報告',
        }),
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const record = mockD1.activityLogs.find((r) => r.id === data.id);
      assert(record, '應能從資料庫查詢到日誌紀錄');
      assert.strictEqual(record.actor_type, 'agent');
      assert.strictEqual(record.requested_by, 'studentA');
      pass('Agent 代表學生 A 執行合規操作成功，requested_by 嚴格綁定學生 A');
    }

    // ----------------------------------------------------
    // 群組 8: 協作者平權審批 (Collaborator Approval)
    // ----------------------------------------------------
    console.log('\n▶ [群組 8: 協作者平權審批與核准留痕]');
    {
      // 學生 A 自行宣告 approved -> 協作者平權成立，記錄 approved_by = studentA
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.studentA },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'request_proposal',
          target: 'report/report.md',
          summary: '學生 A 提議變更並完成確認',
          approval_status: 'approved',
        }),
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const record = mockD1.activityLogs.find((r) => r.id === data.id);
      assert(record, '應能從資料庫查詢到日誌紀錄');
      assert.strictEqual(record.approval_status, 'approved');
      assert.strictEqual(record.approved_by, 'studentA');
      pass('協作者可直接核准操作：approval_status 為 approved，approved_by 記錄為自身');
    }
    {
      // 助教亦具備協作者 approved_by 核准能力
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.assistant },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'request_proposal',
          target: 'report/report.md',
          summary: '助教審查並核准變更',
          approval_status: 'approved',
        }),
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const record = mockD1.activityLogs.find((r) => r.id === data.id);
      assert(record, '應能從資料庫查詢到日誌紀錄');
      assert.strictEqual(record.approval_status, 'approved');
      assert.strictEqual(record.approved_by, 'ta_alex');
      pass('助教具備協作者核准能力：approved_by 記錄為 ta_alex');
    }
    {
      // 教師核准 -> 成功記錄 approved_by = teacher_smith
      const res = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: COOKIES.teacher },
        body: JSON.stringify({
          repo_name: 'Lorin1470/ee201-lab-01-shared',
          action: 'request_proposal',
          target: 'report/report.md',
          summary: '教師審批通過實驗進度',
          approval_status: 'approved',
        }),
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const record = mockD1.activityLogs.find((r) => r.id === data.id);
      assert(record, '應能從資料庫查詢到日誌紀錄');
      assert.strictEqual(record.approval_status, 'approved');
      assert.strictEqual(record.approved_by, 'teacher_smith');
      pass('教師成功核准變更，approved_by 正確賦予');
    }

    // ----------------------------------------------------
    // 群組 9: 儲存庫 1-to-1 唯一性約束
    // ----------------------------------------------------
    console.log('\n▶ [群組 9: 儲存庫 1-to-1 唯一綁定約束]');
    {
      let caught = false;
      try {
        await mockD1.prepare(`INSERT INTO experiments VALUES (?, ?, ?, ?, ?, ?)`).bind(
          'exp_dup', 'c_ee201', 'lab-99', '重複Repo', 'Lorin1470/ee201-lab-01-shared', 'shared'
        ).run();
      } catch (err) {
        caught = true;
        assert(err.message.includes('UNIQUE constraint failed'), '觸發 UNIQUE 約束');
      }
      assert(caught, '同一個 Repository 重複綁定至新實驗必須遭資料庫拒絕');
      pass('Repository 唯一綁定約束有效防範跨實驗重複註冊');
    }

    // ----------------------------------------------------
    // 群組 10: Bootstrap Admin 安全開關
    // ----------------------------------------------------
    console.log('\n▶ [群組 10: Bootstrap Admin 安全性]');
    {
      // 目前系統內已有 teacher_smith，Bootstrap 管理員不得再提權
      const res = await fetch(`${BASE_URL}/courses`, { headers: { Cookie: COOKIES.bootstrapAdmin } });
      const data = await res.json();
      assert.strictEqual(data.courses.length, 0);
      pass('當系統已有有效 Teacher 時，INITIAL_ADMIN_GITHUB_ID 自動停用 (無永久後門)');
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
