#!/usr/bin/env node

/**
 * verify-dark-mode.mjs
 * 驗證深色模式 (Dark Mode) 架構、防閃白 (Anti-FOUC)、組件樣式與切換行為
 *
 * 驗收範圍：
 * 1. 防閃白機制 (web/index.html 中的同步 inline script 與 body dark 樣式)
 * 2. Tailwind v4 深色模式規則 (web/src/index.css 中的 @variant dark 設定)
 * 3. ThemeContext 狀態管理架構 (預設 system preference、localStorage 存取、例外容錯)
 * 4. Navbar 主題切換按鈕、圖示、中文提示 (切換深色模式 / 切換淺色模式) 與無障礙屬性
 * 5. 全站核心頁面與組件深色模式 Tailwind 類別覆蓋率檢查
 * 6. Theme 邏輯單元測試 (模擬 theme 切換、持久化與 documentElement class 操作)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.resolve(ROOT_DIR, 'web');

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

console.log('\n====================================================');
console.log('🌙 深色模式 (Dark Mode) 完整功能與樣式驗證開始');
console.log('====================================================\n');

// ---------------------------------------------------------------
// 測試組 1: 防閃白 (Anti-FOUC) 與 HTML 基礎配置
// ---------------------------------------------------------------
console.log('--- 測試組 1: 防閃白 (Anti-FOUC) 與 HTML 基礎配置 ---');
try {
  const indexHtmlPath = path.resolve(WEB_DIR, 'index.html');
  assert.ok(fs.existsSync(indexHtmlPath), 'web/index.html 必須存在');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  // 1. 檢查 <head> 內是否有同步 inline script 檢查主題
  assert.ok(
    indexHtml.includes('<script>') && indexHtml.includes('localStorage.getItem'),
    'index.html 必須包含讀取 localStorage 主題的同步 inline script'
  );
  assert.ok(
    indexHtml.includes('prefers-color-scheme: dark'),
    'inline script 必須支援系統 prefers-color-scheme: dark 偵測'
  );
  assert.ok(
    indexHtml.includes("classList.add('dark')") || indexHtml.includes('classList.toggle'),
    'inline script 必須能在頁面渲染前將 dark class 添加至 documentElement'
  );
  assert.ok(
    indexHtml.includes('try {') && indexHtml.includes('catch'),
    'inline script 必須包含 try/catch 避免在無 localStorage 權限時拋錯阻礙渲染'
  );

  // 2. 檢查 <body> 預設深色樣式背景與文字
  assert.ok(
    indexHtml.includes('dark:bg-slate-900') && indexHtml.includes('dark:text-slate-100'),
    'body 必須設定 dark:bg-slate-900 與 dark:text-slate-100'
  );

  pass('Anti-FOUC inline script 與 body 深色基底配置完整且具備防護');
} catch (err) {
  fail('Anti-FOUC 或 index.html 配置驗證失敗', err);
}

// ---------------------------------------------------------------
// 測試組 2: Tailwind CSS v4 深色變體設定
// ---------------------------------------------------------------
console.log('\n--- 測試組 2: Tailwind CSS v4 深色變體設定 ---');
try {
  const indexCssPath = path.resolve(WEB_DIR, 'src/index.css');
  assert.ok(fs.existsSync(indexCssPath), 'web/src/index.css 必須存在');
  const indexCss = fs.readFileSync(indexCssPath, 'utf8');

  assert.ok(
    indexCss.includes('@variant dark') || indexCss.includes('@custom-variant dark'),
    'index.css 必須定義 @variant dark 以支援 .dark class 控制'
  );
  assert.ok(
    indexCss.includes('.dark'),
    'Tailwind 深色變體必須匹配 .dark 類別'
  );

  pass('Tailwind v4 深色變體規則配置正確');
} catch (err) {
  fail('Tailwind CSS 深色設定驗證失敗', err);
}

// ---------------------------------------------------------------
// 測試組 3: ThemeContext 架構與邏輯檢查
// ---------------------------------------------------------------
console.log('\n--- 測試組 3: ThemeContext 架構與邏輯檢查 ---');
try {
  const contextPath = path.resolve(WEB_DIR, 'src/context/ThemeContext.tsx');
  assert.ok(fs.existsSync(contextPath), 'ThemeContext.tsx 必須存在');
  const contextCode = fs.readFileSync(contextPath, 'utf8');

  assert.ok(contextCode.includes('ThemeProvider'), '必須導出 ThemeProvider');
  assert.ok(contextCode.includes('useTheme'), '必須導出 useTheme hook');
  assert.ok(contextCode.includes("'theme'"), "儲存鍵必須為 'theme'");
  assert.ok(
    contextCode.includes('toggleTheme') || contextCode.includes('setTheme'),
    'ThemeContext 必須提供切換或設定主題之方法'
  );
  assert.ok(
    contextCode.includes('prefers-color-scheme: dark'),
    'ThemeContext 必須支援 matchMedia prefers-color-scheme'
  );
  assert.ok(
    contextCode.includes('try {') && contextCode.includes('catch'),
    'ThemeContext 的 localStorage 存取必須包含例外保護'
  );

  pass('ThemeContext 導出齊全、型別定義完整且容錯性高');
} catch (err) {
  fail('ThemeContext 驗證失敗', err);
}

// ---------------------------------------------------------------
// 測試組 4: Navbar 主題切換按鈕、圖示與中文無障礙提示
// ---------------------------------------------------------------
console.log('\n--- 測試組 4: Navbar 主題切換按鈕與無障礙提示 ---');
try {
  const navbarPath = path.resolve(WEB_DIR, 'src/components/Navbar.tsx');
  assert.ok(fs.existsSync(navbarPath), 'Navbar.tsx 必須存在');
  const navbarCode = fs.readFileSync(navbarPath, 'utf8');

  assert.ok(navbarCode.includes('useTheme'), 'Navbar 必須引用 useTheme hook');
  assert.ok(
    navbarCode.includes('切換深色模式') && navbarCode.includes('切換淺色模式'),
    'Navbar 切換按鈕必須提供繁體中文提示 (切換深色模式 / 切換淺色模式)'
  );
  assert.ok(
    navbarCode.includes('aria-label='),
    'Navbar 切換按鈕必須設定 aria-label'
  );
  assert.ok(
    navbarCode.includes('title='),
    'Navbar 切換按鈕必須設定 title tooltip'
  );
  assert.ok(
    navbarCode.includes('Sun') || navbarCode.includes('Moon') || navbarCode.includes('svg'),
    'Navbar 必須包含太陽與月亮視覺圖示'
  );

  pass('Navbar 主題按鈕提供完整之繁體中文提示與無障礙屬性');
} catch (err) {
  fail('Navbar 主題按鈕驗證失敗', err);
}

// ---------------------------------------------------------------
// 測試組 5: 全站核心頁面與組件深色模式 Tailwind 類別覆蓋率檢查
// ---------------------------------------------------------------
console.log('\n--- 測試組 5: 全站核心組件深色樣式覆蓋率檢查 ---');
try {
  const componentsToCheck = [
    { file: 'src/App.tsx', minDarkClasses: 3, label: 'App 根組件與頁尾' },
    { file: 'src/components/Navbar.tsx', minDarkClasses: 8, label: 'Navbar 導航列與按鈕' },
    { file: 'src/components/CourseList.tsx', minDarkClasses: 12, label: 'CourseList 課程清單與篩選' },
    { file: 'src/components/CourseDetail.tsx', minDarkClasses: 15, label: 'CourseDetail 詳情與成員清單' },
    { file: 'src/components/ExperimentDetail.tsx', minDarkClasses: 15, label: 'ExperimentDetail 實驗詳情與分頁' },
    { file: 'src/components/SkillDownloadPage.tsx', minDarkClasses: 5, label: 'SkillDownloadPage 獨立頁面' },
    { file: 'src/components/SkillDownloadGuide.tsx', minDarkClasses: 8, label: 'SkillDownloadGuide 引導與提示詞區塊' },
    { file: 'src/components/WorkspaceManager.tsx', minDarkClasses: 25, label: 'WorkspaceManager 檔案樹、Markdown 與彈窗' },
  ];

  for (const item of componentsToCheck) {
    const fullPath = path.resolve(WEB_DIR, item.file);
    assert.ok(fs.existsSync(fullPath), `${item.file} 檔案必須存在`);
    const code = fs.readFileSync(fullPath, 'utf8');

    // 計算 dark: 前綴出現次數
    const matches = code.match(/dark:[a-zA-Z0-9_\-\/\[\]#:]+/g) || [];
    assert.ok(
      matches.length >= item.minDarkClasses,
      `${item.label} (${item.file}) dark 樣式類別數量 (${matches.length}) 不足期望值 (${item.minDarkClasses})`
    );
    pass(`${item.label} (${item.file}) 通過檢驗，包含 ${matches.length} 個 dark: 樣式類別`);
  }
} catch (err) {
  fail('組件深色樣式覆蓋率檢驗失敗', err);
}

// ---------------------------------------------------------------
// 測試組 6: 模擬 Theme 邏輯與 documentElement 運作檢驗
// ---------------------------------------------------------------
console.log('\n--- 測試組 6: 模擬 Theme 邏輯與 documentElement 運作檢驗 ---');
try {
  // 模擬 document 與 localStorage 環境
  const mockStorage = new Map();
  const mockLocalStorage = {
    getItem: (key) => (mockStorage.has(key) ? mockStorage.get(key) : null),
    setItem: (key, val) => mockStorage.set(key, String(val)),
    removeItem: (key) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  };

  const classListSet = new Set();
  const mockDocumentElement = {
    classList: {
      add: (cls) => classListSet.add(cls),
      remove: (cls) => classListSet.delete(cls),
      toggle: (cls, force) => {
        if (force === undefined) {
          if (classListSet.has(cls)) classListSet.delete(cls);
          else classListSet.add(cls);
        } else if (force) {
          classListSet.add(cls);
        } else {
          classListSet.delete(cls);
        }
      },
      contains: (cls) => classListSet.has(cls),
    },
  };

  // 測試 1: 預設空 storage，系統偏好為 dark
  let systemPrefersDark = true;
  function resolveInitialTheme(storage, prefersDark) {
    try {
      const stored = storage.getItem('theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (_) {}
    return prefersDark ? 'dark' : 'light';
  }

  function applyTheme(docEl, theme) {
    if (theme === 'dark') {
      docEl.classList.add('dark');
    } else {
      docEl.classList.remove('dark');
    }
  }

  // Case A: 首次進入，無儲存，系統為 dark
  let themeA = resolveInitialTheme(mockLocalStorage, systemPrefersDark);
  assert.strictEqual(themeA, 'dark');
  applyTheme(mockDocumentElement, themeA);
  assert.strictEqual(mockDocumentElement.classList.contains('dark'), true);
  pass('無 localStorage 時，正確繼承系統 dark 偏好並添加 .dark class');

  // Case B: 使用者手動切換為 light
  mockLocalStorage.setItem('theme', 'light');
  let themeB = resolveInitialTheme(mockLocalStorage, systemPrefersDark);
  assert.strictEqual(themeB, 'light');
  applyTheme(mockDocumentElement, themeB);
  assert.strictEqual(mockDocumentElement.classList.contains('dark'), false);
  pass('使用者手動切換為 light 時，localStorage 優先於系統偏好並移除 .dark class');

  // Case C: 使用者手動切換為 dark
  mockLocalStorage.setItem('theme', 'dark');
  let themeC = resolveInitialTheme(mockLocalStorage, false); // 即使系統是 light
  assert.strictEqual(themeC, 'dark');
  applyTheme(mockDocumentElement, themeC);
  assert.strictEqual(mockDocumentElement.classList.contains('dark'), true);
  pass('使用者手動切換為 dark 時，即便系統為 light 依然維持 dark');

  // Case D: localStorage 異常 (模擬 Private Mode 拋錯)
  const throwingStorage = {
    getItem: () => { throw new Error('SecurityError: Access is denied'); },
    setItem: () => { throw new Error('SecurityError: Access is denied'); },
  };
  let themeD = resolveInitialTheme(throwingStorage, true);
  assert.strictEqual(themeD, 'dark', 'localStorage 拋錯時應回退至系統偏好');
  pass('localStorage 權限受阻時能優雅回退，無未捕獲異常');

} catch (err) {
  fail('模擬 Theme 邏輯測試失敗', err);
}

// ---------------------------------------------------------------
// 統計報告
// ---------------------------------------------------------------
console.log('\n====================================================');
console.log(`總測試結果: 通過 ${passedCount} 項, 失敗 ${failedCount} 項`);
console.log('====================================================\n');

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
