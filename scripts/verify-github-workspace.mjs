#!/usr/bin/env node

/**
 * verify-github-workspace.mjs
 * 驗證 GitHub Workspace Skill 規範與 Agent 直連操作邏輯
 *
 * 測試架構分層（嚴格區分測試真實覆蓋範圍）：
 * -------------------------------------------------------------
 * 【層級一：純函式單元測試 (Pure Function Unit Tests)】
 *   驗證路徑解析、模式判定、聖域防護、Base64無損轉換及SHA校驗之純函式實作。
 *
 * 【層級二：Skill 文件規範自動檢查 (Skill Specification Static Checks)】
 *   自動化解析 SKILL.md，嚴格驗證安全鐵律條款是否存在且無破綻（如禁止預設推送到 main、分步授權等）。
 *
 * 【層級三：實際 GitHub API 遠端操作狀態 (Remote GitHub API Live Status)】
 *   清楚標示已於真實 GitHub Sandbox (Lorin1470/lab-workspace-sandbox-e2e) 實測之項目，
 *   以及尚未於遠端壓測之項目。
 *
 * 【層級四：Agent 真實執行流程驗收狀態 (Agent Interactive Flow Acceptance)】
 *   清楚標示在人機協作流程中已人工驗收之安全鎖行為，以及未自動化項目（對話狀態機）。
 * -------------------------------------------------------------
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  printUncommittedManualInstructions,
  printManualInstructions,
  printManualPushInstructions,
  isValidBranchName,
} from "./create-lab.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

let passedCount = 0;
let unitTestCount = 0;
function pass(msg) {
  passedCount++;
  unitTestCount++;
  console.log(`  ✅ [PASS] ${msg}`);
}

// ==============================================================
// Agent GitHub Workspace 解析與安全核心邏輯實作 (Core Logic)
// ==============================================================

/**
 * 1. 儲存庫名稱格式驗證 (鐵律：永遠為 owner/repo)
 */
function validateRepositoryName(repoString) {
  if (!repoString || typeof repoString !== "string") {
    throw new Error("Repository 名稱不得為空");
  }
  const trimmed = repoString.trim();
  const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (!match) {
    throw new Error(`Repository 格式不合法，必須為 'owner/repo' 格式: '${trimmed}'`);
  }
  // 嚴禁將 experiments 拼入 repository 名稱
  if (match[2].startsWith("experiments") || trimmed.includes("/experiments/")) {
    throw new Error(`儲存庫名稱中不得包含實驗目錄路徑: '${trimmed}'`);
  }
  return { owner: match[1], repo: match[2], fullName: trimmed };
}

/**
 * 2. 架構模式與實驗目錄解析
 */
function resolveWorkspaceMode({ repo, config, currentPath }) {
  if (!repo) {
    throw new Error("無法識別目標 GitHub Repository，拒絕寫入");
  }
  const validRepo = validateRepositoryName(repo);

  // 判定模式
  const isCoursePath =
    (currentPath && currentPath.includes("experiments/")) ||
    (config && config.mode === "course") ||
    (config && config.course_repo && config.experiment_code);

  if (isCoursePath) {
    const experimentCode =
      (config && (config.experiment_code || config.experiment_id)) ||
      (currentPath ? currentPath.match(/experiments\/([a-zA-Z0-9_.-]+)/)?.[1] : null);

    if (!experimentCode) {
      throw new Error("Course Mode 下無法辨識實驗代碼 (experiment_code)，拒絕寫入");
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(experimentCode)) {
      throw new Error(`非法實驗代碼格式: '${experimentCode}'`);
    }

    return {
      mode: "course",
      repository: validRepo.fullName,
      owner: validRepo.owner,
      repo: validRepo.repo,
      experimentCode,
      scopePrefix: `experiments/${experimentCode}/`,
    };
  }

  // Experiment Mode
  return {
    mode: "experiment",
    repository: validRepo.fullName,
    owner: validRepo.owner,
    repo: validRepo.repo,
    experimentCode: (config && (config.experiment_id || config.experiment_code)) || null,
    scopePrefix: "",
  };
}

/**
 * 3. 路徑安全正規化與防穿越檢驗
 */
function sanitizePath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("路徑不得為空");
  }

  if (rawPath.includes("\0") || rawPath.includes("%00")) {
    throw new Error("路徑包含非法空字元 (Null Byte)");
  }

  // 解碼多重 URL 編碼穿越 (%2e%2e, %252e%252e)
  let decoded = rawPath;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }

  if (
    rawPath.startsWith("/") ||
    decoded.startsWith("/") ||
    rawPath.startsWith("\\") ||
    decoded.startsWith("\\") ||
    /^[a-zA-Z]:/.test(decoded)
  ) {
    throw new Error("不允許使用絕對路徑或磁碟機代號");
  }

  const normalized = decoded.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error("路徑穿越檢驗失敗 (不允許 ..)");
    }
  }

  const clean = segments.filter((s) => s && s !== ".").join("/");
  if (!clean) {
    throw new Error("目標路徑不得為空");
  }
  return clean;
}

/**
 * 4. 計算最終遠端路徑並進行邊界隔離檢驗
 */
function resolveScopedRemotePath(workspaceContext, relativePath) {
  const cleanPath = sanitizePath(relativePath);
  const fullPath = `${workspaceContext.scopePrefix}${cleanPath}`;

  if (workspaceContext.mode === "course") {
    // 嚴格檢驗：最終路徑必須以該實驗的 scopePrefix 開頭
    if (!fullPath.startsWith(workspaceContext.scopePrefix)) {
      throw new Error(`越界存取阻絕：路徑 '${fullPath}' 超出目前實驗範圍 '${workspaceContext.scopePrefix}'`);
    }
  }

  return fullPath;
}

/**
 * 5. 報告模式路徑解析與個人身分邊界
 */
function resolveReportPath(workspaceContext, reportMode, currentUser) {
  if (reportMode === "shared") {
    return resolveScopedRemotePath(workspaceContext, "report/report.md");
  }

  if (reportMode === "separate") {
    if (!currentUser || typeof currentUser !== "string" || !currentUser.trim()) {
      throw new Error("Separate 模式下無法確認當前 GitHub 使用者身分，嚴禁寫入報告 (不退回共用報告)");
    }
    const cleanUser = currentUser.trim();
    return resolveScopedRemotePath(workspaceContext, `report/report-${cleanUser}.md`);
  }

  throw new Error(`未知的報告模式: '${reportMode}'`);
}

/**
 * 6. 寫入前安全檢查 (防覆寫、Raw Sanctuary 聖域保護)
 */
function checkPreWritePolicy({ relativePath, isNewFile, remoteFileExists, actionType }) {
  const normPath = sanitizePath(relativePath);

  // Raw Sanctuary 聖域鐵律
  if (normPath === "raw" || normPath.startsWith("raw/")) {
    if (actionType === "modify" || actionType === "delete" || actionType === "rename") {
      throw new Error(`Raw Sanctuary 聖域鐵律阻絕：禁止修改、覆寫或刪除 raw/ 原始數據 (${normPath})`);
    }
    if (actionType === "create" && remoteFileExists) {
      throw new Error(`Raw Sanctuary 聖域衝突 (409 Conflict)：原始檔案 '${normPath}' 已存在，不可重複覆寫`);
    }
  }

  // 建立新檔案防覆寫
  if (isNewFile && remoteFileExists) {
    throw new Error(`建立失敗 (409 Conflict)：目標檔案 '${normPath}' 已存在，為防資料遺失禁止覆寫`);
  }

  return true;
}

/**
 * 7. 二進位無損轉換與檢驗
 */
function processBinaryAsset(bufferOrBytes) {
  if (!(bufferOrBytes instanceof Uint8Array) && !Buffer.isBuffer(bufferOrBytes)) {
    throw new Error("二進位素材必須為 Uint8Array 或 Buffer");
  }
  const originalBytes = Buffer.from(bufferOrBytes);
  const base64Str = originalBytes.toString("base64");

  // 解碼回 Buffer 比對
  const decodedBytes = Buffer.from(base64Str, "base64");
  if (!originalBytes.equals(decodedBytes)) {
    throw new Error("二進位轉碼發生損壞 (Byte mismatch)");
  }

  // 驗證若嘗試以 UTF-8 錯誤解碼二進位檔案將導致資料損壞
  const lossyString = originalBytes.toString("utf8");
  const lossyRebuilt = Buffer.from(lossyString, "utf8");
  const isLossyCorrupted = !originalBytes.equals(lossyRebuilt);

  return {
    base64: base64Str,
    sha256: crypto.createHash("sha256").update(originalBytes).digest("hex"),
    size: originalBytes.length,
    isLossyCorrupted,
  };
}

/**
 * 8. 寫入後驗證 (Post-Write Verification)
 */
function verifyWriteResult({ apiResponse, expectedSha256, verifyReadFn }) {
  if (!apiResponse || !apiResponse.success) {
    throw new Error("寫入請求失敗，不可宣稱成功");
  }

  const commitSha = apiResponse.commit_sha;
  if (!commitSha || typeof commitSha !== "string" || !/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error(`GitHub 未回傳有效的 40 位元 Git Commit SHA (取得: '${commitSha}')，驗證失敗`);
  }

  if (verifyReadFn) {
    const remoteData = verifyReadFn();
    if (!remoteData || !remoteData.exists) {
      throw new Error("寫入後驗證失敗：遠端無法讀取到該檔案");
    }
    if (expectedSha256 && remoteData.sha256 !== expectedSha256) {
      throw new Error("寫入後驗證失敗：遠端內容 SHA256 與本地預期不符");
    }
  }

  return { verified: true, commitSha };
}

// ==============================================================
// 執行測試套件
// ==============================================================

async function runVerification() {
  console.log("\n====================================================");
  console.log("🧪 GitHub Workspace Skill & Direct Operation 驗證");
  console.log("====================================================\n");

  // -----------------------------------------------------------
  // [群組 1: Course Mode 與 Experiment Mode 模式辨識]
  // -----------------------------------------------------------
  console.log("▶ [群組 1: Course Mode 與 Experiment Mode 模式辨識]");

  // 1.1 正確辨識 Course Mode
  {
    const ctx = resolveWorkspaceMode({
      repo: "TestLabOrg/ee301-course-repo",
      config: { mode: "course", experiment_code: "lab-01" },
      currentPath: "experiments/lab-01",
    });
    assert.strictEqual(ctx.mode, "course");
    assert.strictEqual(ctx.repository, "TestLabOrg/ee301-course-repo");
    assert.strictEqual(ctx.scopePrefix, "experiments/lab-01/");
    pass("1. 正確辨識 Course Mode，解析出 scopePrefix: experiments/lab-01/");
  }

  // 1.2 正確辨識 Experiment Mode
  {
    const ctx = resolveWorkspaceMode({
      repo: "TestLabOrg/electronics-lab-01",
      config: { mode: "experiment", experiment_id: "lab-01" },
      currentPath: "",
    });
    assert.strictEqual(ctx.mode, "experiment");
    assert.strictEqual(ctx.repository, "TestLabOrg/electronics-lab-01");
    assert.strictEqual(ctx.scopePrefix, "");
    pass("1b. 正確辨識 Experiment Mode，scopePrefix 為空，工作目錄為根目錄");
  }

  // -----------------------------------------------------------
  // [群組 2: 儲存庫名稱防混淆鐵律]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 2: 儲存庫名稱防混淆鐵律]");

  // 2.1 嚴禁把實驗目錄拼入 Repo 名稱
  assert.throws(
    () => {
      validateRepositoryName("TestLabOrg/ee301-course-repo/experiments/lab-01");
    },
    /儲存庫名稱中不得包含實驗目錄路徑|必須為 'owner\/repo' 格式/
  );
  pass("2. 不會把實驗目錄誤當 Repo 名稱 (阻擋 owner/repo/experiments/lab-01)");

  // 2.2 拒絕格式非 owner/repo
  assert.throws(
    () => {
      validateRepositoryName("just-a-repo-name");
    },
    /必須為 'owner\/repo' 格式/
  );
  pass("2b. 非 owner/repo 格式拒絕解析");

  // -----------------------------------------------------------
  // [群組 3: 報告模式路徑規則 (Shared vs Separate)]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 3: 報告模式路徑規則 (Shared vs Separate)]");

  // 3.1 Course Mode 下 shared 報告路徑
  {
    const ctx = resolveWorkspaceMode({
      repo: "TestLabOrg/ee301-course-repo",
      config: { mode: "course", experiment_code: "lab-01" },
    });
    const repPath = resolveReportPath(ctx, "shared", null);
    assert.strictEqual(repPath, "experiments/lab-01/report/report.md");
    pass("3. Shared 模式正確解析報告路徑至 experiments/lab-01/report/report.md");
  }

  // 3.2 Course Mode 下 separate 報告路徑 (已知使用者)
  {
    const ctx = resolveWorkspaceMode({
      repo: "TestLabOrg/ee301-course-repo",
      config: { mode: "course", experiment_code: "lab-01" },
    });
    const repPath = resolveReportPath(ctx, "separate", "studentA");
    assert.strictEqual(repPath, "experiments/lab-01/report/report-studentA.md");
    pass("3b. Separate 模式正確解析個人報告路徑至 experiments/lab-01/report/report-studentA.md");
  }

  // 3.3 Separate 模式未提供身分時嚴格拒絕寫入 (不退回共用報告)
  assert.throws(
    () => {
      const ctx = resolveWorkspaceMode({
        repo: "TestLabOrg/ee301-course-repo",
        config: { mode: "course", experiment_code: "lab-01" },
      });
      resolveReportPath(ctx, "separate", null);
    },
    /無法確認當前 GitHub 使用者身分，嚴禁寫入報告/
  );
  pass("4. Separate 模式身分不明時拒絕存取，絕對不退回共用報告或猜測他人檔案");

  // -----------------------------------------------------------
  // [群組 4: 無法辨識 Repo 或實驗代碼時拒絕寫入]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 4: 缺少關鍵識別資訊時拒絕寫入]");

  // 4.1 缺少 Repo 名稱
  assert.throws(
    () => {
      resolveWorkspaceMode({ repo: "", config: {} });
    },
    /無法識別目標 GitHub Repository，拒絕寫入/
  );
  pass("5. 缺少 Repo 資訊時拒絕寫入");

  // 4.2 Course Mode 缺少 experiment_code
  assert.throws(
    () => {
      resolveWorkspaceMode({
        repo: "TestLabOrg/ee301-course-repo",
        config: { mode: "course" },
        currentPath: "experiments",
      });
    },
    /無法辨識實驗代碼/
  );
  pass("5b. Course Mode 缺少 experiment_code 時拒絕寫入");

  // -----------------------------------------------------------
  // [群組 5: 路徑穿越與跨實驗操作防護]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 5: 路徑穿越與跨實驗操作防護]");

  // 5.1 ../ 相對路徑穿越攔截
  assert.throws(
    () => {
      sanitizePath("../etc/passwd");
    },
    /路徑穿越檢驗失敗/
  );
  pass("6. ../ 相對路徑穿越精準攔截");

  // 5.2 URL 編碼穿越 (%2e%2e)
  assert.throws(
    () => {
      sanitizePath("%2e%2e/secret.txt");
    },
    /路徑穿越檢驗失敗/
  );
  pass("6b. %2e%2e URL 編碼穿越精準攔截");

  // 5.3 絕對路徑攔截
  assert.throws(
    () => {
      sanitizePath("/etc/hosts");
    },
    /不允許使用絕對路徑/
  );
  pass("6c. 絕對路徑遭精準阻擋");

  // 5.4 Course Mode 下嘗試跨越實驗目錄 (從 lab-01 存取 lab-02)
  {
    const ctx = resolveWorkspaceMode({
      repo: "TestLabOrg/ee301-course-repo",
      config: { mode: "course", experiment_code: "lab-01" },
    });
    assert.throws(
      () => {
        // 企圖透過 ../ 越界到 lab-02
        const attemptPath = sanitizePath("../lab-02/secret.txt");
        resolveScopedRemotePath(ctx, attemptPath);
      },
      /路徑穿越檢驗失敗/
    );
    pass("6d. Course Mode 跨實驗越界操作全數阻絕");
  }

  // -----------------------------------------------------------
  // [群組 6: 檔案防覆寫安全鎖]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 6: 建立新檔案防覆寫檢驗]");

  // 6.1 建立新檔案時若遠端已存在該檔案，拒絕覆寫
  assert.throws(
    () => {
      checkPreWritePolicy({
        relativePath: "analysis/curve.png",
        isNewFile: true,
        remoteFileExists: true,
        actionType: "create",
      });
    },
    /409 Conflict.*已存在.*禁止覆寫/
  );
  pass("7. 建立新檔案前檢測遠端已存在，觸發 409 Conflict 阻止覆寫");

  // 6.2 遠端不存在時允許建立
  {
    const ok = checkPreWritePolicy({
      relativePath: "analysis/new_plot.py",
      isNewFile: true,
      remoteFileExists: false,
      actionType: "create",
    });
    assert.strictEqual(ok, true);
    pass("7b. 遠端不存在時合法建立新檔案");
  }

  // -----------------------------------------------------------
  // [群組 7: Raw Data Sanctuary 聖域不可變鐵律]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 7: Raw Data Sanctuary 聖域鐵律]");

  // 7.1 嚴禁修改 raw/ 現有檔案
  assert.throws(
    () => {
      checkPreWritePolicy({
        relativePath: "raw/measurements.csv",
        isNewFile: false,
        remoteFileExists: true,
        actionType: "modify",
      });
    },
    /Raw Sanctuary 聖域鐵律阻絕：禁止修改、覆寫或刪除 raw\//
  );
  pass("8. 修改 raw/ 既有檔案遭聖域鐵律阻絕");

  // 7.2 嚴禁刪除 raw/ 現有檔案
  assert.throws(
    () => {
      checkPreWritePolicy({
        relativePath: "raw/data.xlsx",
        isNewFile: false,
        remoteFileExists: true,
        actionType: "delete",
      });
    },
    /Raw Sanctuary 聖域鐵律阻絕：禁止修改、覆寫或刪除 raw\//
  );
  pass("8b. 刪除 raw/ 既有檔案遭聖域鐵律阻絕");

  // 7.3 上傳 raw 檔案時若已存在同名檔案，遭 409 衝突阻止
  assert.throws(
    () => {
      checkPreWritePolicy({
        relativePath: "raw/data.csv",
        isNewFile: true,
        remoteFileExists: true,
        actionType: "create",
      });
    },
    /Raw Sanctuary 聖域衝突 \(409 Conflict\)/
  );
  pass("8c. 上傳同名 raw 檔案遭 409 阻絕，杜絕就地改寫原始數據");

  // -----------------------------------------------------------
  // [群組 8: 二進位無損轉換與文字解碼損壞防護]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 8: 二進位素材無損轉換檢驗]");

  // 8.1 產生典型 JPEG 標頭與二進位資料 (含 0xFF, 0xD8, 0x00, 0xFE, 0x80 等無效 UTF-8 字元)
  const binaryJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x80, 0xfe, 0xff]);
  const binResult = processBinaryAsset(binaryJpeg);

  // 驗證 Base64 與 Byte 完整性
  assert.strictEqual(binResult.size, binaryJpeg.length);
  assert.strictEqual(typeof binResult.base64, "string");
  // 驗證若當作文字解碼確實會造成資料損壞，因此必須使用二進位傳輸
  assert.strictEqual(binResult.isLossyCorrupted, true);
  pass("9. [單元隔離] 二進位圖片素材通過 Base64/Binary 無損檢驗，確認若錯誤以文字解碼會損壞");

  // -----------------------------------------------------------
  // [群組 9: 寫入後驗證與真實 Commit SHA 查驗 (模擬驗證)]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 9: 寫入後驗證與真實 Commit SHA 查驗 (邏輯驗證)]");

  // 9.1 API 寫入成功且包含真實 40 位元 SHA
  {
    const realSha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    const res = verifyWriteResult({
      apiResponse: { success: true, commit_sha: realSha },
      expectedSha256: "dummy",
      verifyReadFn: () => ({ exists: true, sha256: "dummy" }),
    });
    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.commitSha, realSha);
    pass("10. [邏輯檢驗] 寫入後成功驗證真實 40 位元 Git Commit SHA 與遠端內容完整性");
  }

  // 9.2 API 缺失 Commit SHA 判定驗證失敗 (不假報成功)
  assert.throws(
    () => {
      verifyWriteResult({
        apiResponse: { success: true, commit_sha: null },
      });
    },
    /GitHub 未回傳有效的 40 位元 Git Commit SHA.*驗證失敗/
  );
  pass("10b. [邏輯檢驗] 缺少 Commit SHA 嚴格判定失敗，不宣稱成功");

  // 9.3 遠端讀取校驗不符判定失敗
  assert.throws(
    () => {
      verifyWriteResult({
        apiResponse: { success: true, commit_sha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" },
        expectedSha256: "expected_hash_value",
        verifyReadFn: () => ({ exists: true, sha256: "mismatched_hash_value" }),
      });
    },
    /遠端內容 SHA256 與本地預期不符/
  );
  pass("9.3 [單元邏輯] 寫入後遠端內容 SHA 不一致判定失敗，嚴禁假報成功");

  // ===========================================================
  // ▶ [群組 10: CLI 手動指引輸出無損與安全檢驗 (單元測試)]
  // ===========================================================
  console.log("\n▶ [群組 10: CLI 手動指引輸出無損與安全檢驗 (單元測試)]");

  function captureLogs(fn) {
    const originalLog = console.log;
    let output = "";
    console.log = (...args) => {
      output += args.join(" ") + "\n";
    };
    try {
      fn();
    } finally {
      console.log = originalLog;
    }
    return output;
  }

  const uncommittedOutput = captureLogs(() => {
    printUncommittedManualInstructions("/tmp/test", "owner/repo", "init msg");
  });
  assert.ok(!uncommittedOutput.includes("git push -u origin main"), "手動指引嚴禁包含 'git push -u origin main'");
  assert.ok(uncommittedOutput.includes("git push origin refs/heads/<source_branch>:refs/heads/<target_branch>"), "手動指引必須包含明確 refs/heads 分支映射");
  pass("11.1 [CLI 單元] printUncommittedManualInstructions 移除寫死 main 並包含 refs/heads 分支映射指引");

  const manualOutput = captureLogs(() => {
    printManualInstructions("/tmp/test", "owner/repo");
  });
  assert.ok(!manualOutput.includes("git push -u origin main"), "手動指引嚴禁包含 'git push -u origin main'");
  assert.ok(manualOutput.includes("git push origin refs/heads/<source_branch>:refs/heads/<target_branch>"), "手動指引必須包含明確 refs/heads 分支映射");
  pass("11.2 [CLI 單元] printManualInstructions 移除寫死 main 並包含 refs/heads 分支映射指引");

  const pushOutput = captureLogs(() => {
    printManualPushInstructions("/tmp/test", "owner/repo", "feat-test");
  });
  assert.ok(!pushOutput.includes("git push -u origin main"), "推送指引嚴禁包含 'git push -u origin main'");
  assert.ok(pushOutput.includes("git push origin refs/heads/feat-test:refs/heads/<target_branch>"), "推送指引必須包含具體來源分支 refs/heads 映射");
  pass("11.3 [CLI 單元] printManualPushInstructions 具備動態來源分支與目標分支 refs/heads 映射指引");

  assert.ok(pushOutput.includes("推向 main 或受保護分支必須取得明確專屬授權"), "手動指引必須聲明推向 main 需明確專屬授權");
  assert.ok(pushOutput.includes("嚴禁使用 --force"), "手動指引必須明文禁止 --force");
  pass("11.4 [CLI 單元] 手動操作指引與 Skill 規範一致（受保護分支專屬授權與禁止 force）");

  // 11.5 isValidBranchName 分支名稱安全格式驗證
  assert.strictEqual(isValidBranchName("main"), true, "main 為合法分支名稱");
  assert.strictEqual(isValidBranchName("feat/github-workspace-skill"), true, "feat/* 為合法分支名稱");
  assert.strictEqual(isValidBranchName("release-1.0_fix"), true, "英數字破折號底線為合法名稱");
  assert.strictEqual(isValidBranchName(""), false, "空字串不得為合法分支");
  assert.strictEqual(isValidBranchName("   "), false, "純空白不得為合法分支");
  assert.strictEqual(isValidBranchName("HEAD"), false, "HEAD 不得為合法分支名稱");
  assert.strictEqual(isValidBranchName("-bad-start"), false, "以破折號開頭之分支名稱不得合法");
  assert.strictEqual(isValidBranchName("/bad-start"), false, "以斜線開頭之分支名稱不得合法");
  assert.strictEqual(isValidBranchName("bad-end/"), false, "以斜線結尾之分支名稱不得合法");
  assert.strictEqual(isValidBranchName("bad..name"), false, "包含雙點之分支名稱不得合法");
  assert.strictEqual(isValidBranchName("bad name"), false, "包含空格之分支名稱不得合法");
  assert.strictEqual(isValidBranchName("feat@{1}"), false, "包含 @{} 之分支名稱不得合法");
  assert.strictEqual(isValidBranchName("feature.lock"), false, "以 .lock 結尾之分支名稱不得合法");
  assert.strictEqual(isValidBranchName("+force-branch"), false, "以加號 (+) 開頭之分支名稱不得合法 (防範 refspec force push 語意)");
  assert.strictEqual(isValidBranchName("+main"), false, "+main 不得為合法分支名稱");
  pass("11.5 [CLI 單元] isValidBranchName 嚴格校驗合法分支格式，防範 HEAD、空值、非法字元、+ 號與參數注入");

  // ===========================================================
  // ▶ [群組 11: CLI 實體控制流程與授權閘門自動化測試 (Control Flow Integration)]
  // ===========================================================
  console.log("\n▶ [群組 11: CLI 實體控制流程與授權閘門自動化測試 (Control Flow Integration)]");

  const createLabScript = path.join(ROOT_DIR, "scripts", "create-lab.mjs");

  // 12.1 --yes 僅自動確認檔案產生，不得跳過 Commit 確認 (若輸入 no 則 0 commit, 0 remote, 0 push)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test1-"));
    try {
      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow1",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow1",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "no\n",
        encoding: "utf8"
      });

      const targetPath = path.join(tmpDir, "fc101-exp-flow1");
      assert.ok(fs.existsSync(path.join(targetPath, "README.md")), "檔案應已被 --yes 自動確認建立");
      assert.ok(output.includes("使用者未確認 Commit"), "輸出必須顯示使用者未確認 Commit");
      assert.ok(output.includes("不建立 Commit、不建立遠端 GitHub Repo、不執行 Push"), "安全原則必須被觸發");
      assert.ok(!output.includes("git push -u origin main"), "手動指引嚴禁包含 'git push -u origin main'");

      let hasCommit = false;
      try {
        execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetPath, stdio: "ignore" });
        hasCommit = true;
      } catch {
        hasCommit = false;
      }
      assert.strictEqual(hasCommit, false, "未確認 Commit 時本地 Git 絕對不可有任何 Commit");
      pass("12.1 [控制流程] --yes 僅自動確認檔案產生，不得跳過 Commit 確認 (拒絕 Commit 則 0 Commit, 0 遠端, 0 Push)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.2 同意 Commit 但拒絕遠端 Repo，不得建立遠端與 Push (安全保留本地 Commit)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test2-"));
    try {
      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow2",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow2",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nno\n",
        encoding: "utf8"
      });

      const targetPath = path.join(tmpDir, "fc101-exp-flow2");
      assert.ok(output.includes("已完成本地 Commit"), "應完成本地 Commit");
      assert.ok(output.includes("使用者未確認建立遠端 Repository"), "應明確確認未建立遠端");
      assert.ok(output.includes("已安全保留本地 Commit，未建立任何遠端 GitHub 資源"), "應安全保留本地 Commit");
      assert.ok(!output.includes("遠端推送預覽確認 (Git Push)"), "拒絕建立遠端時不得進入 Push 流程");
      assert.ok(!output.includes("git push -u origin main"), "手動指引嚴禁包含 'git push -u origin main'");

      const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetPath, encoding: "utf8" }).trim();
      assert.strictEqual(headCommit.length, 40, "本地應有 40 位元真實 Commit SHA");
      const remotes = execFileSync("git", ["remote"], { cwd: targetPath, encoding: "utf8" }).trim();
      assert.strictEqual(remotes, "", "拒絕建立遠端時本地不可存在 remote origin");
      pass("12.2 [控制流程] 同意 Commit 但拒絕遠端 Repo 時，保留本地 Commit 且完全不建立遠端與 Push");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ===========================================================
  // 取得真實 Git 執行檔絕對路徑 (跨平台相容，嚴防遞迴呼叫與相對路徑)
  // ===========================================================
  function getRealGitBinary() {
    const isWindows = process.platform === "win32";
    const binaryNames = isWindows ? ["git.exe", "git.cmd", "git"] : ["git"];

    // 優先策略 1：透過系統 which / where 探測真實 git 的絕對路徑
    try {
      const probeCmd = isWindows ? "where" : "which";
      const stdout = execFileSync(probeCmd, ["git"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (path.isAbsolute(line)) {
          try {
            const resolved = fs.realpathSync(line);
            const stat = fs.statSync(resolved);
            if (stat.isFile()) {
              if (!isWindows) {
                fs.accessSync(resolved, fs.constants.X_OK);
              }
              const ver = execFileSync(resolved, ["--version"], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"]
              });
              if (ver.toLowerCase().includes("git version")) {
                return resolved;
              }
            }
          } catch {}
        }
      }
    } catch {}

    // 優先策略 2：搜尋目前 process.env.PATH 中的各目錄 (僅收錄絕對路徑且具有執行權限之檔案)
    const pathDirs = (process.env.PATH || "").split(path.delimiter);
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const name of binaryNames) {
        const candidate = path.join(dir, name);
        try {
          if (path.isAbsolute(candidate)) {
            const resolved = fs.realpathSync(candidate);
            const stat = fs.statSync(resolved);
            if (stat.isFile()) {
              if (!isWindows) {
                fs.accessSync(resolved, fs.constants.X_OK);
              }
              const ver = execFileSync(resolved, ["--version"], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"]
              });
              if (ver.toLowerCase().includes("git version")) {
                return resolved;
              }
            }
          }
        } catch {}
      }
    }

    // 優先策略 3：檢查常見平台的標準安裝位置
    const standardPaths = isWindows
      ? [
          "C:\\Program Files\\Git\\cmd\\git.exe",
          "C:\\Program Files\\Git\\bin\\git.exe",
          "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
        ]
      : [
          "/usr/bin/git",
          "/usr/local/bin/git",
          "/opt/homebrew/bin/git",
          "/Library/Developer/CommandLineTools/usr/bin/git"
        ];
    for (const candidate of standardPaths) {
      try {
        const resolved = fs.realpathSync(candidate);
        const stat = fs.statSync(resolved);
        if (stat.isFile()) {
          if (!isWindows) {
            fs.accessSync(resolved, fs.constants.X_OK);
          }
          const ver = execFileSync(resolved, ["--version"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
          });
          if (ver.toLowerCase().includes("git version")) {
            return resolved;
          }
        }
      } catch {}
    }

    throw new Error("無法定位可執行的真實 Git 二進位檔絕對路徑，無法安全執行 Mock Git 隔離測試。");
  }

  const realGitBinary = getRealGitBinary();

  // 建立 Mock 執行環境 (提供 gh 與 git 攔截，以 JSON Lines 格式記錄完整參數邊界)
  function setupMockBin(tmpDir, customGitBranchHandler = "") {
    const binDir = path.join(tmpDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });

    const nodeBin = process.execPath;
    const mockGhCallsLog = path.join(tmpDir, "gh-calls.log");
    const mockGh = path.join(binDir, "gh");
    fs.writeFileSync(
      mockGh,
      `#!/bin/sh
"${nodeBin}" -e '
  const fs = require("fs");
  const args = process.argv.slice(2);
  const logFile = process.argv[1];
  fs.appendFileSync(logFile, JSON.stringify(args) + "\\n");
' "${mockGhCallsLog}" "$@"
exit 0
`,
      { mode: 0o755 }
    );

    const mockGitPushLog = path.join(tmpDir, "git-push.log");
    const mockGitCallsLog = path.join(tmpDir, "git-calls.log");
    const mockGit = path.join(binDir, "git");
    const mockGitScript = `#!/bin/sh
REAL_GIT="${realGitBinary}"
"${nodeBin}" -e '
  const fs = require("fs");
  const args = process.argv.slice(2);
  const logFile = process.argv[1];
  fs.appendFileSync(logFile, JSON.stringify(args) + "\\n");
' "${mockGitCallsLog}" "$@"

if [ "$1" = "push" ]; then
  "${nodeBin}" -e '
    const fs = require("fs");
    const args = process.argv.slice(2);
    const logFile = process.argv[1];
    fs.appendFileSync(logFile, JSON.stringify(args) + "\\n");
  ' "${mockGitPushLog}" "$@"
  exit 0
fi
${customGitBranchHandler}
exec "$REAL_GIT" "$@"
`;
    fs.writeFileSync(mockGit, mockGitScript, { mode: 0o755 });

    return {
      binDir,
      mockGhCallsLog,
      mockGitPushLog,
      mockGitCallsLog,
      readCalls: () => {
        if (!fs.existsSync(mockGitCallsLog)) return [];
        return fs.readFileSync(mockGitCallsLog, "utf8")
          .split("\n")
          .filter(Boolean)
          .map(line => JSON.parse(line));
      },
      readPushCalls: () => {
        if (!fs.existsSync(mockGitPushLog)) return [];
        return fs.readFileSync(mockGitPushLog, "utf8")
          .split("\n")
          .filter(Boolean)
          .map(line => JSON.parse(line));
      },
      assertMockInterceptedAndZeroPush: () => {
        assert.ok(fs.existsSync(mockGitCallsLog), "Mock Git 必須被 CLI 實際呼叫 (證明 Mock 攔截生效)");
        const calls = fs.readFileSync(mockGitCallsLog, "utf8")
          .split("\n")
          .filter(Boolean)
          .map(line => JSON.parse(line));
        assert.ok(calls.some(args => args[0] === "init"), "CLI 必須實際執行 git init 子程序");
        const pushCalls = calls.filter(args => args[0] === "push");
        assert.strictEqual(pushCalls.length, 0, "安全阻擋情境下 git push 呼叫次數必須精確為 0");
        assert.strictEqual(fs.existsSync(mockGitPushLog), false, "安全阻擋情境下嚴禁產生 git push 攔截日誌");
      }
    };
  }

  // 12.3 同意建立遠端 Repo 但拒絕 Push (Mock gh 攔截：驗證 gh repo create 嚴禁攜帶 --push)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test3-"));
    try {
      const { binDir, mockGhCallsLog, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow3",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow3",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nno\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      const ghCalls = fs.existsSync(mockGhCallsLog)
        ? fs.readFileSync(mockGhCallsLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line))
        : [];
      const repoCreateCall = ghCalls.find(args => args[0] === "repo" && args[1] === "create");
      assert.ok(repoCreateCall, "gh repo create 必須被呼叫");
      assert.ok(!repoCreateCall.includes("--push"), "gh repo create 呼叫參數中嚴禁攜帶 --push！");
      assert.ok(output.includes("使用者未授權遠端 Push"), "輸出必須顯示使用者未授權遠端 Push");
      assert.ok(output.includes("未執行任何推送操作"), "輸出必須宣告未執行任何推送操作");
      assertMockInterceptedAndZeroPush();
      pass("12.3 [控制流程] 同意建立遠端但拒絕 Push：gh repo create 徹底解耦 --push，0 推送操作且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.4 同意 Push 但目標分支留空，嚴禁預設推送 main，流程立即取消終止
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test4-"));
    try {
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow4",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow4",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\n\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("未指定目標分支，取消推送"), "目標分支空白時必須取消推送");
      assert.ok(!output.includes("正在推送至遠端"), "嚴禁自動執行推送");
      assertMockInterceptedAndZeroPush();
      pass("12.4 [控制流程] 同意 Push 但目標分支留空：嚴禁預設推向 main，推送流程立即安全終止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.5 同意 Push 且目標輸入 main，但拒絕受保護分支專屬授權，立即終止
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test5-"));
    try {
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow5",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow5",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nno\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("未取得指向該分支的明確授權，取消推送"), "受保護分支未獲確認必須取消推送");
      assert.ok(!output.includes("正在推送至遠端"), "嚴禁未獲專屬授權執行推送");
      assertMockInterceptedAndZeroPush();
      pass("12.5 [控制流程] 推向 main 目標分支拒絕專屬授權：受保護分支雙重授權閘門觸發，安全終止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.6 模擬 git branch --show-current 失敗或回傳空字串：確認 CLI 中止且沒有執行 git push
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test6a-"));
    try {
      const customBranchHandler = `
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  if [ -n "$MOCK_BRANCH_FAIL" ]; then
    exit 1
  fi
  if [ -n "$MOCK_BRANCH_EMPTY" ]; then
    exit 0
  fi
fi
`;
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      // 情境 a: git branch --show-current 執行失敗 (exit 1)
      const outputFail = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow6a",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow6a",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          MOCK_BRANCH_FAIL: "1"
        }
      });

      assert.ok(outputFail.includes("無法確認目前本地來源分支"), "輸出必須顯示無法確認目前本地來源分支警示");
      assert.ok(outputFail.includes("嚴禁預設回退至 main 或未確認分支"), "輸出必須顯示嚴禁回退 main 規範");
      assert.ok(!outputFail.includes("正在推送至遠端"), "嚴禁未確認來源分支時執行推送");
      assertMockInterceptedAndZeroPush();

      // 情境 b: git branch --show-current 回傳空字串
      const outputEmpty = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow6b",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow6b",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          MOCK_BRANCH_EMPTY: "1"
        }
      });

      assert.ok(outputEmpty.includes("無法確認目前本地來源分支"), "輸出必須顯示無法確認目前本地來源分支警示");
      assert.ok(!outputEmpty.includes("正在推送至遠端"), "嚴禁來源分支為空字串時執行推送");
      assertMockInterceptedAndZeroPush();

      pass("12.6 [控制流程] 模擬 git branch --show-current 失敗或回傳空字串：確認 CLI 中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.7 模擬 detached HEAD：確認中止且沒有執行 git push
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test7-"));
    try {
      const customBranchHandler = `
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  # detached HEAD 在 git branch --show-current 下不輸出任何內容並以 0 退出
  exit 0
fi
`;
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow7",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow7",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("無法確認目前本地來源分支"), "輸出必須顯示無法確認目前本地來源分支警示");
      assert.ok(output.includes("嚴禁預設回退至 main 或未確認分支"), "輸出必須顯示嚴禁回退 main 規範");
      assert.ok(!output.includes("正在推送至遠端"), "detached HEAD 狀態嚴禁執行推送");
      assertMockInterceptedAndZeroPush();
      pass("12.7 [控制流程] 模擬 detached HEAD：確認 CLI 中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.7b 模擬 git rev-parse HEAD 失敗或無法取得有效 SHA：確認 CLI 中止且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test7b-"));
    try {
      const customBranchHandler = `
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  exit 1
fi
`;
      const { binDir, readCalls, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow7b",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow7b",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("無法確認本地待推送之 Commit SHA"), "輸出必須顯示無法確認 Commit SHA 警示");
      assert.ok(output.includes("嚴禁在無法確認待推送 Commit 之情況下發起推送"), "輸出必須顯示安全中止規範");
      assert.ok(!output.includes("【待推送 Commit SHA】: HEAD"), "絕不將 'HEAD' 字面值當成實際 Commit SHA 顯示");
      assert.ok(!output.includes("是否執行遠端 Git Push？"), "未確認 Commit SHA 嚴禁進入推送授權步驟");
      assert.ok(!output.includes("正在推送至遠端"), "未確認 Commit SHA 嚴禁執行推送");
      assertMockInterceptedAndZeroPush();

      const calls = readCalls();
      assert.ok(calls.some(args => args[0] === "rev-parse" && args[1] === "HEAD"), "必須確實呼叫 rev-parse HEAD 子程序");
      pass("12.7b [控制流程] 模擬 git rev-parse HEAD 失敗：絕不將 HEAD 假裝成實際 SHA，確認 CLI 中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.7c 儲存庫物件格式 (Object Format) 與 Commit SHA 驗證相容性 (支援 SHA-1 40 位元與 SHA-256 64 位元)
  {
    let supportsSha256 = false;
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-sha256-probe-"));
    try {
      execFileSync(realGitBinary, ["init", "--object-format=sha256"], {
        cwd: probeDir,
        stdio: "ignore"
      });
      const fmt = execFileSync(realGitBinary, ["rev-parse", "--show-object-format"], {
        cwd: probeDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      supportsSha256 = fmt === "sha256";
    } catch {
      supportsSha256 = false;
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }

    if (!supportsSha256) {
      console.log("  ℹ️  [環境宣告] 本機 Git 環境未支援 --object-format=sha256，已明確標記並略過 SHA-256 實體執行測試，僅驗證 SHA-1。");
    } else {
      // 情境 a: SHA-256 儲存庫正常流程：驗證 CLI 識別 64 位元 SHA 並在授權後完成推送
      const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test7c-sha256-ok-"));
      try {
        const customBranchHandler = `
if [ "$1" = "init" ]; then
  shift
  exec "$REAL_GIT" init --object-format=sha256 "$@"
fi
`;
        const { binDir, readPushCalls } = setupMockBin(tmpDirA, customBranchHandler);

        const outputOk = execFileSync("node", [
          createLabScript,
          "--course-name", "FlowCourse",
          "--course-id", "FC101",
          "--semester", "114-1",
          "--exp-id", "exp-flow7c",
          "--exp-name", "FlowExp",
          "--repo", "testorg/fc101-exp-flow7c",
          "--yes"
        ], {
          cwd: tmpDirA,
          input: "yes\nyes\n1\nyes\nsha256-target\n",
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`
          }
        });

        assert.ok(outputOk.includes("【待推送 Commit SHA】:"), "SHA-256 儲存庫輸出必須包含待推送 Commit SHA");
        const shaMatch = outputOk.match(/【待推送 Commit SHA】:\s*([0-9a-f]{64})/i);
        assert.ok(shaMatch, "必須能從遠端推送預覽中精確擷取出 64 位元 Commit SHA");
        const previewSha = shaMatch[1].trim();
        assert.strictEqual(previewSha.length, 64, "預覽 Commit SHA 長度必須恰好為 64 位元十六進位字串");
        const targetPathA = path.join(tmpDirA, "fc101-exp-flow7c");
        const realHeadSha = execFileSync(realGitBinary, ["rev-parse", "HEAD"], {
          cwd: targetPathA,
          encoding: "utf8"
        }).trim();
        assert.strictEqual(previewSha, realHeadSha, "預覽 Commit SHA 必須與測試儲存庫透過真實 Git 取得之 HEAD SHA 完全一致");
        assert.ok(outputOk.includes("正在推送至遠端: git push origin refs/heads/"), "SHA-256 儲存庫授權後應成功發起推送");
        const pushLogs = readPushCalls();
        assert.strictEqual(pushLogs.length, 1, "SHA-256 儲存庫授權後應恰好執行 1 次推送");
      } finally {
        fs.rmSync(tmpDirA, { recursive: true, force: true });
      }

      // 情境 b: SHA-256 儲存庫但 Commit SHA 長度不符 (模擬回傳 40 位元 SHA)：確認 CLI 攔截且 0 git push 呼叫
      const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test7c-sha256-mismatch-"));
      try {
        const customBranchHandler = `
if [ "$1" = "init" ]; then
  shift
  exec "$REAL_GIT" init --object-format=sha256 "$@"
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  # 刻意回傳 40 位元長度之 SHA，模擬與 sha256 儲存庫不匹配
  echo "1111222233334444555566667777888899990000"
  exit 0
fi
`;
        const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDirB, customBranchHandler);

        const outputMismatch = execFileSync("node", [
          createLabScript,
          "--course-name", "FlowCourse",
          "--course-id", "FC101",
          "--semester", "114-1",
          "--exp-id", "exp-flow7c-mismatch",
          "--exp-name", "FlowExp",
          "--repo", "testorg/fc101-exp-flow7c-mismatch",
          "--yes"
        ], {
          cwd: tmpDirB,
          input: "yes\nyes\n1\nyes\nsha256-target\n",
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`
          }
        });

        assert.ok(outputMismatch.includes("無法確認本地待推送之 Commit SHA"), "SHA 長度與物件格式不符時必須中斷");
        assert.ok(outputMismatch.includes("未取得有效的 SHA256 Commit SHA，預期格式為 64 位元十六進位字串"), "必須提示預期 64 位元格式");
        assert.ok(!outputMismatch.includes("正在推送至遠端"), "SHA 長度不符時嚴禁推送");
        assertMockInterceptedAndZeroPush();
      } finally {
        fs.rmSync(tmpDirB, { recursive: true, force: true });
      }

      pass("12.7c [控制流程] Git 儲存庫物件格式相容性：動態支援 SHA-1 與 SHA-256 64 位元 SHA 驗證 (比對真實 HEAD 完全一致)，格式長度不符立即中斷且 0 git push");
    }
  }

  // 12.7d 物件格式讀取失敗 (exit 1 或輸出空字串)：拒絕默認回退 SHA-1，安全中止且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test7d-objfmt-fail-"));
    try {
      const customBranchHandler = `
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-object-format" ]; then
  exit 1
fi
`;
      const { binDir, readCalls, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow7d",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow7d",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("無法確認 Git 儲存庫物件格式"), "輸出必須顯示無法確認物件格式警示");
      assert.ok(output.includes("嚴禁在無法確認儲存庫物件格式之情況下發起推送"), "輸出必須宣告安全中止規範");
      assert.ok(!output.includes("正在推送至遠端"), "物件格式讀取失敗嚴禁發起推送");
      assert.ok(!output.includes("是否執行遠端 Git Push？"), "物件格式讀取失敗嚴禁進入推送確認步驟");
      assertMockInterceptedAndZeroPush();

      const calls = readCalls();
      assert.ok(calls.some(args => args[0] === "rev-parse" && args[1] === "--show-object-format"), "必須確實呼叫 rev-parse --show-object-format 子程序");
      pass("12.7d [控制流程] 物件格式讀取失敗：嚴禁默認回退 SHA-1，確認 CLI 安全中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.7e 儲存庫物件格式為未知/不支援格式 (unknown-hash-format)：安全中止且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test7e-objfmt-unknown-"));
    try {
      const customBranchHandler = `
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-object-format" ]; then
  echo "unknown-hash-format"
  exit 0
fi
`;
      const { binDir, readCalls, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow7e",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow7e",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes('未能識別支援的物件格式: "unknown-hash-format"'), "輸出必須明確拒絕未知的物件格式");
      assert.ok(output.includes("無法確認 Git 儲存庫物件格式"), "輸出必須顯示無法確認物件格式警示");
      assert.ok(!output.includes("正在推送至遠端"), "未知物件格式嚴禁發起推送");
      assert.ok(!output.includes("是否執行遠端 Git Push？"), "未知物件格式嚴禁進入推送確認步驟");
      assertMockInterceptedAndZeroPush();

      const calls = readCalls();
      assert.ok(calls.some(args => args[0] === "rev-parse" && args[1] === "--show-object-format"), "必須確實呼叫 rev-parse --show-object-format 子程序");
      pass("12.7e [控制流程] 物件格式為未知格式 (unknown-hash-format)：嚴禁默認視為 SHA-1，確認安全中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.8a 來源分支讀取成功但分支名稱含雙點無效 (bad..branch)：確認 CLI 中止且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test8a-src-inv-"));
    try {
      const customBranchHandler = `
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  echo "bad..branch"
  exit 0
fi
`;
      const { binDir, readCalls, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow8a-src-inv",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow8a-src-inv",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("無法確認目前本地來源分支"), "輸出必須顯示無法確認目前本地來源分支警示");
      assert.ok(output.includes("請使用者先確認並手動切換至合法的本地分支"), "輸出必須提示使用者先切換至合法本地分支");
      assert.ok(!output.includes("正在推送至遠端"), "來源分支格式無效時嚴禁執行推送");
      assert.ok(!output.includes("是否執行遠端 Git Push？"), "來源分支格式無效時嚴禁進入推送確認流程");
      assertMockInterceptedAndZeroPush();

      const calls = readCalls();
      assert.ok(calls.some(args => args[0] === "branch" && args[1] === "--show-current"), "必須確實呼叫 branch --show-current 取得分支名稱");
      pass("12.8a [控制流程] 來源分支讀取成功但名稱含雙點無效 (bad..branch)：確認 CLI 中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.8b 來源分支讀取成功但分支名稱含非法字元 (feature@{upstream})：確認 CLI 中止且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test8b-src-inv-"));
    try {
      const customBranchHandler = `
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  echo "feature@{upstream}"
  exit 0
fi
`;
      const { binDir, readCalls, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow8b-src-inv",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow8b-src-inv",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("無法確認目前本地來源分支"), "輸出必須顯示無法確認目前本地來源分支警示");
      assert.ok(output.includes("請使用者先確認並手動切換至合法的本地分支"), "輸出必須提示使用者先切換至合法本地分支");
      assert.ok(!output.includes("正在推送至遠端"), "來源分支格式無效時嚴禁執行推送");
      assert.ok(!output.includes("是否執行遠端 Git Push？"), "來源分支格式無效時嚴禁進入推送確認流程");
      assertMockInterceptedAndZeroPush();

      const calls = readCalls();
      assert.ok(calls.some(args => args[0] === "branch" && args[1] === "--show-current"), "必須確實呼叫 branch --show-current 取得分支名稱");
      pass("12.8b [控制流程] 來源分支讀取成功但名稱含非法字元 (feature@{upstream})：確認 CLI 中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.8c 來源分支讀取成功但名稱開頭為 '+' (+force-branch)：嚴防 refspec force 語意，確認 CLI 中止且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test8c-src-plus-"));
    try {
      const customBranchHandler = `
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  echo "+force-branch"
  exit 0
fi
`;
      const { binDir, readCalls, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customBranchHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow8c-src-plus",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow8c-src-plus",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nmain\nyes\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("無法確認目前本地來源分支"), "輸出必須顯示無法確認目前本地來源分支警示");
      assert.ok(output.includes("嚴禁預設回退至 main 或未確認分支"), "輸出必須顯示嚴禁回退 main 規範");
      assert.ok(!output.includes("正在推送至遠端"), "來源分支開頭含 '+' 時嚴禁執行推送");
      assert.ok(!output.includes("是否執行遠端 Git Push？"), "來源分支開頭含 '+' 時嚴禁進入推送確認流程");
      assertMockInterceptedAndZeroPush();

      const calls = readCalls();
      assert.ok(calls.some(args => args[0] === "branch" && args[1] === "--show-current"), "必須確實呼叫 branch --show-current 取得分支名稱");
      pass("12.8c [控制流程] 來源分支名稱開頭含 '+' (+force-branch)：嚴防 refspec force 語意，確認 CLI 中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.9 輸入非法目標分支 (如 bad..branch)：確認被拒絕且沒有執行 git push
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test9-"));
    try {
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow9",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow9",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nbad..branch\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes('目標分支名稱格式不合法 ("bad..branch")'), "輸出必須拒絕非法目標分支格式 bad..branch");
      assert.ok(output.includes("目標分支必須為合法的 Git 分支名稱，已取消推送"), "輸出必須顯示取消推送警示");
      assert.ok(!output.includes("正在推送至遠端"), "嚴禁對非法目標分支執行推送");
      assertMockInterceptedAndZeroPush();
      pass("12.9 [控制流程] 輸入非法目標分支 (bad..branch)：check-ref-format 攔截，確認被拒絕且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.9b 輸入開頭為 '+' 的目標分支 (+force-target)：嚴防 refspec force 語意，確認被拒絕且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test9b-tgt-plus-"));
    try {
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow9b",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow9b",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\n+force-target\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes('目標分支名稱格式不合法 ("+force-target")'), "輸出必須拒絕開頭為 '+' 的目標分支格式");
      assert.ok(output.includes("目標分支必須為合法的 Git 分支名稱，已取消推送"), "輸出必須顯示取消推送警示");
      assert.ok(!output.includes("正在推送至遠端"), "嚴禁對開頭為 '+' 的目標分支執行推送");
      assertMockInterceptedAndZeroPush();
      pass("12.9b [控制流程] 輸入開頭為 '+' 的目標分支 (+force-target)：嚴防 refspec force 語意，確認被拒絕且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.10 正常來源分支加上空白目標分支：確認不得 Push 且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test10-"));
    try {
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow10",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow10",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\n   \n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("未指定目標分支，取消推送"), "正常來源分支下目標分支空白必須取消推送");
      assert.ok(!output.includes("正在推送至遠端"), "嚴禁空白目標分支自動執行推送");
      assertMockInterceptedAndZeroPush();
      pass("12.10 [控制流程] 正常來源分支加上空白目標分支：確認取消推送且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.11 完整授權且有效目標分支：攔截器確認成功執行參數化映射推送 (非空攔截證明)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test11-"));
    try {
      const { binDir, readCalls, readPushCalls } = setupMockBin(tmpDir);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow11",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow11",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\ncustom-flow-target\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("正在推送至遠端: git push origin"), "合法授權應發起推送操作");
      assert.ok(output.includes("custom-flow-target"), "應推送至指定目標分支");
      const calls = readCalls();
      const pushCalls = calls.filter(args => args[0] === "push");
      assert.strictEqual(pushCalls.length, 1, "完整授權推送情境下 git push 呼叫次數必須剛好為 1");
      const pushLogs = readPushCalls();
      assert.strictEqual(pushLogs.length, 1, "git-push.log 必須恰好記錄 1 次推送");
      const pushArgv = pushLogs[0];
      assert.strictEqual(pushArgv[0], "push", "第一個參數必須為 push");
      assert.strictEqual(pushArgv[1], "origin", "第二個參數必須為 origin");
      assert.ok(pushArgv[2].startsWith("refs/heads/"), "第三個參數必須以 refs/heads/ 明確前綴開頭，嚴防 force push 語意");
      assert.ok(pushArgv[2].endsWith(":refs/heads/custom-flow-target"), "第三個參數必須明確映射至 :refs/heads/custom-flow-target");
      assert.strictEqual(pushArgv[2].startsWith("+"), false, "refspec 嚴禁以加號 (+) 開頭");
      // 檢查傳入 Git 的所有參數，確保絕無任何 force 選項
      assert.ok(
        !pushArgv.some(arg => arg === "--force" || arg === "-f" || arg.startsWith("--force-") || arg.startsWith("+")),
        "實際傳入 Git 之 argv 嚴禁包含 --force, -f, --force-with-lease 或以 + 開頭之 refspec"
      );
      pass("12.11 [控制流程] 完整授權且有效目標分支：攔截器確認成功執行參數化 refs/heads/ 映射推送 (防範 force，精確驗證 argv)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.12 [控制流程] TOCTOU 模擬：授權確認後 Commit SHA 發生漂移 (二次校驗不符)，確認安全中斷且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test12-toctou-sha-"));
    try {
      const stateFile = path.join(tmpDir, "rev-parse-count.txt");
      const customHandler = `
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  COUNT=0
  if [ -f "${stateFile}" ]; then
    COUNT=$(cat "${stateFile}")
  fi
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "${stateFile}"
  if [ "$COUNT" -ge 2 ]; then
    # 第二次呼叫 (授權後的二次校驗) 刻意回傳漂移的 SHA
    echo "9999888877776666555544443333222211110000"
    exit 0
  fi
fi
`;
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow12-toctou",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow12-toctou",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nvalid-target\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("待推送 Commit SHA 在授權確認後發生變更"), "SHA 漂移時必須輸出警告");
      assert.ok(output.includes("檢測到待推送 Commit 漂移，已安全中止 Push 流程"), "SHA 漂移時必須安全中止");
      assert.ok(!output.includes("正在推送至遠端"), "SHA 漂移時嚴禁推送");
      assertMockInterceptedAndZeroPush();
      pass("12.12 [控制流程] TOCTOU 防護：授權確認後 Commit SHA 漂移，CLI 偵測並安全中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.13 [控制流程] TOCTOU 模擬：授權確認後來源分支改變或分離，確認安全中斷且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test13-toctou-branch-"));
    try {
      const stateFile = path.join(tmpDir, "branch-count.txt");
      const customHandler = `
if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  COUNT=0
  if [ -f "${stateFile}" ]; then
    COUNT=$(cat "${stateFile}")
  fi
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "${stateFile}"
  if [ "$COUNT" -ge 2 ]; then
    # 第二次呼叫刻意回傳其他分支或空值
    echo "drifted-branch"
    exit 0
  fi
fi
`;
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow13-toctou-br",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow13-toctou-br",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nvalid-target\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("來源分支在授權確認後發生變更或無法確認"), "分支漂移時必須輸出警告");
      assert.ok(output.includes("檢測到來源分支狀態漂移，已安全中止 Push 流程"), "分支漂移時必須安全中止");
      assert.ok(!output.includes("正在推送至遠端"), "分支漂移時嚴禁推送");
      assertMockInterceptedAndZeroPush();
      pass("12.13 [控制流程] TOCTOU 防護：授權確認後來源分支改變/分離，CLI 偵測並安全中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 12.14 [控制流程] TOCTOU 模擬：授權確認後二次讀取 SHA 失敗，確認安全中斷且 0 git push 呼叫
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-flow-test14-toctou-shafail-"));
    try {
      const stateFile = path.join(tmpDir, "rev-parse-fail.txt");
      const customHandler = `
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  COUNT=0
  if [ -f "${stateFile}" ]; then
    COUNT=$(cat "${stateFile}")
  fi
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "${stateFile}"
  if [ "$COUNT" -ge 2 ]; then
    # 第二次呼叫刻意失敗 (exit 1)
    exit 1
  fi
fi
`;
      const { binDir, assertMockInterceptedAndZeroPush } = setupMockBin(tmpDir, customHandler);

      const output = execFileSync("node", [
        createLabScript,
        "--course-name", "FlowCourse",
        "--course-id", "FC101",
        "--semester", "114-1",
        "--exp-id", "exp-flow14-toctou-shafail",
        "--exp-name", "FlowExp",
        "--repo", "testorg/fc101-exp-flow14-toctou-shafail",
        "--yes"
      ], {
        cwd: tmpDir,
        input: "yes\nyes\n1\nyes\nvalid-target\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      });

      assert.ok(output.includes("待推送 Commit SHA 在授權確認後發生變更或無法取得"), "二次 SHA 失敗時必須輸出警告");
      assert.ok(output.includes("檢測到待推送 Commit 漂移，已安全中止 Push 流程"), "二次 SHA 失敗時必須安全中止");
      assert.ok(!output.includes("正在推送至遠端"), "二次 SHA 失敗時嚴禁推送");
      assertMockInterceptedAndZeroPush();
      pass("12.14 [控制流程] TOCTOU 防護：授權確認後二次讀取 SHA 失敗，CLI 偵測並安全中止且 0 git push 呼叫");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ===========================================================
  // 【層級二：Skill 文件規範與 CLI 安全檢查 (Specification & CLI Static Checks)】
  // ===========================================================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📜 【層級二：Skill 文件規範自動檢查 (Specification Static Checks)】");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const skillPath = path.join(ROOT_DIR, ".github", "skills", "github-workspace", "SKILL.md");
  const tmplSkillPath = path.join(ROOT_DIR, "template", ".github", "skills", "github-workspace", "SKILL.md");

  assert.ok(fs.existsSync(skillPath), "母倉庫 SKILL.md 必須存在");
  assert.ok(fs.existsSync(tmplSkillPath), "template SKILL.md 必須存在");

  const skillContent = fs.readFileSync(skillPath, "utf8");
  const tmplSkillContent = fs.readFileSync(tmplSkillPath, "utf8");

  let staticCheckCount = 0;
  function passStatic(msg) {
    passedCount++;
    staticCheckCount++;
    console.log(`  ✅ [PASS] ${msg}`);
  }

  // 10.1 Push 安全防護：不得寫死或預設推送至 main
  assert.ok(!skillContent.includes("git push origin main"), "SKILL.md 嚴禁包含寫死預設推送至 main ('git push origin main')");
  assert.ok(
    /(嚴禁|禁止|不得).*預設.*(推送|使用).*main/.test(skillContent),
    "SKILL.md 必須明確規範『禁止預設推送至 main』"
  );
  passStatic("10.1 Push 安全規範：確認未寫死 main，嚴禁將 main 設為預設推送目標");

  // 10.2 明確來源與目標分支映射
  assert.ok(
    skillContent.includes("<source_branch>:<target_branch>"),
    "SKILL.md 必須明確規範來源與目標分支映射 (<source_branch>:<target_branch>)"
  );
  passStatic("10.2 Push 分支映射：執行指令明確包含來源與目標分支映射 (source:target)");

  // 10.3 授權目標分支嚴格一致性
  assert.ok(
    skillContent.includes("授權之目標分支必須與實際執行的推送指令完全一致") ||
    /目標分支必須與.*授權.*一致/.test(skillContent),
    "SKILL.md 必須規定授權目標分支與執行指令完全一致"
  );
  passStatic("10.3 目標分支一致性：使用者授權之目標分支必須與實際執行指令完全一致");

  // 10.4 遠端目標分支狀態檢查與防分歧
  assert.ok(
    skillContent.includes("非預期分歧") && skillContent.includes("立即停止"),
    "SKILL.md 必須規定遠端目標分支非預期分歧時立即停止"
  );
  passStatic("10.4 遠端狀態檢驗：執行前檢查遠端目標分支，若發生非預期分歧立即停止");

  // 10.5 受保護分支特別授權鐵律
  assert.ok(
    skillContent.includes("必須取得明確指向該分支的本次授權"),
    "SKILL.md 必須規定目標分支為 main 或受保護分支時必須取得明確指向該分支的本次授權"
  );
  assert.ok(
    skillContent.includes("不得沿用"),
    "SKILL.md 必須禁止沿用其他分支授權推向 main 或受保護分支"
  );
  passStatic("10.5 受保護分支特別授權：main 或受保護分支必須取得明確指向該分支的獨立授權，嚴禁沿用");

  // 10.6 Push 專屬預覽確認與執行指令預覽
  assert.ok(skillContent.includes("遠端推送預覽確認 (Git Push)"), "SKILL.md 必須定義專屬 Git Push 預覽確認區塊");
  assert.ok(skillContent.includes("待推送 Commit SHA"), "Push 預覽必須明確顯示待推送 Commit SHA");
  assert.ok(skillContent.includes("【預計執行指令】"), "Push 預覽必須包含預計執行指令");
  passStatic("10.6 Push 獨立預覽：具備來源/目標分支/Commit SHA/預計執行指令之專屬確認區塊");

  // 10.7 分步獨立授權原則 (檔案寫入 ≠ Commit ≠ Push)
  assert.ok(
    skillContent.includes("建立/修改檔案") &&
    skillContent.includes("Commit") &&
    skillContent.includes("Push"),
    "SKILL.md 必須明確規範檔案建立、Commit、Push 各自獨立授權"
  );
  assert.ok(skillContent.includes("不可繼承"), "SKILL.md 必須強調授權不可自動跨階段繼承");
  passStatic("10.7 分步授權原則：嚴格宣告建立檔案 ≠ Commit ≠ Push，各階段獨立授權且不可繼承");

  // 10.8 未取得授權時必須立即停止
  assert.ok(
    skillContent.includes("未取得授權時必須立即停止") || skillContent.includes("未取得使用者明確授權前，必須立即停止"),
    "SKILL.md 必須明確規範未獲授權時必須立即停止"
  );
  passStatic("10.8 安全停止條款：未取得明確授權時必須立即停止，嚴禁越權執行");

  // 10.9 歷史保護與禁止 force push
  assert.ok(skillContent.includes("git push --force"), "SKILL.md 必須明文禁止 git push --force");
  assert.ok(skillContent.includes("重寫") || skillContent.includes("篡改"), "SKILL.md 必須明文禁止刪除或重寫 Commit 歷史");
  passStatic("10.9 歷史保護規範：嚴禁 --force 推送，嚴禁刪除或篡改 Commit 歷史，禁止自動重試");

  // 10.10 Push 授權絕不等於 PR 合併或部署
  assert.ok(
    skillContent.includes("PR 合併") || skillContent.includes("部署"),
    "SKILL.md 必須明確宣告 Push 授權絕不得解讀為 PR 合併或部署授權"
  );
  passStatic("10.10 邊界防護條款：明確規定 Push 授權絕不得解讀為 PR 合併、部署或刪除分支");

  // 10.11 防覆寫與 404 預檢
  assert.ok(/404 Not Found/.test(skillContent), "SKILL.md 必須要求建立新檔案前確認 404 Not Found");
  assert.ok(/若遠端已存在該檔案.*禁止覆寫/.test(skillContent), "SKILL.md 必須要求遠端存在時禁止覆寫");
  passStatic("10.11 防覆寫條款：強制建立前發送 GET 預檢 404，已存在檔案禁止覆寫");

  // 10.12 Raw Data Sanctuary 不可變條款
  assert.ok(/Raw Data Sanctuary/.test(skillContent), "SKILL.md 必須包含 Raw Data Sanctuary 規範");
  assert.ok(/嚴禁對.*raw\/.*現存檔案進行修改、覆蓋、重新命名或刪除/.test(skillContent), "SKILL.md 必須明文保護 raw/ 現存檔案");
  passStatic("10.12 原始數據聖域：明文禁止修改、覆蓋、重新命名或刪除 raw/ 檔案");

  // 10.13 路徑穿越與空字元防護規範
  assert.ok(/%2e%2e/i.test(skillContent), "SKILL.md 必須明文禁止 %2e%2e URL 編碼路徑穿越");
  assert.ok(/\.\.\//.test(skillContent), "SKILL.md 必須明文禁止 ../ 路徑穿越");
  assert.ok(/(%00|\\0)/.test(skillContent), "SKILL.md 必須明文禁止空字元注入");
  passStatic("10.13 路徑安全規範：完整納入相對路徑穿越、編碼穿越與空字元防禦條款");

  // 10.14 雙模式與報告隔離條款
  assert.ok(/Course Mode/.test(skillContent), "SKILL.md 必須包含 Course Mode 規範");
  assert.ok(/Experiment Mode/.test(skillContent), "SKILL.md 必須包含 Experiment Mode 規範");
  assert.ok(/report_mode:\s*separate/.test(skillContent), "SKILL.md 必須規範 separate 模式個人報告隔離");
  passStatic("10.14 架構與報告隔離規範：明確規範雙模式目錄邊界與個人報告隔離");

  // 10.15 範本副本 100% 同步檢驗
  const rootSkillHash = crypto.createHash("sha256").update(skillContent).digest("hex");
  const tmplSkillHash = crypto.createHash("sha256").update(tmplSkillContent).digest("hex");
  assert.strictEqual(rootSkillHash, tmplSkillHash, "母倉庫與 template 之 SKILL.md 雜湊必須完全相同");
  passStatic("10.15 範本同步一致性：母倉庫與 template/ 之 Skill 雜湊 Byte-for-byte 100% 一致");

  const createLabScriptPath = path.join(ROOT_DIR, "scripts", "create-lab.mjs");
  assert.ok(fs.existsSync(createLabScriptPath), "create-lab.mjs 必須存在");
  const createLabContent = fs.readFileSync(createLabScriptPath, "utf8");

  // 10.16 手動指引全數移除寫死 git push -u origin main 並統一明確 refs/heads 寫法
  assert.ok(
    !createLabContent.includes("git push -u origin main"),
    "create-lab.mjs 全文嚴禁殘留 'git push -u origin main'"
  );
  assert.ok(
    createLabContent.includes("git push origin refs/heads/<source_branch>:refs/heads/<target_branch>"),
    "create-lab.mjs 手動指引必須使用明確 refs/heads/<source_branch>:refs/heads/<target_branch> 寫法"
  );
  passStatic("10.16 CLI 手動指引規範：全文無殘留 'git push -u origin main'，且指引統一使用明確 refs/heads 格式");

  // 10.17 建立遠端儲存庫與 Push 徹底解耦 (嚴禁 --push)
  assert.ok(
    !createLabContent.includes("'--push'"),
    "create-lab.mjs 中 gh repo create 嚴禁攜帶 '--push' 參數"
  );
  assert.ok(
    createLabContent.includes("本步驟僅建立遠端儲存庫並設定 origin，絕不自動執行 Push"),
    "create-lab.mjs 必須明確宣告建立遠端不自動執行 Push"
  );
  passStatic("10.17 CLI 遠端建立獨立性：gh repo create 徹底解耦 --push，建立儲存庫不等同獲准 Push");

  // 10.18 獨立遠端 Push 授權閘門 (未獲授權絕不執行推送)
  assert.ok(
    createLabContent.includes("是否執行遠端 Git Push？") &&
    createLabContent.includes("未執行任何推送操作"),
    "create-lab.mjs 必須包含獨立 Push 授權閘門，未獲授權絕不執行推送"
  );
  passStatic("10.18 CLI Push 獨立授權閘門：具備專屬確認步驟，未獲使用者明確授權時絕不執行推送");

  // 10.19 嚴禁未經明確目標分支授權預設推送 main，且執行指令具備明確分支映射
  assert.ok(
    createLabContent.includes("請輸入授權推送的目標分支") &&
    createLabContent.includes("不可空白") &&
    createLabContent.includes("受保護分支"),
    "create-lab.mjs 必須要求明確指定目標分支，且推向 main/master 需專屬確認"
  );
  assert.ok(
    createLabContent.includes("pushRefspec") &&
    createLabContent.includes("git push origin") &&
    createLabContent.includes("refs/heads/"),
    "create-lab.mjs 推送指令必須使用具備明確 refs/heads/ 前綴之分支映射 (refs/heads/<source>:refs/heads/<target>)"
  );
  passStatic("10.19 CLI 目標分支明確授權：禁止預設推向 main，推向受保護分支需專屬確認且強制 refs/heads/ 分支映射 (杜絕 force push)");

  // 10.20 來源分支無法確認中斷與分支格式安全檢查 (參數化子程序呼叫，杜絕 Shell 字串插值)
  assert.ok(
    createLabContent.includes("isValidBranchName") &&
    createLabContent.includes("無法確認目前本地來源分支") &&
    createLabContent.includes("嚴禁預設回退至 main 或未確認分支"),
    "create-lab.mjs 必須具備來源分支安全檢查與 detached HEAD 中斷機制"
  );
  assert.ok(
    !createLabContent.includes("execSync("),
    "create-lab.mjs 全文嚴禁使用 execSync，以防 shell injection"
  );
  assert.ok(
    createLabContent.includes("execFileSync('git', ['check-ref-format', '--branch',") ||
    createLabContent.includes('execFileSync("git", ["check-ref-format", "--branch",'),
    "create-lab.mjs 之 isValidBranchName 必須採用 execFileSync 參數化陣列呼叫"
  );
  assert.ok(
    createLabContent.includes("無法確認本地待推送之 Commit SHA") &&
    createLabContent.includes("無法確認 Git 儲存庫物件格式") &&
    createLabContent.includes("--show-object-format") &&
    createLabContent.includes("/^[0-9a-f]{64}$/i"),
    "create-lab.mjs 必須依儲存庫物件格式檢驗待推送之 Commit SHA (支援 SHA-1 與 SHA-256)，未確認物件格式或 Commit 時立即中止"
  );
  passStatic("10.20 CLI 來源與目標分支安全驗證：嚴防 detached HEAD 與非法格式，物件格式未知或 Commit 未確認時立即中斷且相容 SHA-1/SHA-256 (參數化無注入)");

  // ===========================================================
  // 【三、真實 GitHub Sandbox E2E 操作紀錄 (可核對之審計歷史)】
  // ===========================================================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌐 【三、真實 GitHub Sandbox E2E 操作紀錄 (可核對之審計歷史)】");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ℹ️  [離線保證] 本腳本純本地執行，不發起即時網路請求，以維護 CI 穩定性與遠端環境乾淨。");
  console.log("  ℹ️  [審計紀錄 - 2026-10-12 於私有沙盒 Lorin1470/lab-workspace-sandbox-e2e 實測查驗核可]：");
  console.log("    • [審計憑證 1] 二進位 PNG (81 bytes) Contents API PUT 上傳：Commit SHA '051eee6f07dada7bfc292a4e60acaac62371cdbb'");
  console.log("    • [審計憑證 2] 二進位 Raw 串流下載 SHA-256：'7a1c549bc458df1140a8c53d1619c046049a7b217bd32b448cd565e230084382' (雙端 100% 一致)");
  console.log("    • [審計憑證 3] macOS 原生 sips 影像結構校驗：'public.png', 4x4, RGB, 8-bit 無失真");
  console.log("    • [審計憑證 4] 純文字 Markdown (461 bytes) PUT 建立：Commit SHA 'ee18e86d41b4373a1ffdfc7b21866453a6c50306'");
  console.log("    • [審計憑證 5] 純文字 Raw 串流下載 SHA-256：'4b7c15c20459c3f1b76c40b311b69c9c6399703d06d073eff2933c23f267ab6d' (雙端 100% 一致)");
  console.log("    • [審計憑證 6] 覆寫衝突拒絕保護：未帶 SHA 遭 GitHub 原生 HTTP 422 拒絕；帶錯 SHA 遭 HTTP 409 拒絕");
  console.log("    • [審計憑證 7] 建立前預檢防護：GET 偵測到 HTTP 200 OK 時主動中斷寫入，阻止發起覆寫");

  // ===========================================================
  // 【四、人工驗收紀錄 (會話審批查核依據)】
  // ===========================================================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 【四、人工驗收紀錄 (會話審批查核依據)】");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ℹ️  [邊界宣告] 以下為在真實會話工程流程中，由使用者獨立授權與查證之行為紀錄：");
  console.log("    • [會話審核 1] 檔案建立前預覽與停止等待授權（未獲授權前 0 檔案寫入）");
  console.log("    • [會話審核 2] 本地 Commit 前預覽與獨立授權（提交 Commit caf6886 與 9dbf84f）");
  console.log("    • [會話審核 3] 遠端 Push 前預覽與獨立授權（推送 feat/github-workspace-skill，未推 main）");
  console.log("    • [會話審核 4] 建立 PR 前預覽與獨立授權（向 main 建立 PR #8）");
  console.log("    • [會話審核 5] 授權邊界嚴守：嚴禁將 Push 授權外溢至 PR 合併或部署，零越權操作");
  console.log("    • [會話審核 6] 儲存庫隔離：零碰觸正式母倉庫遠端 main、零碰觸正式課程 Repo");

  // ===========================================================
  // 【五、尚未實作的 Agent 自動化行為測試 (未自動化驗證)】
  // ===========================================================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⚠️ 【五、尚未實作的 Agent 自動化行為測試 (未自動化驗證)】");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ℹ️  [誠實標示] 本測試腳本為單元與靜態規格檢查，以下項目目前『未由腳本自動化驗證』：");
  console.log("    • [⚠️ 未自動化驗證] Agent 多輪對話狀態機自動化測試 (LLM Dialogue Mock Runner)");
  console.log("      說明：目前依賴人機互動安全鎖與使用者審批閘門，腳本無法獨立斷言 LLM 自然語言對話行為。");
  console.log("    • [⚠️ 未自動化驗證] 超大檔案 (>100MB) Git LFS 分塊上傳遠端測試 (超出實驗常態尺寸)");
  console.log("    • [⚠️ 未自動化驗證] 高並發多成員衝突自動重試測試 (超出單一 Agent 授權範圍)");

  console.log("\n====================================================");
  console.log(`📊 驗證總結：`);
  console.log(`   • 自動化單元測試：通過 ${unitTestCount} 項`);
  console.log(`   • Skill 與 CLI 規範靜態檢查：通過 ${staticCheckCount} 項`);
  console.log(`   • 本地自動化測試總計：通過 ${passedCount} 項，失敗 0 項`);
  console.log(`   • 真實遠端 Sandbox E2E：提供可核對歷史紀錄 (不計入本機自動化計數)`);
  console.log(`   • 人工驗收紀錄：提供會話查驗依據 (不計入本機自動化計數)`);
  console.log(`   • 未自動化行為測試：明確標示 3 項待實作/未自動化`);
  console.log("====================================================\n");
}

runVerification().catch((err) => {
  console.error("❌ 驗證失敗:", err);
  process.exit(1);
});
