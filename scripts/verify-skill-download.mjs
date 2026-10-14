#!/usr/bin/env node

/**
 * verify-skill-download.mjs
 * 驗證 github-workspace Skill 下載與 Agent 安裝引導功能
 *
 * 驗收範圍：
 * 1. Skill 來源一致性 (母倉庫、template、web/public、web/dist 四處雜湊完全一致)
 * 2. 下載原始 SKILL.md 內容實質檢驗 (Frontmatter、核心規範、無損完整性、404/錯誤防禦)
 * 3. 下載 ZIP 目錄結構檢驗 (保留 github-workspace/ 目錄層級、解壓縮實質檢驗、無遺漏檔案)
 * 4. Agent 安裝提示詞 7 大合規要求審查 (a ~ g 嚴格涵蓋)
 * 5. 提示詞複製功能與剪貼簿異常/失敗情境測試
 * 6. 前端介面文案與兩步驟引導審查 (非直裝宣告、兩步驟分離、無技術洩漏)
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from '../web/node_modules/jszip/lib/index.js';
import {

  AGENT_INSTALL_PROMPT,
  downloadRawSkill,
  createSkillZip,
  downloadSkillZip,
  copyInstallPrompt,
  fetchRawSkillContent,
} from '../web/src/utils/skill-downloader.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let passedCount = 0;
let failedCount = 0;

function pass(msg) {
  passedCount++;
  console.log(`  ✅ [PASS] ${msg}`);
}

function fail(msg, err) {
  failedCount++;
  console.error(`  ❌ [FAIL] ${msg}`);
  if (err) console.error(err);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

console.log('\n====================================================');
console.log('🧪 github-workspace Skill 下載與安裝引導完整驗證開始');
console.log('====================================================\n');

// ---------------------------------------------------------------
// 測試組 1: Skill 來源一致性 (Source Consistency)
// ---------------------------------------------------------------
console.log('▶ [測試組 1: Skill 來源一致性檢查]');
try {
  const rootSkillPath = path.join(ROOT_DIR, '.github', 'skills', 'github-workspace', 'SKILL.md');
  const tmplSkillPath = path.join(ROOT_DIR, 'template', '.github', 'skills', 'github-workspace', 'SKILL.md');
  const webSkillPath = path.join(ROOT_DIR, 'web', 'public', 'skills', 'github-workspace', 'SKILL.md');
  const distSkillPath = path.join(ROOT_DIR, 'web', 'dist', 'skills', 'github-workspace', 'SKILL.md');

  assert(fs.existsSync(rootSkillPath), '母倉庫 .github/skills/github-workspace/SKILL.md 必須存在');
  assert(fs.existsSync(tmplSkillPath), 'template/.github/skills/github-workspace/SKILL.md 必須存在');
  assert(fs.existsSync(webSkillPath), 'web/public/skills/github-workspace/SKILL.md 必須存在');

  const rootBuf = fs.readFileSync(rootSkillPath);
  const tmplBuf = fs.readFileSync(tmplSkillPath);
  const webBuf = fs.readFileSync(webSkillPath);

  const rootHash = sha256(rootBuf);
  const tmplHash = sha256(tmplBuf);
  const webHash = sha256(webBuf);

  assert.strictEqual(tmplHash, rootHash, 'template 中的 SKILL.md 雜湊必須與母倉庫完全一致');
  pass('1. 母倉庫與 template 之 github-workspace/SKILL.md 雜湊 100% 一致');

  assert.strictEqual(webHash, rootHash, 'web/public 中的 SKILL.md 雜湊必須與母倉庫完全一致');
  pass('2. web/public 靜態檔案來源與母倉庫 SKILL.md 雜湊 100% 一致 (無第二份拷貝維護漏洞)');

  if (fs.existsSync(distSkillPath)) {
    const distHash = sha256(fs.readFileSync(distSkillPath));
    assert.strictEqual(distHash, rootHash, 'web/dist 建置產物中的 SKILL.md 雜湊必須與母倉庫一致');
    pass('3. web/dist 正式建置目錄中之 SKILL.md 雜湊與母倉庫 100% 一致');
  }

  const manifestPath = path.join(ROOT_DIR, 'web', 'public', 'skills', 'github-workspace', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json 必須存在');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(Array.isArray(manifest) && manifest.includes('SKILL.md'), 'manifest.json 必須列出 SKILL.md');
  pass('4. manifest.json 結構正確且完整收錄 Skill 必要檔案清單');
} catch (err) {
  fail('測試組 1 執行失敗', err);
}

// ---------------------------------------------------------------
// 測試組 2: 原始檔案下載與內容實質檢驗 (Raw SKILL.md Download)
// ---------------------------------------------------------------
console.log('\n▶ [測試組 2: 原始 SKILL.md 下載與實質內容檢驗]');
try {
  const rootSkillContent = fs.readFileSync(
    path.join(ROOT_DIR, '.github', 'skills', 'github-workspace', 'SKILL.md'),
    'utf8'
  );

  // 模擬正常靜態請求
  const mockFetcher = async (url) => {
    if (url === '/skills/github-workspace/SKILL.md') {
      return {
        ok: true,
        status: 200,
        text: async () => rootSkillContent,
      };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  let savedBlob = null;
  let savedFilename = null;
  const mockSaver = (blob, filename) => {
    savedBlob = blob;
    savedFilename = filename;
  };

  const downloadRes = await downloadRawSkill({
    fetcher: mockFetcher,
    saver: mockSaver,
  });

  assert.strictEqual(downloadRes.filename, 'SKILL.md', '下載檔名必須為 SKILL.md');
  assert.strictEqual(savedFilename, 'SKILL.md', 'saver 接收檔名必須為 SKILL.md');
  assert(downloadRes.size > 10000, '下載內容大小必須合理 (> 10KB)');
  assert.strictEqual(sha256(downloadRes.content), sha256(rootSkillContent), '下載內容雜湊必須與母倉庫完全一致');
  pass('5. downloadRawSkill 下載檔名與內容雜湊與母倉庫完全一致');

  // 檢查實質規範內容
  assert(downloadRes.content.includes('name: github-workspace'), '必須包含 name: github-workspace');
  assert(downloadRes.content.includes('version: "1.0"'), '必須包含 version: "1.0"');
  assert(downloadRes.content.includes('Raw Data Sanctuary'), '必須包含 Raw Data Sanctuary 規範');
  assert(downloadRes.content.includes('Git 安全鎖'), '必須包含 Git 安全鎖規範');
  assert(downloadRes.content.includes('Course Mode'), '必須包含 Course Mode 規範');
  assert(downloadRes.content.includes('Experiment Mode'), '必須包含 Experiment Mode 規範');
  pass('6. 下載之 SKILL.md 實質內容包含 Frontmatter、Raw Data Sanctuary 與 Git 安全鎖等全部核心規範');

  // 測試 404 異常防禦
  const failFetcher = async () => ({
    ok: false,
    status: 404,
    text: async () => 'File not found',
  });
  let threwError = false;
  try {
    await downloadRawSkill({ fetcher: failFetcher, saver: mockSaver });
  } catch (e) {
    threwError = true;
    assert(e.message.includes('404'), '錯誤訊息應反映 HTTP 404');
  }
  assert(threwError, '當端點 404 時必須明確拋出異常，不可假報成功');
  pass('7. 靜態端點 404 時正確拋出錯誤，絕不假裝下載成功');
} catch (err) {
  fail('測試組 2 執行失敗', err);
}

// ---------------------------------------------------------------
// 測試組 3: ZIP 目錄結構與解壓縮實質檢驗 (ZIP Packaging Structure)
// ---------------------------------------------------------------
console.log('\n▶ [測試組 3: ZIP 目錄結構與實質內容檢驗]');
try {
  const rootSkillContent = fs.readFileSync(
    path.join(ROOT_DIR, '.github', 'skills', 'github-workspace', 'SKILL.md'),
    'utf8'
  );

  const mockFetcher = async (url) => {
    if (url === '/skills/github-workspace/manifest.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ['SKILL.md'],
      };
    }
    if (url === '/skills/github-workspace/SKILL.md') {
      return {
        ok: true,
        status: 200,
        text: async () => rootSkillContent,
      };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  let savedZipBlob = null;
  let savedZipFilename = null;
  const mockZipSaver = (blob, filename) => {
    savedZipBlob = blob;
    savedZipFilename = filename;
  };

  const zipRes = await downloadSkillZip({
    fetcher: mockFetcher,
    saver: mockZipSaver,
  });

  assert.strictEqual(zipRes.filename, 'github-workspace.zip', 'ZIP 檔名必須為 github-workspace.zip');
  assert.strictEqual(savedZipFilename, 'github-workspace.zip', 'saver 接收檔名必須為 github-workspace.zip');
  pass('8. downloadSkillZip 下載檔名正確為 github-workspace.zip');

  // 解析生成的 ZIP 內容並檢視目錄樹
  const zipArrayBuffer = await savedZipBlob.arrayBuffer();
  const unzipped = await JSZip.loadAsync(zipArrayBuffer);

  const zipEntries = Object.keys(unzipped.files);
  assert(
    zipEntries.includes('github-workspace/SKILL.md'),
    'ZIP 內必須包含「github-workspace/SKILL.md」正確目錄結構路徑'
  );
  pass('9. ZIP 內部目錄結構正確包含 github-workspace/SKILL.md');

  // 驗證絕無散落在根目錄的雜亂檔案
  assert(!zipEntries.includes('SKILL.md'), 'ZIP 根目錄不應散落未放入 github-workspace/ 的檔案');
  pass('10. ZIP 根目錄無散亂檔案，嚴格維持 github-workspace/ 為頂層目錄');

  // 實質讀取 ZIP 內的 SKILL.md 內容並比對雜湊
  const extractedSkillFile = unzipped.file('github-workspace/SKILL.md');
  assert(extractedSkillFile !== null, '解壓縮取得之 SKILL.md 不得為 null');
  const extractedText = await extractedSkillFile.async('text');
  assert.strictEqual(
    sha256(extractedText),
    sha256(rootSkillContent),
    'ZIP 內解壓縮之 SKILL.md 雜湊必須與母倉庫完全一致'
  );
  pass('11. ZIP 打包後解壓縮之 SKILL.md 內容無損，雜湊與母倉庫 100% 一致');

  // 測試當 manifest 遺漏 SKILL.md 或檔案請求失敗時的防禦
  const brokenFetcher = async (url) => {
    if (url === '/skills/github-workspace/manifest.json') {
      return { ok: true, status: 200, json: async () => ['other.txt'] };
    }
    if (url === '/skills/github-workspace/other.txt') {
      return { ok: true, status: 200, text: async () => 'hello' };
    }
    return { ok: false, status: 404 };
  };
  let zipErrorCaught = false;
  try {
    await createSkillZip({ fetcher: brokenFetcher });
  } catch (err) {
    zipErrorCaught = true;
    assert(err.message.includes('遺漏必要的核心 SKILL.md 檔案'));
  }
  assert(zipErrorCaught, '若打包遺漏 SKILL.md 必須中斷並拒絕產生破損壓縮檔');
  pass('12. 打包防禦機制通過：若缺少必要 SKILL.md 檔案則主動拋出錯誤阻絕');
} catch (err) {
  fail('測試組 3 執行失敗', err);
}

// ---------------------------------------------------------------
// 測試組 4: Agent 安裝提示詞 7 大合規要求審查 (Prompt Verification)
// ---------------------------------------------------------------
console.log('\n▶ [測試組 4: Agent 安裝提示詞 7 大合規要求審查]');
try {
  const p = AGENT_INSTALL_PROMPT;

  assert(typeof p === 'string' && p.length > 200, '提示詞必須存在且長度充足');
  pass('13. 提示詞為非空字串且長度充足');

  // a. 先辨識目前使用的 Agent 與其支援的 Skill 安裝格式
  assert(
    p.includes('辨識你目前運行的 AI Agent 類型') &&
    (p.includes('Antigravity') || p.includes('Codex')),
    '提示詞必須要求先辨識 Agent 類型與支援格式'
  );
  pass('14. 要求 a: 先辨識目前使用的 Agent 類型與支援安裝格式 (通過)');

  // b. 閱讀下載的 Skill，確認內容與檔案完整性
  assert(
    p.includes('閱讀該 Skill 檔案') &&
    p.includes('YAML Frontmatter') &&
    p.includes('完整性'),
    '提示詞必須要求閱讀 Skill 並確認完整性'
  );
  pass('15. 要求 b: 先閱讀下載的 Skill 並驗證 YAML Frontmatter 與內容完整性 (通過)');

  // c. 依該 Agent 的官方規範選擇正確的使用者層級或專案層級安裝位置，不可假設所有 Agent 都使用同一路徑
  assert(
    p.includes('官方規範') &&
    p.includes('使用者層級') &&
    p.includes('專案層級') &&
    p.includes('不可假設所有 Agent 都使用同一路徑'),
    '提示詞必須要求依規範選擇使用者或專案層級路徑，不可假設所有 Agent 使用同一路徑'
  );
  pass('16. 要求 c: 依 Agent 官方規範區分使用者層級/專案層級，不可假設單一路徑 (通過)');

  // d. 若沒有提供檔案路徑，先詢問使用者檔案位置，或在可用的工作區中尋找，不可假裝已取得檔案
  assert(
    p.includes('尚未在對話中提供下載的 Skill 檔案路徑') &&
    p.includes('可用的工作區目錄中搜尋') &&
    p.includes('詢問我') &&
    p.includes('絕對嚴禁假裝已經取得檔案'),
    '提示詞必須要求未獲路徑時先搜尋或詢問，嚴禁假裝取得'
  );
  pass('17. 要求 d: 未提供路徑時先尋找或主動詢問使用者，絕對嚴禁假裝取得檔案 (通過)');

  // e. 如果目的地已有同名 Skill，先比較內容並詢問使用者，不可直接覆蓋
  assert(
    p.includes('已有同名的 Skill') &&
    p.includes('比對兩者的內容') &&
    p.includes('不可直接強制覆蓋'),
    '提示詞必須要求防覆寫比對並取得確認'
  );
  pass('18. 要求 e: 目的地若有同名 Skill 先比對內容與版本差異並徵詢確認，不可直接覆蓋 (通過)');

  // f. 安裝後驗證目錄結構、必要檔案與內容完整性；能驗證 Agent 識別狀態時，也要驗證
  assert(
    p.includes('驗證安裝目錄結構') &&
    p.includes('必要檔案') &&
    p.includes('Agent 的 Skill 識別狀態'),
    '提示詞必須要求安裝後驗證結構、必要檔案與 Agent 識別狀態'
  );
  pass('19. 要求 f: 安裝後驗證目錄結構、必要檔案 (SKILL.md) 與 Agent 識別狀態 (通過)');

  // g. 回報實際安裝路徑、驗證結果與需要使用者手動完成的步驟
  assert(
    p.includes('實際安裝路徑') &&
    p.includes('完整性驗證結果') &&
    p.includes('手動'),
    '提示詞必須要求回報實際安裝路徑、驗證結果與手動步驟'
  );
  pass('20. 要求 g: 回報實際安裝路徑、驗證結果與使用者手動步驟 (通過)');
} catch (err) {
  fail('測試組 4 執行失敗', err);
}

// ---------------------------------------------------------------
// 測試組 5: 提示詞複製成功與失敗情境測試 (Copy Functionality & Fallback)
// ---------------------------------------------------------------
console.log('\n▶ [測試組 5: 提示詞複製與異常回饋測試]');
const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
try {
  // 5.1 現代環境 navigator.clipboard.writeText 成功流程
  let clipboardWrittenText = null;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async (text) => {
          clipboardWrittenText = text;
        },
      },
    },
    configurable: true,
    writable: true,
  });

  const copyResSuccess = await copyInstallPrompt(AGENT_INSTALL_PROMPT);
  assert.strictEqual(copyResSuccess.success, true, '支援剪貼簿環境下應回傳 success: true');
  assert.strictEqual(clipboardWrittenText, AGENT_INSTALL_PROMPT, '寫入剪貼簿內容必須完全相符');
  pass('21. 正常剪貼簿環境下成功寫入並回傳 success: true');

  // 5.2 模擬權限被拒絕 (writeText 拋出 NotAllowedError)
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error('NotAllowedError: Document is not focused or permission denied');
        },
      },
    },
    configurable: true,
    writable: true,
  });

  const copyResDenied = await copyInstallPrompt(AGENT_INSTALL_PROMPT);
  assert.strictEqual(copyResDenied.success, false, '剪貼簿被拒時應回傳 success: false');
  assert(copyResDenied.error.includes('NotAllowedError') || copyResDenied.error.includes('剪貼簿'), '應包含錯誤原因');
  pass('22. 剪貼簿寫入被拒絕時回傳明確錯誤原因，不產生未捕獲異常');

  // 5.3 模擬無 navigator.clipboard 且無 document (純伺服器端環境)
  Object.defineProperty(globalThis, 'navigator', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  const copyResNoEnv = await copyInstallPrompt(AGENT_INSTALL_PROMPT);
  assert.strictEqual(copyResNoEnv.success, false, '無剪貼簿環境下回傳 false');
  assert(copyResNoEnv.error.includes('不支援') || copyResNoEnv.error.includes('拒絕'));
  pass('23. 不支援剪貼簿之環境友善回傳錯誤提示，引導使用者手動選取複製');
} catch (err) {
  fail('測試組 5 執行失敗', err);
} finally {
  if (originalNavigatorDesc) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
  } else {
    delete globalThis.navigator;
  }
}


// ---------------------------------------------------------------
// 測試組 6: 前端頁面元件靜態審查 (UI Integrity & Safety Checks)
// ---------------------------------------------------------------
console.log('\n▶ [測試組 6: 前端介面文案與兩步驟引導審查]');
try {
  const guidePath = path.join(ROOT_DIR, 'web', 'src', 'components', 'SkillDownloadGuide.tsx');
  assert(fs.existsSync(guidePath), 'SkillDownloadGuide.tsx 必須存在');
  const guideContent = fs.readFileSync(guidePath, 'utf8');

  // 兩步驟明確劃分
  assert(guideContent.includes('步驟一：下載 Skill 檔案'), '必須清楚包含步驟一標題');
  assert(guideContent.includes('步驟二：一鍵複製安裝提示詞') || guideContent.includes('步驟二：複製'), '必須清楚包含步驟二標題');
  pass('24. SkillDownloadGuide 明確劃分「步驟一：下載」與「步驟二：安裝」兩個不同階段');

  // 非直裝聲明 (網站不假裝已安裝至本機)
  assert(
    guideContent.includes('網站僅提供') || guideContent.includes('不會亦無法直接安裝'),
    '必須聲明網站只負責提供檔案與提示詞，無本機直裝功能'
  );
  pass('25. 介面明確標註網站僅提供檔案與提示詞，絕不假稱已直接安裝到電腦');

  // 必須包含「下載 SKILL.md」、「下載 ZIP」與「複製 Agent 安裝提示詞」等操作按鈕
  assert(guideContent.includes('下載 SKILL.md'), '必須具備下載 SKILL.md 按鈕');
  assert(guideContent.includes('下載 ZIP'), '必須具備下載 ZIP 按鈕');
  assert(guideContent.includes('複製 Agent 安裝提示詞'), '必須具備複製 Agent 安裝提示詞按鈕');
  pass('26. 包含原始 SKILL.md 下載、ZIP 下載及提示詞一鍵複製全部必要功能按鈕');

  // 檢查 CourseList.tsx 與 ExperimentDetail.tsx 的整合
  const courseListContent = fs.readFileSync(
    path.join(ROOT_DIR, 'web', 'src', 'components', 'CourseList.tsx'),
    'utf8'
  );
  assert(
    courseListContent.includes('<SkillDownloadGuide') || courseListContent.includes('SkillDownloadGuide'),
    'CourseList 必須整合 SkillDownloadGuide'
  );
  pass('27. 課程列表 (CourseList) 正確整合 SkillDownloadGuide 引導區塊');

  const expDetailContent = fs.readFileSync(
    path.join(ROOT_DIR, 'web', 'src', 'components', 'ExperimentDetail.tsx'),
    'utf8'
  );
  assert(
    expDetailContent.includes('<SkillDownloadGuide') || expDetailContent.includes('SkillDownloadGuide'),
    'ExperimentDetail 的 download tab 必須整合 SkillDownloadGuide'
  );
  pass('28. 實驗詳情 (ExperimentDetail) 的「打包下載」分頁正確整合 SkillDownloadGuide');

  // 確保沒有違反既有測試規定的黑名單關鍵字
  assert(!expDetailContent.includes('本地 Git'), 'ExperimentDetail 絕不得出現「本地 Git」');
  assert(!expDetailContent.includes('提交至儲存庫'), 'ExperimentDetail 絕不得出現「提交至儲存庫」');
  assert(!expDetailContent.includes('(experiments/${'), 'ExperimentDetail 絕不得外洩 scoped path');
  pass('29. 嚴格通過既有黑名單審查，絕無引入「本地 Git」、「提交至儲存庫」或 scoped path 外洩');
} catch (err) {
  fail('測試組 6 執行失敗', err);
}

// ---------------------------------------------------------------
// 驗證總結
// ---------------------------------------------------------------
console.log('\n====================================================');
console.log(`📊 驗證總結：通過 ${passedCount} 項，失敗 ${failedCount} 項`);
console.log('====================================================\n');

if (failedCount > 0) {
  process.exit(1);
}
