/**
 * skill-downloader.ts
 * github-workspace Agent Skill 靜態下載與提示詞輔助函式庫
 *
 * 核心原則：
 * 1. 嚴格以母倉庫 .github/skills/github-workspace/SKILL.md 作為唯一規範源頭。
 * 2. 網站前端透過靜態檔案端點讀取，絕不維護第二份寫死文字。
 * 3. 打包 ZIP 時保持正確的「github-workspace/」目錄結構，絕不遺漏必要檔案。
 * 4. 提示詞使用繁體中文，完整涵蓋環境辨識、檔案驗證、規範路徑選擇、防覆寫比對、結構驗證與安裝回報。
 */

import JSZip from 'jszip';

export const AGENT_INSTALL_PROMPT = `請協助我安裝「github-workspace」Agent Skill。請嚴格遵循以下步驟與規範執行，不可跳過任何步驟或假裝成功：

1. 【辨識 Agent 類型與 Skill 格式】
   請先主動辨識你目前運行的 AI Agent 類型（例如 Antigravity、OpenAI Codex、Claude Code、Cursor 等），以及該 Agent 官方支援的 Agent Skill / 擴充工具格式與安裝規範。

2. 【定位下載檔案】
   若我尚未在對話中提供下載的 Skill 檔案路徑（例如 SKILL.md 或解壓縮後的 github-workspace 目錄），請先在目前可用的工作區目錄中搜尋；若找不到，請先詢問我檔案放置的本機路徑。絕對嚴禁假裝已經取得檔案或憑空編造內容。

3. 【閱讀並驗證內容完整性】
   在進行任何安裝動作前，請先完整閱讀該 Skill 檔案，核對 YAML Frontmatter（包含 name: github-workspace、version 等欄位）與核心操作規範，確認內容完整且檔案未受損。

4. 【選擇正確安裝位置】
   依據該 Agent 的官方規範選擇正確的使用者層級（User-level / Global）或專案層級（Project-level / Workspace）安裝位置，不可假設所有 Agent 都使用同一路徑。

5. 【防覆寫比對與確認】
   若目的地已有同名的 Skill（例如既有的 github-workspace），請先比對兩者的內容與版本差異並向我說明，詢問我的確認，絕對不可直接強制覆蓋。

6. 【驗證安裝結構與狀態】
   安裝完成後，請實質驗證安裝目錄結構、必要檔案（必須包含 SKILL.md）與內容完整性。若目前環境支援檢測 Agent 的 Skill 識別狀態（例如查看可用 Skill 清單），請一併進行驗證。

7. 【回報結果與手動步驟】
   請詳細回報實際安裝路徑、完整性驗證結果，以及是否需要我手動重啟 Agent 或重新載入等步驟。`;

export interface DownloadResult {
  filename: string;
  size: number;
  content: string;
}

export interface ZipDownloadResult {
  filename: string;
  size: number;
  files: string[];
}

/**
 * 複製安裝提示詞至剪貼簿（具備 fallback 備援）
 */
export async function copyInstallPrompt(
  text: string = AGENT_INSTALL_PROMPT
): Promise<{ success: boolean; error?: string }> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return { success: true };
    }

    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) {
        return { success: true };
      }
    }

    return {
      success: false,
      error: '瀏覽器拒絕剪貼簿寫入權限，請手動選取文字進行複製。',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || '無法存取系統剪貼簿，請手動選取文字進行複製。',
    };
  }
}

/**
 * 觸發瀏覽器下載 Blob
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 從靜態端點取得原始 SKILL.md 內容
 */
export async function fetchRawSkillContent(fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher('/skills/github-workspace/SKILL.md');
  if (!res.ok) {
    throw new Error(`無法下載 SKILL.md 檔案 (HTTP ${res.status})`);
  }
  const text = await res.text();
  if (!text || text.trim().length === 0) {
    throw new Error('下載的 SKILL.md 內容為空');
  }
  if (!text.includes('name: github-workspace')) {
    throw new Error('下載的 SKILL.md 格式不正確 (缺少 Frontmatter 宣告)');
  }
  return text;
}

/**
 * 下載原始 SKILL.md 單檔
 */
export async function downloadRawSkill(options?: {
  fetcher?: typeof fetch;
  saver?: (blob: Blob, filename: string) => void;
}): Promise<DownloadResult> {
  const fetcher = options?.fetcher || fetch;
  const saver = options?.saver || triggerBrowserDownload;

  const content = await fetchRawSkillContent(fetcher);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const filename = 'SKILL.md';
  saver(blob, filename);

  return {
    filename,
    size: blob.size,
    content,
  };
}

/**
 * 打包 Skill 為 ZIP (包含正確的 github-workspace/ 目錄結構)
 */
export async function createSkillZip(options?: {
  fetcher?: typeof fetch;
}): Promise<{ zip: JSZip; blob: Blob; files: string[] }> {
  const fetcher = options?.fetcher || fetch;
  const zip = new JSZip();

  let fileList: string[] = ['SKILL.md'];
  try {
    const manifestRes = await fetcher('/skills/github-workspace/manifest.json');
    if (manifestRes.ok) {
      const parsed = await manifestRes.json();
      if (Array.isArray(parsed) && parsed.length > 0) {
        fileList = parsed;
      }
    }
  } catch {
    // 預設 fallback 為 SKILL.md
  }

  const addedFiles: string[] = [];
  for (const relativePath of fileList) {
    const fileRes = await fetcher(`/skills/github-workspace/${relativePath}`);
    if (!fileRes.ok) {
      throw new Error(`無法讀取 Skill 必要檔案「${relativePath}」(HTTP ${fileRes.status})`);
    }
    const fileContent = await fileRes.text();
    const zipPath = `github-workspace/${relativePath}`;
    zip.file(zipPath, fileContent);
    addedFiles.push(zipPath);
  }

  if (!addedFiles.includes('github-workspace/SKILL.md')) {
    throw new Error('Skill 打包失敗：遺漏必要的核心 SKILL.md 檔案');
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return {
    zip,
    blob,
    files: addedFiles,
  };
}

/**
 * 下載包含完整目錄結構的 Skill ZIP
 */
export async function downloadSkillZip(options?: {
  fetcher?: typeof fetch;
  saver?: (blob: Blob, filename: string) => void;
}): Promise<ZipDownloadResult> {
  const saver = options?.saver || triggerBrowserDownload;
  const { blob, files } = await createSkillZip(options);
  const filename = 'github-workspace.zip';
  saver(blob, filename);

  return {
    filename,
    size: blob.size,
    files,
  };
}
