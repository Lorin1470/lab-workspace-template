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

export const SKILL_REPO_URL = 'https://github.com/Lorin1470/lab-workspace-template';
export const SKILL_RAW_URL =
  'https://raw.githubusercontent.com/Lorin1470/lab-workspace-template/main/.github/skills/github-workspace/SKILL.md';

export const AGENT_INSTALL_PROMPT = `請協助安裝 \`github-workspace\` Agent Skill。

【官方來源】
- GitHub 儲存庫：${SKILL_REPO_URL}
- 原始 Skill：${SKILL_RAW_URL}

【執行要求】
1. 從上述官方來源取得 \`github-workspace\` Skill；如果無法下載，明確告知使用者，不可假裝取得檔案。
2. 確認 \`SKILL.md\` 完整、YAML Frontmatter 正確，並符合目前 Agent 支援的 Skill 格式。
3. 依目前 Agent 的官方規範選擇使用者層級或專案層級安裝位置，不可猜測路徑。
4. 如果已有同名 Skill，先比較內容，不可未經確認就覆蓋。
5. 安裝後驗證實際檔案、路徑與內容完整性，並回報結果及必要的重新載入步驟。`;

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
