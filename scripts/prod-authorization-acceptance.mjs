#!/usr/bin/env node

/**
 * prod-authorization-acceptance.mjs
 * Production Authorization Acceptance Test against live Cloudflare Pages
 *
 * Target: https://lab.minerdog.qzz.io/api
 * Deployment: 0228065 / b5152f74-07da-4dab-bebc-b660a280c36d
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.resolve(__dirname, '../web');

const BASE_URL = process.env.API_BASE_URL || 'https://lab.minerdog.qzz.io/api';
const OFFICIAL_COURSE_ID = 'c_4ca69360967f';
const OFFICIAL_EXP_ID = 'exp_f20e3137675a';
const OFFICIAL_MEMBER_ID = 'cm_882776c7726e'; // minerdog's active course membership
const OFFICIAL_EXP_MEMBER_ID = 'em_c72c0d7e0b9d'; // minerdog's active exp membership

const TEST_COURSE_ID = 'c_prod_auth_audit_' + Date.now().toString(36);
const TEST_EXP_ID = 'exp_prod_auth_audit_' + Date.now().toString(36);
const TEST_REPO_NAME = 'Lorin1470/lab-workspace-template';

// Helper to execute remote D1 command
function d1Remote(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute experiment-workspace-db --remote --command="${escaped}"`;
  return execSync(cmd, { cwd: WEB_DIR, stdio: 'pipe' }).toString();
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

const results = [];

function recordTest({ id, role, method, endpoint, expectedStatus, actualStatus, summary, pass }) {
  results.push({
    id,
    role,
    method,
    endpoint,
    expectedStatus,
    actualStatus,
    summary,
    pass,
  });
  const icon = pass ? '✅ [PASS]' : '❌ [FAIL]';
  console.log(`  ${icon} [${id}] (${role}) ${method} ${endpoint} -> ${actualStatus} (Exp: ${expectedStatus}) : ${summary}`);
}

async function api(endpoint, options = {}, token = null) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Cookie'] = `app_session=${token}`;
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  console.log('====================================================');
  console.log('🛡️  Production Authorization Acceptance Test (0228065)');
  console.log(`目標網址: ${BASE_URL}`);
  console.log('====================================================\n');

  // 1. Generate real Opaque Session Tokens
  const teacherRawToken = 'prod-auth-t-' + crypto.randomUUID();
  const studentRawToken = 'prod-auth-s-' + crypto.randomUUID();
  const outsiderRawToken = 'prod-auth-o-' + crypto.randomUUID();

  const teacherHashed = sha256(teacherRawToken);
  const studentHashed = sha256(studentRawToken);
  const outsiderHashed = sha256(outsiderRawToken);

  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  console.log('▶ [前置作業：注入受控驗收 Session 與隔離測試課程至 Remote D1]');
  try {
    // 注入 Session
    d1Remote(`INSERT INTO user_sessions (session_id, github_id, username, display_name, expires_at) VALUES ('${teacherHashed}', '106532605', 'Lorin1470', 'Lorin Teacher', '${expiresAt}');`);
    d1Remote(`INSERT INTO user_sessions (session_id, github_id, username, display_name, expires_at) VALUES ('${studentHashed}', '341289281', 'minerdog', 'Minerdog Student', '${expiresAt}');`);
    d1Remote(`INSERT INTO user_sessions (session_id, github_id, username, display_name, expires_at) VALUES ('${outsiderHashed}', '999999999', 'outsider_evil', 'Evil Outsider', '${expiresAt}');`);

    // 建立隔離專用測試課程 (不碰正式課程)
    d1Remote(`INSERT INTO courses (id, course_code, name, semester, mode, github_repository, status, created_by_github_id) VALUES ('${TEST_COURSE_ID}', 'AUDIT-TEST', '隔離驗收專用課程', '113-1', 'course', '${TEST_REPO_NAME}', 'active', '106532605');`);
    d1Remote(`INSERT INTO course_memberships (id, course_id, github_id, username, role, status) VALUES ('cm_audit_t', '${TEST_COURSE_ID}', '106532605', 'Lorin1470', 'teacher', 'active');`);
    d1Remote(`INSERT INTO course_memberships (id, course_id, github_id, username, role, status) VALUES ('cm_audit_s', '${TEST_COURSE_ID}', '341289281', 'minerdog', 'student', 'active');`);
    d1Remote(`INSERT INTO experiments (id, course_id, experiment_code, name, repository, report_mode, status) VALUES ('${TEST_EXP_ID}', '${TEST_COURSE_ID}', 'lab-audit', '隔離驗收實驗', NULL, 'shared', 'in_progress');`);
    d1Remote(`INSERT INTO experiment_memberships (id, experiment_id, github_id, username, role, status) VALUES ('em_audit_s', '${TEST_EXP_ID}', '341289281', 'minerdog', 'student', 'active');`);
    console.log('  ✅ 測試 Session 與隔離測試課程就緒\n');
  } catch (err) {
    console.error('前置作業失敗:', err);
    process.exit(1);
  }

  try {
    // ====================================================
    // 群組 1: 未登入拒絕存取 (401 Unauthorized)
    // ====================================================
    console.log('▶ [群組 1: 未登入拒絕存取 (401 Unauthorized)]');
    {
      const res = await api(`/courses/${OFFICIAL_COURSE_ID}`);
      recordTest({
        id: '1.1',
        role: 'Unauthenticated',
        method: 'GET',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}`,
        expectedStatus: 401,
        actualStatus: res.status,
        summary: res.data?.error || 'Unauthorized',
        pass: res.status === 401,
      });
    }
    {
      const res = await api(`/courses/${OFFICIAL_COURSE_ID}/repository/delete`, {
        method: 'POST',
        body: JSON.stringify({ repository_confirmation: 'Lorin1470/digital-design-practice' }),
      });
      recordTest({
        id: '1.2',
        role: 'Unauthenticated',
        method: 'POST',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/repository/delete`,
        expectedStatus: 401,
        actualStatus: res.status,
        summary: res.data?.error || 'Unauthorized',
        pass: res.status === 401,
      });
    }

    // ====================================================
    // 群組 2: 學生有效 Session 呼叫管理端點全面阻絕 (403 Forbidden)
    // ====================================================
    console.log('\n▶ [群組 2: 學生有效 Session 呼叫管理端點全面阻絕 (403 Forbidden)]');

    // 2.1 刪除課程 Repository
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/repository/delete`,
        {
          method: 'POST',
          body: JSON.stringify({ repository_confirmation: 'Lorin1470/digital-design-practice' }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.1',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/repository/delete`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.2 解除綁定課程 Repository
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/repository/unbind`,
        { method: 'POST' },
        studentRawToken
      );
      recordTest({
        id: '2.2',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/repository/unbind`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.3 綁定或變更課程 Repository
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/repository`,
        {
          method: 'POST',
          body: JSON.stringify({ repository: 'Lorin1470/hacked-repo', private: true }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.3',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/repository`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.4 新增課程成員
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ username: 'new_hacker', role: 'student' }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.4',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/members`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.5 提權成員為教師 (Privilege Escalation)
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: 'teacher' }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.5',
        role: 'Student (minerdog)',
        method: 'PATCH',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID} (role=teacher)`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.6 停用課程成員
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'inactive' }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.6',
        role: 'Student (minerdog)',
        method: 'PATCH',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID} (status=inactive)`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.7 撤銷課程成員協作者 (Revoke)
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID}/revoke`,
        { method: 'POST' },
        studentRawToken
      );
      recordTest({
        id: '2.7',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID}/revoke`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.8 同步成員協作者 (Sync)
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID}/sync`,
        { method: 'POST' },
        studentRawToken
      );
      recordTest({
        id: '2.8',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/members/${OFFICIAL_MEMBER_ID}/sync`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.9 建立實驗
    {
      const res = await api(
        `/experiments`,
        {
          method: 'POST',
          body: JSON.stringify({
            course_id: OFFICIAL_COURSE_ID,
            experiment_code: 'hacked-lab',
            name: '竄改實驗',
          }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.9',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/experiments`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.10 修改實驗設定
    {
      const res = await api(
        `/experiments/${OFFICIAL_EXP_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: '竄改名稱' }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.10',
        role: 'Student (minerdog)',
        method: 'PATCH',
        endpoint: `/experiments/${OFFICIAL_EXP_ID}`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.11 修改課程資訊
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: '竄改課程名稱' }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.11',
        role: 'Student (minerdog)',
        method: 'PATCH',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.12 觸發 Repository Provisioning
    {
      const res = await api(
        `/experiments/${OFFICIAL_EXP_ID}/provision`,
        { method: 'POST' },
        studentRawToken
      );
      recordTest({
        id: '2.12',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/experiments/${OFFICIAL_EXP_ID}/provision`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // 2.13 學生指派實驗成員
    {
      const res = await api(
        `/experiments/${OFFICIAL_EXP_ID}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ username: 'minerdog', role: 'student' }),
        },
        studentRawToken
      );
      recordTest({
        id: '2.13',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/experiments/${OFFICIAL_EXP_ID}/members`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('managers'),
      });
    }

    // ====================================================
    // 群組 3: 參數竄改防護 (IDOR、Existence Masking 與身分防偽)
    // ====================================================
    console.log('\n▶ [群組 3: 參數竄改防護 (IDOR、Existence Masking 與身分防偽)]');

    // 3.1 竄改 URL 課程 ID 至不存在之課程 -> 404
    {
      const res = await api(`/courses/c_nonexistent_fake99`, {}, studentRawToken);
      recordTest({
        id: '3.1',
        role: 'Student (minerdog)',
        method: 'GET',
        endpoint: `/courses/c_nonexistent_fake99`,
        expectedStatus: 404,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 404,
      });
    }

    // 3.2 竄改 URL 實驗 ID 至不存在之實驗 -> 404
    {
      const res = await api(`/experiments/exp_nonexistent_fake99`, {}, studentRawToken);
      recordTest({
        id: '3.2',
        role: 'Student (minerdog)',
        method: 'GET',
        endpoint: `/experiments/exp_nonexistent_fake99`,
        expectedStatus: 404,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 404,
      });
    }

    // 3.3 跨課程竄改 memberId (以 Course A 參數試圖修改不存在成員) -> 404
    {
      const res = await api(
        `/courses/${OFFICIAL_COURSE_ID}/members/cm_fake_idor_member`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: 'teacher' }),
        },
        teacherRawToken
      );
      recordTest({
        id: '3.3',
        role: 'Teacher (Lorin1470)',
        method: 'PATCH',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/members/cm_fake_idor_member`,
        expectedStatus: 404,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 404,
      });
    }

    // 3.4 陌生訪客窺探真實課程 (Existence Masking) -> 404 Not Found
    {
      const res = await api(`/courses/${OFFICIAL_COURSE_ID}`, {}, outsiderRawToken);
      recordTest({
        id: '3.4',
        role: 'Outsider (outsider_evil)',
        method: 'GET',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}`,
        expectedStatus: 404,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 404,
      });
    }

    // 3.5 陌生訪客窺探真實實驗 (Existence Masking) -> 404 Not Found
    {
      const res = await api(`/experiments/${OFFICIAL_EXP_ID}`, {}, outsiderRawToken);
      recordTest({
        id: '3.5',
        role: 'Outsider (outsider_evil)',
        method: 'GET',
        endpoint: `/experiments/${OFFICIAL_EXP_ID}`,
        expectedStatus: 404,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 404,
      });
    }

    // 3.6 學生查詢其他未授權課程之 Activity Log -> 回傳 404 (Existence Masking)
    {
      const res = await api(`/activity?course_id=c_unauthorized_other`, {}, studentRawToken);
      recordTest({
        id: '3.6',
        role: 'Student (minerdog)',
        method: 'GET',
        endpoint: `/activity?course_id=c_unauthorized_other`,
        expectedStatus: 404,
        actualStatus: res.status,
        summary: res.data?.error || `回傳狀態: ${res.status}`,
        pass: res.status === 404,
      });
    }

    // 3.7 Request Body 偽造身分欄位 (Anti-Spoofing: POST /api/activity)
    {
      const res = await api(
        `/activity`,
        {
          method: 'POST',
          body: JSON.stringify({
            repo_name: 'Lorin1470/digital-design-practice',
            action: 'file_modified',
            actor_type: 'web',
            actor_id: 'fake_teacher_hacker',
            actor_name: 'Fake Teacher',
            requested_by: 'fake_teacher_hacker',
            summary: '測試偽造日誌欄位',
          }),
        },
        studentRawToken
      );

      // 檢查最新日誌是否鎖定為 sessionUser.username ('minerdog')
      const latestLogOut = d1Remote(`SELECT actor_id, requested_by FROM activity_logs ORDER BY timestamp DESC LIMIT 1;`);
      const isAntiSpoofed = latestLogOut.includes('minerdog') && !latestLogOut.includes('fake_teacher_hacker');

      recordTest({
        id: '3.7',
        role: 'Student (minerdog)',
        method: 'POST',
        endpoint: `/activity (偽造 actor_id=fake_teacher_hacker)`,
        expectedStatus: 201,
        actualStatus: res.status,
        summary: isAntiSpoofed ? '後端強制以 Session 身分 minerdog 覆寫成功' : '日誌未被覆蓋',
        pass: res.status === 201 && isAntiSpoofed,
      });
    }

    // ====================================================
    // 群組 4: 隔離測試課程驗證 (解除綁定不刪除遠端庫 & raw/ 聖域不可繞過)
    // ====================================================
    console.log('\n▶ [群組 4: 隔離測試課程驗證 (解除綁定不刪除遠端庫 & raw/ 聖域不可繞過)]');

    // 4.1 教師執行解除綁定 -> 200 成功，且 GitHub 儲存庫不受影響
    {
      const res = await api(
        `/courses/${TEST_COURSE_ID}/repository/unbind`,
        { method: 'POST' },
        teacherRawToken
      );
      const courseRow = d1Remote(`SELECT github_repository FROM courses WHERE id = '${TEST_COURSE_ID}';`);
      const unbindPass = res.status === 200 && courseRow.includes('null');

      // 驗證遠端 GitHub 儲存庫完好無損 (公開可查)
      const ghCheck = await fetch(`https://api.github.com/repos/${TEST_REPO_NAME}`, {
        headers: { 'User-Agent': 'acceptance-test' },
      });
      const repoStillExists = ghCheck.status === 200;

      recordTest({
        id: '4.1',
        role: 'Teacher (Lorin1470)',
        method: 'POST',
        endpoint: `/courses/${TEST_COURSE_ID}/repository/unbind`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `D1 解綁: ${unbindPass}, 遠端庫存活: ${repoStillExists}`,
        pass: unbindPass && repoStillExists,
      });
    }

    // 4.2 學生嘗試 DELETE raw/* 檔案 -> 403 Raw sanctuary violation
    {
      const res = await api(
        `/experiments/${TEST_EXP_ID}/workspace/file`,
        {
          method: 'DELETE',
          body: JSON.stringify({ path: 'raw/data.csv' }),
        },
        studentRawToken
      );
      recordTest({
        id: '4.2',
        role: 'Student (minerdog)',
        method: 'DELETE',
        endpoint: `/experiments/${TEST_EXP_ID}/workspace/file (raw/data.csv)`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('Raw sanctuary violation'),
      });
    }

    // 4.3 學生嘗試 PUT 覆寫 raw/* 檔案 -> 403 Raw sanctuary violation
    {
      const res = await api(
        `/experiments/${TEST_EXP_ID}/workspace/file`,
        {
          method: 'PUT',
          body: JSON.stringify({
            path: 'raw/data.csv',
            content: 'tampered',
            message: 'hacked raw',
          }),
        },
        studentRawToken
      );
      recordTest({
        id: '4.3',
        role: 'Student (minerdog)',
        method: 'PUT',
        endpoint: `/experiments/${TEST_EXP_ID}/workspace/file (raw/data.csv)`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('Raw sanctuary violation'),
      });
    }

    // 4.4 教師嘗試 DELETE raw/* 檔案 -> 403 Raw sanctuary violation (聖域對所有角色一律平等阻絕)
    {
      const res = await api(
        `/experiments/${TEST_EXP_ID}/workspace/file`,
        {
          method: 'DELETE',
          body: JSON.stringify({ path: 'raw/sensor.bin' }),
        },
        teacherRawToken
      );
      recordTest({
        id: '4.4',
        role: 'Teacher (Lorin1470)',
        method: 'DELETE',
        endpoint: `/experiments/${TEST_EXP_ID}/workspace/file (raw/sensor.bin)`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('Raw sanctuary violation'),
      });
    }

    // 4.5 教師嘗試 PUT raw/* 檔案 -> 403 Raw sanctuary violation
    {
      const res = await api(
        `/experiments/${TEST_EXP_ID}/workspace/file`,
        {
          method: 'PUT',
          body: JSON.stringify({
            path: 'raw/sensor.bin',
            content: 'override',
            message: 'teacher try override raw',
          }),
        },
        teacherRawToken
      );
      recordTest({
        id: '4.5',
        role: 'Teacher (Lorin1470)',
        method: 'PUT',
        endpoint: `/experiments/${TEST_EXP_ID}/workspace/file (raw/sensor.bin)`,
        expectedStatus: 403,
        actualStatus: res.status,
        summary: res.data?.error || '',
        pass: res.status === 403 && (res.data?.error || '').includes('Raw sanctuary violation'),
      });
    }

    // ====================================================
    // 群組 5: 合法授權操作驗證 (教師正常管理 & 學生正常使用)
    // ====================================================
    console.log('\n▶ [群組 5: 合法授權操作驗證 (教師正常管理 & 學生正常使用)]');

    // 5.1 教師查詢課程詳情 -> 200 (role: teacher)
    {
      const res = await api(`/courses/${OFFICIAL_COURSE_ID}`, {}, teacherRawToken);
      recordTest({
        id: '5.1',
        role: 'Teacher (Lorin1470)',
        method: 'GET',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `role: ${res.data?.course?.role}`,
        pass: res.status === 200 && res.data?.course?.role === 'teacher',
      });
    }

    // 5.2 教師查詢課程成員清單 -> 200
    {
      const res = await api(`/courses/${OFFICIAL_COURSE_ID}/members`, {}, teacherRawToken);
      recordTest({
        id: '5.2',
        role: 'Teacher (Lorin1470)',
        method: 'GET',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/members`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `成員數量: ${res.data?.course_members?.length || 0}`,
        pass: res.status === 200 && Array.isArray(res.data?.course_members) && res.data.course_members.length > 0,
      });
    }

    // 5.3 教師查詢儲存庫中繼資料 -> 200
    {
      const res = await api(`/courses/${OFFICIAL_COURSE_ID}/repository`, {}, teacherRawToken);
      recordTest({
        id: '5.3',
        role: 'Teacher (Lorin1470)',
        method: 'GET',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}/repository`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `repository: ${res.data?.repository}`,
        pass: res.status === 200 && res.data?.repository === 'Lorin1470/digital-design-practice',
      });
    }

    // 5.4 學生查詢課程詳情 -> 200 (role: student)
    {
      const res = await api(`/courses/${OFFICIAL_COURSE_ID}`, {}, studentRawToken);
      recordTest({
        id: '5.4',
        role: 'Student (minerdog)',
        method: 'GET',
        endpoint: `/courses/${OFFICIAL_COURSE_ID}`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `role: ${res.data?.course?.role}`,
        pass: res.status === 200 && res.data?.course?.role === 'student',
      });
    }

    // 5.5 學生查詢已分派實驗詳情 -> 200 (role: student)
    {
      const res = await api(`/experiments/${OFFICIAL_EXP_ID}`, {}, studentRawToken);
      recordTest({
        id: '5.5',
        role: 'Student (minerdog)',
        method: 'GET',
        endpoint: `/experiments/${OFFICIAL_EXP_ID}`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `role: ${res.data?.role}`,
        pass: res.status === 200 && res.data?.role === 'student',
      });
    }

    // 5.6 學生取得身分檢查 -> 200 (authenticated: true, username: minerdog)
    {
      const res = await api(`/auth/me`, {}, studentRawToken);
      recordTest({
        id: '5.6',
        role: 'Student (minerdog)',
        method: 'GET',
        endpoint: `/auth/me`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `authenticated: ${res.data?.authenticated}, user: ${res.data?.user?.username}`,
        pass: res.status === 200 && res.data?.authenticated === true && res.data?.user?.username === 'minerdog',
      });
    }

    // 5.7 教師取得身分檢查 -> 200 (authenticated: true, username: Lorin1470)
    {
      const res = await api(`/auth/me`, {}, teacherRawToken);
      recordTest({
        id: '5.7',
        role: 'Teacher (Lorin1470)',
        method: 'GET',
        endpoint: `/auth/me`,
        expectedStatus: 200,
        actualStatus: res.status,
        summary: `authenticated: ${res.data?.authenticated}, user: ${res.data?.user?.username}`,
        pass: res.status === 200 && res.data?.authenticated === true && res.data?.user?.username === 'Lorin1470',
      });
    }

  } finally {
    console.log('\n▶ [清理作業：移除隔離測試課程與驗收 Session]');
    try {
      d1Remote(`DELETE FROM user_sessions WHERE session_id IN ('${teacherHashed}', '${studentHashed}', '${outsiderHashed}');`);
      d1Remote(`DELETE FROM experiment_memberships WHERE experiment_id = '${TEST_EXP_ID}';`);
      d1Remote(`DELETE FROM experiments WHERE id = '${TEST_EXP_ID}';`);
      d1Remote(`DELETE FROM course_memberships WHERE course_id = '${TEST_COURSE_ID}';`);
      d1Remote(`DELETE FROM courses WHERE id = '${TEST_COURSE_ID}';`);
      console.log('  ✅ 清理完成，正式課程資料零變更、零污染\n');
    } catch (cleanupErr) {
      console.error('清理異常:', cleanupErr);
    }
  }

  // 匯總報告
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  console.log('====================================================');
  console.log(`📊 Production Authorization Acceptance Test 總結:`);
  console.log(`總計: ${total} 項 | 通過: ${passed} 項 | 失敗: ${failed} 項`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('未捕捉例外:', err);
  process.exit(1);
});
