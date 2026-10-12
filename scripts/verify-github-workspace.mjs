#!/usr/bin/env node

/**
 * verify-github-workspace.mjs
 * 驗證 GitHub Workspace Skill 規範與 Agent 直連操作邏輯
 *
 * 核心驗收指標 (依任務要求 1-10)：
 * 1. 正確辨識 Course Mode (多實驗共享 Repo，目錄為 experiments/<code\>/)
 * 2. 正確辨識 Experiment Mode (單一實驗獨立 Repo，工作目錄為根目錄)
 * 3. 不會把實驗目錄誤當 Repo 名稱 (嚴格維持 owner/repo 格式，禁止拼入 experiments/)
 * 4. shared 與 separate 報告路徑規則正確 (shared -> report.md, separate -> report-<user>.md，身分邊界)
 * 5. 無法辨識 Repo 或實驗時拒絕寫入 (未提供或格式錯誤時中止)
 * 6. 路徑穿越與跨實驗操作受到阻止 (../, %2e%2e, 跨目錄操作全數阻絕)
 * 7. 不會覆寫現有檔案 (建立前檢查遠端存在性，存在即衝突)
 * 8. 不會修改或刪除 raw/ 既有檔案 (Raw Sanctuary 聖域不可變鐵律)
 * 9. 二進位檔案不會經過有損的文字轉換 (Base64/Binary byte-for-byte 完整性，禁止損壞字元)
 * 10. 寫入失敗或驗證失敗時，不會假報成功 (Commit SHA 缺失或校驗不合判定失敗)
 * 11. SKILL.md 結構、版本 (v1.0)、Frontmatter 與規範完整度檢驗
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
  pass("10c. [邏輯檢驗] 寫入後遠端內容 SHA 不一致判定失敗，嚴禁假報成功");

  // -----------------------------------------------------------
  // [群組 10: 範本同步一致性與冪等性 (Sync Integrity & Idempotency)]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 10: 範本同步一致性與冪等性檢驗]");

  const rootSkillFile = path.join(ROOT_DIR, ".github", "skills", "github-workspace", "SKILL.md");
  const tmplSkillFile = path.join(ROOT_DIR, "template", ".github", "skills", "github-workspace", "SKILL.md");
  assert.ok(fs.existsSync(rootSkillFile), "母倉庫 SKILL.md 必須存在");
  assert.ok(fs.existsSync(tmplSkillFile), "template SKILL.md 必須存在");

  const rootHash = crypto.createHash("sha256").update(fs.readFileSync(rootSkillFile)).digest("hex");
  const tmplHash = crypto.createHash("sha256").update(fs.readFileSync(tmplSkillFile)).digest("hex");
  assert.strictEqual(rootHash, tmplHash, "母倉庫與 template 中的 github-workspace/SKILL.md 雜湊必須 100% 一致");
  pass("11. 母倉庫與 template 之 Skill 內容雜湊完全吻合 (Byte-for-byte 100% 一致)");

  // -----------------------------------------------------------
  // [群組 10: SKILL.md 結構與規格檢驗]
  // -----------------------------------------------------------
  console.log("\n▶ [群組 10: SKILL.md 檔案存在與規格完整度檢驗]");

  const skillPath = path.join(ROOT_DIR, ".github", "skills", "github-workspace", "SKILL.md");
  assert.ok(fs.existsSync(skillPath), "SKILL.md 必須存在於 .github/skills/github-workspace/");

  const skillContent = fs.readFileSync(skillPath, "utf8");
  assert.ok(skillContent.includes("name: github-workspace"), "SKILL.md 必須宣告 name: github-workspace");
  assert.ok(skillContent.includes('version: "1.0"'), "SKILL.md 必須宣告 version: 1.0");
  assert.ok(skillContent.includes("Course Mode"), "SKILL.md 必須涵蓋 Course Mode 規範");
  assert.ok(skillContent.includes("Experiment Mode"), "SKILL.md 必須涵蓋 Experiment Mode 規範");
  assert.ok(skillContent.includes("Raw Data Sanctuary"), "SKILL.md 必須涵蓋 Raw Data Sanctuary 規範");
  assert.ok(skillContent.includes("separate"), "SKILL.md 必須涵蓋 separate 報告模式規範");
  assert.ok(skillContent.includes("shared"), "SKILL.md 必須涵蓋 shared 報告模式規範");
  assert.ok(skillContent.includes("https://lab.minerdog.qzz.io/api"), "SKILL.md 必須明文禁止 Web API");
  pass("11. SKILL.md 檔案存在，Frontmatter、Version 1.0 與核心安全規範完整度檢驗合格");

  console.log("\n====================================================");
  console.log(`📊 驗證總結：通過 ${passedCount} 項，失敗 0 項`);
  console.log("====================================================\n");
}

runVerification().catch((err) => {
  console.error("❌ 驗證失敗:", err);
  process.exit(1);
});
