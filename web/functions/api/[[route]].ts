/**
 * Cloudflare Pages Functions API Router
 * 處理 GitHub API 轉發、活動紀錄 (D1) 存取與身份驗證
 */

interface Env {
  DB?: any;
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
    // 1. 活動紀錄 API (D1 整合)
    if (path.startsWith('activity')) {
      if (request.method === 'GET') {
        const repo = url.searchParams.get('repo');
        if (env.DB && repo) {
          const { results } = await env.DB.prepare(
            'SELECT * FROM activity_logs WHERE repo_name = ? ORDER BY timestamp DESC LIMIT 50'
          ).bind(repo).all();
          return new Response(JSON.stringify({ success: true, logs: results }), { headers });
        }
        
        // 若 D1 尚未綁定，回傳示範演練紀錄
        return new Response(JSON.stringify({
          success: true,
          mode: 'mock',
          logs: [
            {
              id: 'log-1',
              repo_name: repo || 'demo/electronics-lab-01',
              experiment_id: 'lab-01',
              timestamp: new Date(Date.now() - 3600000).toISOString(),
              actor_type: 'user',
              actor_id: 'sample-user',
              actor_name: '示範學生',
              action: 'upload_raw',
              summary: '上傳示波器量測原始數據 measurements.csv',
            },
            {
              id: 'log-2',
              repo_name: repo || 'demo/electronics-lab-01',
              experiment_id: 'lab-01',
              timestamp: new Date(Date.now() - 1800000).toISOString(),
              actor_type: 'agent',
              actor_id: 'agent:antigravity',
              actor_name: 'AI Agent',
              requested_by: 'sample-user',
              approved_by: 'sample-user',
              action: 'generate_curve',
              summary: '清洗數據並繪製二極體特性曲線圖至 analysis/curve.svg',
              commit_sha: 'a83f91c'
            }
          ]
        }), { headers });
      }

      if (request.method === 'POST') {
        const body = await request.json() as any;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO activity_logs (id, repo_name, experiment_id, timestamp, actor_type, actor_id, actor_name, actor_avatar, requested_by, approved_by, action, summary, commit_sha, details_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            id,
            body.repo_name,
            body.experiment_id || 'lab-01',
            now,
            body.actor_type || 'user',
            body.actor_id || 'anonymous',
            body.actor_name || '使用者',
            body.actor_avatar || null,
            body.requested_by || null,
            body.approved_by || null,
            body.action,
            body.summary,
            body.commit_sha || null,
            body.details_json || null
          ).run();
        }

        return new Response(JSON.stringify({ success: true, id }), { headers });
      }
    }

    // 2. 系統狀態與環境檢查
    if (path === 'status') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'lab-workspace-web',
        hasD1: !!env.DB,
        hasGithubAuth: !!env.GITHUB_CLIENT_ID
      }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found', path }), { status: 404, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
