/**
 * Cloudflare Pages Functions API Router
 * 處理活動紀錄 (D1) 存取、身分驗證與真實性規則檢驗
 */

interface Env {
  DB?: any;
  ACTIVITY_LOG_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

// 雜湊 Session Token (SHA-256)
async function hashSessionToken(token: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 解析 Cookie 標頭
function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [key, ...vals] = part.trim().split('=');
    if (key) {
      cookies[key.trim()] = vals.join('=').trim();
    }
  }
  return cookies;
}

// 依據 Cookie 驗證並取得 Session 使用者
async function getSessionUser(request: Request, env: Env): Promise<{
  session_id: string;
  github_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  expires_at: string;
} | null> {
  if (!env.DB) return null;
  const cookies = parseCookies(request.headers.get('Cookie'));
  const rawToken = cookies['app_session'];
  if (!rawToken || typeof rawToken !== 'string' || rawToken.trim() === '') {
    return null;
  }
  const hashedId = await hashSessionToken(rawToken.trim());
  const row: any = await env.DB.prepare(
    'SELECT session_id, github_id, username, display_name, avatar_url, expires_at FROM user_sessions WHERE session_id = ?'
  ).bind(hashedId).first();

  if (!row) return null;

  // 檢查是否過期
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM user_sessions WHERE session_id = ?').bind(hashedId).run().catch(() => {});
    return null;
  }

  return row;
}

/**
 * 權限檢查擴充點 (Extension Point)
 * 權限模型：GitHub Identity -> D1 Membership -> config.yml consistency -> GitHub Repo Permission
 */
export async function checkExperimentPermission(
  user: { username: string; github_id: string } | null,
  repo: string,
  expId?: string
): Promise<{ allowed: boolean; role: 'student' | 'teacher' | 'guest'; reason?: string }> {
  if (!user) {
    return { allowed: false, role: 'guest', reason: 'Unauthenticated' };
  }
  // 本階段預留 Extension Point，預設允許通過身分驗證者操作
  return { allowed: true, role: 'student' };
}

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');

  const origin = request.headers.get('Origin') || '*';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    // 1. 活動紀錄 API (D1 整合與真實性檢驗)
    if (path === 'activity' || path.startsWith('activity/')) {
      // 嚴格拒絕非 GET/POST/OPTIONS 的操作 (append-only 設計，無 UPDATE/DELETE)
      if (request.method !== 'GET' && request.method !== 'POST') {
        return new Response(
          JSON.stringify({ error: 'Method not allowed: activity_logs is append-only' }),
          {
            status: 405,
            headers: {
              ...headers,
              Allow: 'GET, POST, OPTIONS',
            },
          }
        );
      }

      // 1.1 查詢活動紀錄 (GET)
      if (request.method === 'GET') {
        const repo = url.searchParams.get('repo');
        if (!repo) {
          return new Response(
            JSON.stringify({ error: 'Missing required query parameter: repo' }),
            { status: 400, headers }
          );
        }

        const exp = url.searchParams.get('exp');
        let limit = parseInt(url.searchParams.get('limit') || '50', 10);
        if (isNaN(limit) || limit < 1) limit = 50;
        if (limit > 100) limit = 100; // 合理上限限制為 100 筆

        if (env.DB) {
          let sql = 'SELECT * FROM activity_logs WHERE repo_name = ?';
          const binds: any[] = [repo];
          if (exp) {
            sql += ' AND experiment_id = ?';
            binds.push(exp);
          }
          sql += ' ORDER BY timestamp DESC LIMIT ?';
          binds.push(limit);

          const { results } = await env.DB.prepare(sql).bind(...binds).all();
          return new Response(JSON.stringify({ success: true, logs: results || [] }), { headers });
        }

        // 若 D1 尚未綁定，回傳示範演練紀錄 (Mock 降級模式)
        return new Response(
          JSON.stringify({
            success: true,
            mode: 'mock',
            logs: [
              {
                id: 'log-1',
                repo_name: repo,
                experiment_id: exp || 'lab-01',
                timestamp: new Date(Date.now() - 3600000).toISOString(),
                actor_type: 'user',
                actor_id: 'sample-user',
                actor_name: '示範學生',
                approval_status: 'none',
                action: 'request_proposal',
                target: 'report/report.md',
                summary: '上傳示波器量測原始數據 measurements.csv 並提議更新報告',
                files_changed: null,
                commit_sha: null,
              },
              {
                id: 'log-2',
                repo_name: repo,
                experiment_id: exp || 'lab-01',
                timestamp: new Date(Date.now() - 1800000).toISOString(),
                actor_type: 'agent',
                actor_id: 'agent:antigravity',
                actor_name: 'AI Agent',
                requested_by: 'sample-user',
                approved_by: 'sample-user',
                approval_status: 'approved',
                action: 'commit_created',
                target: 'report/report.md',
                summary: '清洗數據並繪製二極體特性曲線圖至 analysis/curve.svg',
                files_changed: JSON.stringify(['report/report.md', 'analysis/curve.svg']),
                commit_sha: 'a83f91c',
              },
            ].slice(0, limit),
          }),
          { headers }
        );
      }

      // 1.2 新增活動紀錄 (POST)
      if (request.method === 'POST') {
        // A. 驗證身分 (支援 Bearer Token CLI 與 Session Cookie Web 雙軌)
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const expectedSecret =
          env.ACTIVITY_LOG_SECRET ||
          (typeof process !== 'undefined' && process.env ? process.env.ACTIVITY_LOG_SECRET : undefined);

        const isBearerAuth = !!(expectedSecret && token && token === expectedSecret);
        let sessionUser: any = null;

        if (!isBearerAuth) {
          sessionUser = await getSessionUser(request, env);
        }

        if (!isBearerAuth && !sessionUser) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized: Invalid or missing Bearer token or session' }),
            { status: 401, headers }
          );
        }

        // B. 解析與結構檢查
        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Request body must be a JSON object' }), {
            status: 400,
            headers,
          });
        }

        // 若使用 Web Session 鑑權，強制以伺服器端 Session 身分鎖定操作者身分 (Anti-Spoofing)
        // 注意：登入身分 (Authentication) 僅代表「誰登入發起請求」，不等於該操作「已獲得批准 (Approval)」。
        // requested_by 反映發起者，而 approved_by 與 approval_status 仍維持既有 Activity Log v1.1/v1.2
        // 的 approval input 語義（例如分步審批 file modification、commit、push），
        // 登入本身不代表自動授予或取代任何審查批准權限。
        if (sessionUser) {
          body.actor_type = 'web';
          body.actor_id = sessionUser.username;
          body.actor_name = sessionUser.display_name || sessionUser.username;
          body.actor_avatar = sessionUser.avatar_url || null;
          body.requested_by = sessionUser.username;
          // approved_by 保持由調用端傳入之既有宣告值或為 null，絕不因使用者登入就自動代表「已批准」
          body.approved_by = body.approved_by ? String(body.approved_by).trim() : null;
        }

        // C. 驗證必要欄位
        const requiredFields = ['repo_name', 'action', 'actor_type', 'actor_id', 'actor_name', 'summary'];
        for (const field of requiredFields) {
          if (!body[field] || typeof body[field] !== 'string' || body[field].trim() === '') {
            return new Response(
              JSON.stringify({ error: `Missing or invalid required field: ${field}` }),
              { status: 400, headers }
            );
          }
        }

        // D. 驗證 actor_type (本階段只允許 user, agent, web，不允許 system)
        const allowedActorTypes = ['user', 'agent', 'web'];
        if (!allowedActorTypes.includes(body.actor_type)) {
          return new Response(
            JSON.stringify({ error: 'Invalid actor_type: must be user, agent, or web' }),
            { status: 400, headers }
          );
        }

        // E. 驗證 approval_status (pending, approved, rejected, none)
        const allowedApprovalStatuses = ['pending', 'approved', 'rejected', 'none'];
        const approvalStatus = body.approval_status || 'none';
        if (!allowedApprovalStatuses.includes(approvalStatus)) {
          return new Response(
            JSON.stringify({ error: 'Invalid approval_status: must be pending, approved, rejected, or none' }),
            { status: 400, headers }
          );
        }

        // F. 驗證 action 與 commit_sha 的真偽關聯 (Rule 9)
        // 1. 非 commit_created / push_completed 時，commit_sha 必須為 NULL
        const allowedCommitActions = ['commit_created', 'push_completed'];
        if (!allowedCommitActions.includes(body.action) && body.commit_sha) {
          return new Response(
            JSON.stringify({ error: 'commit_sha is only allowed for commit_created or push_completed' }),
            { status: 400, headers }
          );
        }

        // 2. 當 action 為 commit_created 或 push_completed 時，commit_sha 必須存在且為非空字串
        if (allowedCommitActions.includes(body.action)) {
          if (!body.commit_sha || typeof body.commit_sha !== 'string' || body.commit_sha.trim() === '') {
            return new Response(
              JSON.stringify({ error: 'commit_sha is required when action is commit_created or push_completed' }),
              { status: 400, headers }
            );
          }
        }

        // G. 驗證 request_rejected 安全規則 (Rule 10)
        // 當 request_rejected 時：
        // 1. approval_status 必須為 rejected
        // 2. files_changed 必須為空
        // 3. commit_sha 必須為 NULL
        if (body.action === 'request_rejected') {
          if (approvalStatus !== 'rejected') {
            return new Response(
              JSON.stringify({ error: 'approval_status must be rejected when action is request_rejected' }),
              { status: 400, headers }
            );
          }
          if (body.commit_sha) {
            return new Response(
              JSON.stringify({ error: 'commit_sha must be null when action is request_rejected' }),
              { status: 400, headers }
            );
          }
          let hasFiles = false;
          if (Array.isArray(body.files_changed)) {
            hasFiles = body.files_changed.length > 0;
          } else if (typeof body.files_changed === 'string') {
            const trimmed = body.files_changed.trim();
            hasFiles = trimmed !== '' && trimmed !== '[]';
          }
          if (hasFiles) {
            return new Response(
              JSON.stringify({ error: 'files_changed must be empty when action is request_rejected' }),
              { status: 400, headers }
            );
          }
        }

        // H. 格式化處理
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const commitSha = allowedCommitActions.includes(body.action) ? (body.commit_sha || null) : null;
        let filesChangedStr: string | null = null;
        if (body.files_changed) {
          if (Array.isArray(body.files_changed)) {
            filesChangedStr = JSON.stringify(body.files_changed);
          } else if (typeof body.files_changed === 'string') {
            filesChangedStr = body.files_changed;
          }
        }
        let detailsJsonStr: string | null = null;
        if (body.details_json) {
          detailsJsonStr =
            typeof body.details_json === 'object'
              ? JSON.stringify(body.details_json)
              : String(body.details_json);
        }

        // I. 寫入 D1 (Append-Only)
        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO activity_logs (
              id, repo_name, experiment_id, timestamp,
              actor_type, actor_id, actor_name, actor_avatar,
              requested_by, approved_by, approval_status,
              action, target, summary, files_changed,
              commit_sha, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            id,
            body.repo_name.trim(),
            body.experiment_id ? body.experiment_id.trim() : 'lab-01',
            now,
            body.actor_type,
            body.actor_id.trim(),
            body.actor_name.trim(),
            body.actor_avatar || null,
            body.requested_by || null,
            body.approved_by || null,
            approvalStatus,
            body.action.trim(),
            body.target || null,
            body.summary.trim(),
            filesChangedStr,
            commitSha,
            detailsJsonStr
          ).run();
        }

        return new Response(
          JSON.stringify({ success: true, id, timestamp: now }),
          { status: 201, headers }
        );
      }
    }

    // 2. 系統狀態與環境檢查
    if (path === 'status') {
      let d1Connected = false;
      let hasActivityTable = false;

      if (env.DB) {
        try {
          const ping = await env.DB.prepare('SELECT 1 as ping').first();
          if (ping && ping.ping === 1) {
            d1Connected = true;
          }
          const table = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='activity_logs'"
          ).first();
          if (table && table.name === 'activity_logs') {
            hasActivityTable = true;
          }
        } catch {
          // 容錯降級，保持健康檢查回應
        }
      }

      return new Response(
        JSON.stringify({
          status: 'online',
          service: 'lab-workspace-web',
          hasD1: !!env.DB,
          d1Connected,
          hasActivityTable,
          hasActivitySecret: !!(
            env.ACTIVITY_LOG_SECRET ||
            (typeof process !== 'undefined' && process.env ? process.env.ACTIVITY_LOG_SECRET : undefined)
          ),
          hasGithubAuth: !!env.GITHUB_CLIENT_ID,
        }),
        { headers }
      );
    }

    // 3. GitHub OAuth 與 Session API
    if (path === 'auth/login') {
      if (!env.GITHUB_CLIENT_ID) {
        return new Response(
          JSON.stringify({ error: 'GitHub OAuth is not configured (missing GITHUB_CLIENT_ID)' }),
          { status: 500, headers }
        );
      }
      const rawReturnTo = url.searchParams.get('return_to') || '/';
      // Open Redirect 防禦：只允許以 / 開頭且非 // 的站內相對路徑
      const returnTo = (rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') && !rawReturnTo.includes(':'))
        ? rawReturnTo
        : '/';

      const state = crypto.randomUUID();
      const stateCookieValue = `${state}:${encodeURIComponent(returnTo)}`;
      const callbackUrl = `${url.origin}/api/auth/callback`;

      const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
      githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      githubAuthUrl.searchParams.set('redirect_uri', callbackUrl);
      githubAuthUrl.searchParams.set('scope', 'read:user');
      githubAuthUrl.searchParams.set('state', state);

      const responseHeaders = new Headers();
      responseHeaders.set('Location', githubAuthUrl.toString());
      responseHeaders.append(
        'Set-Cookie',
        `oauth_state=${encodeURIComponent(stateCookieValue)}; Path=/api/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax`
      );

      return new Response(null, { status: 302, headers: responseHeaders });
    }

    if (path === 'auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      const cookies = parseCookies(request.headers.get('Cookie'));
      const rawCookieState = cookies['oauth_state'];

      if (!code || !state || !rawCookieState) {
        return new Response(
          JSON.stringify({ error: 'Invalid or missing OAuth state or code' }),
          { status: 400, headers }
        );
      }

      let decodedState = '';
      let returnTo = '/';
      try {
        const parts = decodeURIComponent(rawCookieState).split(':');
        decodedState = parts[0];
        if (parts[1]) returnTo = decodeURIComponent(parts[1]);
      } catch {
        return new Response(
          JSON.stringify({ error: 'Malformed oauth_state cookie' }),
          { status: 400, headers }
        );
      }

      if (state !== decodedState) {
        return new Response(
          JSON.stringify({ error: 'OAuth state mismatch (possible CSRF)' }),
          { status: 403, headers }
        );
      }

      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        return new Response(
          JSON.stringify({ error: 'GitHub OAuth server configuration error' }),
          { status: 500, headers }
        );
      }

      // 交換 Access Token
      const callbackUrl = `${url.origin}/api/auth/callback`;
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'lab-workspace-web',
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: callbackUrl,
        }),
      });

      const tokenData: any = await tokenRes.json().catch(() => ({}));
      if (!tokenData || !tokenData.access_token) {
        return new Response(
          JSON.stringify({
            error: 'Failed to obtain access token from GitHub',
            detail: tokenData.error_description || tokenData.error,
          }),
          { status: 502, headers }
        );
      }

      // 使用 Token 讀取 GitHub 使用者資訊
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'lab-workspace-web',
        },
      });

      if (!userRes.ok) {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch user profile from GitHub' }),
          { status: 502, headers }
        );
      }

      const userData: any = await userRes.json();
      const githubId = String(userData.id);
      const username = String(userData.login);
      const displayName = userData.name ? String(userData.name) : username;
      const avatarUrl = userData.avatar_url ? String(userData.avatar_url) : null;

      // 建立 Opaque Session Token (不儲存 Access Token)
      const rawSessionToken = crypto.randomUUID() + '.' + crypto.randomUUID();
      const hashedSessionId = await hashSessionToken(rawSessionToken);
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 天有效期

      if (env.DB) {
        await env.DB.prepare(
          `INSERT INTO user_sessions (session_id, github_id, username, display_name, avatar_url, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(hashedSessionId, githubId, username, displayName, avatarUrl, now, expiresAt).run();
      }

      const responseHeaders = new Headers();
      responseHeaders.set('Location', returnTo);
      // 清除 oauth_state
      responseHeaders.append(
        'Set-Cookie',
        'oauth_state=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
      );
      // 寫入 app_session Cookie (7 天)
      responseHeaders.append(
        'Set-Cookie',
        `app_session=${rawSessionToken}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`
      );

      return new Response(null, { status: 302, headers: responseHeaders });
    }

    if (path === 'auth/me') {
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(
          JSON.stringify({ authenticated: false, user: null }),
          { headers }
        );
      }
      return new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            github_id: sessionUser.github_id,
            username: sessionUser.username,
            display_name: sessionUser.display_name,
            avatar_url: sessionUser.avatar_url,
          },
        }),
        { headers }
      );
    }

    if (path === 'auth/logout') {
      const cookies = parseCookies(request.headers.get('Cookie'));
      const rawToken = cookies['app_session'];
      if (rawToken && env.DB) {
        const hashedId = await hashSessionToken(rawToken.trim());
        await env.DB.prepare('DELETE FROM user_sessions WHERE session_id = ?').bind(hashedId).run().catch(() => {});
      }

      const responseHeaders = new Headers(headers);
      responseHeaders.append(
        'Set-Cookie',
        'app_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
      );

      return new Response(JSON.stringify({ success: true }), { headers: responseHeaders });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found', path }), { status: 404, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
