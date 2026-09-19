/**
 * Cloudflare Pages Functions API Router
 * 處理活動紀錄 (D1) 存取、身分驗證與真實性規則檢驗
 */

interface Env {
  DB?: any;
  ACTIVITY_LOG_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  INITIAL_ADMIN_GITHUB_ID?: string;
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

// 安全執行 D1 查詢取第一筆 (相容 mock 與原生 D1)
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
  const stmt = env.DB.prepare(
    'SELECT session_id, github_id, username, display_name, avatar_url, expires_at FROM user_sessions WHERE session_id = ?'
  ).bind(hashedId);
  const row: any = await safeD1First(stmt);

  if (!row || !row.session_id) return null;

  // 檢查是否過期
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM user_sessions WHERE session_id = ?').bind(hashedId).run().catch(() => {});
    return null;
  }

  return row;
}

// 檢查使用者是否為該課程之合法 active Teacher
export async function isCourseTeacher(env: Env, courseId: string, githubId: string): Promise<boolean> {
  if (!env.DB || !courseId || !githubId) return false;
  const stmt = env.DB.prepare(
    'SELECT id, role, status FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"'
  ).bind(courseId, githubId);
  const mem: any = await safeD1First(stmt);
  if (mem && mem.role === 'teacher') return true;

  // Bootstrap Admin fallback (僅限全系統 0 active Teacher 時)
  if (env.INITIAL_ADMIN_GITHUB_ID && githubId === env.INITIAL_ADMIN_GITHUB_ID) {
    const tcRow: any = await safeD1First(env.DB.prepare('SELECT COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"'));
    if (tcRow && tcRow.count === 0) return true;
  }
  return false;
}

// 檢查使用者是否具備建立新課程權限 (既有 Teacher 或全系統 0 active Teacher 時之 Bootstrap Admin)
export async function canUserCreateCourse(env: Env, githubId: string): Promise<boolean> {
  if (!env.DB || !githubId) return false;
  const stmt = env.DB.prepare(
    'SELECT id FROM course_memberships WHERE github_id = ? AND role = "teacher" AND status = "active" LIMIT 1'
  ).bind(githubId);
  const existingTeacher: any = await safeD1First(stmt);
  if (existingTeacher) return true;

  if (env.INITIAL_ADMIN_GITHUB_ID && githubId === env.INITIAL_ADMIN_GITHUB_ID) {
    const tcRow: any = await safeD1First(env.DB.prepare('SELECT COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"'));
    if (tcRow && tcRow.count === 0) return true;
  }
  return false;
}

// 1. 安全路徑正規化 (Repository-relative path normalization)
export function normalizeRepoPath(rawPath: string | null | undefined): string {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    decoded = rawPath;
  }
  const cleaned = decoded.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = cleaned.split('/');
  const safeParts: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      safeParts.pop();
    } else {
      safeParts.push(part);
    }
  }
  return safeParts.join('/');
}

// 2. 檢查是否屬於 raw/ 聖域 (Immutable Raw Sanctuary)
export function isRawSanctuaryPath(normalizedPath: string): boolean {
  if (!normalizedPath) return false;
  return normalizedPath === 'raw' || normalizedPath.startsWith('raw/');
}

export interface PermissionResult {
  allowed: boolean;
  role: 'teacher' | 'assistant' | 'student' | 'guest';
  reason?: string;
  course?: any;
  experiment?: any;
  report_mode?: 'shared' | 'separate';
}

/**
 * 伺服器端核心權限解析器 (Reusable Server-side Permission Resolver)
 * 權限模型：GitHub Identity (github_id) -> D1 Membership (Course/Experiment) -> Guardrails
 */
export async function resolveExperimentPermission(
  env: Env,
  user: { github_id: string; username: string } | null,
  context: {
    repo_name?: string;
    course_id?: string;
    experiment_code?: string;
  },
  action?: string,
  targetPath?: string | null,
  filesChanged?: (string | null)[] | null
): Promise<PermissionResult> {
  // A. 身分驗證 (Authentication Check)
  if (!user || !user.github_id) {
    return { allowed: false, role: 'guest', reason: 'Unauthenticated: Valid session required' };
  }

  if (!env.DB) {
    return { allowed: false, role: 'guest', reason: 'Database unavailable' };
  }

  // B. 查詢實驗與課程實體 (Experiment & Course Context)
  let exp: any = null;
  let course: any = null;

  if (context.repo_name) {
    const stmt = env.DB.prepare(
      'SELECT id, course_id, experiment_code, name, repository, report_mode, config_version, status FROM experiments WHERE repository = ?'
    ).bind(context.repo_name);
    exp = await safeD1First(stmt);
    if (exp && exp.repository !== context.repo_name) {
      exp = null;
    }
  } else if (context.course_id && context.experiment_code) {
    const stmt = env.DB.prepare(
      'SELECT id, course_id, experiment_code, name, repository, report_mode, config_version, status FROM experiments WHERE course_id = ? AND experiment_code = ?'
    ).bind(context.course_id, context.experiment_code);
    exp = await safeD1First(stmt);
  }

  if (context.repo_name && !exp) {
    return { allowed: false, role: 'guest', reason: 'Experiment repository not found in system' };
  }

  if (exp) {
    const stmt = env.DB.prepare(
      'SELECT id, course_code, name, semester, status, created_by_github_id FROM courses WHERE id = ?'
    ).bind(exp.course_id);
    course = await safeD1First(stmt);
  } else if (context.course_id) {
    const stmt = env.DB.prepare(
      'SELECT id, course_code, name, semester, status, created_by_github_id FROM courses WHERE id = ?'
    ).bind(context.course_id);
    course = await safeD1First(stmt);
  }

  // C. 成員角色解析 (Hierarchical Membership Resolution)
  let resolvedRole: 'teacher' | 'assistant' | 'student' | 'guest' = 'guest';

  // 1. 若為具體實驗，先查 experiment_memberships
  if (exp) {
    const stmt = env.DB.prepare(
      'SELECT role, status FROM experiment_memberships WHERE experiment_id = ? AND github_id = ? AND status = "active"'
    ).bind(exp.id, user.github_id);
    const expMember: any = await safeD1First(stmt);

    if (expMember) {
      resolvedRole = expMember.role as ('student' | 'assistant');
    }
  }

  // 2. 查 course_memberships (教師或全課助教具備課程下所有實驗存取權)
  const courseId = exp ? exp.course_id : context.course_id;
  if (courseId) {
    const stmt = env.DB.prepare(
      'SELECT role, status FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"'
    ).bind(courseId, user.github_id);
    const courseMember: any = await safeD1First(stmt);

    if (courseMember) {
      if (courseMember.role === 'teacher') {
        resolvedRole = 'teacher';
      } else if (courseMember.role === 'assistant' && resolvedRole !== 'teacher') {
        resolvedRole = 'assistant';
      } else if (courseMember.role === 'student' && resolvedRole === 'guest') {
        // 重要業務規則：Course member 但尚未分組至該 Experiment，不得存取該 Experiment
        return {
          allowed: false,
          role: 'guest',
          reason: 'Access denied: Enrolled in course but not assigned to this experiment',
          course,
          experiment: exp,
        };
      }
    }
  }

  // 3. 安全 Bootstrap Admin 檢查 (只有當系統內完全沒有任何 active teacher 角色時，才允許 INITIAL_ADMIN_GITHUB_ID 提權)
  if (resolvedRole === 'guest' && env.INITIAL_ADMIN_GITHUB_ID && user.github_id === env.INITIAL_ADMIN_GITHUB_ID) {
    const stmt = env.DB.prepare(
      'SELECT COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"'
    );
    const teacherCountRow: any = await safeD1First(stmt);
    const teacherCount = teacherCountRow ? teacherCountRow.count : 0;
    if (teacherCount === 0) {
      resolvedRole = 'teacher';
    }
  }

  // 若仍為 guest，無權限存取
  if (resolvedRole === 'guest') {
    return {
      allowed: false,
      role: 'guest',
      reason: 'Forbidden: User is not an active member of this course or experiment',
      course,
      experiment: exp,
    };
  }

  const reportMode: 'shared' | 'separate' = exp?.report_mode || 'shared';

  const isWriteAction = action
    ? ['file_created', 'file_modified', 'commit_created', 'push_completed', 'request_proposal'].includes(action)
    : false;

  // 檢查 Course 狀態 (active / archived / inactive)
  if (course && course.status && course.status !== 'active') {
    if (resolvedRole === 'student') {
      if (course.status === 'inactive') {
        return {
          allowed: false,
          role: 'guest',
          reason: 'Course is inactive: Access denied for students',
          course,
          experiment: exp,
          report_mode: reportMode,
        };
      }
      if (isWriteAction) {
        return {
          allowed: false,
          role: resolvedRole,
          reason: 'Course is archived: Student write operations are prohibited',
          course,
          experiment: exp,
          report_mode: reportMode,
        };
      }
    }
  }

  // D. 業務行為與路徑合規檢查 (Guardrails)
  if (action) {
    const normTarget = normalizeRepoPath(targetPath);
    const filesList = Array.isArray(filesChanged) ? filesChanged.filter(Boolean).map(f => normalizeRepoPath(f!)) : [];

    // 鐵律 1: raw 聖域保護 (所有角色均嚴格禁止修改 raw/*)
    const touchesRaw = isRawSanctuaryPath(normTarget) || filesList.some(isRawSanctuaryPath);

    if (touchesRaw && isWriteAction) {
      return {
        allowed: false,
        role: resolvedRole,
        reason: 'Raw sanctuary violation: Modifications to raw/* are strictly forbidden for all roles',
        course,
        experiment: exp,
        report_mode: reportMode,
      };
    }

    // 鐵律 2: separate 報告模式隔離
    if (reportMode === 'separate') {
      const isReportWrite = isWriteAction && (normTarget.startsWith('report/') || filesList.some(f => f.startsWith('report/')));

      if (isReportWrite) {
        // Assistant 角色在第一版為 review/read，嚴格禁止修改學生個人報告
        if (resolvedRole === 'assistant') {
          return {
            allowed: false,
            role: resolvedRole,
            reason: 'Separate report violation: Assistant has read/review permissions only and cannot modify student separate reports',
            course,
            experiment: exp,
            report_mode: reportMode,
          };
        }

        // Student 角色嚴格只能修改自己的 report/report-<github_id>.md
        if (resolvedRole === 'student') {
          const myExpectedReport = `report/report-${user.github_id}.md`;

          if (normTarget.startsWith('report/')) {
            if (normTarget !== myExpectedReport) {
              return {
                allowed: false,
                role: resolvedRole,
                reason: `Separate report violation: Students can only modify their own report (${myExpectedReport}), attempted: ${normTarget}`,
                course,
                experiment: exp,
                report_mode: reportMode,
              };
            }
          }

          for (const file of filesList) {
            if (file.startsWith('report/') && file !== myExpectedReport) {
              return {
                allowed: false,
                role: resolvedRole,
                reason: `Separate report violation: Students cannot modify other reports (${file})`,
                course,
                experiment: exp,
                report_mode: reportMode,
              };
            }
          }
        }
        // Teacher (resolvedRole === 'teacher'): 具備管理全課程與實驗報告之權威，允許操作
      }
    }
  }

  return {
    allowed: true,
    role: resolvedRole,
    course,
    experiment: exp,
    report_mode: reportMode,
  };
}

/**
 * 權限檢查擴充點相容封裝
 */
export async function checkExperimentPermission(
  user: { username: string; github_id: string } | null,
  repo: string,
  expId?: string,
  env?: any,
  action?: string,
  target?: string,
  filesChanged?: string[]
): Promise<{ allowed: boolean; role: 'student' | 'teacher' | 'assistant' | 'guest'; reason?: string }> {
  if (!user) {
    return { allowed: false, role: 'guest', reason: 'Unauthenticated' };
  }
  if (!env || !env.DB) {
    return { allowed: true, role: 'student' };
  }
  const res = await resolveExperimentPermission(env, user, { repo_name: repo }, action, target, filesChanged);
  return { allowed: res.allowed, role: res.role, reason: res.reason };
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
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

        // 檢查該 repo 是否為系統註冊之 Experiment (如果是，則必須授權存取)
        if (env.DB) {
          const stmt = env.DB.prepare('SELECT id, repository FROM experiments WHERE repository = ?').bind(repo);
          const expRow: any = await safeD1First(stmt);
          if (expRow && expRow.repository === repo) {
            const authHeader = request.headers.get('Authorization') || '';
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
            const expectedSecret =
              env.ACTIVITY_LOG_SECRET ||
              (typeof process !== 'undefined' && process.env ? process.env.ACTIVITY_LOG_SECRET : undefined);
            const isBearer = !!(expectedSecret && token && token === expectedSecret);

            if (!isBearer) {
              const sessionUser = await getSessionUser(request, env);
              if (!sessionUser) {
                return new Response(
                  JSON.stringify({ error: 'Repository not found or access denied' }),
                  { status: 404, headers }
                );
              }
              const perm = await resolveExperimentPermission(env, sessionUser, { repo_name: repo });
              if (!perm.allowed) {
                return new Response(
                  JSON.stringify({ error: 'Repository not found or access denied' }),
                  { status: 404, headers }
                );
              }
            }
          }
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

        // 若為 Bearer Token 鑑權，依然執行 Raw 聖域防護檢驗
        if (isBearerAuth) {
          const normTarget = normalizeRepoPath(body.target);
          const filesList = Array.isArray(body.files_changed) ? body.files_changed.map((f: any) => normalizeRepoPath(f)) : [];
          const touchesRaw = isRawSanctuaryPath(normTarget) || filesList.some(isRawSanctuaryPath);
          const isWriteAction = [
            'file_created',
            'file_modified',
            'commit_created',
            'push_completed',
            'request_proposal',
          ].includes(body.action);
          if (touchesRaw && isWriteAction) {
            return new Response(
              JSON.stringify({ error: 'Raw sanctuary violation: Modifications to raw/* are strictly forbidden' }),
              { status: 403, headers }
            );
          }
        }

        // 若使用 Web Session 鑑權，強制以伺服器端 Session 身分鎖定操作者身分 (Anti-Spoofing)
        // 且嚴格透過 resolveExperimentPermission 執行權限與審核校驗
        if (sessionUser) {
          let permRole: string = 'student';

          if (env.DB && body.repo_name) {
            const stmt = env.DB.prepare('SELECT id, repository FROM experiments WHERE repository = ?').bind(body.repo_name);
            const expCheck: any = await safeD1First(stmt);
            if (expCheck && expCheck.repository === body.repo_name) {
              const perm = await resolveExperimentPermission(
                env,
                sessionUser,
                { repo_name: body.repo_name },
                body.action,
                body.target,
                body.files_changed
              );

              if (!perm.allowed) {
                return new Response(
                  JSON.stringify({ error: `Forbidden: ${perm.reason}` }),
                  { status: 403, headers }
                );
              }
              permRole = perm.role;
            }
          }

          body.actor_type = body.actor_type === 'agent' ? 'agent' : 'web';
          body.actor_id = sessionUser.username;
          body.actor_name = sessionUser.display_name || sessionUser.username;
          body.actor_avatar = sessionUser.avatar_url || null;
          body.requested_by = sessionUser.username;

          // 審批分離原則 (Approval Non-Conflation):
          // 只有 Teacher 角色可以在提交時標註核准 (approved_by)
          // 學生發起之請求一律強制 approval_status = 'pending', approved_by = null
          if (permRole === 'teacher' && body.approval_status === 'approved') {
            body.approved_by = sessionUser.username;
          } else {
            body.approved_by = null;
            if (body.approval_status === 'approved') {
              body.approval_status = 'pending';
            } else {
              body.approval_status = body.approval_status || 'none';
            }
          }
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

    // 4. 課程、實驗與成員管理 API (Course / Experiment / Membership Management)

    // 4.1 Courses 集合操作 (GET: 列表, POST: 建立)
    if (path === 'courses') {
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ success: true, courses: [] }), { headers });
      }

      if (request.method === 'GET') {
        // 查詢使用者為 active 成員的所有課程 (包含 status，學生過濾 inactive)
        const res: any = await env.DB.prepare(
          `SELECT c.id, c.course_code, c.name, c.semester, c.status, c.created_by_github_id, c.created_at, c.updated_at, cm.role
           FROM courses c
           JOIN course_memberships cm ON c.id = cm.course_id
           WHERE cm.github_id = ? AND cm.status = 'active'
             AND (cm.role IN ('teacher', 'assistant') OR c.status != 'inactive')
           ORDER BY c.semester DESC, c.course_code ASC`
        ).bind(sessionUser.github_id).all();

        let coursesList = res.results || [];

        // 若未加入任何課程，檢查是否為 Bootstrap 管理員 (系統尚無任何 active teacher 時啟用)
        if (coursesList.length === 0 && env.INITIAL_ADMIN_GITHUB_ID && sessionUser.github_id === env.INITIAL_ADMIN_GITHUB_ID) {
          const tcRow: any = await safeD1First(env.DB.prepare('SELECT COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"'));
          if (tcRow && tcRow.count === 0) {
            const allCourses: any = await env.DB.prepare('SELECT * FROM courses ORDER BY semester DESC, course_code ASC').all();
            coursesList = (allCourses.results || []).map((c: any) => ({ ...c, role: 'teacher' }));
          }
        }

        return new Response(JSON.stringify({ success: true, courses: coursesList }), { headers });
      }

      if (request.method === 'POST') {
        const canCreate = await canUserCreateCourse(env, sessionUser.github_id);
        if (!canCreate) {
          return new Response(JSON.stringify({ error: 'Forbidden: Only teachers can create courses' }), { status: 403, headers });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const course_code = String(body.course_code || '').trim();
        const name = String(body.name || '').trim();
        const semester = String(body.semester || '').trim();

        if (!course_code || !name || !semester) {
          return new Response(JSON.stringify({ error: 'course_code, name, and semester are required' }), { status: 400, headers });
        }

        // 檢查 UNIQUE(course_code, semester)
        const existing: any = await safeD1First(
          env.DB.prepare('SELECT id FROM courses WHERE course_code = ? AND semester = ?').bind(course_code, semester)
        );
        if (existing) {
          return new Response(JSON.stringify({ error: 'Conflict: Course with this course_code and semester already exists' }), { status: 409, headers });
        }

        const courseId = `c_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const memId = `cm_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const now = new Date().toISOString();

        const stmtCourse = env.DB.prepare(
          `INSERT INTO courses (id, course_code, name, semester, status, created_by_github_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(courseId, course_code, name, semester, 'active', sessionUser.github_id, now, now);

        // 建立者自動成為該課程之 Teacher (原子化批次執行，防範孤兒課程)
        const stmtMember = env.DB.prepare(
          `INSERT INTO course_memberships (id, course_id, github_id, username, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(memId, courseId, sessionUser.github_id, sessionUser.username, 'teacher', 'active', now, now);

        try {
          if (typeof env.DB.batch === 'function') {
            await env.DB.batch([stmtCourse, stmtMember]);
          } else {
            await stmtCourse.run();
            await stmtMember.run();
          }
        } catch (dbErr: any) {
          const errMsg = String(dbErr?.message || dbErr);
          if (errMsg.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ error: 'Conflict: Course with this course_code and semester already exists' }), { status: 409, headers });
          }
          throw dbErr;
        }

        const createdCourse: any = await safeD1First(env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(courseId));
        return new Response(JSON.stringify({
          success: true,
          course: { ...createdCourse, role: 'teacher' },
          membership: { id: memId, course_id: courseId, github_id: sessionUser.github_id, username: sessionUser.username, role: 'teacher', status: 'active' }
        }), { status: 201, headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.2 單一 Course 詳情與修改 (GET /api/courses/:id, PATCH /api/courses/:id)
    const courseIdMatch = path.match(/^courses\/([a-zA-Z0-9_-]+)$/);
    if (courseIdMatch) {
      const courseId = courseIdMatch[1];
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers });
      }

      const course: any = await safeD1First(env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(courseId));
      if (!course) {
        return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404, headers });
      }

      // 檢查使用者在該課程的角色
      const courseMem: any = await safeD1First(
        env.DB.prepare('SELECT role, status FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"').bind(courseId, sessionUser.github_id)
      );
      let userRole = courseMem ? courseMem.role : null;
      if (!userRole && env.INITIAL_ADMIN_GITHUB_ID && sessionUser.github_id === env.INITIAL_ADMIN_GITHUB_ID) {
        const tcRow: any = await safeD1First(env.DB.prepare('SELECT COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"'));
        if (tcRow && tcRow.count === 0) userRole = 'teacher';
      }

      if (!userRole || (course.status === 'inactive' && userRole === 'student')) {
        // 存在性遮蔽：非成員或已停用課程對學生無法窺探
        return new Response(JSON.stringify({ error: 'Course not found or access denied' }), { status: 404, headers });
      }

      if (request.method === 'GET') {
        return new Response(JSON.stringify({ success: true, course: { ...course, role: userRole } }), { status: 200, headers });
      }

      if (request.method === 'PATCH') {
        if (userRole !== 'teacher') {
          return new Response(JSON.stringify({ error: 'Forbidden: Only course teachers can update course details' }), { status: 403, headers });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const updates: string[] = [];
        const binds: any[] = [];

        if (body.name !== undefined) {
          const val = String(body.name).trim();
          if (!val) return new Response(JSON.stringify({ error: 'name cannot be empty' }), { status: 400, headers });
          updates.push('name = ?');
          binds.push(val);
        }

        if (body.semester !== undefined) {
          const val = String(body.semester).trim();
          if (!val) return new Response(JSON.stringify({ error: 'semester cannot be empty' }), { status: 400, headers });
          // 檢查衝突
          const conflict: any = await safeD1First(
            env.DB.prepare('SELECT id FROM courses WHERE course_code = ? AND semester = ? AND id != ?').bind(course.course_code, val, courseId)
          );
          if (conflict) {
            return new Response(JSON.stringify({ error: 'Conflict: Course code and semester already exists' }), { status: 409, headers });
          }
          updates.push('semester = ?');
          binds.push(val);
        }

        if (body.status !== undefined) {
          if (!['active', 'archived', 'inactive'].includes(body.status)) {
            return new Response(JSON.stringify({ error: 'Invalid status: must be active, archived, or inactive' }), { status: 400, headers });
          }
          updates.push('status = ?');
          binds.push(body.status);
        }

        if (updates.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid fields provided for update' }), { status: 400, headers });
        }

        const now = new Date().toISOString();
        updates.push('updated_at = ?');
        binds.push(now);
        binds.push(courseId);

        try {
          await env.DB.prepare(`UPDATE courses SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
        } catch (dbErr: any) {
          const errMsg = String(dbErr?.message || dbErr);
          if (errMsg.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ error: 'Conflict: Course code and semester already exists' }), { status: 409, headers });
          }
          throw dbErr;
        }
        const updatedCourse: any = await safeD1First(env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(courseId));
        return new Response(JSON.stringify({ success: true, course: { ...updatedCourse, role: userRole } }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.3 課程成員管理 (GET /api/courses/:id/members, POST /api/courses/:id/members)
    const courseMembersMatch = path.match(/^courses\/([a-zA-Z0-9_-]+)\/members$/);
    if (courseMembersMatch) {
      const courseId = courseMembersMatch[1];
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers });
      }

      const course: any = await safeD1First(env.DB.prepare('SELECT id, status FROM courses WHERE id = ?').bind(courseId));
      if (!course) {
        return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404, headers });
      }

      const isTeacher = await isCourseTeacher(env, courseId, sessionUser.github_id);

      if (request.method === 'GET') {
        const myMem: any = await safeD1First(
          env.DB.prepare('SELECT role FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"').bind(courseId, sessionUser.github_id)
        );
        if ((!myMem && !isTeacher) || (course.status === 'inactive' && !isTeacher)) {
          return new Response(JSON.stringify({ error: 'Course not found or access denied' }), { status: 404, headers });
        }

        const res: any = await env.DB.prepare(
          'SELECT id, course_id, github_id, username, role, status, created_at, updated_at FROM course_memberships WHERE course_id = ? ORDER BY role DESC, username ASC'
        ).bind(courseId).all();

        return new Response(JSON.stringify({ success: true, course_members: res.results || [] }), { headers });
      }

      if (request.method === 'POST') {
        if (!isTeacher) {
          return new Response(JSON.stringify({ error: 'Forbidden: Only course teachers can manage course members' }), { status: 403, headers });
        }

        if (course.status !== 'active') {
          return new Response(JSON.stringify({ error: `Cannot add members to a ${course.status} course` }), { status: 400, headers });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const github_id = String(body.github_id || '').trim();
        const username = String(body.username || '').trim();
        const role = String(body.role || '').trim();

        if (!github_id || !username || !role) {
          return new Response(JSON.stringify({ error: 'github_id, username, and role are required' }), { status: 400, headers });
        }

        if (!['teacher', 'assistant', 'student'].includes(role)) {
          return new Response(JSON.stringify({ error: 'Invalid role: must be teacher, assistant, or student' }), { status: 400, headers });
        }

        // 檢查 UNIQUE(course_id, github_id)
        const existingMem: any = await safeD1First(
          env.DB.prepare('SELECT id, status FROM course_memberships WHERE course_id = ? AND github_id = ?').bind(courseId, github_id)
        );
        if (existingMem) {
          if (existingMem.status === 'active') {
            return new Response(JSON.stringify({ error: 'Conflict: User is already an active member of this course' }), { status: 409, headers });
          }
          const now = new Date().toISOString();
          await env.DB.prepare(
            'UPDATE course_memberships SET role = ?, username = ?, status = "active", updated_at = ? WHERE id = ?'
          ).bind(role, username, now, existingMem.id).run();
          const reactivated: any = await safeD1First(env.DB.prepare('SELECT * FROM course_memberships WHERE id = ?').bind(existingMem.id));
          return new Response(JSON.stringify({ success: true, member: reactivated }), { status: 200, headers });
        }

        const memId = `cm_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO course_memberships (id, course_id, github_id, username, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(memId, courseId, github_id, username, role, 'active', now, now).run();

        const createdMember: any = await safeD1First(env.DB.prepare('SELECT * FROM course_memberships WHERE id = ?').bind(memId));
        return new Response(JSON.stringify({ success: true, member: createdMember }), { status: 201, headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.4 單一課程成員修改與停用 (PATCH /api/courses/:id/members/:memberId)
    // 依據架構規範：不提供 DELETE 端點，一律透過 PATCH 更新 status='inactive'；DELETE 請求回傳 405
    const courseMemberItemMatch = path.match(/^courses\/([a-zA-Z0-9_-]+)\/members\/([a-zA-Z0-9_-]+)$/);
    if (courseMemberItemMatch) {
      const courseId = courseMemberItemMatch[1];
      const memberId = courseMemberItemMatch[2];
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers });
      }

      // IDOR 防護 1: 檢查所屬課程是否存在
      const course: any = await safeD1First(env.DB.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId));
      if (!course) {
        return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404, headers });
      }

      const isTeacher = await isCourseTeacher(env, courseId, sessionUser.github_id);
      if (!isTeacher) {
        return new Response(JSON.stringify({ error: 'Forbidden: Only course teachers can manage course members' }), { status: 403, headers });
      }

      // IDOR 防護 2: 嚴格比對 memberId 與 courseId，找不到或不匹配一律 404 (防止洩漏其他課程成員存在性)
      const targetMem: any = await safeD1First(
        env.DB.prepare('SELECT * FROM course_memberships WHERE id = ? AND course_id = ?').bind(memberId, courseId)
      );
      if (!targetMem) {
        return new Response(JSON.stringify({ error: 'Course member not found' }), { status: 404, headers });
      }

      if (request.method === 'PATCH') {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const updates: string[] = [];
        const binds: any[] = [];

        // Last Teacher Protection: 不可降級或停用最後一位 Active Teacher
        if (targetMem.role === 'teacher' && targetMem.status === 'active') {
          const isDemoting = body.role !== undefined && body.role !== 'teacher';
          const isDeactivating = body.status !== undefined && body.status !== 'active';
          if (isDemoting || isDeactivating) {
            const tcRow: any = await safeD1First(
              env.DB.prepare('SELECT COUNT(*) as count FROM course_memberships WHERE course_id = ? AND role = "teacher" AND status = "active"').bind(courseId)
            );
            if (tcRow && tcRow.count <= 1) {
              const actionName = isDemoting ? 'demote' : 'deactivate';
              return new Response(JSON.stringify({ error: `Cannot ${actionName} the only active teacher in this course` }), { status: 400, headers });
            }
          }
        }

        if (body.role !== undefined) {
          if (!['teacher', 'assistant', 'student'].includes(body.role)) {
            return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400, headers });
          }
          updates.push('role = ?');
          binds.push(body.role);
        }

        if (body.status !== undefined) {
          if (!['active', 'inactive', 'suspended'].includes(body.status)) {
            return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400, headers });
          }
          updates.push('status = ?');
          binds.push(body.status);
        }

        if (body.username !== undefined) {
          const u = String(body.username).trim();
          if (u) {
            updates.push('username = ?');
            binds.push(u);
          }
        }

        if (updates.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid fields provided for update' }), { status: 400, headers });
        }

        const now = new Date().toISOString();
        updates.push('updated_at = ?');
        binds.push(now);
        binds.push(memberId);

        await env.DB.prepare(`UPDATE course_memberships SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
        const updatedMem: any = await safeD1First(env.DB.prepare('SELECT * FROM course_memberships WHERE id = ?').bind(memberId));
        return new Response(JSON.stringify({ success: true, member: updatedMem }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.5 Experiments 集合操作 (GET: 查詢, POST: 建立)
    if (path === 'experiments') {
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ success: true, experiments: [] }), { headers });
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const course_id = String(body.course_id || '').trim();
        const experiment_code = String(body.experiment_code || '').trim();
        const name = String(body.name || '').trim();
        const repository = String(body.repository || '').trim();
        const report_mode = body.report_mode || 'shared';

        if (!course_id || !experiment_code || !name || !repository) {
          return new Response(JSON.stringify({ error: 'course_id, experiment_code, name, and repository are required' }), { status: 400, headers });
        }

        if (!['shared', 'separate'].includes(report_mode)) {
          return new Response(JSON.stringify({ error: 'Invalid report_mode: must be shared or separate' }), { status: 400, headers });
        }

        // 檢查課程存在性與狀態
        const course: any = await safeD1First(env.DB.prepare('SELECT id, status FROM courses WHERE id = ?').bind(course_id));
        if (!course) {
          return new Response(JSON.stringify({ error: 'Course not found' }), { status: 400, headers });
        }
        if (course.status !== 'active') {
          return new Response(JSON.stringify({ error: `Cannot create experiment in a ${course.status} course` }), { status: 400, headers });
        }

        // 檢查建立者是否為該課程 Teacher
        const isTeacher = await isCourseTeacher(env, course_id, sessionUser.github_id);
        if (!isTeacher) {
          return new Response(JSON.stringify({ error: 'Forbidden: Only course teachers can create experiments' }), { status: 403, headers });
        }

        // 檢查 repository 格式
        if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
          return new Response(JSON.stringify({ error: 'Invalid repository format: must be owner/repo' }), { status: 400, headers });
        }

        // 檢查 repository 唯一性約束 (UNIQUE)
        const existingRepo: any = await safeD1First(
          env.DB.prepare('SELECT id FROM experiments WHERE repository = ?').bind(repository)
        );
        if (existingRepo) {
          return new Response(JSON.stringify({ error: 'Conflict: Repository is already registered for another experiment' }), { status: 409, headers });
        }

        // 檢查 UNIQUE(course_id, experiment_code)
        const existingCode: any = await safeD1First(
          env.DB.prepare('SELECT id FROM experiments WHERE course_id = ? AND experiment_code = ?').bind(course_id, experiment_code)
        );
        if (existingCode) {
          return new Response(JSON.stringify({ error: 'Conflict: Experiment code already exists in this course' }), { status: 409, headers });
        }

        const expId = `exp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const now = new Date().toISOString();

        try {
          await env.DB.prepare(
            `INSERT INTO experiments (
              id, course_id, experiment_code, name, repository, report_mode, config_version, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(expId, course_id, experiment_code, name, repository, report_mode, '1.0', 'not_started', now, now).run();
        } catch (dbErr: any) {
          const errMsg = String(dbErr?.message || dbErr);
          if (errMsg.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ error: 'Conflict: Repository or experiment_code already exists' }), { status: 409, headers });
          }
          throw dbErr;
        }

        const createdExp: any = await safeD1First(env.DB.prepare('SELECT * FROM experiments WHERE id = ?').bind(expId));
        return new Response(JSON.stringify({ success: true, experiment: createdExp }), { status: 201, headers });
      }

      if (request.method === 'GET') {
        const repo = url.searchParams.get('repo');
        if (repo) {
          const perm = await resolveExperimentPermission(env, sessionUser, { repo_name: repo });
          if (!perm.allowed || !perm.experiment) {
            return new Response(JSON.stringify({ error: 'Experiment not found or access denied' }), { status: 404, headers });
          }
          return new Response(
            JSON.stringify({
              success: true,
              experiment: perm.experiment,
              course: perm.course,
              role: perm.role,
              report_mode: perm.report_mode,
            }),
            { headers }
          );
        }

        const courseId = url.searchParams.get('course_id');
        if (!courseId) {
          return new Response(JSON.stringify({ error: 'Missing required query parameter: course_id or repo' }), { status: 400, headers });
        }

        const courseMem: any = await safeD1First(
          env.DB.prepare('SELECT role, status FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"').bind(courseId, sessionUser.github_id)
        );

        let isTeacherOrTa = courseMem && (courseMem.role === 'teacher' || courseMem.role === 'assistant');

        if (!isTeacherOrTa && env.INITIAL_ADMIN_GITHUB_ID && sessionUser.github_id === env.INITIAL_ADMIN_GITHUB_ID) {
          const tcRow: any = await safeD1First(env.DB.prepare('SELECT COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"'));
          if (tcRow && tcRow.count === 0) {
            isTeacherOrTa = true;
          }
        }

        // 檢查課程存在性與狀態 (inactive 課程對學生隱藏 404)
        const course: any = await safeD1First(env.DB.prepare('SELECT id, status FROM courses WHERE id = ?').bind(courseId));
        if (!course || (course.status === 'inactive' && !isTeacherOrTa)) {
          return new Response(JSON.stringify({ error: 'Course not found or access denied' }), { status: 404, headers });
        }

        let expList: any[] = [];
        if (isTeacherOrTa) {
          const res: any = await env.DB.prepare(
            'SELECT * FROM experiments WHERE course_id = ? ORDER BY experiment_code ASC'
          ).bind(courseId).all();
          expList = res.results || [];
        } else if (courseMem && courseMem.role === 'student') {
          const res: any = await env.DB.prepare(
            `SELECT e.*, em.group_name
             FROM experiments e
             JOIN experiment_memberships em ON e.id = em.experiment_id
             WHERE e.course_id = ? AND em.github_id = ? AND em.status = 'active'
             ORDER BY e.experiment_code ASC`
          ).bind(courseId, sessionUser.github_id).all();
          expList = res.results || [];
        } else {
          return new Response(JSON.stringify({ error: 'Course not found or access denied' }), { status: 404, headers });
        }

        return new Response(JSON.stringify({ success: true, experiments: expList }), { headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.6 單一 Experiment 詳情與修改 (GET /api/experiments/:id, PATCH /api/experiments/:id)
    const expItemMatch = path.match(/^experiments\/([a-zA-Z0-9_-]+)$/);
    if (expItemMatch) {
      const expId = expItemMatch[1];
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers });
      }

      const exp: any = await safeD1First(env.DB.prepare('SELECT * FROM experiments WHERE id = ?').bind(expId));
      if (!exp) {
        return new Response(JSON.stringify({ error: 'Experiment not found' }), { status: 404, headers });
      }

      const perm = await resolveExperimentPermission(env, sessionUser, { repo_name: exp.repository });
      if (!perm.allowed) {
        return new Response(JSON.stringify({ error: 'Experiment not found or access denied' }), { status: 404, headers });
      }

      if (request.method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          experiment: exp,
          course: perm.course,
          role: perm.role,
          report_mode: perm.report_mode,
        }), { status: 200, headers });
      }

      if (request.method === 'PATCH') {
        if (perm.role !== 'teacher') {
          return new Response(JSON.stringify({ error: 'Forbidden: Only teachers can update experiment' }), { status: 403, headers });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const updates: string[] = [];
        const binds: any[] = [];

        if (body.name !== undefined) {
          const n = String(body.name).trim();
          if (!n) return new Response(JSON.stringify({ error: 'name cannot be empty' }), { status: 400, headers });
          updates.push('name = ?');
          binds.push(n);
        }

        if (body.report_mode !== undefined) {
          if (!['shared', 'separate'].includes(body.report_mode)) {
            return new Response(JSON.stringify({ error: 'Invalid report_mode: must be shared or separate' }), { status: 400, headers });
          }
          updates.push('report_mode = ?');
          binds.push(body.report_mode);
        }

        if (body.status !== undefined) {
          if (!['not_started', 'in_progress', 'data_processing', 'report_writing', 'completed'].includes(body.status)) {
            return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400, headers });
          }
          updates.push('status = ?');
          binds.push(body.status);
        }

        if (updates.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid fields provided for update' }), { status: 400, headers });
        }

        const now = new Date().toISOString();
        updates.push('updated_at = ?');
        binds.push(now);
        binds.push(expId);

        await env.DB.prepare(`UPDATE experiments SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
        const updatedExp: any = await safeD1First(env.DB.prepare('SELECT * FROM experiments WHERE id = ?').bind(expId));
        return new Response(JSON.stringify({ success: true, experiment: updatedExp }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.7 實驗成員配置管理 (GET /api/experiments/:id/members, POST /api/experiments/:id/members)
    const expMembersMatch = path.match(/^experiments\/([a-zA-Z0-9_-]+)\/members$/);
    if (expMembersMatch) {
      const expId = expMembersMatch[1];
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers });
      }

      const exp: any = await safeD1First(env.DB.prepare('SELECT id, course_id, repository FROM experiments WHERE id = ?').bind(expId));
      if (!exp) {
        return new Response(JSON.stringify({ error: 'Experiment not found' }), { status: 404, headers });
      }

      if (request.method === 'GET') {
        const perm = await resolveExperimentPermission(env, sessionUser, { repo_name: exp.repository });
        if (!perm.allowed) {
          return new Response(JSON.stringify({ error: 'Experiment not found or access denied' }), { status: 404, headers });
        }

        const res: any = await env.DB.prepare(
          'SELECT id, experiment_id, github_id, username, role, group_name, status, created_at, updated_at FROM experiment_memberships WHERE experiment_id = ? AND status = "active"'
        ).bind(expId).all();

        return new Response(JSON.stringify({ success: true, experiment_members: res.results || [] }), { headers });
      }

      if (request.method === 'POST') {
        const isTeacher = await isCourseTeacher(env, exp.course_id, sessionUser.github_id);
        if (!isTeacher) {
          return new Response(JSON.stringify({ error: 'Forbidden: Only course teachers can assign members to experiments' }), { status: 403, headers });
        }

        const expCourse: any = await safeD1First(env.DB.prepare('SELECT status FROM courses WHERE id = ?').bind(exp.course_id));
        if (expCourse && expCourse.status !== 'active') {
          return new Response(JSON.stringify({ error: `Cannot assign members in a ${expCourse.status} course` }), { status: 400, headers });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const github_id = String(body.github_id || '').trim();
        const username = String(body.username || '').trim();
        const role = String(body.role || 'student').trim();
        const group_name = body.group_name !== undefined ? String(body.group_name).trim() : null;

        if (!github_id || !username) {
          return new Response(JSON.stringify({ error: 'github_id and username are required' }), { status: 400, headers });
        }

        if (!['student', 'assistant'].includes(role)) {
          return new Response(JSON.stringify({ error: 'Invalid role: must be student or assistant' }), { status: 400, headers });
        }

        // 前置條件校驗：該被分配之使用者必須已是該課程 (Course) 的 active 成員！
        const courseMem: any = await safeD1First(
          env.DB.prepare('SELECT id, role FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"').bind(exp.course_id, github_id)
        );
        if (!courseMem) {
          return new Response(JSON.stringify({ error: 'Bad Request: Target user is not enrolled as an active member of the course' }), { status: 400, headers });
        }

        // 檢查 UNIQUE(experiment_id, github_id)
        const existingMem: any = await safeD1First(
          env.DB.prepare('SELECT id, status FROM experiment_memberships WHERE experiment_id = ? AND github_id = ?').bind(expId, github_id)
        );
        if (existingMem) {
          if (existingMem.status === 'active') {
            return new Response(JSON.stringify({ error: 'Conflict: User is already an active member of this experiment' }), { status: 409, headers });
          }
          const now = new Date().toISOString();
          await env.DB.prepare(
            'UPDATE experiment_memberships SET role = ?, group_name = ?, status = "active", updated_at = ? WHERE id = ?'
          ).bind(role, group_name, now, existingMem.id).run();
          const reactivated: any = await safeD1First(env.DB.prepare('SELECT * FROM experiment_memberships WHERE id = ?').bind(existingMem.id));
          return new Response(JSON.stringify({ success: true, member: reactivated }), { status: 200, headers });
        }

        const emId = `em_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO experiment_memberships (id, experiment_id, github_id, username, role, group_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(emId, expId, github_id, username, role, group_name, 'active', now, now).run();

        const createdExpMem: any = await safeD1First(env.DB.prepare('SELECT * FROM experiment_memberships WHERE id = ?').bind(emId));
        return new Response(JSON.stringify({ success: true, member: createdExpMem }), { status: 201, headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.8 單一實驗成員修改與停用 (PATCH /api/experiments/:id/members/:memberId)
    // 依據架構規範：不提供 DELETE 端點，一律透過 PATCH 更新 status='inactive'；DELETE 請求回傳 405
    const expMemberItemMatch = path.match(/^experiments\/([a-zA-Z0-9_-]+)\/members\/([a-zA-Z0-9_-]+)$/);
    if (expMemberItemMatch) {
      const expId = expMemberItemMatch[1];
      const memberId = expMemberItemMatch[2];
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers });
      }

      const exp: any = await safeD1First(env.DB.prepare('SELECT course_id FROM experiments WHERE id = ?').bind(expId));
      if (!exp) {
        return new Response(JSON.stringify({ error: 'Experiment not found' }), { status: 404, headers });
      }

      const isTeacher = await isCourseTeacher(env, exp.course_id, sessionUser.github_id);
      if (!isTeacher) {
        return new Response(JSON.stringify({ error: 'Forbidden: Only course teachers can manage experiment members' }), { status: 403, headers });
      }

      // IDOR 防護：嚴格限定 memberId 與 expId 匹配，不匹配或不存在一律 404
      const targetMem: any = await safeD1First(
        env.DB.prepare('SELECT * FROM experiment_memberships WHERE id = ? AND experiment_id = ?').bind(memberId, expId)
      );
      if (!targetMem) {
        return new Response(JSON.stringify({ error: 'Experiment member not found' }), { status: 404, headers });
      }

      if (request.method === 'PATCH') {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
        }

        const updates: string[] = [];
        const binds: any[] = [];

        if (body.group_name !== undefined) {
          updates.push('group_name = ?');
          binds.push(body.group_name ? String(body.group_name).trim() : null);
        }

        if (body.role !== undefined) {
          if (!['student', 'assistant'].includes(body.role)) {
            return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400, headers });
          }
          updates.push('role = ?');
          binds.push(body.role);
        }

        if (body.status !== undefined) {
          if (!['active', 'inactive'].includes(body.status)) {
            return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400, headers });
          }
          updates.push('status = ?');
          binds.push(body.status);
        }

        if (updates.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid fields provided for update' }), { status: 400, headers });
        }

        const now = new Date().toISOString();
        updates.push('updated_at = ?');
        binds.push(now);
        binds.push(memberId);

        await env.DB.prepare(`UPDATE experiment_memberships SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
        const updatedMem: any = await safeD1First(env.DB.prepare('SELECT * FROM experiment_memberships WHERE id = ?').bind(memberId));
        return new Response(JSON.stringify({ success: true, member: updatedMem }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    // 4.9 舊版 /api/members 相容查詢端點
    if (path === 'members') {
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Valid session required' }), { status: 401, headers });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ success: true, members: [] }), { headers });
      }

      const courseId = url.searchParams.get('course_id');
      const experimentId = url.searchParams.get('experiment_id');
      const repo = url.searchParams.get('repo');

      if (repo) {
        const perm = await resolveExperimentPermission(env, sessionUser, { repo_name: repo });
        if (!perm.allowed || !perm.experiment) {
          return new Response(JSON.stringify({ error: 'Experiment not found or access denied' }), { status: 404, headers });
        }
        const res: any = await env.DB.prepare(
          'SELECT id, experiment_id, github_id, username, role, group_name, status FROM experiment_memberships WHERE experiment_id = ? AND status = "active"'
        ).bind(perm.experiment.id).all();
        return new Response(JSON.stringify({ success: true, experiment_members: res.results || [] }), { headers });
      }

      if (courseId) {
        const courseMem: any = await safeD1First(env.DB.prepare(
          'SELECT role FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"'
        ).bind(courseId, sessionUser.github_id));

        let canViewCourse = !!courseMem;
        if (!canViewCourse && env.INITIAL_ADMIN_GITHUB_ID && sessionUser.github_id === env.INITIAL_ADMIN_GITHUB_ID) {
          const tcRow: any = await safeD1First(env.DB.prepare('SELECT COUNT(*) as count FROM course_memberships WHERE role = "teacher" AND status = "active"'));
          if (tcRow && tcRow.count === 0) canViewCourse = true;
        }

        if (!canViewCourse) {
          return new Response(JSON.stringify({ error: 'Course not found or access denied' }), { status: 404, headers });
        }
        const res: any = await env.DB.prepare(
          'SELECT id, course_id, github_id, username, role, status FROM course_memberships WHERE course_id = ? AND status = "active"'
        ).bind(courseId).all();
        return new Response(JSON.stringify({ success: true, course_members: res.results || [] }), { headers });
      }

      if (experimentId) {
        const expRow: any = await safeD1First(env.DB.prepare('SELECT id, course_id, repository FROM experiments WHERE id = ?').bind(experimentId));
        if (!expRow) {
          return new Response(JSON.stringify({ error: 'Experiment not found' }), { status: 404, headers });
        }
        const perm = await resolveExperimentPermission(env, sessionUser, { repo_name: expRow.repository });
        if (!perm.allowed) {
          return new Response(JSON.stringify({ error: 'Access denied' }), { status: 404, headers });
        }
        const res: any = await env.DB.prepare(
          'SELECT id, experiment_id, github_id, username, role, group_name, status FROM experiment_memberships WHERE experiment_id = ? AND status = "active"'
        ).bind(experimentId).all();
        return new Response(JSON.stringify({ success: true, experiment_members: res.results || [] }), { headers });
      }

      return new Response(JSON.stringify({ error: 'Missing required query parameter: course_id, experiment_id, or repo' }), { status: 400, headers });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found', path }), { status: 404, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
