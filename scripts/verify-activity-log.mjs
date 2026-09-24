#!/usr/bin/env node

/**
 * test-activity-log.mjs
 * 驗證 Activity Log v1.2 本地 API、D1 模型與 CLI 回報工具之完整測試套件
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { onRequest } from '../web/functions/api/[[route]].ts';

const execFileAsync = promisify(execFile);
const TEST_SECRET = 'test-activity-secret-token-xyz';
const TEST_REPO = 'Lorin1470/electronics-lab-01';

// 模擬 Cloudflare D1 資料庫
class MockD1 {
  constructor() {
    this.records = [];
    this.lastQuery = null;
    this.lastBinds = null;
  }

  prepare(query) {
    return {
      bind: (...binds) => {
        this.lastQuery = query;
        this.lastBinds = binds;
        return {
          run: async () => {
            if (query.trim().startsWith('INSERT INTO activity_logs')) {
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
              this.records.push(record);
              return { success: true };
            }
            return { success: true };
          },
          all: async () => {
            let res = [...this.records];
            if (query.includes('WHERE repo_name = ?')) {
              const repo = binds[0];
              res = res.filter((r) => r.repo_name === repo);
              if (query.includes('AND experiment_id = ?')) {
                const exp = binds[1];
                res = res.filter((r) => r.experiment_id === exp);
              }
            }
            res.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            const limit = binds[binds.length - 1];
            if (typeof limit === 'number') {
              res = res.slice(0, limit);
            }
            return { results: res };
          },
        };
      },
    };
  }
}

const mockD1 = new MockD1();

// 建立本地測試伺服器模擬 Cloudflare Pages Functions
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

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

// 測試執行器
async function runTests() {
  console.log('\n====================================================');
  console.log('🧪 Activity Log v1.2 完整驗證測試開始');
  console.log('====================================================\n');

  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}/api/activity`;
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ ${message}`);
      passCount++;
    } else {
      console.error(`  ❌ ${message}`);
      failCount++;
    }
  }

  try {
    // ----------------------------------------------------
    // 測試 1: 正常 request_proposal
    // ----------------------------------------------------
    console.log('▶ [測試 1] 正常 request_proposal (提出計畫，無 SHA)');
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        experiment_id: 'lab-01',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        requested_by: 'studentA',
        approval_status: 'pending',
        action: 'request_proposal',
        target: 'report/report-studentA.md',
        summary: '向 studentA 提出個人實驗報告大綱與理論章節規劃',
      }),
    });
    assert(res1.status === 201, `狀態碼應為 201 (實際: ${res1.status})`);
    const record1 = mockD1.records.find((r) => r.action === 'request_proposal');
    assert(record1 && record1.approval_status === 'pending', 'approval_status 應為 pending');
    assert(record1 && record1.commit_sha === null, 'request_proposal 之 commit_sha 必須為 null');

    // ----------------------------------------------------
    // 測試 2: 正常 file_created
    // ----------------------------------------------------
    console.log('\n▶ [測試 2] 正常 file_created (本地建立檔案，無 SHA)');
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        experiment_id: 'lab-01',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        requested_by: 'studentA',
        approved_by: 'studentA',
        approval_status: 'approved',
        action: 'file_created',
        target: 'report/report-studentA.md',
        files_changed: ['report/report-studentA.md'],
        summary: '在本地實際建立 report/report-studentA.md 檔案',
      }),
    });
    assert(res2.status === 201, `狀態碼應為 201 (實際: ${res2.status})`);
    const record2 = mockD1.records.find((r) => r.action === 'file_created');
    assert(record2 && record2.commit_sha === null, 'file_created 之 commit_sha 必須為 null');
    assert(record2 && record2.files_changed.includes('report-studentA.md'), 'files_changed 應記錄目標檔案');

    // ----------------------------------------------------
    // 測試 3: 正常 file_modified
    // ----------------------------------------------------
    console.log('\n▶ [測試 3] 正常 file_modified (本地修改檔案，無 SHA)');
    const res3 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        experiment_id: 'lab-01',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        requested_by: 'studentA',
        approved_by: 'studentA',
        approval_status: 'approved',
        action: 'file_modified',
        target: 'report/report-studentA.md',
        files_changed: ['report/report-studentA.md'],
        summary: '在本地補充 studentA 報告之實驗理論原理公式',
      }),
    });
    assert(res3.status === 201, `狀態碼應為 201 (實際: ${res3.status})`);
    const record3 = mockD1.records.find((r) => r.action === 'file_modified');
    assert(record3 && record3.commit_sha === null, 'file_modified 之 commit_sha 必須為 null');

    // ----------------------------------------------------
    // 測試 4: 正常 commit_created
    // ----------------------------------------------------
    console.log('\n▶ [測試 4] 正常 commit_created (本地 Git Commit 成功，必須帶 SHA)');
    const res4 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        experiment_id: 'lab-01',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        requested_by: 'studentA',
        approved_by: 'studentA',
        approval_status: 'approved',
        action: 'commit_created',
        target: 'report/report-studentA.md',
        files_changed: ['report/report-studentA.md'],
        commit_sha: '2847bab',
        summary: '[lab-01] 新增 studentA 個人報告之 RC 電路實驗目的與理論推導',
      }),
    });
    assert(res4.status === 201, `狀態碼應為 201 (實際: ${res4.status})`);
    const record4 = mockD1.records.find((r) => r.action === 'commit_created');
    assert(record4 && record4.commit_sha === '2847bab', 'commit_created 必須正確儲存 commit_sha');

    // ----------------------------------------------------
    // 測試 5: 正常 push_completed
    // ----------------------------------------------------
    console.log('\n▶ [測試 5] 正常 push_completed (遠端 Push 成功，必須帶 SHA)');
    const res5 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        experiment_id: 'lab-01',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        requested_by: 'studentA',
        approved_by: 'studentA',
        approval_status: 'approved',
        action: 'push_completed',
        target: 'origin/main',
        commit_sha: '2847bab',
        summary: '成功將 commit 2847bab 推送至 GitHub origin/main',
      }),
    });
    assert(res5.status === 201, `狀態碼應為 201 (實際: ${res5.status})`);
    const record5 = mockD1.records.find((r) => r.action === 'push_completed');
    assert(record5 && record5.commit_sha === '2847bab', 'push_completed 必須正確儲存 commit_sha');

    // ----------------------------------------------------
    // 測試 6: request_rejected (安全拒絕)
    // ----------------------------------------------------
    console.log('\n▶ [測試 6] request_rejected (越權操作遭拒：approval=rejected, 無 SHA, 無 files_changed)');
    const res6 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        experiment_id: 'lab-01',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        requested_by: 'studentA',
        approval_status: 'rejected',
        action: 'request_rejected',
        target: 'report/report-studentB.md',
        summary: '拒絕 studentA 越權修改 studentB 個人報告之要求',
        details_json: { rejection_reason: '跨成員報告安全規則限制' },
      }),
    });
    assert(res6.status === 201, `狀態碼應為 201 (實際: ${res6.status})`);
    const record6 = mockD1.records.find((r) => r.action === 'request_rejected');
    assert(record6 && record6.approval_status === 'rejected', 'approval_status 應為 rejected');
    assert(record6 && record6.commit_sha === null, 'request_rejected 之 commit_sha 必須為 null');
    assert(record6 && record6.files_changed === null, 'request_rejected 之 files_changed 必須為 null');

    // ----------------------------------------------------
    // 測試 7: 非 commit action 帶 SHA → 必須拒絕 (400)
    // ----------------------------------------------------
    console.log('\n▶ [測試 7] 非 commit action 帶 SHA (防偽檢查)');
    const res7 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        action: 'file_modified',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        commit_sha: 'fake_sha_12345', // 違規：file_modified 不得有 SHA
        summary: '企圖虛報 commit SHA',
      }),
    });
    assert(res7.status === 400, `應回傳 400 Bad Request (實際: ${res7.status})`);

    // ----------------------------------------------------
    // 測試 8: request_rejected 帶 files_changed → 必須拒絕 (400)
    // ----------------------------------------------------
    console.log('\n▶ [測試 8] request_rejected 帶 files_changed (防偽檢查)');
    const res8 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        action: 'request_rejected',
        approval_status: 'rejected',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        files_changed: ['report/report-studentB.md'], // 違規：被拒絕的操作不得有變更檔案
        summary: '企圖虛報被拒絕請求之檔案變更',
      }),
    });
    assert(res8.status === 400, `應回傳 400 Bad Request (實際: ${res8.status})`);

    // ----------------------------------------------------
    // 測試 9: 錯誤或缺少 Token → POST 必須失敗 (401)
    // ----------------------------------------------------
    console.log('\n▶ [測試 9] 錯誤或缺少 Token 鑑權測試');
    const res9a = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-secret-token',
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        action: 'request_proposal',
        actor_type: 'user',
        actor_id: 'studentA',
        actor_name: '學生A',
        summary: '測試未授權寫入',
      }),
    });
    assert(res9a.status === 401, `錯誤 Token 應回傳 401 Unauthorized (實際: ${res9a.status})`);

    const res9b = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // 無 Authorization
      body: JSON.stringify({
        repo_name: TEST_REPO,
        action: 'request_proposal',
        actor_type: 'user',
        actor_id: 'studentA',
        actor_name: '學生A',
        summary: '測試無 Token 寫入',
      }),
    });
    assert(res9b.status === 401, `缺少 Token 應回傳 401 Unauthorized (實際: ${res9b.status})`);

    // ----------------------------------------------------
    // 測試 10: 缺少必要欄位 → POST 必須失敗 (400)
    // ----------------------------------------------------
    console.log('\n▶ [測試 10] 缺少必要欄位檢查');
    const res10a = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        // 缺少 repo_name
        action: 'request_proposal',
        actor_type: 'user',
        actor_id: 'studentA',
        actor_name: '學生A',
        summary: '缺少 repo_name',
      }),
    });
    assert(res10a.status === 400, `缺少 repo_name 應回傳 400 (實際: ${res10a.status})`);

    const res10b = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        action: 'request_proposal',
        actor_type: 'system', // 違規：本階段禁止 system
        actor_id: 'sys',
        actor_name: '系統',
        summary: '非法 actor_type',
      }),
    });
    assert(res10b.status === 400, `非法 actor_type ('system') 應回傳 400 (實際: ${res10b.status})`);

    // ----------------------------------------------------
    // 測試 11: GET 可以依 repo 查詢
    // ----------------------------------------------------
    console.log('\n▶ [測試 11] GET 依 repo 查詢');
    const res11 = await fetch(`${baseUrl}?repo=${TEST_REPO}`);
    const data11 = await res11.json();
    assert(res11.status === 200 && data11.success, 'GET 查詢應成功 (200)');
    assert(data11.logs && data11.logs.length >= 6, `應回傳至少 6 筆記錄 (實際: ${data11.logs?.length})`);
    assert(data11.logs.every((l) => l.repo_name === TEST_REPO), '所有回傳之 repo_name 均應相符');

    // ----------------------------------------------------
    // 測試 12: GET 可以依 experiment_id 篩選
    // ----------------------------------------------------
    console.log('\n▶ [測試 12] GET 依 experiment_id 篩選');
    // 注入一筆不同 experiment_id 的記錄
    await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        experiment_id: 'lab-99-special',
        actor_type: 'user',
        actor_id: 'studentA',
        actor_name: '學生A',
        action: 'file_created',
        summary: '特殊實驗測試記錄',
      }),
    });

    const res12 = await fetch(`${baseUrl}?repo=${TEST_REPO}&exp=lab-99-special`);
    const data12 = await res12.json();
    assert(res12.status === 200 && data12.logs.length === 1, '篩選 lab-99-special 應恰好回傳 1 筆記錄');
    assert(data12.logs[0].experiment_id === 'lab-99-special', '回傳之 experiment_id 應為 lab-99-special');

    // ----------------------------------------------------
    // 測試 13: limit 有上限 (最高 100)
    // ----------------------------------------------------
    console.log('\n▶ [測試 13] limit 上限保護 (超過 100 必須自動裁切為 100)');
    await fetch(`${baseUrl}?repo=${TEST_REPO}&limit=999`);
    assert(mockD1.lastBinds[mockD1.lastBinds.length - 1] === 100, 'D1 LIMIT 綁定參數應自動被截斷為 100');

    // ----------------------------------------------------
    // 測試 14: activity_logs 沒有 UPDATE / DELETE route (405)
    // ----------------------------------------------------
    console.log('\n▶ [測試 14] Append-Only 保護 (拒絕 PUT / DELETE)');
    const res14a = await fetch(baseUrl, { method: 'PUT' });
    assert(res14a.status === 405, `PUT 應回傳 405 Method Not Allowed (實際: ${res14a.status})`);
    const res14b = await fetch(baseUrl, { method: 'DELETE' });
    assert(res14b.status === 405, `DELETE 應回傳 405 Method Not Allowed (實際: ${res14b.status})`);

    // ----------------------------------------------------
    // 測試 15: CLI 完整呼叫驗證 (scripts/log-activity.mjs)
    // ----------------------------------------------------
    console.log('\n▶ [測試 15] CLI 工具端到端回報驗證');
    const cliPath = path.resolve('scripts/log-activity.mjs');

    // A. 正常透過環境變數傳遞呼叫 CLI
    const { stdout: cliOut } = await execFileAsync(
      'node',
      [
        cliPath,
        '--repo',
        TEST_REPO,
        '--experiment-id',
        'lab-01',
        '--actor',
        'agent:antigravity',
        '--action',
        'commit_created',
        '--sha',
        '9ddafd2',
        '--requested-by',
        'studentA',
        '--approved-by',
        'studentA',
        '--approval',
        'approved',
        '--target',
        'report/report-studentA.md',
        '--summary',
        '[lab-01] 透過 CLI 成功回報提交',
      ],
      {
        env: {
          ...process.env,
          ACTIVITY_LOG_API_URL: baseUrl,
          ACTIVITY_LOG_SECRET: TEST_SECRET,
        },
      }
    );
    assert(cliOut.includes('活動紀錄已成功寫入 D1'), 'CLI 應顯示寫入成功訊息');

    // B. 未設定 Secret 時 CLI 必須拒絕送出，且不偽造成功
    let cliFailedCorrectly = false;
    try {
      await execFileAsync('node', [cliPath, '--repo', TEST_REPO, '--action', 'file_created', '--summary', '無 secret 測試'], {
        env: {
          ...process.env,
          ACTIVITY_LOG_API_URL: '',
          ACTIVITY_LOG_SECRET: '',
        },
      });
    } catch (err) {
      cliFailedCorrectly = err.code !== 0 && err.stderr.includes('未設定 ACTIVITY_LOG_API_URL 或 ACTIVITY_LOG_SECRET');
    }
    assert(cliFailedCorrectly, '未設定環境變數時，CLI 必須以非 0 狀態碼退出並給予提示');

    // ----------------------------------------------------
    // 測試 16: commit_created 無 SHA → 必須回傳 400
    // ----------------------------------------------------
    console.log('\n▶ [測試 16] commit_created 缺少 SHA (強制要求 SHA)');
    const res16 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        action: 'commit_created',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        summary: '缺少 SHA 的 commit_created',
      }),
    });
    assert(res16.status === 400, `commit_created 無 SHA 應回傳 400 Bad Request (實際: ${res16.status})`);

    // ----------------------------------------------------
    // 測試 17: push_completed 無 SHA → 必須回傳 400
    // ----------------------------------------------------
    console.log('\n▶ [測試 17] push_completed 缺少 SHA (強制要求 SHA)');
    const res17 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({
        repo_name: TEST_REPO,
        action: 'push_completed',
        actor_type: 'agent',
        actor_id: 'agent:antigravity',
        actor_name: 'AI Agent',
        summary: '缺少 SHA 的 push_completed',
      }),
    });
    assert(res17.status === 400, `push_completed 無 SHA 應回傳 400 Bad Request (實際: ${res17.status})`);

    // ----------------------------------------------------
    // 測試 18: 在 test-b-lab-02 目錄下執行母倉庫 log-activity.mjs (不提供 --repo)
    // ----------------------------------------------------
    console.log('\n▶ [測試 18] 在 test-b-lab-02 目錄下執行 CLI 自動推導 repo');
    const testBDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-b-lab-02-'));
    execSync('git init', { cwd: testBDir, stdio: 'ignore' });
    execSync('git remote add origin https://github.com/Lorin1470/test-b-lab-02.git', { cwd: testBDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(testBDir, 'config.yml'), 'experiment_id: lab-02\n');

    const { stdout: cliTestBOut } = await execFileAsync(
      'node',
      [
        cliPath,
        '--actor',
        'agent:antigravity',
        '--action',
        'file_modified',
        '--target',
        'report/report-studentA.md',
        '--summary',
        '在 test-b 目錄下透過 Git remote 自動推導 repo 測試',
      ],
      {
        cwd: testBDir,
        env: {
          ...process.env,
          ACTIVITY_LOG_API_URL: baseUrl,
          ACTIVITY_LOG_SECRET: TEST_SECRET,
        },
      }
    );
    assert(cliTestBOut.includes('活動紀錄已成功寫入 D1'), '在 test-b 目錄下執行應能成功寫入');
    const recTestB = mockD1.records[mockD1.records.length - 1];
    assert(recTestB && recTestB.repo_name === 'Lorin1470/test-b-lab-02', `repo_name 應自動推導為 Lorin1470/test-b-lab-02 (實際: ${recTestB?.repo_name})`);

    // ----------------------------------------------------
    // 測試 19: config.yml 沒有 repository 時仍可正常取得 experiment_id
    // ----------------------------------------------------
    console.log('\n▶ [測試 19] 自動從 test-b-lab-02 config.yml 讀取 experiment_id');
    assert(recTestB && recTestB.experiment_id === 'lab-02', `experiment_id 應自動讀取為 lab-02 (實際: ${recTestB?.experiment_id})`);

    // ----------------------------------------------------
    // 測試 20: 非 GitHub remote → 明確錯誤
    // ----------------------------------------------------
    console.log('\n▶ [測試 20] 非 GitHub remote 錯誤攔截');
    const tmpNonGh = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-test-nongh-'));
    try {
      execSync('git init', { cwd: tmpNonGh, stdio: 'ignore' });
      execSync('git remote add origin https://gitlab.com/someuser/lab-project.git', { cwd: tmpNonGh, stdio: 'ignore' });
      let nonGhFailed = false;
      let nonGhErr = '';
      try {
        await execFileAsync('node', [cliPath, '--action', 'request_proposal', '--summary', '非 github 測試'], {
          cwd: tmpNonGh,
          env: { ...process.env, ACTIVITY_LOG_API_URL: baseUrl, ACTIVITY_LOG_SECRET: TEST_SECRET },
        });
      } catch (err) {
        nonGhFailed = err.code !== 0;
        nonGhErr = err.stderr || '';
      }
      assert(nonGhFailed && nonGhErr.includes('目前僅支援 GitHub 遠端'), '非 GitHub 遠端應明確顯示錯誤並拒絕');
    } finally {
      fs.rmSync(tmpNonGh, { recursive: true, force: true });
    }

    // ----------------------------------------------------
    // 測試 21: 沒有 origin → 明確錯誤
    // ----------------------------------------------------
    console.log('\n▶ [測試 21] 無 Git remote.origin.url 錯誤攔截');
    const tmpNoOrigin = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-test-noorigin-'));
    try {
      execSync('git init', { cwd: tmpNoOrigin, stdio: 'ignore' });
      let noOriginFailed = false;
      let noOriginErr = '';
      try {
        await execFileAsync('node', [cliPath, '--action', 'request_proposal', '--summary', '無 origin 測試'], {
          cwd: tmpNoOrigin,
          env: { ...process.env, ACTIVITY_LOG_API_URL: baseUrl, ACTIVITY_LOG_SECRET: TEST_SECRET },
        });
      } catch (err) {
        noOriginFailed = err.code !== 0;
        noOriginErr = err.stderr || '';
      }
      assert(noOriginFailed && noOriginErr.includes('缺少必要參數: --repo'), '無 origin 時應明確提示缺少 --repo');
    } finally {
      fs.rmSync(tmpNoOrigin, { recursive: true, force: true });
    }

    // ----------------------------------------------------
    // 測試 22: --repo 明確指定時優先使用指定值
    // ----------------------------------------------------
    console.log('\n▶ [測試 22] --repo 明確指定時優先覆蓋');
    const { stdout: cliOverrideOut } = await execFileAsync(
      'node',
      [
        cliPath,
        '--repo',
        'CustomOrg/overridden-lab-repo',
        '--actor',
        'agent:antigravity',
        '--action',
        'file_modified',
        '--summary',
        '明確覆蓋 repo 測試',
      ],
      {
        cwd: testBDir,
        env: {
          ...process.env,
          ACTIVITY_LOG_API_URL: baseUrl,
          ACTIVITY_LOG_SECRET: TEST_SECRET,
        },
      }
    );
    assert(cliOverrideOut.includes('活動紀錄已成功寫入 D1'), '明確帶入 --repo 應能成功寫入');
    const recOverride = mockD1.records[mockD1.records.length - 1];
    assert(recOverride && recOverride.repo_name === 'CustomOrg/overridden-lab-repo', `repo_name 應為明確指定的 CustomOrg/overridden-lab-repo (實際: ${recOverride?.repo_name})`);
  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`📊 測試總結：通過 ${passCount} 項，失敗 ${failCount} 項`);
  console.log('====================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('測試套件執行發生未捕捉例外:', err);
  process.exit(1);
});
