#!/usr/bin/env node

/**
 * create-lab.mjs
 * 實驗課 GitHub 工作區快速建立工具 (CLI)
 * 
 * 嚴格安全確認規範：
 * 1. 本地檔案產生需確認 (--yes 僅適用此非破壞性步驟)
 * 2. 初始 Commit 必須明確獨立確認 (預設 No，--yes 不得繞過)
 * 3. 遠端 GitHub Repo 建立與 Push 必須明確獨立確認 (預設 No，--yes 不得繞過)
 * 4. 若未確認 Commit，絕不執行 Commit、絕不建立遠端、絕不 Push
 * 5. 若確認 Commit 但未確認 Push，僅完成本地 Commit，不建立遠端、不 Push
 * 6. 嚴格驗證 Repository 名稱防範路徑穿越與非法字元
 * 7. 所有外部指令採用 execFileSync / argv 傳參，杜絕 shell injection
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
    console.log('  .github/skills/experiment-report/SKILL.md\n');
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
    // 步驟 3：強制遠端 GitHub Repo 建立與 Push 確認 (不得被 --yes 繞過)
    // ----------------------------------------------------
    console.log('\n==================== 遠端 GitHub 設定確認 ====================');
    console.log(`預計建立遠端 Repository:`);
    console.log(`  ${fullRepoName}`);
    console.log('可見度 (Visibility):');
    console.log('  private (預設私有)');
    console.log('即將 Push 的 Commit:');
    console.log(`  ${initialCommitMsg}`);
    console.log('包含檔案:');
    console.log('  所有已提交之實驗規範與範本檔案 (main 分支)');
    console.log('============================================================\n');

    const ghConfirm = (await prompter.ask('是否在 GitHub 建立遠端 Repo 並執行 Push？ [Yes / No] (預設 No): ')).trim().toLowerCase();
    const isPushApproved = ghConfirm === 'yes' || ghConfirm === 'y';

    if (!isPushApproved) {
      console.log('\n⚠️ 使用者未確認遠端 Push。');
      console.log('✅ 已安全保留本地 Commit，未建立任何遠端 GitHub 資源。');
      printManualInstructions(targetPath, fullRepoName);
      prompter.close();
      return;
    }

    // 詢問可見度並建立遠端
    const visibilityInput = (await prompter.ask('可見度 [1] private (私有) / [2] public (公開) (預設 1): ')).trim();
    const visibility = visibilityInput === '2' ? '--public' : '--private';

    console.log(`\n🚀 正在建立 GitHub Repository: ${fullRepoName} (${visibility})...`);
    try {
      execFileSync('gh', ['repo', 'create', fullRepoName, visibility, '--source=.', '--remote=origin', '--push'], {
        cwd: targetPath,
        stdio: 'inherit'
      });
      console.log(`\n🎉 遠端 Repository 建立完成！網址: https://github.com/${fullRepoName}`);
    } catch (err) {
      console.warn(`\n⚠️ 遠端建立失敗或中斷: ${err.message}`);
      printManualInstructions(targetPath, fullRepoName);
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

function printUncommittedManualInstructions(targetPath, fullRepoName, initialCommitMsg) {
  console.log('\n📌 目前檔案已產生並暫存於本地，後續若確認欲提交與發布，請依序執行：');
  console.log('');
  console.log('   步驟 a (建立本地 Commit)：');
  console.log(`      cd "${targetPath}"`);
  console.log(`      git commit -m "${initialCommitMsg}"`);
  console.log('');
  console.log('   步驟 b (建立遠端 GitHub Repository)：');
  console.log(`      gh repo create "${fullRepoName}" --private`);
  console.log('      # 或至 GitHub 網頁手動點擊 New Repository 建立');
  console.log('');
  console.log('   步驟 c (設定遠端 Remote)：');
  console.log(`      git remote add origin https://github.com/${fullRepoName}.git`);
  console.log('      git branch -M main');
  console.log('');
  console.log('   步驟 d (推送至遠端)：');
  console.log('      git push -u origin main');
  console.log('');
  console.log('   ⚠️ 提醒：上述每一步驟均涉及版本與遠端變更，請於執行前自行確認。');
}

function printManualInstructions(targetPath, fullRepoName) {
  console.log('\n📌 本地 Commit 已就緒。若日後欲手動發布至 GitHub，請依序執行：');
  console.log('');
  console.log('   步驟 a (建立遠端 GitHub Repository)：');
  console.log(`      gh repo create "${fullRepoName}" --private`);
  console.log('      # 或至 GitHub 網頁手動點擊 New Repository 建立');
  console.log('');
  console.log('   步驟 b (設定遠端 Remote)：');
  console.log(`      git remote add origin https://github.com/${fullRepoName}.git`);
  console.log('      git branch -M main');
  console.log('');
  console.log('   步驟 c (推送至遠端)：');
  console.log('      git push -u origin main');
  console.log('');
  console.log('   ⚠️ 提醒：每一步驟均為獨立操作，請於執行前確認遠端設定與權限。');
}

main();
