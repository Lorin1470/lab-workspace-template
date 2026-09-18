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

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
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
        // A. 驗證 Bearer Token
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const expectedSecret =
          env.ACTIVITY_LOG_SECRET ||
          (typeof process !== 'undefined' && process.env ? process.env.ACTIVITY_LOG_SECRET : undefined);

        if (!expectedSecret || !token || token !== expectedSecret) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized: Invalid or missing Bearer token' }),
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
      return new Response(
        JSON.stringify({
          status: 'online',
          service: 'lab-workspace-web',
          hasD1: !!env.DB,
          hasActivitySecret: !!(
            env.ACTIVITY_LOG_SECRET ||
            (typeof process !== 'undefined' && process.env ? process.env.ACTIVITY_LOG_SECRET : undefined)
          ),
          hasGithubAuth: !!env.GITHUB_CLIENT_ID,
        }),
        { headers }
      );
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found', path }), { status: 404, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
