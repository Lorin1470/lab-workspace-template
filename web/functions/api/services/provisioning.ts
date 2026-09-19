/**
 * provisioning.ts
 * GitHub App Repository Provisioning Service
 *
 * 職責：
 * 1. 使用 Web Crypto (RS256) 與 GitHub App Private Key 簽署 JWT
 * 2. 獲取 GitHub App Installation Access Token (嚴禁洩漏至前端、D1 或 Activity Log)
 * 3. 驗證 Repository 命名規範與目標 Owner 權限範圍
 * 4. 自公開範本 Lorin1470/lab-workspace-template 初始化新實驗專案 Repository
 * 5. 提供等冪性 (Idempotency) 與故障自癒檢查 (若 Repo 已存在則驗證並標記 ready，不覆寫或刪除)
 * 6. 錯誤訊息全面過濾與去敏 (Sanitization)
 */

export type ProvisioningStatus = 'pending' | 'creating' | 'ready' | 'failed';

export interface ProvisionResult {
  success: boolean;
  status: ProvisioningStatus;
  already_existed?: boolean;
  repository?: {
    owner: string;
    name: string;
    full_name: string;
    html_url: string;
    default_branch: string;
  };
  error?: string;
}

/**
 * 錯誤訊息去敏函數：徹底抹除任何可能混入的 Token、Bearer 憑證或私鑰字串
 */
export function sanitizeErrorMessage(msg: string | unknown): string {
  if (!msg) return '';
  const text = typeof msg === 'string' ? msg : String((msg as any)?.message || msg);
  return text
    .replace(/ghs_[a-zA-Z0-9_]+/g, '[REDACTED_TOKEN]')
    .replace(/ghp_[a-zA-Z0-9_]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[REDACTED_KEY]')
    .trim();
}

/**
 * Base64 轉換為 Uint8Array (相容 Web Worker 與 Node.js)
 */
function base64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // Node.js Buffer fallback if atob not present
  const buf = Buffer.from(clean, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Uint8Array 轉換為 URL-Safe Base64 字串
 */
function base64UrlEncode(strOrBytes: string | Uint8Array): string {
  let b64: string;
  if (typeof strOrBytes === 'string') {
    if (typeof btoa === 'function') {
      b64 = btoa(unescape(encodeURIComponent(strOrBytes)));
    } else {
      b64 = Buffer.from(strOrBytes, 'utf8').toString('base64');
    }
  } else {
    if (typeof btoa === 'function') {
      let binary = '';
      const len = strOrBytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(strOrBytes[i]);
      }
      b64 = btoa(binary);
    } else {
      b64 = Buffer.from(strOrBytes.buffer, strOrBytes.byteOffset, strOrBytes.byteLength).toString('base64');
    }
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeDerLength(len: number): Uint8Array {
  if (len < 128) return new Uint8Array([len]);
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * 將 PKCS#1 RSA Private Key 轉換為 PKCS#8 DER 格式 (Web Crypto 規範)
 */
function pkcs1ToPkcs8(pkcs1Der: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const octetLen = encodeDerLength(pkcs1Der.length);
  const octetString = concatUint8Arrays(new Uint8Array([0x04]), octetLen, pkcs1Der);

  const body = concatUint8Arrays(version, algorithmIdentifier, octetString);
  const bodyLen = encodeDerLength(body.length);
  return concatUint8Arrays(new Uint8Array([0x30]), bodyLen, body);
}

/**
 * 匯入 RSA Private Key (支援 PKCS#1 與 PKCS#8 PEM 格式)
 */
export async function importRsaPrivateKey(pemString: string): Promise<CryptoKey> {
  const cleanPem = pemString.trim();
  const isPkcs1 = cleanPem.includes('BEGIN RSA PRIVATE KEY');
  const b64 = cleanPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const rawDer = base64ToUint8Array(b64);
  const pkcs8Der = isPkcs1 ? pkcs1ToPkcs8(rawDer) : rawDer;

  const subtleCrypto = crypto.subtle || (globalThis as any).crypto?.webcrypto?.subtle;
  if (!subtleCrypto) {
    throw new Error('Web Crypto subtle is not available in current runtime environment');
  }

  return await subtleCrypto.importKey(
    'pkcs8',
    pkcs8Der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * 產生 GitHub App 專用之 RS256 JWT
 */
export async function createGitHubAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - 60, // 允許 60 秒時鐘誤差
    exp: now + 10 * 60, // GitHub 規範最大效期 10 分鐘
    iss: appId,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const key = await importRsaPrivateKey(privateKeyPem);
  const encoder = new TextEncoder();
  const subtleCrypto = crypto.subtle || (globalThis as any).crypto?.webcrypto?.subtle;
  const sigBuffer = await subtleCrypto.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(dataToSign));
  const encodedSig = base64UrlEncode(new Uint8Array(sigBuffer));

  return `${dataToSign}.${encodedSig}`;
}

/**
 * 交換 GitHub App Installation Access Token
 */
export async function getInstallationToken(
  env: any,
  fetchFn: typeof fetch = fetch
): Promise<{ token: string; expires_at: string; target_owner?: string }> {
  const appId = String(env.GITHUB_APP_ID || '').trim();
  const installationId = String(env.GITHUB_APP_INSTALLATION_ID || '').trim();
  const privateKey = String(env.GITHUB_APP_PRIVATE_KEY || '').trim();

  if (!appId || !installationId || !privateKey) {
    throw new Error(
      'GitHub App configuration incomplete: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, or GITHUB_APP_PRIVATE_KEY missing'
    );
  }

  const jwt = await createGitHubAppJwt(appId, privateKey);

  // 取得或推導目標 Owner
  let targetOwner = env.GITHUB_APP_TARGET_OWNER ? String(env.GITHUB_APP_TARGET_OWNER).trim() : undefined;
  if (!targetOwner) {
    try {
      const instRes = await fetchFn(`https://api.github.com/app/installations/${installationId}`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Lab-Workspace-System/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (instRes.ok) {
        const instData: any = await instRes.json();
        if (instData?.account?.login) {
          targetOwner = instData.account.login;
        }
      }
    } catch (_err) {
      // 若查詢 installation 失敗，由後續權限或配置驗證處理
    }
  }

  const tokenRes = await fetchFn(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Lab-Workspace-System/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({}),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({ message: tokenRes.statusText }));
    let errMsg = '';
    if (tokenRes.status === 401) {
      errMsg = 'GitHub App authentication failed (HTTP 401)';
    } else if (tokenRes.status === 403) {
      errMsg = 'GitHub App installation access forbidden (HTTP 403)';
    } else if (tokenRes.status === 404) {
      errMsg = 'GitHub App installation not found (HTTP 404)';
    } else if (tokenRes.status === 429) {
      errMsg = 'GitHub API rate limit exceeded (HTTP 429)';
    } else if (tokenRes.status >= 500) {
      errMsg = `GitHub API server error (HTTP ${tokenRes.status})`;
    } else {
      errMsg = err.message || tokenRes.statusText;
    }
    throw new Error(`Failed to obtain GitHub App installation token: ${sanitizeErrorMessage(errMsg)}`);
  }

  const tokenData: any = await tokenRes.json();
  return {
    token: tokenData.token,
    expires_at: tokenData.expires_at,
    target_owner: targetOwner,
  };
}

/**
 * 執行 Repository 建立與範本初始化核心服務
 */
export async function provisionRepository(
  env: any,
  repository: string,
  description?: string,
  fetchFn: typeof fetch = fetch
): Promise<ProvisionResult> {
  // 1. 嚴格驗證 repository 格式 (owner/name)
  const match = repository.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (!match) {
    return {
      success: false,
      status: 'failed',
      error: 'Invalid repository format: must be owner/name',
    };
  }
  const [_, owner, repoName] = match;

  // 2. 獲取安裝 Token 與目標權限帳號
  let token: string;
  let targetOwner: string | undefined;
  try {
    const tokenInfo = await getInstallationToken(env, fetchFn);
    token = tokenInfo.token;
    targetOwner = tokenInfo.target_owner;
  } catch (err: any) {
    return {
      success: false,
      status: 'failed',
      error: sanitizeErrorMessage(err?.message || 'Failed to authenticate with GitHub App'),
    };
  }

  // 3. 驗證 Repository Owner 是否屬於該 GitHub App Installation 授權目標
  if (targetOwner && owner.toLowerCase() !== targetOwner.toLowerCase()) {
    return {
      success: false,
      status: 'failed',
      error: `Repository owner '${owner}' is not authorized for this GitHub App installation. Authorized target owner is '${targetOwner}'.`,
    };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Lab-Workspace-System/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 4. 等冪性與自癒檢查：若目標 Repository 已在 GitHub 存在，直接驗證並回傳 ready (絕不覆寫或刪除)
  try {
    const checkRes = await fetchFn(`https://api.github.com/repos/${owner}/${repoName}`, { headers });
    if (checkRes.ok) {
      const repoData: any = await checkRes.json();
      return {
        success: true,
        status: 'ready',
        already_existed: true,
        repository: {
          owner: repoData.owner?.login || owner,
          name: repoData.name || repoName,
          full_name: repoData.full_name || `${owner}/${repoName}`,
          html_url: repoData.html_url || `https://github.com/${owner}/${repoName}`,
          default_branch: repoData.default_branch || 'main',
        },
      };
    }
  } catch (_checkErr) {
    // 網路暫態錯誤將交由下一步建立嘗試
  }

  // 5. 從公開 Template Repository 建立新專案
  const templateRepo = env.GITHUB_TEMPLATE_REPO || 'Lorin1470/lab-workspace-template';
  let genRes: Response;
  try {
    genRes = await fetchFn(`https://api.github.com/repos/${templateRepo}/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        owner,
        name: repoName,
        description: description || `Lab workspace for ${owner}/${repoName}`,
        private: true,
        include_all_branches: false,
      }),
    });
  } catch (netErr: any) {
    return {
      success: false,
      status: 'failed',
      error: sanitizeErrorMessage(`Network error calling GitHub API: ${netErr?.message || netErr}`),
    };
  }

  if (!genRes.ok) {
    const err = await genRes.json().catch(() => ({ message: genRes.statusText }));
    let statusMsg = '';
    if (genRes.status === 401) {
      statusMsg = 'GitHub API authentication failed (HTTP 401)';
    } else if (genRes.status === 403) {
      statusMsg = 'GitHub API access forbidden (HTTP 403)';
    } else if (genRes.status === 404) {
      statusMsg = 'Template repository not found (HTTP 404)';
    } else if (genRes.status === 429) {
      statusMsg = 'GitHub API rate limit exceeded (HTTP 429)';
    } else if (genRes.status >= 500) {
      statusMsg = `GitHub API server error (HTTP ${genRes.status})`;
    } else {
      statusMsg = err.message || `Failed to create repository from template (HTTP ${genRes.status})`;
    }

    return {
      success: false,
      status: 'failed',
      error: sanitizeErrorMessage(statusMsg),
    };
  }

  const genData: any = await genRes.json();

  // 6. 驗證建立結果
  let verifyData: any = genData;
  try {
    const verifyRes = await fetchFn(`https://api.github.com/repos/${owner}/${repoName}`, { headers });
    if (verifyRes.ok) {
      verifyData = await verifyRes.json();
    }
  } catch (_verErr) {
    // 若立即查詢因 GitHub 內部同步微延遲未果，採用建立時回傳之資料
  }

  return {
    success: true,
    status: 'ready',
    already_existed: false,
    repository: {
      owner: verifyData.owner?.login || owner,
      name: verifyData.name || repoName,
      full_name: verifyData.full_name || `${owner}/${repoName}`,
      html_url: verifyData.html_url || `https://github.com/${owner}/${repoName}`,
      default_branch: verifyData.default_branch || 'main',
    },
  };
}
