#!/usr/bin/env node

/**
 * create-lab.mjs
 * 實驗課 GitHub 工作區快速建立工具 (CLI)
 * 
 * 嚴格安全確認規範：
 * 1. 本地檔案產生需確認 (--yes 僅適用此非破壞性步驟)
 * 2. 初始 Commit 必須明確獨立確認 (預設 No，--yes 不得繞過)
 * 3. 遠端 GitHub Repo 建立必須明確獨立確認 (預設 No，--yes 不得繞過；僅建立遠端不包含 Push)
 * 4. 遠端 Push 必須具備獨立授權閘門 (預設 No，--yes 不得繞過；嚴禁預設推向 main；強制明確分支映射)
 * 5. 若未確認 Commit，絕不執行 Commit、絕不建立遠端、絕不 Push
 * 6. 若確認 Commit 但未確認建立遠端，僅完成本地 Commit，不建立遠端、不 Push
 * 7. 若建立遠端但未確認 Push，僅建立遠端與設定 remote，不執行任何推送
 * 8. 嚴格驗證 Repository 名稱防範路徑穿越與非法字元
 * 9. 所有外部指令採用 execFileSync / argv 傳參，杜絕 shell injection
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'template');

// 先執行 Skill 同步 (使用 execFileSync 防範 shell injection)
try {
  execFileSync('node', ['scripts/sync-skill.mjs'], { cwd: ROOT_DIR, stdio: ['ignore', 'ignore', 'ignore'] });
} catch {
  // 忽略
}

// 建立穩定支援互動鍵盤與 piped 輸入的 Prompt 機制
function createPrompter() {
  const lines = [];
  let pendingResolve = null;
  let isClosed = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  rl.on('line', (line) => {
    if (pendingResolve) {
      const res = pendingResolve;
      pendingResolve = null;
      res(line);
    } else {
      lines.push(line);
    }
  });

  rl.on('close', () => {
    isClosed = true;
    if (pendingResolve) {
      const res = pendingResolve;
      pendingResolve = null;
      res('');
    }
  });

  return {
    async ask(query) {
      process.stdout.write(query);
      if (lines.length > 0) {
        const line = lines.shift();
        if (!process.stdin.isTTY) {
          process.stdout.write(line + '\n');
        }
        return line;
      }
      if (isClosed) return '';
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },
    close() {
      rl.close();
    }
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

// 驗證 Repository 名稱合法性並防範路徑穿越
function validateRepoName(repoString) {
  if (!repoString || typeof repoString !== 'string') {
    throw new Error('Repository 名稱不得為空。');
  }
  const trimmed = repoString.trim();
  const parts = trimmed.split('/');
  if (parts.length > 2) {
    throw new Error(`Repository 格式不合法，僅允許 "repo-name" 或 "owner/repo-name" 格式: "${trimmed}"`);
  }
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`Repository 名稱包含非法路徑標識 ("${part}"): "${trimmed}"`);
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(part)) {
      throw new Error(`Repository 名稱包含非法字元，僅允許英數字、底線、破折號與點: "${part}"`);
    }
  }

  const folderName = parts[parts.length - 1];
  const targetPath = path.resolve(process.cwd(), folderName);
  const relative = path.relative(process.cwd(), targetPath);

  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
    throw new Error(`目標資料夾路徑不合法或試圖進行路徑穿越: "${folderName}"`);
  }

  return { fullRepoName: trimmed, folderName, targetPath };
}

// 驗證 Git 分支名稱合法性 (嚴防空值、注入、非合法字元、Force 語意與非法 refspec)
export function isValidBranchName(branch, cwd = process.cwd()) {
  if (!branch || typeof branch !== 'string') return false;
  const trimmed = branch.trim();
  if (!trimmed || trimmed !== branch) return false;
  if (
    trimmed === 'HEAD' ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.') ||
    trimmed.endsWith('.lock') ||
    trimmed.includes('..') ||
    trimmed.includes('//') ||
    trimmed.includes('@{') ||
    /[~^:?*\[\\ \t\r\n]/.test(trimmed) ||
    /[\x00-\x1f\x7f]/.test(trimmed)
  ) {
    return false;
  }
  try {
    execFileSync('git', ['check-ref-format', '--branch', trimmed], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const cliOpts = parseArgs();
  const prompter = createPrompter();

  console.log('\n======================================================');
  console.log('🧪 實驗課 GitHub 工作區系統 - 建立新實驗 Repo');
  console.log('======================================================\n');

  try {
    let courseName = cliOpts['course-name'];
    let courseId = cliOpts['course-id'];
    let semester = cliOpts['semester'];
    let experimentId = cliOpts['experiment-id'];
    let experimentName = cliOpts['experiment-name'];
    let reportMode = cliOpts['report-mode'];
    let membersInput = cliOpts['members'];
    let fullRepoName = cliOpts['repo'];
    const autoConfirmFilesOnly = cliOpts['yes'] || cliOpts['y'];

    const isInteractive = !courseName && !courseId && !experimentId;

    if (isInteractive) {
      courseName = (await prompter.ask('課程名稱 (例如: 電子學實驗): ')).trim() || '電子學實驗';
      courseId = (await prompter.ask('課程代碼 (例如: EE201): ')).trim() || 'EE201';
      semester = (await prompter.ask('學期代號 (例如: 114-1, 2026-Fall) [預設: 114-1]: ')).trim() || '114-1';
      experimentId = (await prompter.ask('實驗編號 (例如: lab-01): ')).trim() || 'lab-01';
      experimentName = (await prompter.ask('實驗名稱 (例如: 二極體特性): ')).trim() || '二極體特性';
      
      let modeInput = (await prompter.ask('報告模式 [shared (共同) / separate (個別)] (預設 shared): ')).trim().toLowerCase();
      reportMode = modeInput === 'separate' ? 'separate' : 'shared';

      membersInput = (await prompter.ask('成員 (以逗號分隔 GitHub 帳號，例如: userA, userB): ')).trim() || 'studentA';

      let defaultOwner = '';
      try {
        defaultOwner = execFileSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        defaultOwner = membersInput.split(',')[0].trim();
      }

      const defaultRepoName = `${courseId.toLowerCase()}-${experimentId}`;
      const fullRepoPrompt = defaultOwner ? `${defaultOwner}/${defaultRepoName}` : defaultRepoName;
      const repoInput = (await prompter.ask(`GitHub Repo (例如: ${fullRepoPrompt}): `)).trim();
      fullRepoName = repoInput || fullRepoPrompt;
    } else {
      courseName = courseName || '電子學實驗';
      courseId = courseId || 'EE201';
      semester = semester || '114-1';
      experimentId = experimentId || 'lab-01';
      experimentName = experimentName || '二極體特性';
      reportMode = reportMode === 'separate' ? 'separate' : 'shared';
      membersInput = membersInput || 'studentA';
      fullRepoName = fullRepoName || `${courseId.toLowerCase()}-${experimentId}`;
    }

    // 驗證 Repository 名稱合法性
    const { folderName, targetPath } = validateRepoName(fullRepoName);

    const memberUsernames = membersInput.split(',').map(u => u.trim()).filter(Boolean);
    const members = memberUsernames.map((user, idx) => ({
      github: user,
      name: user,
      role: idx === 0 ? '組長' : '組員'
    }));

    if (fs.existsSync(targetPath)) {
      console.error(`\n❌ 錯誤：目標資料夾已存在 (${targetPath})，請指定其他名稱或先清理既有目錄。`);
      prompter.close();
      process.exit(1);
    }

    // ----------------------------------------------------
    // 步驟 1：顯示預計建立清單與本地檔案產生確認
    // ----------------------------------------------------
    console.log('即將建立本地實驗工作區：\n');
    console.log(`目標路徑: ${targetPath}`);
    console.log(`關聯 Repo: ${fullRepoName}`);
    console.log('包含檔案與目錄：');
    console.log('  README.md');
    console.log('  config.yml');
    console.log('  raw/');
    console.log('  photos/');
    console.log('  processed/');
    console.log('  analysis/');
    console.log('  report/');
    console.log('  .github/skills/experiment-report/SKILL.md');
    console.log('  .github/skills/github-workspace/SKILL.md\n');
    console.log('Template Version:');
    console.log('  1.0\n');
    console.log(`詳細設定:`);
    console.log(`  - 課程: ${courseName} (${courseId}, ${semester})`);
    console.log(`  - 實驗: ${experimentId} - ${experimentName}`);
    console.log(`  - 模式: ${reportMode}`);
    console.log(`  - 成員: ${members.map(m => `@${m.github} (${m.role})`).join(', ')}`);
    console.log('======================================================\n');

    let allowGenerateFiles = false;
    if (autoConfirmFilesOnly) {
      console.log('是否建立本地檔案？ [Yes / No] (預設 No): Yes (--yes 自動確認本地檔案產生)');
      allowGenerateFiles = true;
    } else {
      const confirmFiles = (await prompter.ask('是否建立本地檔案？ [Yes / No] (預設 No): ')).trim().toLowerCase();
      allowGenerateFiles = confirmFiles === 'yes' || confirmFiles === 'y';
    }

    if (!allowGenerateFiles) {
      console.log('\n❌ 使用者未確認建立檔案，已中止操作。\n');
      prompter.close();
      return;
    }

    // 複製 Template 並配置檔案
    console.log('\n📦 正在產生實驗工作區檔案...');
    copyRecursiveSync(TEMPLATE_DIR, targetPath);

    // 填寫 config.yml
    const configContent = generateConfigYaml({
      courseName,
      courseId,
      semester,
      experimentId,
      experimentName,
      reportMode,
      members
    });
    fs.writeFileSync(path.join(targetPath, 'config.yml'), configContent, 'utf8');

    // 填寫 README.md
    const membersMarkdown = members.map(m => `- **${m.role}**：${m.name} ([@${m.github}](https://github.com/${m.github}))`).join('\n');
    let readmeContent = fs.readFileSync(path.join(targetPath, 'README.md'), 'utf8');
    readmeContent = readmeContent
      .replace(/\{\{COURSE_NAME\}\}/g, courseName)
      .replace(/\{\{COURSE_ID\}\}/g, courseId)
      .replace(/\{\{EXPERIMENT_ID\}\}/g, experimentId)
      .replace(/\{\{EXPERIMENT_NAME\}\}/g, experimentName)
      .replace(/\{\{REPORT_MODE\}\}/g, reportMode)
      .replace(/\{\{STATUS\}\}/g, '⬜ 尚未開始')
      .replace(/\{\{TEMPLATE_VERSION\}\}/g, '1.0')
      .replace(/\{\{SKILL_VERSION\}\}/g, '1.1')
      .replace(/\{\{MEMBERS_LIST\}\}/g, membersMarkdown);
    fs.writeFileSync(path.join(targetPath, 'README.md'), readmeContent, 'utf8');

    // 填寫 report.md
    let reportContent = fs.readFileSync(path.join(targetPath, 'report', 'report.md'), 'utf8');
    const membersText = members.map(m => `${m.name} (${m.github})`).join('、');
    const today = new Date().toISOString().slice(0, 10);
    reportContent = reportContent
      .replace(/\{\{COURSE_NAME\}\}/g, courseName)
      .replace(/\{\{EXPERIMENT_ID\}\}/g, experimentId)
      .replace(/\{\{EXPERIMENT_NAME\}\}/g, experimentName)
      .replace(/\{\{MEMBERS_TEXT\}\}/g, membersText)
      .replace(/\{\{DATE\}\}/g, today);
    fs.writeFileSync(path.join(targetPath, 'report', 'report.md'), reportContent, 'utf8');

    console.log('✅ 本地工作區檔案配置完成！');

    // 初始化 Git 並 Stage (使用 execFileSync 避免 shell injection 與 stdin 佔用)
    execFileSync('git', ['init'], { cwd: targetPath, stdio: ['ignore', 'ignore', 'ignore'] });
    execFileSync('git', ['add', '.'], { cwd: targetPath, stdio: ['ignore', 'ignore', 'ignore'] });

    // ----------------------------------------------------
    // 步驟 2：強制 Commit 確認 (不得被 --yes 繞過)
    // ----------------------------------------------------
    const initialCommitMsg = `[${experimentId}] 初始化實驗工作區 (Template v1.0)`;
    console.log('\n==================== 本地 Commit 確認 ====================');
    console.log('即將提交以下檔案至本地 Git Repository：');
    console.log('  + README.md');
    console.log('  + config.yml');
    console.log('  + raw/.gitkeep');
    console.log('  + photos/.gitkeep');
    console.log('  + processed/.gitkeep');
    console.log('  + analysis/.gitkeep');
    console.log('  + report/.gitkeep');
    console.log('  + report/report.md');
    console.log('  + .github/skills/experiment-report/SKILL.md');
    console.log('  + .github/skills/experiment-report/references/git-commit-guide.md');
    console.log('  + .github/skills/experiment-report/references/report-template.md');
    console.log('  + .github/skills/github-workspace/SKILL.md');
    console.log('  + .gitignore');
    console.log('\n預計 Commit Message：');
    console.log(`  "${initialCommitMsg}"`);
    console.log('========================================================\n');

    const commitConfirm = (await prompter.ask('是否執行初始 Git Commit？ [Yes / No] (預設 No): ')).trim().toLowerCase();
    const isCommitApproved = commitConfirm === 'yes' || commitConfirm === 'y';

    if (!isCommitApproved) {
      console.log('\n⚠️ 使用者未確認 Commit。');
      console.log('❌ 依安全規範：不建立 Commit、不建立遠端 GitHub Repo、不執行 Push。');
      printUncommittedManualInstructions(targetPath, fullRepoName, initialCommitMsg);
      prompter.close();
      return;
    }

    // 執行本地 Commit (使用 execFileSync 參數化呼叫)
    execFileSync('git', ['commit', '-m', initialCommitMsg], { cwd: targetPath, stdio: ['ignore', 'ignore', 'ignore'] });
    console.log(`✅ 已完成本地 Commit: "${initialCommitMsg}"`);

    // ----------------------------------------------------
    // 步驟 3：強制遠端 GitHub Repo 建立確認 (獨立閘門，不得被 --yes 繞過)
    // ----------------------------------------------------
    console.log('\n==================== 遠端 GitHub 設定確認 ====================');
    console.log(`預計建立遠端 Repository:`);
    console.log(`  ${fullRepoName}`);
    console.log('可見度 (Visibility):');
    console.log('  private (預設私有)');
    console.log('安全原則:');
    console.log('  本步驟僅建立遠端儲存庫並設定 origin，絕不自動執行 Push。');
    console.log('============================================================\n');

    const ghConfirm = (await prompter.ask('是否在 GitHub 建立遠端 Repository？ [Yes / No] (預設 No): ')).trim().toLowerCase();
    const isRepoApproved = ghConfirm === 'yes' || ghConfirm === 'y';

    if (!isRepoApproved) {
      console.log('\n⚠️ 使用者未確認建立遠端 Repository。');
      console.log('✅ 已安全保留本地 Commit，未建立任何遠端 GitHub 資源。');
      printManualInstructions(targetPath, fullRepoName);
      prompter.close();
      return;
    }

    // 詢問可見度並建立遠端 (嚴格不帶 --push，僅建立儲存庫並綁定 remote)
    const visibilityInput = (await prompter.ask('可見度 [1] private (私有) / [2] public (公開) (預設 1): ')).trim();
    const visibility = visibilityInput === '2' ? '--public' : '--private';

    console.log(`\n🚀 正在建立 GitHub Repository: ${fullRepoName} (${visibility})...`);
    try {
      execFileSync('gh', ['repo', 'create', fullRepoName, visibility, '--source=.', '--remote=origin'], {
        cwd: targetPath,
        stdio: 'inherit'
      });
      console.log(`\n🎉 遠端 Repository 建立完成！網址: https://github.com/${fullRepoName}`);
    } catch (err) {
      console.warn(`\n⚠️ 遠端建立失敗或中斷: ${err.message}`);
      printManualInstructions(targetPath, fullRepoName);
      prompter.close();
      return;
    }

    // ----------------------------------------------------
    // 步驟 4：獨立遠端 Git Push 授權閘門 (不得被 --yes 繞過)
    // ----------------------------------------------------
    let currentBranch = '';
    try {
      currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd: targetPath, encoding: 'utf8' }).trim();
    } catch {
      currentBranch = '';
    }

    if (!currentBranch || !isValidBranchName(currentBranch, targetPath)) {
      console.log('\n❌ 安全警告：無法確認目前本地來源分支（指令失敗、分支空白、處於 detached HEAD 或分支名稱不合法）。');
      console.log('🛑 依安全規範：嚴禁預設回退至 main 或未確認分支，絕不自動切換分支，已安全中止 Push 流程。');
      console.log('👉 請使用者先確認並手動切換至合法的本地分支（例如: git checkout <branch-name>），再重新執行此程序。');
      printManualPushInstructions(targetPath, fullRepoName, '<source_branch>');
      prompter.close();
      return;
    }

    let objectFormat = '';
    try {
      objectFormat = execFileSync('git', ['rev-parse', '--show-object-format'], {
        cwd: targetPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim().toLowerCase();
    } catch {
      objectFormat = '';
    }

    if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
      console.log(`\n❌ 安全警告：無法確認 Git 儲存庫物件格式（未能識別支援的物件格式: "${objectFormat || '無法讀取'}"，僅支援 SHA-1 或 SHA-256）。`);
      console.log('🛑 依安全規範：嚴禁在無法確認儲存庫物件格式之情況下發起推送，已安全中止 Push 流程。');
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
      prompter.close();
      return;
    }

    let headSha = '';
    try {
      headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetPath, encoding: 'utf8' }).trim();
    } catch {
      headSha = '';
    }

    const expectedShaLength = objectFormat === 'sha256' ? 64 : 40;
    const shaRegex = objectFormat === 'sha256' ? /^[0-9a-f]{64}$/i : /^[0-9a-f]{40}$/i;

    if (!headSha || !shaRegex.test(headSha)) {
      console.log(`\n❌ 安全警告：無法確認本地待推送之 Commit SHA（未取得有效的 ${objectFormat.toUpperCase()} Commit SHA，預期格式為 ${expectedShaLength} 位元十六進位字串）。`);
      console.log('🛑 依安全規範：嚴禁在無法確認待推送 Commit 之情況下發起推送，已安全中止 Push 流程。');
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
      prompter.close();
      return;
    }

    console.log('\n==================== 遠端推送預覽確認 (Git Push) ====================');
    console.log(`【目標儲存庫】: ${fullRepoName}`);
    console.log('【Remote】: origin');
    console.log(`【來源分支】: ${currentBranch}`);
    console.log(`【待推送 Commit SHA】: ${headSha}`);
    console.log(`【Commit Message】: "${initialCommitMsg}"`);
    console.log('【安全原則】: 建立遠端 Repo 不等同於獲准 Push；嚴禁未獲授權預設推向 main；必須明確指定來源與目標分支映射。');
    console.log('===================================================================\n');

    const pushConfirm = (await prompter.ask('是否執行遠端 Git Push？ [Yes / No] (預設 No): ')).trim().toLowerCase();
    const isPushApproved = pushConfirm === 'yes' || pushConfirm === 'y';

    if (!isPushApproved) {
      console.log('\n⚠️ 使用者未授權遠端 Push。');
      console.log('✅ 已建立遠端 Repository 並綁定 origin，未執行任何推送操作。');
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
      prompter.close();
      return;
    }

    const targetBranchInput = (await prompter.ask(`請輸入授權推送的目標分支 (來源分支為 ${currentBranch}，請明確輸入目標分支名稱，不可空白): `)).trim();
    if (!targetBranchInput) {
      console.log('\n⚠️ 未指定目標分支，取消推送。');
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
      prompter.close();
      return;
    }

    if (!isValidBranchName(targetBranchInput, targetPath)) {
      console.log(`\n❌ 錯誤：目標分支名稱格式不合法 ("${targetBranchInput}")。`);
      console.log('🛑 依安全規範：目標分支必須為合法的 Git 分支名稱，已取消推送。');
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
      prompter.close();
      return;
    }

    if (targetBranchInput === 'main' || targetBranchInput === 'master') {
      const protectedConfirm = (await prompter.ask(`⚠️ 目標分支為 [${targetBranchInput}]，請確認是否明確授權推向該分支？ [Yes / No] (預設 No): `)).trim().toLowerCase();
      if (protectedConfirm !== 'yes' && protectedConfirm !== 'y') {
        console.log('\n⚠️ 未取得指向該分支的明確授權，取消推送。');
        printManualPushInstructions(targetPath, fullRepoName, currentBranch);
        prompter.close();
        return;
      }
    }

    // 二次校驗來源分支狀態與 Commit SHA，防範預覽與實際推送間之 TOCTOU 漂移風險
    let postAuthBranch = '';
    try {
      postAuthBranch = execFileSync('git', ['branch', '--show-current'], { cwd: targetPath, encoding: 'utf8' }).trim();
    } catch {
      postAuthBranch = '';
    }

    if (!postAuthBranch || postAuthBranch !== currentBranch) {
      console.log(`\n❌ 安全警告：來源分支在授權確認後發生變更或無法確認（預覽時為 "${currentBranch}"，現為 "${postAuthBranch || '未知/已分離'}"）。`);
      console.log('🛑 依安全規範：檢測到來源分支狀態漂移，已安全中止 Push 流程。');
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
      prompter.close();
      return;
    }

    let postAuthSha = '';
    try {
      postAuthSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetPath, encoding: 'utf8' }).trim();
    } catch {
      postAuthSha = '';
    }

    if (!postAuthSha || postAuthSha !== headSha) {
      console.log(`\n❌ 安全警告：待推送 Commit SHA 在授權確認後發生變更或無法取得（預覽時為 ${headSha}，現為 ${postAuthSha || '無法讀取'}）。`);
      console.log('🛑 依安全規範：檢測到待推送 Commit 漂移，已安全中止 Push 流程。');
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
      prompter.close();
      return;
    }

    const pushRefspec = `refs/heads/${currentBranch}:refs/heads/${targetBranchInput}`;
    console.log(`\n🚀 正在推送至遠端: git push origin ${pushRefspec}...`);
    try {
      execFileSync('git', ['push', 'origin', pushRefspec], {
        cwd: targetPath,
        stdio: 'inherit'
      });
      console.log(`\n🎉 遠端 Push 完成！分支 ${pushRefspec} 已成功發布。`);
    } catch (err) {
      console.warn(`\n⚠️ 遠端 Push 失敗: ${err.message}`);
      printManualPushInstructions(targetPath, fullRepoName, currentBranch);
    }

    console.log('\n======================================================');
    console.log(`✨ 實驗工作區 [${folderName}] 建立成功！`);
    console.log(`👉 本地路徑: ${targetPath}`);
    console.log('======================================================\n');

  } catch (err) {
    console.error('\n❌ 執行過程發生錯誤:', err.message || err);
  } finally {
    prompter.close();
  }
}

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function generateConfigYaml({ courseName, courseId, semester, experimentId, experimentName, reportMode, members }) {
  const today = new Date().toISOString().slice(0, 10);
  const membersYaml = members.map(m => `  - github: "${m.github}"\n    name: "${m.name}"\n    role: "${m.role}"`).join('\n');

  return `# ==========================================
# 實驗課 GitHub 工作區設定檔 (config.yml)
# ==========================================
course_id: "${courseId}"
course_name: "${courseName}"
semester: "${semester}"

experiment_id: "${experimentId}"
experiment_name: "${experimentName}"

template_version: "1.0"
skill_version: "1.1"

report_mode: "${reportMode}"
status: "not_started"

members:
${membersYaml}

created_at: "${today}"
`;
}

export function printUncommittedManualInstructions(targetPath, fullRepoName, initialCommitMsg) {
  console.log('\n📌 目前檔案已產生並暫存於本地，後續若確認欲提交與發布，請依序執行：');
  console.log('');
  console.log('   步驟 a (建立本地 Commit)：');
  console.log(`      cd "${targetPath}"`);
  console.log(`      git commit -m "${initialCommitMsg}"`);
  console.log('');
  console.log('   步驟 b (建立遠端 GitHub Repository，僅建立遠端不自動 push)：');
  console.log(`      gh repo create "${fullRepoName}" --private`);
  console.log('      # 或至 GitHub 網頁手動點擊 New Repository 建立');
  console.log('');
  console.log('   步驟 c (設定遠端 Remote)：');
  console.log(`      git remote add origin https://github.com/${fullRepoName}.git`);
  console.log('');
  console.log('   步驟 d (推送至遠端 - 需明確指定來源與目標分支映射，嚴禁未經確認預設推向 main)：');
  console.log('      # 1. 檢視當前分支與待推送狀態');
  console.log('      git branch --show-current');
  console.log('      git log -n 1 --oneline');
  console.log('      # 2. 依明確授權之目標分支執行映射推送 (例：推向指定 <target_branch>)');
  console.log('      git push origin refs/heads/<source_branch>:refs/heads/<target_branch>');
  console.log('');
  console.log('   ⚠️ 提醒：上述每一步驟均為獨立操作，各步驟需獨立確認，嚴禁使用 --force。');
}

export function printManualInstructions(targetPath, fullRepoName) {
  console.log('\n📌 本地 Commit 已就緒。若日後欲手動發布至 GitHub，請依序執行：');
  console.log('');
  console.log('   步驟 a (建立遠端 GitHub Repository，僅建立遠端不自動 push)：');
  console.log(`      gh repo create "${fullRepoName}" --private`);
  console.log('      # 或至 GitHub 網頁手動點擊 New Repository 建立');
  console.log('');
  console.log('   步驟 b (設定遠端 Remote)：');
  console.log(`      cd "${targetPath}"`);
  console.log(`      git remote add origin https://github.com/${fullRepoName}.git`);
  console.log('');
  console.log('   步驟 c (推送至遠端 - 需明確指定來源與目標分支映射，嚴禁未經確認預設推向 main)：');
  console.log('      # 1. 檢視當前分支與待推送狀態');
  console.log('      git branch --show-current');
  console.log('      git log -n 1 --oneline');
  console.log('      # 2. 依明確授權之目標分支執行映射推送 (例：推向指定 <target_branch>)');
  console.log('      git push origin refs/heads/<source_branch>:refs/heads/<target_branch>');
  console.log('');
  console.log('   ⚠️ 提醒：每一步驟均為獨立操作，推向 main 或受保護分支必須取得明確專屬授權。');
}

export function printManualPushInstructions(targetPath, fullRepoName, currentBranch = '<source_branch>') {
  console.log('\n📌 遠端 GitHub Repository 已建立，本地已綁定 origin。若日後欲手動推送至遠端，請依序執行：');
  console.log('');
  console.log('   步驟 a (確認當前分支與待推送狀態)：');
  console.log(`      cd "${targetPath}"`);
  console.log('      git branch --show-current');
  console.log('      git log -n 1 --oneline');
  console.log('');
  console.log('   步驟 b (確認遠端目標分支無非預期分歧)：');
  console.log('      git ls-remote origin <target_branch>');
  console.log('');
  console.log('   步驟 c (明確指定來源與目標分支映射執行推送，嚴禁未經確認預設推向 main)：');
  console.log(`      git push origin refs/heads/${currentBranch}:refs/heads/<target_branch>`);
  console.log('');
  console.log('   ⚠️ 提醒：推向 main 或受保護分支必須取得明確專屬授權，嚴禁使用 --force。');
}

export { main };

const isDirectExecution = Boolean(
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    path.resolve(process.argv[1]) === path.resolve(__filename))
);

if (isDirectExecution) {
  main();
}
