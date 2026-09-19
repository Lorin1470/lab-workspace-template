/**
 * workspace.ts
 * GitHub Workspace Service Core
 *
 * 職責：
 * 1. 取得實驗綁定的 GitHub repository (自 D1 experiments 解析，不接受任意輸入)
 * 2. 驗證協作者身分邊界 (Collaborator Access Boundary)
 * 3. 讀取 repository 檔案樹 (listFiles via GitHub Contents API)
 * 4. 讀取單一檔案內容 (readFile，自動 Base64 -> UTF-8 解碼，支援大檔檢測)
 * 5. 建立與更新文字檔案 (createOrUpdateFile，自動取得現有 SHA 防 race condition)
 * 6. 建立與更新二進位檔案 (createOrUpdateBinaryFile，支援照片等素材)
 * 7. 提取並回傳 GitHub 真正產生的 Git Commit SHA
 * 8. 嚴格路徑防禦 (防 ../ 穿越、絕對路徑、編碼穿越、空字元注入)
 * 9. 維護 Raw Data Sanctuary 聖域保護與 Separate Report 個人報告隔離
 */

import {
  getInstallationToken,
  sanitizeErrorMessage,
} from './provisioning.ts';

export interface WorkspaceRepoInfo {
  experiment_id: string;
  experiment_code: string;
  course_id: string;
  name: string;
  owner: string;
  repo: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  report_mode: 'shared' | 'separate';
  provisioning_status: string;
}

export interface WorkspaceFileItem {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  sha?: string;
  download_url?: string | null;
}

export interface WorkspaceFileContent {
  path: string;
  content: string;
  sha: string;
  size: number;
  encoding: 'utf-8' | 'base64';
}

export interface WorkspaceWriteResult {
  success: boolean;
  path: string;
  commit_sha: string;
  commit_message: string;
  content_sha: string;
}

export interface WorkspaceServiceOptions {
  sha?: string;
  isBase64?: boolean;
}

export interface WorkspaceSessionUser {
  github_id: string | number;
  username?: string;
}

/**
 * Workspace 專用錯誤類別
 */
export class WorkspaceError extends Error {
  public status: number;
  public details?: any;

  constructor(status: number, message: string, details?: any) {
    super(sanitizeErrorMessage(message));
    this.name = 'WorkspaceError';
    this.status = status;
    this.details = details;
  }
}

/**
 * 安全執行 D1 查詢取第一筆資料
 */
async function safeD1First(stmt: any): Promise<any> {
  if (!stmt) return null;
  if (typeof stmt.first === 'function') {
    try {
      return await stmt.first();
    } catch {
      return null;
    }
  }
  if (typeof stmt.all === 'function') {
    try {
      const res = await stmt.all();
      return res?.results?.[0] || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 安全取得 Installation Token 並將錯誤包裝為標準 WorkspaceError (502)
 */
async function obtainInstallationToken(env: any, fetchFn: typeof fetch): Promise<string> {
  try {
    const tokenInfo = await getInstallationToken(env, fetchFn);
    return tokenInfo.token;
  } catch (err: any) {
    throw new WorkspaceError(
      502,
      `GitHub App authentication failed: ${sanitizeErrorMessage(err.message || err)}`
    );
  }
}

/**
 * 安全執行 fetch，將網路底層錯誤轉譯為 WorkspaceError (502)
 */
async function safeFetch(
  fetchFn: typeof fetch,
  url: string,
  options: any
): Promise<Response> {
  try {
    return await fetchFn(url, options);
  } catch (err: any) {
    throw new WorkspaceError(
      502,
      `GitHub API network error: ${sanitizeErrorMessage(err.message || err)}`
    );
  }
}

/**
 * Base64 轉換為 Uint8Array (相容 Web Crypto 與 Node.js)
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const buf = Buffer.from(clean, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Uint8Array 轉換為 Base64 字串
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/**
 * UTF-8 字串轉 Base64
 */
export function stringToBase64(str: string): string {
  const encoder = new TextEncoder();
  return uint8ArrayToBase64(encoder.encode(str));
}

/**
 * Base64 轉 UTF-8 字串
 */
export function base64ToString(b64: string): string {
  const bytes = base64ToUint8Array(b64);
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

/**
 * 安全路徑正規化與遍歷防禦檢驗 (Repository Path Sanitizer)
 *
 * 防禦項目：
 * - 空字元注入 (\0, %00)
 * - 絕對路徑 (/foo, \foo, C:\foo)
 * - 相對遍歷 (../, /../, photos/../../etc)
 * - URL 編碼穿越 (%2e%2e, %252e%252e)
 */
export function validateWorkspacePath(
  rawPath: string | null | undefined,
  options?: { allowEmpty?: boolean }
): string {
  if (rawPath === null || rawPath === undefined) {
    if (options?.allowEmpty) return '';
    throw new WorkspaceError(400, 'Invalid path: path is required');
  }

  if (typeof rawPath !== 'string') {
    throw new WorkspaceError(400, 'Invalid path: path must be a string');
  }

  // 1. 空字元檢查
  if (rawPath.includes('\0') || rawPath.includes('%00')) {
    throw new WorkspaceError(400, 'Invalid path: null byte detected');
  }

  // 2. 多重 URL 解碼以捕捉巢狀編碼穿越 (例如 %252e%252e)
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

  // 3. 絕對路徑與磁碟代號防禦
  if (
    rawPath.startsWith('/') ||
    decoded.startsWith('/') ||
    rawPath.startsWith('\\') ||
    decoded.startsWith('\\') ||
    /^[a-zA-Z]:/.test(decoded)
  ) {
    throw new WorkspaceError(400, 'Invalid path: absolute path is not allowed');
  }

  // 4. 斜線正規化
  const normalized = decoded.replace(/\\/g, '/');

  // 5. 分割段落檢查 .. 穿越
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new WorkspaceError(400, 'Invalid path: path traversal is not allowed');
    }
  }

  // 6. 清理冗餘分隔符與目前目錄標記 (./)
  const cleanSegments = segments.filter((s) => s && s !== '.');
  const result = cleanSegments.join('/');

  if (result === '' && !options?.allowEmpty) {
    throw new WorkspaceError(400, 'Invalid path: target path cannot be empty');
  }

  return result;
}

/**
 * 檢查是否屬於 raw/ 聖域 (Immutable Raw Sanctuary)
 */
export function isRawSanctuaryPath(normalizedPath: string): boolean {
  if (!normalizedPath) return false;
  return normalizedPath === 'raw' || normalizedPath.startsWith('raw/');
}

/**
 * 將 Repo 路徑轉為 URL 安全編碼 (保留目錄斜線，編碼檔名中特殊字元)
 */
function encodeRepoPathForUrl(path: string): string {
  if (!path) return '';
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * 1. 取得實驗綁定的 GitHub repository 與工作區資訊
 * 嚴禁 caller 隨意傳入 owner/repo，必須由 D1 experimentId 查詢綁定
 */
export async function getWorkspaceRepository(
  env: any,
  experimentId: string,
  sessionUser?: WorkspaceSessionUser | null
): Promise<WorkspaceRepoInfo> {
  if (!experimentId || typeof experimentId !== 'string') {
    throw new WorkspaceError(400, 'Invalid or missing experiment ID');
  }

  if (!env?.DB) {
    throw new WorkspaceError(500, 'Database unavailable');
  }

  // 查詢實驗資料
  const exp: any = await safeD1First(
    env.DB.prepare(
      'SELECT id, course_id, experiment_code, name, repository, report_mode, status, provisioning_status FROM experiments WHERE id = ?'
    ).bind(experimentId)
  );

  if (!exp) {
    throw new WorkspaceError(404, `Experiment '${experimentId}' not found`);
  }

  // 驗證協作者身分 (若有 sessionUser)
  if (sessionUser && sessionUser.github_id) {
    const mem: any = await safeD1First(
      env.DB.prepare(
        'SELECT id, role, status FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"'
      ).bind(exp.course_id, String(sessionUser.github_id))
    );
    if (!mem) {
      throw new WorkspaceError(403, 'Forbidden: Access denied to experiment workspace');
    }
  }

  // 驗證 Repository 綁定格式
  const repo = exp.repository;
  if (!repo || typeof repo !== 'string') {
    throw new WorkspaceError(400, `Experiment '${experimentId}' has no repository bound`);
  }

  const match = repo.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (!match) {
    throw new WorkspaceError(400, `Invalid repository format in binding: '${repo}'`);
  }

  const [_, owner, repoName] = match;

  return {
    experiment_id: exp.id,
    experiment_code: exp.experiment_code,
    course_id: exp.course_id,
    name: exp.name,
    owner,
    repo: repoName,
    full_name: repo,
    html_url: `https://github.com/${repo}`,
    default_branch: 'main',
    report_mode: exp.report_mode || 'shared',
    provisioning_status: exp.provisioning_status || 'pending',
  };
}

/**
 * 2. 讀取 repository 檔案樹 (支援目錄或根目錄)
 */
export async function listFiles(
  env: any,
  experimentId: string,
  dirPath: string = '',
  sessionUser?: WorkspaceSessionUser | null,
  fetchFn: typeof fetch = fetch
): Promise<WorkspaceFileItem[]> {
  const repoInfo = await getWorkspaceRepository(env, experimentId, sessionUser);
  const normPath = validateWorkspacePath(dirPath, { allowEmpty: true });

  const token = await obtainInstallationToken(env, fetchFn);
  const encodedPath = encodeRepoPathForUrl(normPath);
  const url = encodedPath
    ? `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`
    : `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents`;

  const res = await safeFetch(fetchFn, url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Lab-Workspace-System/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ message: res.statusText }));
    if (res.status === 404) {
      throw new WorkspaceError(404, `Directory or file '${normPath || '/'}' not found in repository`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new WorkspaceError(502, `GitHub App authentication or permission error: ${sanitizeErrorMessage(errBody.message || res.statusText)}`);
    }
    throw new WorkspaceError(
      res.status >= 500 ? 502 : res.status,
      `GitHub API error (${res.status}): ${sanitizeErrorMessage(errBody.message || res.statusText)}`
    );
  }

  const data: any = await res.json();
  const rawList = Array.isArray(data) ? data : [data];

  const items: WorkspaceFileItem[] = rawList.map((item: any) => ({
    path: item.path,
    name: item.name,
    type: item.type === 'dir' ? 'directory' : 'file',
    size: typeof item.size === 'number' ? item.size : undefined,
    sha: item.sha,
    download_url: item.download_url || null,
  }));

  // 排序：目錄優先，其餘依照名稱英數字排序
  items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return items;
}

/**
 * 3. 讀取單一文字檔案內容 (自動將 Base64 解碼為 UTF-8 字串)
 */
export async function readFile(
  env: any,
  experimentId: string,
  filePath: string,
  sessionUser?: WorkspaceSessionUser | null,
  fetchFn: typeof fetch = fetch
): Promise<WorkspaceFileContent> {
  const repoInfo = await getWorkspaceRepository(env, experimentId, sessionUser);
  const normPath = validateWorkspacePath(filePath, { allowEmpty: false });

  const token = await obtainInstallationToken(env, fetchFn);
  const encodedPath = encodeRepoPathForUrl(normPath);
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`;

  const res = await safeFetch(fetchFn, url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Lab-Workspace-System/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ message: res.statusText }));
    if (res.status === 404) {
      throw new WorkspaceError(404, `File '${normPath}' not found in repository`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new WorkspaceError(502, `GitHub App authentication or permission error: ${sanitizeErrorMessage(errBody.message || res.statusText)}`);
    }
    throw new WorkspaceError(
      res.status >= 500 ? 502 : res.status,
      `GitHub API error (${res.status}): ${sanitizeErrorMessage(errBody.message || res.statusText)}`
    );
  }

  const data: any = await res.json();

  if (Array.isArray(data) || data.type === 'dir') {
    throw new WorkspaceError(400, `Path '${normPath}' is a directory, not a file`);
  }

  // 大檔案限制檢測 (GitHub Contents API 上限約 1MB)
  if (data.size > 1048576 || (!data.content && data.size > 0)) {
    throw new WorkspaceError(
      413,
      `File '${normPath}' is too large for Contents API (${data.size} bytes). Large file strategy required.`
    );
  }

  let textContent = '';
  if (data.content && data.encoding === 'base64') {
    try {
      textContent = base64ToString(data.content);
    } catch {
      textContent = data.content;
    }
  } else if (typeof data.content === 'string') {
    textContent = data.content;
  }

  return {
    path: normPath,
    content: textContent,
    sha: data.sha,
    size: data.size || 0,
    encoding: 'utf-8',
  };
}

/**
 * 4. 建立或更新文字檔案 (支援自動推導現有 SHA 防競態條件，回傳真實 commit SHA)
 */
export async function createOrUpdateFile(
  env: any,
  experimentId: string,
  filePath: string,
  content: string,
  commitMessage: string,
  sessionUser?: WorkspaceSessionUser | null,
  options?: WorkspaceServiceOptions,
  fetchFn: typeof fetch = fetch
): Promise<WorkspaceWriteResult> {
  const repoInfo = await getWorkspaceRepository(env, experimentId, sessionUser);
  const normPath = validateWorkspacePath(filePath, { allowEmpty: false });

  // 1. Raw Data Sanctuary 聖域鐵律防護：嚴禁任何角色修改 raw/*
  if (isRawSanctuaryPath(normPath)) {
    throw new WorkspaceError(403, 'Raw sanctuary violation: Modifications to raw/* are strictly forbidden');
  }

  // 2. Separate Report 個人報告隔離防護
  if (repoInfo.report_mode === 'separate' && normPath.startsWith('report/')) {
    if (sessionUser && sessionUser.github_id) {
      const isSelfReport =
        normPath === `report/${sessionUser.github_id}.md` ||
        normPath.startsWith(`report/${sessionUser.github_id}/`);
      if (!isSelfReport) {
        throw new WorkspaceError(
          403,
          'Separate report mode violation: Collaborators can only edit their personal report (report/<github_id>.md)'
        );
      }
    }
  }

  if (!commitMessage || typeof commitMessage !== 'string' || !commitMessage.trim()) {
    throw new WorkspaceError(400, 'Commit message is required');
  }

  const token = await obtainInstallationToken(env, fetchFn);
  const encodedPath = encodeRepoPathForUrl(normPath);
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Lab-Workspace-System/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // 3. 取得目前檔案 SHA (若 options.sha 未顯式指定)
  let targetSha = options?.sha;
  if (!targetSha) {
    const checkRes = await safeFetch(fetchFn, url, { method: 'GET', headers });
    if (checkRes.ok) {
      const checkData: any = await checkRes.json();
      if (checkData?.sha) {
        targetSha = checkData.sha;
      }
    } else if (checkRes.status !== 404) {
      const errBody = await checkRes.json().catch(() => ({ message: checkRes.statusText }));
      throw new WorkspaceError(
        checkRes.status >= 500 ? 502 : checkRes.status,
        `Failed to check existing file state: ${sanitizeErrorMessage(errBody.message || checkRes.statusText)}`
      );
    }
  }

  // 4. 編碼內容為 Base64
  const base64Content = stringToBase64(content);

  const payload: any = {
    message: commitMessage.trim(),
    content: base64Content,
  };
  if (targetSha) {
    payload.sha = targetSha;
  }

  const putRes = await safeFetch(fetchFn, url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({ message: putRes.statusText }));
    if (putRes.status === 409) {
      throw new WorkspaceError(409, 'Conflict: SHA mismatch or parallel modification detected');
    }
    if (putRes.status === 401 || putRes.status === 403) {
      throw new WorkspaceError(502, `GitHub App authentication or permission error: ${sanitizeErrorMessage(errBody.message || putRes.statusText)}`);
    }
    throw new WorkspaceError(
      putRes.status >= 500 ? 502 : putRes.status,
      `GitHub API error (${putRes.status}): ${sanitizeErrorMessage(errBody.message || putRes.statusText)}`
    );
  }

  const putData: any = await putRes.json();
  const commitSha = putData?.commit?.sha;
  if (!commitSha) {
    throw new WorkspaceError(502, 'GitHub API did not return a valid commit SHA');
  }

  return {
    success: true,
    path: normPath,
    commit_sha: commitSha,
    commit_message: commitMessage.trim(),
    content_sha: putData?.content?.sha || '',
  };
}

/**
 * 5. 建立或更新二進位檔案 (支援照片上傳與素材寫入，接收 Uint8Array, ArrayBuffer 或 Base64 字串)
 */
export async function createOrUpdateBinaryFile(
  env: any,
  experimentId: string,
  filePath: string,
  data: Uint8Array | ArrayBuffer | string,
  commitMessage: string,
  sessionUser?: WorkspaceSessionUser | null,
  options?: WorkspaceServiceOptions,
  fetchFn: typeof fetch = fetch
): Promise<WorkspaceWriteResult> {
  const repoInfo = await getWorkspaceRepository(env, experimentId, sessionUser);
  const normPath = validateWorkspacePath(filePath, { allowEmpty: false });

  // 1. Raw Data Sanctuary 聖域鐵律防護
  if (isRawSanctuaryPath(normPath)) {
    throw new WorkspaceError(403, 'Raw sanctuary violation: Modifications to raw/* are strictly forbidden');
  }

  // 2. Separate Report 個人報告隔離防護
  if (repoInfo.report_mode === 'separate' && normPath.startsWith('report/')) {
    if (sessionUser && sessionUser.github_id) {
      const isSelfReport =
        normPath === `report/${sessionUser.github_id}.md` ||
        normPath.startsWith(`report/${sessionUser.github_id}/`);
      if (!isSelfReport) {
        throw new WorkspaceError(
          403,
          'Separate report mode violation: Collaborators can only edit their personal report (report/<github_id>.md)'
        );
      }
    }
  }

  if (!commitMessage || typeof commitMessage !== 'string' || !commitMessage.trim()) {
    throw new WorkspaceError(400, 'Commit message is required');
  }

  // 3. 轉換二進位資料為 Base64
  let base64Content: string;
  if (typeof data === 'string') {
    if (options?.isBase64) {
      base64Content = data.replace(/\s+/g, '');
    } else {
      base64Content =
        /^[A-Za-z0-9+/=]+$/.test(data.trim()) && data.trim().length % 4 === 0
          ? data.trim()
          : stringToBase64(data);
    }
  } else if (data instanceof Uint8Array) {
    base64Content = uint8ArrayToBase64(data);
  } else if (data instanceof ArrayBuffer) {
    base64Content = uint8ArrayToBase64(new Uint8Array(data));
  } else {
    throw new WorkspaceError(
      400,
      'Invalid binary data format: must be Uint8Array, ArrayBuffer, or base64 string'
    );
  }

  const token = await obtainInstallationToken(env, fetchFn);
  const encodedPath = encodeRepoPathForUrl(normPath);
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Lab-Workspace-System/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // 4. 取得目前檔案 SHA (若 options.sha 未指定)
  let targetSha = options?.sha;
  if (!targetSha) {
    const checkRes = await safeFetch(fetchFn, url, { method: 'GET', headers });
    if (checkRes.ok) {
      const checkData: any = await checkRes.json();
      if (checkData?.sha) {
        targetSha = checkData.sha;
      }
    } else if (checkRes.status !== 404) {
      const errBody = await checkRes.json().catch(() => ({ message: checkRes.statusText }));
      throw new WorkspaceError(
        checkRes.status >= 500 ? 502 : checkRes.status,
        `Failed to check existing file state: ${sanitizeErrorMessage(errBody.message || checkRes.statusText)}`
      );
    }
  }

  const payload: any = {
    message: commitMessage.trim(),
    content: base64Content,
  };
  if (targetSha) {
    payload.sha = targetSha;
  }

  const putRes = await safeFetch(fetchFn, url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({ message: putRes.statusText }));
    if (putRes.status === 409) {
      throw new WorkspaceError(409, 'Conflict: SHA mismatch or parallel modification detected');
    }
    if (putRes.status === 401 || putRes.status === 403) {
      throw new WorkspaceError(502, `GitHub App authentication or permission error: ${sanitizeErrorMessage(errBody.message || putRes.statusText)}`);
    }
    throw new WorkspaceError(
      putRes.status >= 500 ? 502 : putRes.status,
      `GitHub API error (${putRes.status}): ${sanitizeErrorMessage(errBody.message || putRes.statusText)}`
    );
  }

  const putData: any = await putRes.json();
  const commitSha = putData?.commit?.sha;
  if (!commitSha) {
    throw new WorkspaceError(502, 'GitHub API did not return a valid commit SHA');
  }

  return {
    success: true,
    path: normPath,
    commit_sha: commitSha,
    commit_message: commitMessage.trim(),
    content_sha: putData?.content?.sha || '',
  };
}

/**
 * 服務工廠：建立封裝好的 Workspace Service 實例
 */
export function createWorkspaceService(env: any, fetchFn: typeof fetch = fetch) {
  return {
    getWorkspaceRepository: (experimentId: string, sessionUser?: WorkspaceSessionUser | null) =>
      getWorkspaceRepository(env, experimentId, sessionUser),
    listFiles: (
      experimentId: string,
      dirPath?: string,
      sessionUser?: WorkspaceSessionUser | null
    ) => listFiles(env, experimentId, dirPath, sessionUser, fetchFn),
    readFile: (
      experimentId: string,
      filePath: string,
      sessionUser?: WorkspaceSessionUser | null
    ) => readFile(env, experimentId, filePath, sessionUser, fetchFn),
    createOrUpdateFile: (
      experimentId: string,
      filePath: string,
      content: string,
      message: string,
      sessionUser?: WorkspaceSessionUser | null,
      options?: WorkspaceServiceOptions
    ) =>
      createOrUpdateFile(
        env,
        experimentId,
        filePath,
        content,
        message,
        sessionUser,
        options,
        fetchFn
      ),
    createOrUpdateBinaryFile: (
      experimentId: string,
      filePath: string,
      data: Uint8Array | ArrayBuffer | string,
      message: string,
      sessionUser?: WorkspaceSessionUser | null,
      options?: WorkspaceServiceOptions
    ) =>
      createOrUpdateBinaryFile(
        env,
        experimentId,
        filePath,
        data,
        message,
        sessionUser,
        options,
        fetchFn
      ),
  };
}
