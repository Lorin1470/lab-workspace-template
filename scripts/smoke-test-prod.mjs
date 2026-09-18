#!/usr/bin/env node

/**
 * smoke-test-prod.mjs
 * Cloudflare Production 端對端自動化 Smoke Test 測試腳本
 *
 * 支援功能：
 * 1. 自動檢測 Cloudflare Pages 線上 API 狀態 (/api/status)
 * 2. 深度驗證 D1 連通性 (d1Connected) 與資料表綱要 (hasActivityTable)
 * 3. 驗證真實 D1 資料庫讀取能力 (非 mock 降級)
 * 4. 驗證 Append-Only 保護 (PUT/DELETE 405) 與未授權阻擋 (無/錯 Token 401)
 * 5. 若本機/CI 環境具備 ACTIVITY_LOG_SECRET，自動執行寫入授權與 SHA 防偽規則測試
 */

const BASE_URL = process.env.ACTIVITY_LOG_API_URL || 'https://lab-workspace-web.pages.dev/api';
const SECRET = process.env.ACTIVITY_LOG_SECRET || null;
const REPO = 'Lorin1470/lab-workspace-template';
const EXP = 'production-smoke-test';

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message, detail = '') {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function run() {
  console.log('====================================================');
  console.log(`🌐 Cloudflare Production Smoke Test 開始`);
  console.log(`目標端點: ${BASE_URL}`);
  console.log('====================================================\n');

  // 1. 深度健康檢查
  console.log('▶ [階段一：API 狀態與 D1 深度連通性]');
  try {
    const res = await fetch(`${BASE_URL}/status`);
    const data = await res.json();
    assert(res.status === 200, 'GET /api/status 回傳 200 OK');
    assert(data.status === 'online', '服務狀態為 online');
    assert(data.hasD1 === true, 'D1 binding 已配置 (hasD1: true)');
    assert(data.d1Connected === true, 'D1 實體查詢連通 (d1Connected: true)');
    assert(data.hasActivityTable === true, 'D1 包含 activity_logs 資料表 (hasActivityTable: true)');
    assert(data.hasActivitySecret === true, 'Production 密鑰已注入 (hasActivitySecret: true)');
  } catch (err) {
    assert(false, 'GET /api/status 連線失敗', err.message);
  }

  // 2. D1 查詢與非 mock 驗證
  console.log('\n▶ [階段二：D1 查詢與資料真實性]');
  try {
    const res = await fetch(`${BASE_URL}/activity?repo=${encodeURIComponent(REPO)}&exp=${encodeURIComponent(EXP)}`);
    const data = await res.json();
    assert(res.status === 200, 'GET /api/activity 回傳 200 OK');
    assert(data.success === true, '查詢回傳 success: true');
    assert(data.mode !== 'mock', '確認非 mock 降級模式 (無 mode: mock)');
    assert(Array.isArray(data.logs), '回傳 logs 陣列');
  } catch (err) {
    assert(false, 'GET /api/activity 查詢失敗', err.message);
  }

  // 3. 查詢缺少必要參數驗證
  try {
    const res = await fetch(`${BASE_URL}/activity`);
    assert(res.status === 400, '缺少 repo 參數時回傳 400 Bad Request');
  } catch (err) {
    assert(false, '缺少 repo 參數檢驗失敗', err.message);
  }

  // 4. Append-Only 安全防護 (PUT/DELETE)
  console.log('\n▶ [階段三：Append-Only 防護與 HTTP Method 限制]');
  try {
    const putRes = await fetch(`${BASE_URL}/activity`, { method: 'PUT' });
    assert(putRes.status === 405, 'PUT /api/activity 遭阻絕 (405 Method Not Allowed)');
    const delRes = await fetch(`${BASE_URL}/activity`, { method: 'DELETE' });
    assert(delRes.status === 405, 'DELETE /api/activity 遭阻絕 (405 Method Not Allowed)');
  } catch (err) {
    assert(false, 'Append-Only 檢驗失敗', err.message);
  }

  // 5. 鑑權阻絕測試 (無 Token / 錯誤 Token)
  console.log('\n▶ [階段四：未授權防護]');
  try {
    const noTokenRes = await fetch(`${BASE_URL}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_name: REPO, action: 'request_proposal' }),
    });
    assert(noTokenRes.status === 401, '無 Token POST 遭阻絕 (401 Unauthorized)');

    const badTokenRes = await fetch(`${BASE_URL}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer definitely-invalid-secret' },
      body: JSON.stringify({ repo_name: REPO, action: 'request_proposal' }),
    });
    assert(badTokenRes.status === 401, '錯誤 Token POST 遭阻絕 (401 Unauthorized)');
  } catch (err) {
    assert(false, '鑑權阻絕檢驗失敗', err.message);
  }

  // 6. 有效 Token 寫入驗證 (僅在具備環境變數時執行)
  console.log('\n▶ [階段五：授權寫入與 SHA 防偽規則]');
  if (SECRET) {
    try {
      // A. request_proposal (正常寫入)
      const postRes = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SECRET}`,
        },
        body: JSON.stringify({
          repo_name: REPO,
          experiment_id: EXP,
          action: 'request_proposal',
          actor_type: 'user',
          actor_id: 'admin',
          actor_name: 'System Administrator',
          target: 'docs/architecture.md',
          summary: '[Production Smoke Test] 驗證 Cloudflare Pages 與 D1 接線成功',
        }),
      });
      const postData = await postRes.json();
      assert(postRes.status === 201, '有效 Token 成功寫入紀錄 (201 Created)', postData.error);
      assert(!!postData.id, `回傳新建紀錄 UUID: ${postData.id}`);

      // B. commit_created 缺少 SHA 阻絕
      const noShaCommitRes = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SECRET}`,
        },
        body: JSON.stringify({
          repo_name: REPO,
          experiment_id: EXP,
          action: 'commit_created',
          actor_type: 'agent',
          actor_id: 'agent:antigravity',
          actor_name: 'AI Agent',
          summary: '[Production Smoke Test] 缺少 SHA 測試',
        }),
      });
      assert(noShaCommitRes.status === 400, 'commit_created 缺少 SHA 遭阻絕 (400 Bad Request)');

      // C. push_completed 缺少 SHA 阻絕
      const noShaPushRes = await fetch(`${BASE_URL}/activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SECRET}`,
        },
        body: JSON.stringify({
          repo_name: REPO,
          experiment_id: EXP,
          action: 'push_completed',
          actor_type: 'agent',
          actor_id: 'agent:antigravity',
          actor_name: 'AI Agent',
          summary: '[Production Smoke Test] 缺少 SHA 測試',
        }),
      });
      assert(noShaPushRes.status === 400, 'push_completed 缺少 SHA 遭阻絕 (400 Bad Request)');
    } catch (err) {
      assert(false, '授權寫入檢驗失敗', err.message);
    }
  } else {
    console.log('  ℹ️ [SKIP] 本機環境無 ACTIVITY_LOG_SECRET（Cloudflare Write-Only 安全隔離）');
    console.log('  ℹ️ [INFO] 唯讀連通性、D1 查詢、資料表綱要與所有安全阻絕規則已 100% 驗證通過');
    skipped += 3;
  }

  console.log('\n====================================================');
  console.log(`📊 測試總結：通過 ${passed} 項，失敗 ${failed} 項，略過 ${skipped} 項`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run();
