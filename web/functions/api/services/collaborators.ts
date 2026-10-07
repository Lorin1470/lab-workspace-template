/**
 * collaborators.ts
 * GitHub Repository Collaborator 權限同步服務
 *
 * 職責：
 * 1. 唯一同步對象為「學生」(role === 'student')，權限固定為 push，嚴禁 admin。
 * 2. Course Mode 同步至 courses.github_repository；Experiment Mode 同步至 experiments.repository。
 * 3. 停用學生時，檢查該學生是否仍有其他有效 membership 需要同一 Repository；若有則保留，若無才呼叫 DELETE。
 * 4. 具備等冪性 (Idempotent)、去敏防護 (Sanitization) 與優雅降級 (不回滾 D1)。
 * 5. 清楚偵測並指出 GitHub App 缺少 Administration: write 權限。
 */

import { getInstallationToken, sanitizeErrorMessage } from './provisioning.ts';

export type GitHubPermissionStatus = 'pending' | 'ready' | 'failed' | 'removed';

export interface SyncResult {
  success: boolean;
  status: GitHubPermissionStatus;
  retained?: boolean;
  error?: string;
}

export interface CollaboratorSyncParams {
  repository: string;
  github_id: string;
  username: string;
  membershipId: string;
  membershipType: 'course' | 'experiment';
}

/**
 * 檢查學生是否仍有其他有效 student membership 需要同一個 repository
 */
export async function countActiveMembershipsForRepo(
  env: any,
  repository: string,
  github_id: string,
  excludeMembershipId: string
): Promise<number> {
  if (!env.DB || !repository || !github_id) return 0;
  try {
    const cleanRepo = repository.trim().toLowerCase();
    const cleanGid = String(github_id).trim();

    const countRes: any = await env.DB.prepare(
      `SELECT (
        (SELECT COUNT(*) FROM course_memberships cm
         JOIN courses c ON cm.course_id = c.id
         WHERE cm.github_id = ? AND cm.status = 'active' AND cm.role = 'student'
           AND c.mode = 'course' AND LOWER(c.github_repository) = ?
           AND cm.id != ?)
        +
        (SELECT COUNT(*) FROM experiment_memberships em
         JOIN experiments e ON em.experiment_id = e.id
         WHERE em.github_id = ? AND em.status = 'active' AND em.role = 'student'
           AND LOWER(e.repository) = ?
           AND em.id != ?)
      ) as active_count`
    ).bind(cleanGid, cleanRepo, excludeMembershipId, cleanGid, cleanRepo, excludeMembershipId).first().catch(() => null);

    return Number(countRes?.active_count || 0);
  } catch (_err) {
    return 0;
  }
}

/**
 * 將學生加入 GitHub Repository Collaborator (permission: push)
 */
export async function syncStudentCollaborator(
  env: any,
  params: CollaboratorSyncParams,
  fetchFn: typeof fetch = fetch
): Promise<SyncResult> {
  const { repository, github_id, username, membershipId, membershipType } = params;

  if (!repository || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
    const errMsg = '無效或未設定的 GitHub Repository 格式';
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', errMsg);
    return { success: false, status: 'failed', error: errMsg };
  }

  if (!username || !github_id) {
    const errMsg = '缺少學生的 GitHub username 或 github_id';
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', errMsg);
    return { success: false, status: 'failed', error: errMsg };
  }

  // 1. 取得 GitHub App Installation Token
  let tokenData: { token: string };
  try {
    tokenData = await getInstallationToken(env, fetchFn);
  } catch (err: any) {
    const rawMsg = err?.message || String(err);
    const sanitized = sanitizeErrorMessage(rawMsg) || '無法取得 GitHub App Installation Token';
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', sanitized);
    return { success: false, status: 'failed', error: sanitized };
  }

  const [owner, repo] = repository.split('/');
  const encodedUsername = encodeURIComponent(username);
  const targetUrl = `https://api.github.com/repos/${owner}/${repo}/collaborators/${encodedUsername}`;

  try {
    // 2. 呼叫 GitHub Collaborators API (固定 permission: push)
    const res = await fetchFn(targetUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Lab-Workspace-System/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission: 'push' }),
    });

    // 201: 邀請已建立並寄發；204: 協作者已加入或權限已更新
    if (res.status === 201 || res.status === 204) {
      const now = new Date().toISOString();
      await updateMembershipSyncStatus(env, membershipType, membershipId, 'ready', null, now);
      await upsertRepoCollaborator(env, repository, github_id, username, 'push', 'ready', null, now);
      return { success: true, status: 'ready' };
    }

    // 403: 權限不足 (通常為 GitHub App 缺少 Administration: write)
    if (res.status === 403) {
      const body: any = await res.json().catch(() => ({}));
      const rawMsg = body.message || 'Forbidden';
      let friendlyError = 'GitHub App 缺少 Administration: write 權限，無法管理協作者';
      if (!rawMsg.includes('Resource not accessible') && !rawMsg.includes('Integration')) {
        friendlyError = `GitHub 權限不足 (HTTP 403): ${sanitizeErrorMessage(rawMsg)}`;
      }
      await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', friendlyError);
      await upsertRepoCollaborator(env, repository, github_id, username, 'push', 'failed', friendlyError);
      return { success: false, status: 'failed', error: friendlyError };
    }

    // 404: 倉庫或使用者不存在
    if (res.status === 404) {
      const notFoundErr = 'GitHub 儲存庫或使用者不存在 (HTTP 404)';
      await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', notFoundErr);
      await upsertRepoCollaborator(env, repository, github_id, username, 'push', 'failed', notFoundErr);
      return { success: false, status: 'failed', error: notFoundErr };
    }

    // 其他失敗
    const errBody: any = await res.json().catch(() => ({}));
    const sanitized = sanitizeErrorMessage(errBody.message || res.statusText || `HTTP ${res.status}`);
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', sanitized);
    await upsertRepoCollaborator(env, repository, github_id, username, 'push', 'failed', sanitized);
    return { success: false, status: 'failed', error: sanitized };
  } catch (err: any) {
    const sanitized = sanitizeErrorMessage(err?.message || '網路通訊異常');
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', sanitized);
    return { success: false, status: 'failed', error: sanitized };
  }
}

/**
 * 停用或移除學生時，連動處理 GitHub Collaborator 權限
 */
export async function removeStudentCollaborator(
  env: any,
  params: CollaboratorSyncParams,
  fetchFn: typeof fetch = fetch
): Promise<SyncResult> {
  const { repository, github_id, username, membershipId, membershipType } = params;

  if (!repository || !username || !github_id) {
    const now = new Date().toISOString();
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'removed', null, now);
    return { success: true, status: 'removed' };
  }

  // 1. 檢查是否仍有其他有效 membership 需要此同一 Repository
  const otherCount = await countActiveMembershipsForRepo(env, repository, github_id, membershipId);
  if (otherCount > 0) {
    // 學生仍有其他課程/實驗綁定同一倉庫，安全保留 Collaborator
    const now = new Date().toISOString();
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'removed', null, now);
    return {
      success: true,
      status: 'removed',
      retained: true,
    };
  }

  // 2. 若已無其他有效 membership，呼叫 GitHub DELETE
  let tokenData: { token: string };
  try {
    tokenData = await getInstallationToken(env, fetchFn);
  } catch (err: any) {
    const sanitized = sanitizeErrorMessage(err?.message || '無法取得 App Token');
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', sanitized);
    return { success: false, status: 'failed', error: sanitized };
  }

  const [owner, repo] = repository.split('/');
  const encodedUsername = encodeURIComponent(username);
  const targetUrl = `https://api.github.com/repos/${owner}/${repo}/collaborators/${encodedUsername}`;

  try {
    const res = await fetchFn(targetUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Lab-Workspace-System/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    // 204: 成功移除；404: 本就不在協作者中，皆視為已移除 (removed)
    if (res.status === 204 || res.status === 404) {
      const now = new Date().toISOString();
      await updateMembershipSyncStatus(env, membershipType, membershipId, 'removed', null, now);
      await upsertRepoCollaborator(env, repository, github_id, username, 'push', 'removed', null, now);
      return { success: true, status: 'removed' };
    }

    const errBody: any = await res.json().catch(() => ({}));
    const sanitized = sanitizeErrorMessage(errBody.message || res.statusText || `HTTP ${res.status}`);
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', sanitized);
    return { success: false, status: 'failed', error: sanitized };
  } catch (err: any) {
    const sanitized = sanitizeErrorMessage(err?.message || '刪除協作者失敗');
    await updateMembershipSyncStatus(env, membershipType, membershipId, 'failed', sanitized);
    return { success: false, status: 'failed', error: sanitized };
  }
}

/**
 * 內部輔助：更新 D1 membership 的同步狀態欄位
 */
async function updateMembershipSyncStatus(
  env: any,
  type: 'course' | 'experiment',
  id: string,
  status: GitHubPermissionStatus,
  error: string | null = null,
  syncedAt: string | null = new Date().toISOString()
) {
  if (!env.DB || !id) return;
  const table = type === 'course' ? 'course_memberships' : 'experiment_memberships';
  try {
    await env.DB.prepare(
      `UPDATE ${table} SET github_permission_status = ?, github_permission_error = ?, github_synced_at = ? WHERE id = ?`
    ).bind(status, error, syncedAt, id).run();
  } catch (_e) {}
}

/**
 * 內部輔助：記錄/更新 repository_collaborators 表格
 */
async function upsertRepoCollaborator(
  env: any,
  repository: string,
  github_id: string,
  username: string,
  permission: string,
  status: GitHubPermissionStatus,
  error: string | null = null,
  syncedAt: string = new Date().toISOString()
) {
  if (!env.DB || !repository || !github_id) return;
  try {
    const id = `rc_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await env.DB.prepare(
      `INSERT INTO repository_collaborators (id, repository, github_id, username, permission, status, error_message, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repository, github_id) DO UPDATE SET
         username = excluded.username,
         permission = excluded.permission,
         status = excluded.status,
         error_message = excluded.error_message,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at`
    ).bind(id, repository, String(github_id), username, permission, status, error, syncedAt, syncedAt, syncedAt).run();
  } catch (_e) {}
}
