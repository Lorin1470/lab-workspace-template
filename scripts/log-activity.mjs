#!/usr/bin/env node

/**
 * log-activity.mjs
 * 透過 Node.js 原生 fetch 回報 Activity Log 操作稽核事件至 Cloudflare D1
 *
 * 支援環境變數：
 *   ACTIVITY_LOG_API_URL  (例如 https://your-pages-domain.pages.dev/api/activity)
 *   ACTIVITY_LOG_SECRET   (Bearer Token，嚴禁寫入 Git 追蹤檔案)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// 從 remote URL 解析 GitHub owner/repository
export function parseGitHubRepoFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();

  // HTTPS URL: https://github.com/owner/repo(.git)
  const httpsMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // SSH URL: git@github.com:owner/repo(.git) 或 ssh://git@github.com/owner/repo(.git)
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return null;
}

// 取得當前目錄的 Git remote.origin.url
export function getRawGitRemoteOrigin(cwd = process.cwd()) {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return remoteUrl || null;
  } catch {
    return null;
  }
}

// 自動從 Git remote 解析 GitHub owner/repository
export function getRepoFromGitRemote(cwd = process.cwd()) {
  const remoteUrl = getRawGitRemoteOrigin(cwd);
  if (!remoteUrl) return null;
  return parseGitHubRepoFromUrl(remoteUrl);
}

// 解析命令列參數
export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// 核心回報函式 (可由程式化調用)
export async function postActivityLog(apiUrl, apiSecret, options) {
  if (!apiUrl || !apiSecret) {
    return {
      success: false,
      error: '未設定 ACTIVITY_LOG_API_URL 或 ACTIVITY_LOG_SECRET 環境變數',
      code: 'MISSING_CREDENTIALS'
    };
  }

  let actorType = options.actor_type;
  let actorName = options.actor_name;
  const actorId = options.actor_id || options.actor || 'agent:antigravity';

  if (!actorType) {
    if (actorId.startsWith('agent:')) {
      actorType = 'agent';
      actorName = actorName || 'AI Agent';
    } else {
      actorType = 'user';
      actorName = actorName || actorId;
    }
  } else {
    actorName = actorName || actorId;
  }

  let approval = options.approval_status || options.approval || 'none';
  let sha = options.commit_sha || options.sha || null;
  let filesChanged = null;

  if (options.files_changed || options.files) {
    const rawFiles = options.files_changed || options.files;
    if (typeof rawFiles === 'string') {
      if (rawFiles.startsWith('[') && rawFiles.endsWith(']')) {
        filesChanged = rawFiles;
      } else {
        const list = rawFiles.split(',').map((s) => s.trim()).filter(Boolean);
        filesChanged = JSON.stringify(list);
      }
    } else if (Array.isArray(rawFiles)) {
      filesChanged = JSON.stringify(rawFiles);
    }
  }

  const action = options.action;

  // 真實性約束 (Client-side Safeguards)
  if (action === 'request_rejected') {
    approval = 'rejected';
    sha = null;
    filesChanged = null;
  } else if (!['commit_created', 'push_completed'].includes(action)) {
    sha = null;
  }

  // commit_created 與 push_completed 必須有 SHA
  if (['commit_created', 'push_completed'].includes(action) && (!sha || typeof sha !== 'string' || sha.trim() === '')) {
    return {
      success: false,
      status: 400,
      error: 'commit_sha is required when action is commit_created or push_completed',
    };
  }

  const payload = {
    repo_name: options.repo_name || options.repo,
    experiment_id: options.experiment_id || options['experiment-id'] || 'lab-01',
    actor_type: actorType,
    actor_id: actorId,
    actor_name: actorName,
    actor_avatar: options.actor_avatar || null,
    requested_by: options.requested_by || options['requested-by'] || null,
    approved_by: options.approved_by || options['approved-by'] || null,
    approval_status: approval,
    action: action,
    target: options.target || null,
    summary: options.summary,
    files_changed: filesChanged,
    commit_sha: sha,
    details_json: options.details_json || options.details || null,
  };

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiSecret}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: data.error || res.statusText,
      };
    }

    return {
      success: true,
      status: res.status,
      id: data.id,
      timestamp: data.timestamp,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

// 主執行流程 (CLI)
async function main() {
  const args = parseArgs(process.argv);

  if (args.help || args.h || process.argv.length <= 2) {
    console.log(`
使用方式: node scripts/log-activity.mjs [選項]

必要參數:
  --action          操作動詞 (request_proposal, file_created, file_modified, commit_created, push_completed, request_rejected)
  --summary         繁體中文客觀摘要說明 (嚴禁漂移)
  --repo            Repository 全名 (例如 Lorin1470/electronics-lab-01，預設嘗試由 config.yml 讀取)

選用參數:
  --actor           操作者 ID (預設 "agent:antigravity"；以 agent: 開頭視為 agent，否則為 user)
  --requested-by    發起操作之使用者帳號
  --approved-by     明確核准之使用者帳號
  --approval        核准狀態 (pending, approved, rejected, none，預設 "none")
  --target          目標路徑 (例如 report/report-studentA.md)
  --sha             關聯之 Git Commit SHA (僅在 commit_created 或 push_completed 允許)
  --files           異動檔案清單 (逗號分隔，例如 "report/report.md,photos/test.jpg")
  --experiment-id   實驗編號 (預設 "lab-01"，或由 config.yml 讀取)
  --api-url         API 網址 (優先取自環境變數 ACTIVITY_LOG_API_URL)
  --api-secret      API 金鑰 (優先取自環境變數 ACTIVITY_LOG_SECRET)

環境變數:
  ACTIVITY_LOG_API_URL  伺服端端點 (例如 https://<pages-app>.pages.dev/api/activity)
  ACTIVITY_LOG_SECRET   伺服端認證金鑰 (切勿寫入任何 Git 追蹤檔案)
`);
    process.exit(0);
  }

  const apiUrl = args['api-url'] || process.env.ACTIVITY_LOG_API_URL;
  const apiSecret = args['api-secret'] || process.env.ACTIVITY_LOG_SECRET;

  if (!apiUrl || !apiSecret) {
    console.error('\n⚠️  [Activity Log] 未設定 ACTIVITY_LOG_API_URL 或 ACTIVITY_LOG_SECRET。');
    console.error('   目前無法將活動紀錄送出至伺服器。');
    console.error('   提示：請由環境變數注入 Secret，切勿將金鑰寫入程式碼或 Git 追蹤檔案。\n');
    process.exit(1);
  }

  // 1. 優先使用明確提供的 --repo
  let repo = args.repo;

  // 2. 嘗試由當前目錄之 config.yml 讀取 experiment_id 與 repository
  let experimentId = args['experiment-id'];
  if (fs.existsSync('config.yml')) {
    try {
      const configContent = fs.readFileSync('config.yml', 'utf8');
      if (!experimentId) {
        const expMatch = configContent.match(/experiment_id:\s*"?([^"\n]+)"?/);
        if (expMatch) experimentId = expMatch[1].trim();
      }
      if (!repo) {
        const repoMatch = configContent.match(/repository:\s*"?([^"\n]+)"?/);
        if (repoMatch) repo = repoMatch[1].trim();
      }
    } catch {
      // 忽略讀檔例外
    }
  }

  // 3. 若 config.yml 未設定 repository，嘗試由 git config --get remote.origin.url 自動解析 GitHub owner/repo
  if (!repo) {
    repo = getRepoFromGitRemote();
  }

  // 4. 若仍無法解析，給予清楚明確的錯誤提示
  if (!repo) {
    const rawOrigin = getRawGitRemoteOrigin();
    if (rawOrigin) {
      console.error(`\n❌ [Activity Log] 無法從 Git 遠端 URL 解析 GitHub Repository: "${rawOrigin}"`);
      console.error('   目前僅支援 GitHub 遠端 (如 https://github.com/owner/repo.git 或 git@github.com:owner/repo.git)。');
      console.error('   請手動提供 --repo <owner/repo> 參數。\n');
    } else {
      console.error('\n❌ [Activity Log] 缺少必要參數: --repo');
      console.error('   (當前目錄的 config.yml 未設定 repository，且本地 Git 亦無設定 remote.origin.url)');
      console.error('   請提供 --repo <owner/repo> 參數手動指定。\n');
    }
    process.exit(1);
  }

  if (!args.action) {
    console.error('\n❌ [Activity Log] 缺少必要參數: --action\n');
    process.exit(1);
  }

  if (['commit_created', 'push_completed'].includes(args.action) && (!args.sha || typeof args.sha !== 'string' || args.sha.trim() === '')) {
    console.error(`\n❌ [Activity Log] 動作為 "${args.action}" 時，--sha 為必填參數。\n`);
    process.exit(1);
  }

  if (!args.summary) {
    console.error('\n❌ [Activity Log] 缺少必要參數: --summary\n');
    process.exit(1);
  }

  const result = await postActivityLog(apiUrl, apiSecret, {
    ...args,
    repo,
    'experiment-id': experimentId || 'lab-01',
  });

  if (!result.success) {
    console.error(`\n❌ [Activity Log] 儲存失敗 (${result.status || 'ERR'}): ${result.error}\n`);
    process.exit(1);
  }

  console.log(`\n✅ [Activity Log] 活動紀錄已成功寫入 D1 (ID: ${result.id}, Time: ${result.timestamp})\n`);
}

// 若由 CLI 直接執行則跑 main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('未預期的例外:', err);
    process.exit(1);
  });
}
