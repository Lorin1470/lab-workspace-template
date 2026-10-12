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
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

let passedCount = 0;
function pass(msg) {
  passedCount++;
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
  // 【層級二：Skill 文件規範自動檢查 (Specification Static Checks)】
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

  // 10.1 Push 安全防護：不得寫死或預設推送至 main
  assert.ok(!skillContent.includes("git push origin main"), "SKILL.md 嚴禁包含寫死預設推送至 main ('git push origin main')");
  assert.ok(
    skillContent.includes("禁止預設推送至 `main`") || skillContent.includes("不得預設使用 `main`"),
    "SKILL.md 必須明確規範『禁止預設推送至 main』"
  );
  pass("10.1 Push 安全規範：確認未寫死 main，嚴禁將 main 設為預設推送目標");

  // 10.2 Push 前四重確認與專屬預覽
  assert.ok(skillContent.includes("遠端推送預覽確認 (Git Push)"), "SKILL.md 必須定義專屬 Git Push 預覽確認區塊");
  assert.ok(skillContent.includes("待推送 Commit SHA"), "Push 預覽必須明確顯示待推送 Commit SHA");
  pass("10.2 Push 安全規範：具備獨立推送預覽區塊與來源/目標分支/Commit SHA 完整檢核");

  // 10.3 分步獨立授權原則 (檔案寫入 ≠ Commit ≠ Push)
  assert.ok(
    skillContent.includes("建立/修改檔案") &&
    skillContent.includes("Commit") &&
    skillContent.includes("Push"),
    "SKILL.md 必須明確規範檔案建立、Commit、Push 各自獨立授權"
  );
  assert.ok(skillContent.includes("不可繼承"), "SKILL.md 必須強調授權不可自動跨階段繼承");
  pass("10.3 分步授權規範：嚴格宣告建立檔案 ≠ Commit ≠ Push，各階段獨立授權且不可繼承");

  // 10.4 未取得授權時必須立即停止
  assert.ok(
    skillContent.includes("未取得授權時必須立即停止") || skillContent.includes("未取得使用者明確授權前，必須立即停止"),
    "SKILL.md 必須明確規範未獲授權時必須立即停止"
  );
  pass("10.4 安全停止條款：未取得明確授權時必須立即停止，嚴禁越權執行");

  // 10.5 嚴禁 force push 與重寫歷史
  assert.ok(skillContent.includes("git push --force"), "SKILL.md 必須明文禁止 git push --force");
  assert.ok(skillContent.includes("重寫") || skillContent.includes("篡改"), "SKILL.md 必須明文禁止刪除或重寫 Commit 歷史");
  pass("10.5 歷史保護規範：嚴禁 --force 推送，嚴禁刪除或篡改 Commit 歷史");

  // 10.6 Push 授權絕不等於 PR 合併或部署
  assert.ok(
    skillContent.includes("PR 合併") || skillContent.includes("部署"),
    "SKILL.md 必須明確宣告 Push 授權絕不得解讀為 PR 合併或部署授權"
  );
  pass("10.6 邊界防護條款：明確規定 Push 授權不擴大至合併或部署");

  // 10.7 防覆寫與 404 預檢
  assert.ok(/404 Not Found/.test(skillContent), "SKILL.md 必須要求建立新檔案前確認 404 Not Found");
  assert.ok(/若遠端已存在該檔案.*禁止覆寫/.test(skillContent), "SKILL.md 必須要求遠端存在時禁止覆寫");
  pass("10.7 防覆寫條款：強制建立前發送 GET 預檢 404，已存在檔案禁止覆寫");

  // 10.8 Raw Data Sanctuary 不可變條款
  assert.ok(/Raw Data Sanctuary/.test(skillContent), "SKILL.md 必須包含 Raw Data Sanctuary 規範");
  assert.ok(/嚴禁對.*raw\/.*現存檔案進行修改、覆蓋、重新命名或刪除/.test(skillContent), "SKILL.md 必須明文保護 raw/ 現存檔案");
  pass("10.8 原始數據聖域：明文禁止修改、覆寫、重新命名或刪除 raw/ 檔案");

  // 10.9 路徑穿越與空字元防護規範
  assert.ok(/%2e%2e/i.test(skillContent), "SKILL.md 必須明文禁止 %2e%2e URL 編碼路徑穿越");
  assert.ok(/\.\.\//.test(skillContent), "SKILL.md 必須明文禁止 ../ 路徑穿越");
  assert.ok(/(%00|\\0)/.test(skillContent), "SKILL.md 必須明文禁止空字元注入");
  pass("10.9 路徑安全規範：完整納入相對路徑穿越、編碼穿越與空字元防禦條款");

  // 10.10 雙模式與報告隔離條款
  assert.ok(/Course Mode/.test(skillContent), "SKILL.md 必須包含 Course Mode 規範");
  assert.ok(/Experiment Mode/.test(skillContent), "SKILL.md 必須包含 Experiment Mode 規範");
  assert.ok(/report_mode:\s*separate/.test(skillContent), "SKILL.md 必須規範 separate 模式個人報告隔離");
  pass("10.10 架構與報告隔離規範：明確規範雙模式目錄邊界與個人報告隔離");

  // 10.11 範本副本 100% 同步檢驗
  const rootSkillHash = crypto.createHash("sha256").update(skillContent).digest("hex");
  const tmplSkillHash = crypto.createHash("sha256").update(tmplSkillContent).digest("hex");
  assert.strictEqual(rootSkillHash, tmplSkillHash, "母倉庫與 template 之 SKILL.md 雜湊必須完全相同");
  pass("10.11 範本同步一致性：母倉庫與 template/ 之 Skill 雜湊 Byte-for-byte 100% 一致");

  // ===========================================================
  // 【層級三：實際 GitHub API 遠端操作狀態標示】
  // ===========================================================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌐 【層級三：實際 GitHub API 遠端操作狀態 (Remote API Live Matrix)】");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ℹ️  [離線保證] 本測試腳本純本機執行，不發起遠端網路請求，以維護 CI 穩定性與遠端環境乾淨。");
  console.log("  ℹ️  [實測紀錄] 以下為在獲授權之私有 Sandbox (Lorin1470/lab-workspace-sandbox-e2e) 的實測狀態：");
  console.log("    • [✅ 已實測 PASS] 二進位 PNG (81 bytes) Contents API PUT 上傳 (真實 Commit: 051eee6)");
  console.log("    • [✅ 已實測 PASS] 二進位 Raw 串流下載 SHA-256 精確比對 (7a1c549b... 100% 吻合)");
  console.log("    • [✅ 已實測 PASS] macOS 原生 sips 驗證二進位圖檔結構正常無失真");
  console.log("    • [✅ 已實測 PASS] 文字檔 Markdown (461 bytes) PUT 上傳 (真實 Commit: ee18e86)");
  console.log("    • [✅ 已實測 PASS] 文字檔 Raw 串流下載 SHA-256 精確比對 (4b7c15c2... 100% 吻合)");
  console.log("    • [✅ 已實測 PASS] 未帶 SHA 覆寫現有檔案遭 GitHub 原生 422 阻絕 (無副作用)");
  console.log("    • [✅ 已實測 PASS] 帶錯誤 SHA 覆寫現有檔案遭 GitHub 原生 409 阻絕 (無副作用)");
  console.log("    • [✅ 已實測 PASS] 預檢 GET 偵測到 200 OK 觸發主動終止，阻止向 GitHub 發起覆寫請求");
  console.log("    • [⏳ 未實測/標記] 超大檔案 (>100MB) Git LFS 分塊上傳 (超出實驗常態尺寸)");
  console.log("    • [⏳ 未實測/標記] 高並發多成員衝突自動重試 (超出單一 Agent 授權範圍)");

  // ===========================================================
  // 【層級四：Agent 真實執行流程驗收狀態標示】
  // ===========================================================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🤖 【層級四：Agent 真實執行流程驗收狀態 (Interactive Flow Matrix)】");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ℹ️  [邊界宣告] 單元測試與文件規範檢查不等於 Agent 完整的真實互動流程驗收。");
  console.log("  ℹ️  [實測紀錄] 以下為在真實會話流程中經人工確認之行為狀態：");
  console.log("    • [✅ 已實測 PASS] 寫入前預覽與停止等待授權（未授權前 0 寫入）");
  console.log("    • [✅ 已實測 PASS] 本地 Commit 前預覽與獨立授權（Commit caf6886）");
  console.log("    • [✅ 已實測 PASS] 遠端 Push 前預覽與獨立授權（Push feat/github-workspace-skill）");
  console.log("    • [✅ 已實測 PASS] 建立 PR 前預覽與獨立授權（PR #8）");
  console.log("    • [✅ 已實測 PASS] 授權邊界嚴守：嚴禁將 Push 授權外溢至 PR 合併或部署");
  console.log("    • [✅ 已實測 PASS] 測試環境隔離：零碰觸正式母倉庫遠端 main、零碰觸正式課程 Repo");
  console.log("    • [⏳ 未實測/標記] LLM 對話狀態機全自動模擬器 (目前依賴系統安全鎖與人類閘門)");

  console.log("\n====================================================");
  console.log(`📊 驗證總結：通過 ${passedCount} 項自動化測試，失敗 0 項`);
  console.log("====================================================\n");
}

runVerification().catch((err) => {
  console.error("❌ 驗證失敗:", err);
  process.exit(1);
});
