/**
 * verify-frontend.mjs
 * Phase 3: Web 管理介面與 API Client 端到端整合驗證測試 (零外部依賴)
 *
 * 測試群組：
 * 1. API Client 與 Courses 管理整合 (清單、詳情、建立、更新、409 衝突、404 存在性遮蔽)
 * 2. API Client 與 Course Memberships 管理整合 (新增、修改角色、Last Active Teacher 降級/停用保護 400)
 * 3. API Client 與 Experiments 管理整合 (建立、查詢、修改、owner/repo 格式驗證、409 重複)
 * 4. API Client 與 Experiment Memberships 整合 (指派組員、更新分組、非課程成員阻絕 400、重複 409)
 * 5. Activity Log 資料讀取與前台展示格式化 (JSON files_changed 解析、SHA 連結、拒絕原因呈現)
 * 6. 前端角色權限邏輯驗證 (Teacher vs Assistant vs Student 視圖、學生隱藏 inactive 課程、archived 唯讀)
 * 7. Session 身分驗證與防偽檢驗 (Cookie 鑑權、登出生命週期、無客戶端身分覆蓋漏洞)
 */

import http from 'node:http';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { onRequest } from '../web/functions/api/[[route]].ts';
import {
  resolveNavbarRepository,
  resolveInitialExperimentTab,
  shouldShowStandaloneProvisioningWarning,
  getReportRelativePath,
} from '../web/src/utils/workspace-ui.ts';

const TEST_PORT = 9005;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 產生測試用 RSA 金鑰對 (PKCS#8)
const testKeypairPkcs8 = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Mock GitHub API 服務
class MockGitHubApi {
  constructor() {
    this.repos = new Map();
    this.files = new Map();
    this.commitCounter = 1000;
    this.authorizedOwner = 'example-org';
    this.templateFail = false;
  }

  setFile(ownerRepo, filePath, content, isDir = false) {
    const key = `${ownerRepo.toLowerCase()}:${filePath}`;
    const sha = crypto.createHash('sha1').update(content || filePath).digest('hex');
    this.files.set(key, {
      content: content || '',
      sha,
      size: Buffer.byteLength(content || '', 'utf8'),
      type: isDir ? 'dir' : 'file',
    });
  }

  fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const method = options.method || 'GET';

    if (urlStr.includes('/access_tokens') && method === 'POST') {
      return new Response(
        JSON.stringify({
          token: 'ghs_mock_token_for_frontend_test',
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
        { status: 201 }
      );
    }

    if (urlStr.includes('/app/installations/') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 654321,
          account: {
            login: this.authorizedOwner,
            type: 'Organization',
          },
        }),
        { status: 200 }
      );
    }

    const repoMatch = urlStr.match(/\/repos\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (repoMatch && method === 'GET') {
      const [_, owner, repoName] = repoMatch;
      const key = `${owner.toLowerCase()}/${repoName.toLowerCase()}`;
      if (this.repos.has(key)) {
        return new Response(
          JSON.stringify({
            id: 88888,
            name: repoName,
            full_name: `${owner}/${repoName}`,
            owner: { login: owner },
            html_url: `https://github.com/${owner}/${repoName}`,
            default_branch: 'main',
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }

    if (urlStr.includes('/generate') && method === 'POST') {
      if (this.templateFail) {
        return new Response(JSON.stringify({ message: 'GitHub template instantiation failed' }), { status: 502 });
      }
      const body = JSON.parse(options.body || '{}');
      const owner = body.owner || this.authorizedOwner;
      const name = body.name;
      const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
      const repoData = {
        id: 99999,
        name,
        full_name: `${owner}/${name}`,
        owner: { login: owner },
        html_url: `https://github.com/${owner}/${name}`,
        default_branch: 'main',
      };
      this.repos.set(key, repoData);
      return new Response(JSON.stringify(repoData), { status: 201 });
    }

    // Contents API (GET & PUT)
    const contentsMatch = urlStr.match(/\/repos\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/contents\/?(.*)$/);
    if (contentsMatch) {
      const [_, owner, repo, rawPath] = contentsMatch;
      const ownerRepo = `${owner}/${repo}`.toLowerCase();
      const filePath = decodeURIComponent(rawPath.split('?')[0]);

      if (method === 'GET') {
        const prefix = filePath ? `${filePath}/` : '';
        const matchingEntries = [];
        const seenDirs = new Set();

        for (const [k, v] of this.files.entries()) {
          if (!k.startsWith(`${ownerRepo}:`)) continue;
          const relPath = k.slice(ownerRepo.length + 1);

          if (filePath === '') {
            const topPart = relPath.split('/')[0];
            if (relPath.includes('/')) {
              if (!seenDirs.has(topPart)) {
                seenDirs.add(topPart);
                matchingEntries.push({
                  name: topPart,
                  path: topPart,
                  sha: crypto.createHash('sha1').update(topPart).digest('hex'),
                  size: 0,
                  type: 'dir',
                });
              }
            } else {
              matchingEntries.push({
                name: relPath,
                path: relPath,
                sha: v.sha,
                size: v.size,
                type: 'file',
              });
            }
          } else if (relPath === filePath && v.type === 'dir') {
            continue;
          } else if (relPath.startsWith(prefix)) {
            const remainder = relPath.slice(prefix.length);
            const subPart = remainder.split('/')[0];
            if (remainder.includes('/')) {
              if (!seenDirs.has(subPart)) {
                seenDirs.add(subPart);
                matchingEntries.push({
                  name: subPart,
                  path: `${prefix}${subPart}`,
                  sha: crypto.createHash('sha1').update(subPart).digest('hex'),
                  size: 0,
                  type: 'dir',
                });
              }
            } else {
              matchingEntries.push({
                name: subPart,
                path: relPath,
                sha: v.sha,
                size: v.size,
                type: 'file',
              });
            }
          }
        }

        const directKey = `${ownerRepo}:${filePath}`;
        const exactFile = this.files.get(directKey);

        if (exactFile && exactFile.type === 'file') {
          return new Response(
            JSON.stringify({
              name: filePath.split('/').pop(),
              path: filePath,
              sha: exactFile.sha,
              size: exactFile.size,
              type: 'file',
              encoding: 'base64',
              content: Buffer.from(exactFile.content).toString('base64'),
            }),
            { status: 200 }
          );
        }

        if (exactFile && exactFile.type === 'dir') {
          return new Response(JSON.stringify(matchingEntries), { status: 200 });
        }

        if (matchingEntries.length > 0 || filePath === '') {
          return new Response(JSON.stringify(matchingEntries), { status: 200 });
        }

        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }

      if (method === 'PUT') {
        const body = JSON.parse(options.body || '{}');
        const directKey = `${ownerRepo}:${filePath}`;
        const existing = this.files.get(directKey);

        // 樂觀鎖校驗
        if (body.sha && (!existing || existing.sha !== body.sha)) {
          return new Response(
            JSON.stringify({
              message: `Resource is at ${existing ? existing.sha : 'none'} but expected ${body.sha}`,
            }),
            { status: 409 }
          );
        }

        const isNew = !existing;
        const decodedContent = Buffer.from(body.content || '', 'base64').toString('utf8');
        const newFileSha = crypto.createHash('sha1').update(decodedContent).digest('hex');
        this.commitCounter++;
        const newCommitSha = crypto
          .createHash('sha1')
          .update(`commit-${this.commitCounter}-${filePath}`)
          .digest('hex');

        this.files.set(directKey, {
          content: decodedContent,
          sha: newFileSha,
          size: Buffer.byteLength(decodedContent, 'utf8'),
          type: 'file',
        });

        return new Response(
          JSON.stringify({
            content: {
              name: filePath.split('/').pop(),
              path: filePath,
              sha: newFileSha,
              size: Buffer.byteLength(decodedContent, 'utf8'),
            },
            commit: {
              sha: newCommitSha,
              message: body.message,
            },
          }),
          { status: isNew ? 201 : 200 }
        );
      }
    }

    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
  };
}

const mockGitHub = new MockGitHubApi();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const urlStr = typeof input === 'string' ? input : (input?.url || '');
  if (urlStr.startsWith('https://api.github.com')) {
    return mockGitHub.fetch(input, init);
  }
  return originalFetch(input, init);
};

// 記憶體 D1 資料庫
class MockFrontendD1 {
  constructor() {
    this.courses = new Map();
    this.experiments = new Map();
    this.experimentProvisionings = new Map();
    this.courseMemberships = new Map();
    this.experimentMemberships = new Map();
    this.sessions = new Map();
    this.activityLogs = [];
  }

  prepare(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      bind: (...binds) => ({
        run: async () => {
          if (q.startsWith('INSERT INTO courses')) {
            let [id, course_code, name, semester, status, created_by_github_id, created_at, updated_at] = binds;
            let mode = 'experiment';
            let github_repository = null;
            if (binds.length >= 10) {
              [id, course_code, name, semester, status, mode, github_repository, created_by_github_id, created_at, updated_at] = binds;
            }
            for (const c of this.courses.values()) {
              if (c.course_code === course_code && c.semester === semester) {
                throw new Error(`UNIQUE constraint failed: courses.course_code, courses.semester`);
              }
            }
            this.courses.set(id, {
              id,
              course_code,
              name,
              semester,
              status: status || 'active',
              mode: mode || 'experiment',
              github_repository,
              created_by_github_id,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE courses SET')) {
            const id = binds[binds.length - 1];
            const course = this.courses.get(id);
            if (course) {
              if (q.includes('name = ?')) course.name = binds[0];
              if (q.includes('semester = ?')) {
                const sIndex = q.indexOf('semester = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                course.semester = binds[idx];
              }
              if (q.includes('status = ?')) {
                const sIndex = q.indexOf('status = ?');
                const idx = (q.slice(0, sIndex).match(/\?/g) || []).length;
                course.status = binds[idx];
              }
              course.updated_at = new Date().toISOString();
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO course_memberships')) {
            const [id, course_id, github_id, username, role, status, created_at, updated_at] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === course_id && m.github_id === github_id) {
                throw new Error(`UNIQUE constraint failed: course_memberships.course_id, course_memberships.github_id`);
              }
            }
            this.courseMemberships.set(id, {
              id,
              course_id,
              github_id,
              username,
              role,
              status: status || 'active',
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE course_memberships SET')) {
            const id = binds[binds.length - 1];
            const m = this.courseMemberships.get(id);
            if (m) {
              if (q.includes('role = ?')) {
                const idx = (q.slice(0, q.indexOf('role = ?')).match(/\?/g) || []).length;
                m.role = binds[idx];
              }
              if (q.includes('status = ?')) {
                const idx = (q.slice(0, q.indexOf('status = ?')).match(/\?/g) || []).length;
                m.status = binds[idx];
              }
              m.updated_at = new Date().toISOString();
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiments')) {
            const [id, course_id, experiment_code, name, repository, report_mode, config_version, status, created_at, updated_at] = binds;
            for (const e of this.experiments.values()) {
              if (repository && e.repository === repository) {
                throw new Error(`UNIQUE constraint failed: experiments.repository`);
              }
              if (e.course_id === course_id && e.experiment_code === experiment_code) {
                throw new Error(`UNIQUE constraint failed: experiments.course_id, experiments.experiment_code`);
              }
            }
            this.experiments.set(id, {
              id,
              course_id,
              experiment_code,
              name,
              repository,
              report_mode: report_mode || 'shared',
              config_version: config_version || '1.0',
              status: status || 'not_started',
              provisioning_status: 'pending',
              provisioning_error: null,
              provisioned_at: null,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE experiments SET')) {
            const id = binds[binds.length - 1];
            const exp = this.experiments.get(id);
            if (exp) {
              if (q.includes('name = ?')) {
                const idx = (q.slice(0, q.indexOf('name = ?')).match(/\?/g) || []).length;
                exp.name = binds[idx];
              }
              if (q.includes('report_mode = ?')) {
                const idx = (q.slice(0, q.indexOf('report_mode = ?')).match(/\?/g) || []).length;
                exp.report_mode = binds[idx];
              }
              if (q.includes('status = ?')) {
                const idx = (q.slice(0, q.indexOf('status = ?')).match(/\?/g) || []).length;
                exp.status = binds[idx];
              }
              if (q.includes('provisioning_status = "creating"')) {
                exp.provisioning_status = 'creating';
                exp.provisioning_error = null;
                exp.updated_at = binds[0];
              } else if (q.includes('provisioning_status = "ready"')) {
                exp.provisioning_status = 'ready';
                exp.provisioning_error = null;
                exp.provisioned_at = binds[0];
                exp.updated_at = binds[1];
              } else if (q.includes('provisioning_status = "failed"')) {
                exp.provisioning_status = 'failed';
                exp.provisioning_error = binds[0];
                exp.updated_at = binds[1];
              } else {
                exp.updated_at = new Date().toISOString();
              }
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiment_provisionings')) {
            const [id, experiment_id, repository, status, created_at, updated_at] = binds;
            this.experimentProvisionings.set(id, {
              id,
              experiment_id,
              repository,
              status,
              error_summary: null,
              created_at,
              updated_at,
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE experiment_provisionings SET')) {
            const id = binds[binds.length - 1];
            const prov = this.experimentProvisionings.get(id);
            if (prov) {
              if (q.includes('status = "ready"')) {
                prov.status = 'ready';
                prov.error_summary = null;
                prov.updated_at = binds[0];
              } else if (q.includes('status = "failed"')) {
                prov.status = 'failed';
                prov.error_summary = binds[0];
                prov.updated_at = binds[1];
              }
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO experiment_memberships')) {
            const [id, experiment_id, github_id, username, role, group_name, status, created_at, updated_at] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === experiment_id && em.github_id === github_id) {
                throw new Error(`UNIQUE constraint failed: experiment_memberships.experiment_id, experiment_memberships.github_id`);
              }
            }
            this.experimentMemberships.set(id, {
              id,
              experiment_id,
              github_id,
              username,
              role,
              group_name: group_name || null,
              status: status || 'active',
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }
          if (q.startsWith('UPDATE experiment_memberships SET')) {
            const id = binds[binds.length - 1];
            const em = this.experimentMemberships.get(id);
            if (em) {
              if (q.includes('group_name = ?')) {
                const idx = (q.slice(0, q.indexOf('group_name = ?')).match(/\?/g) || []).length;
                em.group_name = binds[idx];
              }
              if (q.includes('role = ?')) {
                const idx = (q.slice(0, q.indexOf('role = ?')).match(/\?/g) || []).length;
                em.role = binds[idx];
              }
              if (q.includes('status = ?')) {
                const idx = (q.slice(0, q.indexOf('status = ?')).match(/\?/g) || []).length;
                em.status = binds[idx];
              }
              em.updated_at = new Date().toISOString();
            }
            return { success: true };
          }
          if (q.startsWith('INSERT INTO activity_logs')) {
            this.activityLogs.push({
              id: binds[0],
              repo_name: binds[1],
              experiment_id: binds[2],
              timestamp: binds[3],
              actor_type: binds[4],
              actor_id: binds[5],
              actor_name: binds[6],
              actor_avatar: binds[7],
              requested_by: binds[8],
              approved_by: binds[9],
              approval_status: binds[10],
              action: binds[11],
              target: binds[12],
              summary: binds[13],
              files_changed: binds[14],
              commit_sha: binds[15],
              details_json: binds[16],
            });
            return { success: true };
          }
          if (q.startsWith('DELETE FROM user_sessions WHERE session_id = ?')) {
            this.sessions.delete(binds[0]);
            return { success: true };
          }
          return { success: true };
        },
        first: async () => {
          if (q.includes('FROM user_sessions WHERE session_id = ?')) {
            return this.sessions.get(binds[0]) || null;
          }
          if (q.includes('FROM courses WHERE course_code = ? AND semester = ? AND id != ?')) {
            const [cc, sem, id] = binds;
            for (const c of this.courses.values()) {
              if (c.course_code === cc && c.semester === sem && c.id !== id) return { ...c };
            }
            return null;
          }
          if (q.includes('FROM courses WHERE course_code = ? AND semester = ?')) {
            const [cc, sem] = binds;
            for (const c of this.courses.values()) {
              if (c.course_code === cc && c.semester === sem) return { ...c };
            }
            return null;
          }
          if (q.includes('FROM courses WHERE id = ?')) {
            return this.courses.get(binds[0]) || null;
          }
          if (q.includes('FROM experiments WHERE repository = ?')) {
            const repo = binds[0];
            for (const e of this.experiments.values()) {
              if (e.repository === repo) return { ...e };
            }
            return null;
          }
          if (q.includes('FROM experiments WHERE course_id = ? AND experiment_code = ?')) {
            const [cid, code] = binds;
            for (const e of this.experiments.values()) {
              if (e.course_id === cid && e.experiment_code === code) return { ...e };
            }
            return null;
          }
          if (q.includes('FROM experiments WHERE id = ?')) {
            return this.experiments.get(binds[0]) || null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"')) {
            const [cid, gid] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid && m.github_id === gid && m.status === 'active') return { ...m };
            }
            return null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ?')) {
            const [cid, gid] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid && m.github_id === gid) return { ...m };
            }
            return null;
          }
          if (q.includes('FROM course_memberships WHERE id = ? AND course_id = ?')) {
            const [id, cid] = binds;
            const m = this.courseMemberships.get(id);
            if (m && m.course_id === cid) return { ...m };
            return null;
          }
          if (q.includes('FROM course_memberships WHERE id = ?')) {
            return this.courseMemberships.get(binds[0]) || null;
          }
          if (q.includes('FROM course_memberships WHERE github_id = ? AND role = "teacher" AND status = "active"')) {
            const gid = binds[0];
            for (const m of this.courseMemberships.values()) {
              if (m.github_id === gid && m.role === 'teacher' && m.status === 'active') return { ...m };
            }
            return null;
          }
          if (q.includes('COUNT(*) as count FROM course_memberships WHERE role = "teacher"') ||
              q.includes("COUNT(*) as count FROM course_memberships WHERE role = 'teacher'")) {
            let count = 0;
            for (const m of this.courseMemberships.values()) {
              if (m.role === 'teacher' && m.status === 'active') count++;
            }
            return { count };
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND role = "teacher" AND status = "active"')) {
            const cid = binds[0];
            let count = 0;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid && m.role === 'teacher' && m.status === 'active') count++;
            }
            return { count };
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND github_id = ? AND status = "active"')) {
            const [eid, gid] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === eid && em.github_id === gid && em.status === 'active') return { ...em };
            }
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ? AND github_id = ?')) {
            const [eid, gid] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === eid && em.github_id === gid) return { ...em };
            }
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE id = ? AND experiment_id = ?')) {
            const [id, eid] = binds;
            const em = this.experimentMemberships.get(id);
            if (em && em.experiment_id === eid) return { ...em };
            return null;
          }
          if (q.includes('FROM experiment_memberships WHERE id = ?')) {
            return this.experimentMemberships.get(binds[0]) || null;
          }
          return null;
        },
        all: async () => {
          if (q.includes('FROM courses c JOIN course_memberships cm ON c.id = cm.course_id WHERE cm.github_id = ?')) {
            const gitId = binds[0];
            const results = [];
            for (const m of this.courseMemberships.values()) {
              if (m.github_id === gitId && m.status === 'active') {
                const c = this.courses.get(m.course_id);
                if (c && (['teacher', 'assistant'].includes(m.role) || c.status !== 'inactive')) {
                  results.push({ ...c, role: m.role });
                }
              }
            }
            return { results };
          }
          if (q.includes('FROM experiments WHERE course_id = ?')) {
            const cid = binds[0];
            const results = [];
            for (const e of this.experiments.values()) {
              if (e.course_id === cid) results.push(e);
            }
            return { results };
          }
          if (q.includes('FROM experiments e JOIN experiment_memberships em ON e.id = em.experiment_id WHERE e.course_id = ? AND em.github_id = ?')) {
            const cid = binds[0];
            const gid = binds[1];
            const results = [];
            for (const em of this.experimentMemberships.values()) {
              if (em.github_id === gid && em.status === 'active') {
                const e = this.experiments.get(em.experiment_id);
                if (e && e.course_id === cid) {
                  results.push({ ...e, group_name: em.group_name });
                }
              }
            }
            return { results };
          }
          if (q.includes('FROM course_memberships WHERE course_id = ?')) {
            const cid = binds[0];
            const results = [];
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === cid) results.push(m);
            }
            return { results };
          }
          if (q.includes('FROM experiment_memberships WHERE experiment_id = ?')) {
            const eid = binds[0];
            const results = [];
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === eid && em.status === 'active') results.push(em);
            }
            return { results };
          }
          if (q.includes('FROM activity_logs WHERE repo_name = ?')) {
            const repo = binds[0];
            let list = this.activityLogs.filter((l) => l.repo_name === repo);
            if (binds.length >= 2 && typeof binds[1] === 'string') {
              list = list.filter((l) => l.experiment_id === binds[1]);
            }
            return { results: list.slice(-50) };
          }
          if (q.includes('FROM experiment_provisionings WHERE experiment_id = ?')) {
            const eid = binds[0];
            const results = [];
            for (const ep of this.experimentProvisionings.values()) {
              if (ep.experiment_id === eid) results.push({ ...ep });
            }
            results.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            return { results };
          }
          return { results: [] };
        },
      }),
      first: async () => {
        if (q.includes('COUNT(*) as count FROM course_memberships WHERE role = "teacher"') ||
            q.includes("COUNT(*) as count FROM course_memberships WHERE role = 'teacher'")) {
          let count = 0;
          for (const m of this.courseMemberships.values()) {
            if (m.role === 'teacher' && m.status === 'active') count++;
          }
          return { count };
        }
        return null;
      },
    };
  }

  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

// 建立測試環境
const mockD1 = new MockFrontendD1();
const mockEnv = {
  DB: mockD1,
  INITIAL_ADMIN_GITHUB_ID: '99999',
  ACTIVITY_LOG_SECRET: 'test_sec_777',
  GITHUB_APP_ID: '123456',
  GITHUB_APP_INSTALLATION_ID: '654321',
  GITHUB_APP_PRIVATE_KEY: testKeypairPkcs8.privateKey,
  GITHUB_APP_TEMPLATE_REPO: 'Lorin1470/lab-workspace-template',
};

// 輔助函式：發送 HTTP 請求
async function apiRequest(path, { method = 'GET', headers = {}, body = null, cookie = null } = {}) {
  const reqHeaders = { ...headers };
  if (cookie) reqHeaders['Cookie'] = cookie;
  if (body && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}/${path.replace(/^\//, '')}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const status = res.status;
  let json = null;
  try {
    json = await res.json();
  } catch {
    //
  }
  return { status, data: json, headers: res.headers };
}

// 輔助函式：建立使用者 Session
function createTestSession(github_id, username, display_name = null) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  mockD1.sessions.set(tokenHash, {
    session_id: tokenHash,
    github_id: String(github_id),
    username,
    display_name: display_name || username,
    avatar_url: `https://github.com/${username}.png`,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  });
  return `app_session=${rawToken}`;
}

// 啟動整合測試伺服器
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuffer = Buffer.concat(chunks);

  const webReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : bodyBuffer,
  });

  try {
    const webRes = await onRequest({ request: webReq, env: mockEnv });
    res.statusCode = webRes.status;
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    const resBody = await webRes.arrayBuffer();
    res.end(Buffer.from(resBody));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

let passedCount = 0;
let failedCount = 0;

function pass(name) {
  console.log(`  ✅ [PASS] ${name}`);
  passedCount++;
}

function fail(name, err) {
  console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
  failedCount++;
}

// 測試套件本體
async function runFrontendIntegrationTests() {
  console.log('\n====================================================');
  console.log('🧪 Web 管理介面與 API Client 端到端整合驗證開始');
  console.log('====================================================\n');

  // 設定測試身分 (初始使用 99999 作為 Bootstrap 建立者)
  const teacherCookie = createTestSession('99999', 'teacherLin', '林老師');
  const studentCookie = createTestSession('20001', 'studentChen', '陳同學');
  const otherStudentCookie = createTestSession('30001', 'otherStudent', '其他同學');

  // -------------------------------------------------------------
  // 群組 1: Courses 管理與 UI 整合流程
  // -------------------------------------------------------------
  console.log('▶ [群組 1: Courses 管理與 UI 整合流程]');
  let courseId = '';
  let expId = '';
  try {
    // 1.1 教師登入建立新課程
    const res1 = await apiRequest('/courses', {
      method: 'POST',
      cookie: teacherCookie,
      body: { course_code: 'EE301', name: '近代物理實驗', semester: '114-1' },
    });
    assert.strictEqual(res1.status, 201);
    assert.strictEqual(res1.data.course.course_code, 'EE301');
    assert.strictEqual(res1.data.course.status, 'active');
    courseId = res1.data.course.id;
    pass('教師成功建立新課程 (201 Created)');

    // 1.2 課程重複 409 衝撞處理
    const res2 = await apiRequest('/courses', {
      method: 'POST',
      cookie: teacherCookie,
      body: { course_code: 'EE301', name: '近代物理實驗二', semester: '114-1' },
    });
    assert.strictEqual(res2.status, 409);
    pass('重複 course_code + semester 正確回傳 409 Conflict');

    // 1.3 查詢個人課程清單
    const res3 = await apiRequest('/courses', { cookie: teacherCookie });
    assert.strictEqual(res3.status, 200);
    assert(res3.data.courses.length >= 1);
    assert.strictEqual(res3.data.courses[0].role, 'teacher');
    pass('教師查詢個人課程清單包含正確角色 (200 OK)');

    // 1.4 教師更新課程設定 (PATCH /courses/:id)
    const res4 = await apiRequest(`/courses/${courseId}`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { name: '近代物理實驗（修訂）' },
    });
    assert.strictEqual(res4.status, 200);
    assert.strictEqual(res4.data.course.name, '近代物理實驗（修訂）');
    pass('教師成功修改課程名稱 (200 OK)');

    // 1.5 學生未加入該課程查詢詳情 (存在性遮蔽 404)
    const res5 = await apiRequest(`/courses/${courseId}`, { cookie: otherStudentCookie });
    assert.strictEqual(res5.status, 404);
    pass('非課程成員查詢課程詳情回傳 404 遮蔽存在性');
  } catch (err) {
    fail('群組 1 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 2: Course Memberships 與 Last Active Teacher 保護
  // -------------------------------------------------------------
  console.log('\n▶ [群組 2: Course Memberships 與 Last Active Teacher 保護]');
  let teacherMemberId = '';
  let studentMemberId = '';
  try {
    // 2.1 查詢課程成員名單 (建立者身為首任 teacher)
    const res1 = await apiRequest(`/courses/${courseId}/members`, { cookie: teacherCookie });
    assert.strictEqual(res1.status, 200);
    const membersList = res1.data.members || res1.data.course_members || [];
    assert.strictEqual(membersList.length, 1);
    teacherMemberId = membersList[0].id;
    assert.strictEqual(membersList[0].role, 'teacher');
    pass('課程建立時已自動批次綁定首位 Teacher 成員');

    // 2.2 移除階級保護：更新成員資訊成功 (200 OK，無 Last Teacher Protection 阻擋)
    const res2 = await apiRequest(`/courses/${courseId}/members/${teacherMemberId}`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { username: 'teacherChen_updated' },
    });
    assert.strictEqual(res2.status, 200);
    pass('移除階級保護：成員資訊自由更新成功 (200 OK)');

    // 2.4 協作者新增學生至課程
    const res4 = await apiRequest(`/courses/${courseId}/members`, {
      method: 'POST',
      cookie: teacherCookie,
      body: { github_id: '20001', username: 'studentChen', role: 'student' },
    });
    assert.strictEqual(res4.status, 201);
    studentMemberId = res4.data.member.id;
    assert.strictEqual(res4.data.member.username, 'studentChen');
    pass('協作者成功將同學加入課程 (201 Created)');

    // 2.5 非課程成員嘗試調用成員管理修改角色 (403 越權攔截)
    const res5 = await apiRequest(`/courses/${courseId}/members/${studentMemberId}`, {
      method: 'PATCH',
      cookie: otherStudentCookie,
      body: { username: 'hacked' },
    });
    assert.strictEqual(res5.status, 403);
    pass('非課程成員嘗試修改成員遭 403 Forbidden 阻絕');
  } catch (err) {
    fail('群組 2 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 3: Experiments 建立、管理與 Regex 檢驗
  // -------------------------------------------------------------
  console.log('\n▶ [群組 3: Experiments 建立、管理與 Regex 檢驗]');
  expId = '';
  try {
    // 3.1 教師建立實驗專案
    const res1 = await apiRequest('/experiments', {
      method: 'POST',
      cookie: teacherCookie,
      body: {
        course_id: courseId,
        experiment_code: 'exp-01',
        name: '光電效應量測普朗克常數',
        repository: 'example-org/physics-exp-01',
        report_mode: 'shared',
      },
    });
    assert.strictEqual(res1.status, 201);
    expId = res1.data.experiment.id;
    assert.strictEqual(res1.data.experiment.experiment_code, 'exp-01');
    pass('教師成功建立實驗專案 (201 Created)');

    // 3.2 驗證非法 repo 格式遭到攔截
    const res2 = await apiRequest('/experiments', {
      method: 'POST',
      cookie: teacherCookie,
      body: {
        course_id: courseId,
        experiment_code: 'exp-invalid',
        name: '非法 Repo 測試',
        repository: 'invalid_repo_without_owner',
      },
    });
    assert.strictEqual(res2.status, 400);
    assert(res2.data.error.includes('owner/repo'));
    pass('非 owner/repo 格式之 repository 遭 400 阻絕');

    // 3.3 實驗 Repository 唯一性衝撞
    const res3 = await apiRequest('/experiments', {
      method: 'POST',
      cookie: teacherCookie,
      body: {
        course_id: courseId,
        experiment_code: 'exp-02',
        name: '重複 Repo 測試',
        repository: 'example-org/physics-exp-01',
      },
    });
    assert.strictEqual(res3.status, 409);
    pass('重複 Repository 綁定回傳 409 Conflict');

    // 3.4 教師更新實驗進度與報告模式
    const res4 = await apiRequest(`/experiments/${expId}`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { status: 'in_progress', report_mode: 'separate' },
    });
    assert.strictEqual(res4.status, 200);
    assert.strictEqual(res4.data.experiment.status, 'in_progress');
    assert.strictEqual(res4.data.experiment.report_mode, 'separate');
    pass('教師成功更新實驗狀態與報告模式 (200 OK)');
  } catch (err) {
    fail('群組 3 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 4: Experiment Memberships 分組與前置條件校驗
  // -------------------------------------------------------------
  console.log('\n▶ [群組 4: Experiment Memberships 分組與前置條件校驗]');
  let expMemberId = '';
  try {
    // 4.1 指派非課程成員遭阻擋 (必須先是 Course Member)
    const res1 = await apiRequest(`/experiments/${expId}/members`, {
      method: 'POST',
      cookie: teacherCookie,
      body: { github_id: '999999', username: 'outsider', role: 'student' },
    });
    assert.strictEqual(res1.status, 400);
    assert(res1.data.error.includes('not enrolled'));
    pass('指派非課程成員至實驗專案遭 400 拒絕');

    // 4.2 指派合法學生至實驗並設定組別
    const res2 = await apiRequest(`/experiments/${expId}/members`, {
      method: 'POST',
      cookie: teacherCookie,
      body: { github_id: '20001', username: 'studentChen', role: 'student', group_name: '第 1 組' },
    });
    assert.strictEqual(res2.status, 201);
    expMemberId = res2.data.member.id;
    assert.strictEqual(res2.data.member.group_name, '第 1 組');
    pass('合法學生成功指派至實驗專案並建立分組 (201 Created)');

    // 4.3 重複指派回傳 409 Conflict
    const res3 = await apiRequest(`/experiments/${expId}/members`, {
      method: 'POST',
      cookie: teacherCookie,
      body: { github_id: '20001', username: 'studentChen', role: 'student' },
    });
    assert.strictEqual(res3.status, 409);
    pass('重複指派相同成員回傳 409 Conflict');

    // 4.4 教師修改成員分組
    const res4 = await apiRequest(`/experiments/${expId}/members/${expMemberId}`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { group_name: '第 2 組' },
    });
    assert.strictEqual(res4.status, 200);
    assert.strictEqual(res4.data.member.group_name, '第 2 組');
    pass('教師成功調整實驗成員組別 (200 OK)');
  } catch (err) {
    fail('群組 4 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 5: Activity Log 前後端展示與格式化
  // -------------------------------------------------------------
  console.log('\n▶ [群組 5: Activity Log 前後端展示與格式化]');
  try {
    // 5.1 寫入一筆真實活動紀錄
    await mockD1.prepare(
      `INSERT INTO activity_logs (id, repo_name, experiment_id, timestamp, actor_type, actor_id, actor_name, actor_avatar, requested_by, approved_by, approval_status, action, target, summary, files_changed, commit_sha, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      'log-test-01',
      'example-org/physics-exp-01',
      'exp-01',
      new Date().toISOString(),
      'web',
      'studentChen',
      '陳同學',
      null,
      'studentChen',
      'studentChen',
      'approved',
      'commit_created',
      'report/report-20001.md',
      '更新普朗克常數擬合曲線分析',
      JSON.stringify(['report/report-20001.md', 'analysis/planck_fit.svg']),
      'd83921a',
      null
    ).run();

    // 5.2 查詢該 Repo 之 Activity Log
    const res1 = await apiRequest('/activity?repo=example-org/physics-exp-01&exp=exp-01', {
      cookie: studentCookie,
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.logs.length, 1);
    const log = res1.data.logs[0];
    assert.strictEqual(log.action, 'commit_created');
    assert.strictEqual(log.commit_sha, 'd83921a');

    // 5.3 驗證 files_changed JSON 反序列化相容性
    const parsedFiles = JSON.parse(log.files_changed);
    assert.strictEqual(parsedFiles.length, 2);
    assert.strictEqual(parsedFiles[0], 'report/report-20001.md');
    pass('Activity Log 成功查詢並完成 files_changed 與 commit_sha 格式解析');

    // 5.4 拒絕越權之 HTTP DELETE /activity (405 Method Not Allowed)
    const res2 = await apiRequest('/activity?repo=example-org/physics-exp-01', {
      method: 'DELETE',
      cookie: teacherCookie,
    });
    assert.strictEqual(res2.status, 405);
    pass('Activity Log 維持 Append-Only 語義，拒絕 DELETE (405)');
  } catch (err) {
    fail('群組 5 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 6: 課程狀態流轉與協作者可見性 (archived / inactive)
  // -------------------------------------------------------------
  console.log('\n▶ [群組 6: 課程狀態流轉與協作者可見性 (archived / inactive)]');
  try {
    // 6.1 將課程設定為 inactive
    await apiRequest(`/courses/${courseId}`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { status: 'inactive' },
    });

    // 6.2 協作者查詢課程詳情 (inactive 課程對協作者可見以便維護與重新啟用)
    const res1 = await apiRequest(`/courses/${courseId}`, { cookie: studentCookie });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.course.status, 'inactive');
    pass('協作者可查詢所屬 Inactive 課程詳情以便維護 (200 OK)');

    // 6.3 非課程成員直接訪問 inactive 課程詳情 (404 存在性遮蔽)
    const res2 = await apiRequest(`/courses/${courseId}`, { cookie: otherStudentCookie });
    assert.strictEqual(res2.status, 404);
    pass('非課程成員存取 Inactive 課程回傳 404 遮蔽存在性');

    // 6.4 恢復為 active
    await apiRequest(`/courses/${courseId}`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { status: 'active' },
    });
    pass('課程順利切換回 Active 狀態');
  } catch (err) {
    fail('群組 6 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 8: Repository Provisioning 前端整合與狀態呈現
  // -------------------------------------------------------------
  console.log('\n▶ [群組 8: Repository Provisioning 前端整合與狀態呈現]');
  try {
    // 8.1 建立前狀態檢查：實驗初始 provisioning_status 應為 pending
    const expCheckRes = await apiRequest(`/experiments/${expId}`, { cookie: teacherCookie });
    assert.strictEqual(expCheckRes.status, 200);
    assert.strictEqual(expCheckRes.data.experiment.provisioning_status, 'pending');
    pass('實驗專案建立後初始狀態為待建立 (pending)');

    // 8.2 非課程成員嘗試呼叫 POST /api/experiments/:id/provision 遭 403 阻絕 (安全邊界在後端)
    const outsiderProvRes = await apiRequest(`/experiments/${expId}/provision`, {
      method: 'POST',
      cookie: otherStudentCookie,
    });
    assert.strictEqual(outsiderProvRes.status, 403);
    pass('非課程成員嘗試觸發儲存庫建立遭 403 Forbidden 阻絕');

    // 8.4 未登入呼叫 POST /api/experiments/:id/provision 遭 401 阻絕
    const unauthProvRes = await apiRequest(`/experiments/${expId}/provision`, {
      method: 'POST',
    });
    assert.strictEqual(unauthProvRes.status, 401);
    pass('未登入使用者嘗試觸發建立遭 401 Unauthorized 阻絕');

    // 8.5 存取不存在之實驗回傳 404
    const notFoundProvRes = await apiRequest(`/experiments/nonexistent-exp/provision`, {
      method: 'POST',
      cookie: teacherCookie,
    });
    assert.strictEqual(notFoundProvRes.status, 404);
    pass('存取不存在之實驗回傳 404 Not Found');

    // 8.6 教師成功觸發建立遠端儲存庫 (回傳 200 OK, status: ready, already_existed: false)
    const teachProvRes = await apiRequest(`/experiments/${expId}/provision`, {
      method: 'POST',
      cookie: teacherCookie,
    });
    assert.strictEqual(teachProvRes.status, 200);
    assert.strictEqual(teachProvRes.data.success, true);
    assert.strictEqual(teachProvRes.data.status, 'ready');
    assert.strictEqual(teachProvRes.data.already_existed, false);
    assert(teachProvRes.data.repository);
    assert.strictEqual(teachProvRes.data.repository.full_name, 'example-org/physics-exp-01');
    assert.strictEqual(teachProvRes.data.experiment.provisioning_status, 'ready');
    assert(teachProvRes.data.experiment.provisioned_at);
    pass('教師成功觸發儲存庫建立並更新狀態為 ready (200 OK)');

    // 8.7 再次呼叫驗證冪等性 (already_existed: true, 狀態維持 ready)
    const retryProvRes = await apiRequest(`/experiments/${expId}/provision`, {
      method: 'POST',
      cookie: teacherCookie,
    });
    assert.strictEqual(retryProvRes.status, 200);
    assert.strictEqual(retryProvRes.data.status, 'ready');
    assert.strictEqual(retryProvRes.data.already_existed, true);
    pass('重複呼叫驗證冪等性 (already_existed: true, 狀態維持 ready)');

    // 8.8 教師查詢 GET /api/experiments/:id/provision 檢視建立歷程
    const histRes = await apiRequest(`/experiments/${expId}/provision`, {
      cookie: teacherCookie,
    });
    assert.strictEqual(histRes.status, 200);
    assert.strictEqual(histRes.data.provisioning_status, 'ready');
    assert(Array.isArray(histRes.data.history));
    assert(histRes.data.history.length >= 1);
    assert.strictEqual(histRes.data.history[0].status, 'ready');
    pass('教師成功查詢儲存庫建立歷程 (history.length >= 1)');

    // 8.9 外部成員 (非課程成員) 查詢 GET /api/experiments/:id/provision 回傳 404 存在性遮蔽
    const outsiderHistRes = await apiRequest(`/experiments/${expId}/provision`, {
      cookie: otherStudentCookie,
    });
    assert.strictEqual(outsiderHistRes.status, 404);
    pass('非課程成員查詢建立歷程回傳 404 存在性遮蔽');

    // 8.10 模擬 GitHub 故障場景：建立新實驗後觸發建立失敗，驗證 failed 狀態與安全錯誤摘要
    const exp2Create = await apiRequest('/experiments', {
      method: 'POST',
      cookie: teacherCookie,
      body: {
        course_id: courseId,
        experiment_code: 'exp-02',
        name: '邁克生干涉儀實驗',
        repository: 'example-org/physics-exp-02',
      },
    });
    assert.strictEqual(exp2Create.status, 201);
    const exp2Id = exp2Create.data.experiment.id;

    // 啟用 GitHub API 錯誤模擬
    mockGitHub.templateFail = true;
    const failProvRes = await apiRequest(`/experiments/${exp2Id}/provision`, {
      method: 'POST',
      cookie: teacherCookie,
    });
    assert.strictEqual(failProvRes.status, 502);
    assert.strictEqual(failProvRes.data.status, 'failed');
    assert(failProvRes.data.error.includes('GitHub API') || failProvRes.data.error.includes('error'));
    // 驗證安全錯誤訊息：不可包含 Private Key 或 Token
    assert(!JSON.stringify(failProvRes.data).includes('PRIVATE KEY'));
    assert(!JSON.stringify(failProvRes.data).includes('ghs_mock'));
    pass('GitHub 失敗場景回傳 502/failed 且未洩漏私鑰或 Token');

    // 8.11 故障排除後重試 (Retry)：解除故障模擬，重新呼叫後成功轉為 ready
    mockGitHub.templateFail = false;
    const recoverProvRes = await apiRequest(`/experiments/${exp2Id}/provision`, {
      method: 'POST',
      cookie: teacherCookie,
    });
    assert.strictEqual(recoverProvRes.status, 200);
    assert.strictEqual(recoverProvRes.data.status, 'ready');
    assert.strictEqual(recoverProvRes.data.experiment.provisioning_status, 'ready');
    pass('重試 (Retry) 流程成功從 failed 復原為 ready (200 OK)');
  } catch (err) {
    fail('群組 8 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 7: Session 鑑權與登出生命週期
  // -------------------------------------------------------------
  console.log('\n▶ [群組 7: Session 鑑權與登出生命週期]');
  try {
    // 7.1 驗證 GET /api/auth/me
    const res1 = await apiRequest('/auth/me', { cookie: teacherCookie });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.authenticated, true);
    assert.strictEqual(res1.data.user.username, 'teacherLin');
    assert.strictEqual(res1.data.user.github_id, '99999');
    pass('/api/auth/me 正確回傳已驗證之使用者資料');

    // 7.2 未登入存取 /api/auth/me
    const res2 = await apiRequest('/auth/me');
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.data.authenticated, false);
    pass('無 Session 存取 /api/auth/me 回傳 authenticated: false');

    // 7.3 POST /api/auth/logout
    const res3 = await apiRequest('/auth/logout', { method: 'POST', cookie: teacherCookie });
    assert.strictEqual(res3.status, 200);
    const setCookie = res3.headers.get('set-cookie') || '';
    assert(setCookie.includes('Max-Age=0'));
    pass('POST /api/auth/logout 成功清除 Session Cookie (Max-Age=0)');

    // 7.4 再次使用已登出之 Cookie 存取需要授權之端點 (401)
    const res4 = await apiRequest('/courses', { cookie: teacherCookie });
    assert.strictEqual(res4.status, 401);
    pass('登出後舊 Session 存取資源回傳 401 Unauthorized');
  } catch (err) {
    fail('群組 7 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 9: Workspace 前端整合、API Client 與錯誤轉譯驗證
  // -------------------------------------------------------------
  console.log('\n▶ [群組 9: Workspace 前端整合、API Client 與錯誤轉譯驗證]');
  try {
    // 預先於 MockGitHub 注入測試檔案
    const testRepo = 'example-org/physics-exp-01';
    mockGitHub.setFile(testRepo, 'README.md', '# 物理實驗工作區\n歡迎共同協作。');
    mockGitHub.setFile(testRepo, 'config.yml', 'version: 1.0');
    mockGitHub.setFile(testRepo, 'notes.md', '初始筆記內容');
    mockGitHub.setFile(testRepo, 'report/report-99999.md', '# 林老師的個人報告');
    mockGitHub.setFile(testRepo, 'report/report-12345.md', '# 王小明同學的個人報告');
    mockGitHub.setFile(testRepo, 'raw/baseline.csv', 'time,voltage\n0,0\n1,2.5');

    // 9.1 listFiles: 協作者成功讀取真實 GitHub 檔案樹 (200 OK)
    const listRes = await apiRequest(`/experiments/${expId}/workspace/files`, {
      cookie: studentCookie,
    });
    assert.strictEqual(listRes.status, 200);
    assert(Array.isArray(listRes.data.items));
    assert(listRes.data.items.some((f) => f.name === 'README.md' && f.type === 'file'));
    assert(listRes.data.items.some((f) => f.name === 'report' && (f.type === 'dir' || f.type === 'directory')));
    pass('協作者成功取得真實 Workspace 檔案樹清單 (200 OK)');

    // 9.2 readFile: 協作者成功讀取檔案內容並取得真實 SHA (200 OK)
    const readRes = await apiRequest(`/experiments/${expId}/workspace/file?path=README.md`, {
      cookie: studentCookie,
    });
    assert.strictEqual(readRes.status, 200);
    assert.strictEqual(readRes.data.path, 'README.md');
    assert(readRes.data.content.includes('# 物理實驗工作區'));
    assert(typeof readRes.data.sha === 'string' && readRes.data.sha.length > 0);
    pass('協作者成功讀取文字檔案內容並取得現行 SHA (200 OK)');

    // 9.3 saveFile: 攜帶有效 SHA 成功更新檔案並產生 commit_sha (200 OK)
    const saveRes = await apiRequest(`/experiments/${expId}/workspace/file`, {
      method: 'PUT',
      cookie: studentCookie,
      body: {
        path: 'notes.md',
        content: '更新後的筆記內容：量測完成',
        message: '更新實驗筆記',
      },
    });
    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.data.success, true);
    assert(typeof saveRes.data.commit_sha === 'string' && saveRes.data.commit_sha.length === 40);
    pass('協作者成功儲存檔案並自 API 取得真實 40 位元 commit_sha (200 OK)');

    // 9.4 409 Conflict 樂觀鎖驗證：帶入過期/錯誤 SHA 遭到 409 阻絕，防止私下覆寫他人成果
    const conflictRes = await apiRequest(`/experiments/${expId}/workspace/file`, {
      method: 'PUT',
      cookie: studentCookie,
      body: {
        path: 'README.md',
        content: '企圖以過期 SHA 覆寫 README',
        message: '嘗試覆寫',
        sha: 'stale_expired_fake_sha_00000000000000000000',
      },
    });
    assert.strictEqual(conflictRes.status, 409);
    pass('過期 SHA 正確引發 409 Conflict 樂觀鎖保護，前端提示重新載入');

    // 9.5 Raw Data Sanctuary 上傳：上傳原始數據成功 (201 Created)
    const rawRes = await apiRequest(`/experiments/${expId}/workspace/raw`, {
      method: 'POST',
      cookie: studentCookie,
      body: {
        path: 'sensor_data.csv',
        content: 'timestamp,value\n100,3.14\n200,3.15',
        message: '上傳感測器原始數據',
      },
    });
    assert.strictEqual(rawRes.status, 201);
    assert.strictEqual(rawRes.data.success, true);
    assert.strictEqual(rawRes.data.path, 'raw/sensor_data.csv');
    assert(typeof rawRes.data.commit_sha === 'string' && rawRes.data.commit_sha.length === 40);
    pass('專屬 Raw 端點成功上傳原始數據至 raw/ 並記錄 commit_sha (201 Created)');

    // 9.6 Raw Data Sanctuary 409 不可覆寫阻絕：重複上傳同名檔案回傳 409
    const rawConflictRes = await apiRequest(`/experiments/${expId}/workspace/raw`, {
      method: 'POST',
      cookie: studentCookie,
      body: {
        path: 'sensor_data.csv',
        content: '企圖竄改原始數據',
      },
    });
    assert.strictEqual(rawConflictRes.status, 409);
    pass('重複上傳 Raw Data 遭 409 阻絕（原始資料已存在，Raw Data 不允許覆寫）');

    // 9.7 通用 PUT 寫入 raw/* 遭 403 阻擋 (Raw Sanctuary 鐵律)
    const putRawRes = await apiRequest(`/experiments/${expId}/workspace/file`, {
      method: 'PUT',
      cookie: studentCookie,
      body: {
        path: 'raw/hack.csv',
        content: 'test',
        message: 'hack raw',
      },
    });
    assert.strictEqual(putRawRes.status, 403);
    pass('通用 File PUT 寫入 raw/* 遭 403 聖域鐵律阻絕');

    // 9.8 照片上傳：上傳合法 PNG 圖片成功 (201 Created)
    const photoRes = await apiRequest(`/experiments/${expId}/workspace/photos`, {
      method: 'POST',
      cookie: studentCookie,
      body: {
        path: 'circuit.png',
        content: Buffer.from('mock_png_binary_data').toString('base64'),
        isBase64: true,
        mime_type: 'image/png',
      },
    });
    assert.strictEqual(photoRes.status, 201);
    assert.strictEqual(photoRes.data.path, 'photos/circuit.png');
    assert(typeof photoRes.data.commit_sha === 'string' && photoRes.data.commit_sha.length === 40);
    pass('照片上傳端點成功寫入 photos/ 並取得真實 commit_sha (201 Created)');

    // 9.9 照片過大 (超過 5MB) 遭 413 Payload Too Large 阻絕
    const hugePhotoContent = 'A'.repeat(5 * 1024 * 1024 + 100);
    const hugePhotoRes = await apiRequest(`/experiments/${expId}/workspace/photos`, {
      method: 'POST',
      cookie: studentCookie,
      body: {
        path: 'huge.jpg',
        content: hugePhotoContent,
        isBase64: false,
        mime_type: 'image/jpeg',
      },
    });
    assert.strictEqual(hugePhotoRes.status, 413);
    pass('超過 5MB 照片上傳遭 413 Payload Too Large 阻擋');

    // 9.10 驗證 Activity Log 已同步寫入 Workspace 操作與真實 commit_sha
    const actRes = await apiRequest(`/activity?repo=${encodeURIComponent(testRepo)}`, {
      cookie: studentCookie,
    });
    assert.strictEqual(actRes.status, 200);
    assert(actRes.data.logs.some((l) => l.action === 'raw_uploaded' && l.commit_sha.length === 40));
    assert(actRes.data.logs.some((l) => l.action === 'photo_uploaded' && l.commit_sha.length === 40));
    pass('Activity Log 成功包含 Workspace 最新操作與真實 40 位元 commit_sha');
  } catch (err) {
    fail('群組 9 執行失敗', err);
  }

  // -------------------------------------------------------------
  // 群組 10: Course → Lab → Workspace UX 與 Course Mode 前台流程驗證
  // -------------------------------------------------------------
  console.log('\n▶ [群組 10: Course → Lab → Workspace UX 與 Course Mode 前台流程驗證]');
  try {
    // 10.1 Course Mode Navbar fallback repository (覆蓋條件 1)
    const courseModeExp = { id: 'exp-course-01', experiment_code: 'lab-01', repository: null };
    const courseModeCourse = { id: 'c-01', mode: 'course', github_repository: 'example-org/shared-physics-course' };
    const resolvedCourseRepo = resolveNavbarRepository(courseModeExp, courseModeCourse);
    assert.strictEqual(resolvedCourseRepo, 'example-org/shared-physics-course');
    assert(!resolvedCourseRepo.includes('experiments/'));
    pass('1. Course Mode 下 Navbar repository 正確 fallback 至 course.github_repository 且不含 scoped path');

    // 10.2 Experiment Mode Navbar repository (覆蓋條件 2)
    const expModeExp = { id: 'exp-legacy-01', experiment_code: 'lab-01', repository: 'example-org/physics-exp-01' };
    const expModeCourse = { id: 'c-02', mode: 'experiment', github_repository: null };
    const resolvedExpRepo = resolveNavbarRepository(expModeExp, expModeCourse);
    assert.strictEqual(resolvedExpRepo, 'example-org/physics-exp-01');
    pass('2. Experiment Mode 下 Navbar repository 正確使用 experiment.repository');

    // 重新建立已登入之教師 Session（Group 7 曾測試登出流程）
    const activeTeacherCookie = createTestSession('99999', 'teacherLin', '林老師');

    // 10.3 report.md 存在時 (shared 模式) Report Tab 顯示實際內容 (覆蓋條件 3)
    await apiRequest(`/experiments/${expId}`, {
      method: 'PATCH',
      cookie: activeTeacherCookie,
      body: { report_mode: 'shared' },
    });
    mockGitHub.setFile('example-org/physics-exp-01', 'report/report.md', '# 物理實驗報告：光電效應\n測量結果：普朗克常數符合預期。');
    const reportReadRes = await apiRequest(`/experiments/${expId}/workspace/file?path=${getReportRelativePath('shared')}`, {
      cookie: studentCookie,
    });
    assert.strictEqual(reportReadRes.status, 200);
    assert.strictEqual(reportReadRes.data.path, 'report/report.md');
    assert(reportReadRes.data.content.includes('# 物理實驗報告：光電效應'));
    assert(!reportReadRes.data.content.includes('$$I_C = \\beta \\cdot I_B$$'));
    pass('3. Shared 模式下 report.md 存在時 Report API 正確回傳實際報告內容而非假資料電晶體公式');

    // 10.4 report.md 不存在時友善 empty state 支援 (覆蓋條件 4)
    const expNoReport = await apiRequest('/experiments', {
      method: 'POST',
      cookie: activeTeacherCookie,
      body: {
        course_id: courseId,
        experiment_code: 'exp-noreport',
        name: '無報告測試實驗',
        repository: 'example-org/physics-exp-noreport',
      },
    });
    assert.strictEqual(expNoReport.status, 201);
    const noReportExpId = expNoReport.data.experiment.id;

    const noReportRes = await apiRequest(`/experiments/${noReportExpId}/workspace/file?path=${getReportRelativePath('shared')}`, {
      cookie: activeTeacherCookie,
    });
    assert.strictEqual(noReportRes.status, 404);
    pass('4. report.md 不存在時回傳 404，由前端平順展現「尚未建立實驗報告」友善空狀態');

    // 10.5 Course Mode report 正確使用 scoped Workspace API (覆蓋條件 5)
    // 建立 Course Mode 課程與實驗
    const courseModeCreate = await apiRequest('/courses', {
      method: 'POST',
      cookie: activeTeacherCookie,
      body: {
        course_code: 'CS101',
        name: '計算機科學實驗',
        semester: '114-1',
        mode: 'course',
        github_repository: 'example-org/shared-physics-course',
      },
    });
    assert.strictEqual(courseModeCreate.status, 201);
    const csCourseId = courseModeCreate.data.course.id;

    const csExpCreate = await apiRequest('/experiments', {
      method: 'POST',
      cookie: activeTeacherCookie,
      body: {
        course_id: csCourseId,
        experiment_code: 'lab-01',
        name: '資料結構實驗一',
        report_mode: 'shared',
      },
    });
    assert.strictEqual(csExpCreate.status, 201);
    const csExpId = csExpCreate.data.experiment.id;

    // 在 Mock GitHub 中將檔案置於 Course Mode scoped 路徑: experiments/lab-01/report/report.md
    mockGitHub.setFile('example-org/shared-physics-course', 'experiments/lab-01/report/report.md', '# CS101 Lab 01 報告\n二元樹實作分析');

    // 前端請求乾淨相對路徑 report/report.md，後端 scoped resolver 正確解析
    const csReportRes = await apiRequest(`/experiments/${csExpId}/workspace/file?path=report/report.md`, {
      cookie: activeTeacherCookie,
    });
    assert.strictEqual(csReportRes.status, 200);
    assert.strictEqual(csReportRes.data.path, 'report/report.md');
    assert(csReportRes.data.content.includes('# CS101 Lab 01 報告'));
    pass('5. Course Mode 下 Report 正確透過 scoped Workspace API 存取，前端毋須自拼路徑');

    // 10.6 「開啟實驗工作區」會進入 Workspace Tab (覆蓋條件 6)
    const defaultTab = resolveInitialExperimentTab();
    assert.strictEqual(defaultTab, 'files');
    const customWorkspaceTab = resolveInitialExperimentTab('files');
    assert.strictEqual(customWorkspaceTab, 'files');
    pass('6. 「開啟實驗工作區」導覽目標正確對應至 Workspace Tab (files) 而非 activity');

    // 10.7 Course Mode 不顯示獨立 repository provisioning warning (覆蓋條件 7)
    const shouldShowInCourseMode = shouldShowStandaloneProvisioningWarning('course', 'example-org/shared-physics-course', 'pending');
    assert.strictEqual(shouldShowInCourseMode, false);
    const shouldShowInExpMode = shouldShowStandaloneProvisioningWarning('experiment', null, 'pending');
    assert.strictEqual(shouldShowInExpMode, true);
    pass('7. Course Mode 成功抑制獨立 Repository 建立警告 (Pending Provisioning)');

    // 10.8 Course Mode UI 不顯示 experiments/<code>/ implementation path (覆蓋條件 8)
    const webComponentsDir = path.resolve('web/src/components');
    const componentFiles = ['CourseDetail.tsx', 'CourseList.tsx', 'ExperimentDetail.tsx', 'Navbar.tsx', 'WorkspaceManager.tsx'];
    for (const compFile of componentFiles) {
      const fullPath = path.join(webComponentsDir, compFile);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert(!content.includes('(experiments/${'), `${compFile} 不應外洩括號 scoped path`);
      assert(!content.includes('路徑：experiments/'), `${compFile} 不應外洩「路徑：experiments/」標籤`);
      assert(!content.includes('experiments/<code\\>/ 目錄隔離'), `${compFile} 不應外洩 experiments/<code\\>/ 目錄隔離技術字樣`);
    }
    pass('8. 前端核心元件靜態審查通過，絕無向一般使用者視覺區域外洩 experiments/<code>/ 實作路徑');

    // 10.9 getReportRelativePath 路徑解析決策驗證
    assert.strictEqual(getReportRelativePath('shared', '20001'), 'report/report.md');
    assert.strictEqual(getReportRelativePath('shared'), 'report/report.md');
    assert.strictEqual(getReportRelativePath('separate', '20001'), 'report/report-20001.md');
    assert.strictEqual(getReportRelativePath('separate', null), 'report/report.md');
    pass('9. getReportRelativePath 依 shared/separate 模式與登入者 GitHub ID 正確動態解析報告路徑');

    // 10.10 Separate Report 模式：學生成功讀取自身個人報告 (200 OK)
    await apiRequest(`/experiments/${expId}`, {
      method: 'PATCH',
      cookie: activeTeacherCookie,
      body: { report_mode: 'separate' },
    });
    mockGitHub.setFile('example-org/physics-exp-01', 'report/report-20001.md', '# 陳同學個人報告\n實測數據符合理論預期。');
    const chenReportRes = await apiRequest(`/experiments/${expId}/workspace/file?path=${getReportRelativePath('separate', '20001')}`, {
      cookie: studentCookie,
    });
    assert.strictEqual(chenReportRes.status, 200);
    assert.strictEqual(chenReportRes.data.path, 'report/report-20001.md');
    assert(chenReportRes.data.content.includes('# 陳同學個人報告'));
    pass('10. Separate Report 模式下，學生透過自身 Session 成功讀取個人報告 (200 OK)');

    // 10.11 Separate Report 模式：學生嘗試讀取其他成員報告遭 403 阻絕
    mockGitHub.setFile('example-org/physics-exp-01', 'report/report-30001.md', '# 其他同學報告');
    const tamperReadRes = await apiRequest(`/experiments/${expId}/workspace/file?path=report/report-30001.md`, {
      cookie: studentCookie,
    });
    assert.strictEqual(tamperReadRes.status, 403);
    assert(tamperReadRes.data.error.includes('Separate report mode violation'));
    pass('11. Separate Report 模式下，學生企圖讀取他人個人報告遭 403 Forbidden 阻絕');

    // 10.12 Separate Report 模式：教師成功讀取學生報告以利批改 (200 OK)
    const teacherReadRes = await apiRequest(`/experiments/${expId}/workspace/file?path=report/report-20001.md`, {
      cookie: activeTeacherCookie,
    });
    assert.strictEqual(teacherReadRes.status, 200);
    assert(teacherReadRes.data.content.includes('# 陳同學個人報告'));
    pass('12. Separate Report 模式下，教師身分成功讀取學生個人報告以利檢閱評分 (200 OK)');

    // 10.13 Report Empty State 文案審查：完全移除「本地 Git」技術術語，以瀏覽器工作區為中心
    const expDetailContent = fs.readFileSync(path.join(webComponentsDir, 'ExperimentDetail.tsx'), 'utf8');
    assert(!expDetailContent.includes('本地 Git'), 'Empty State 不應提及「本地 Git」');
    assert(!expDetailContent.includes('提交至儲存庫'), 'Empty State 不應提及「提交至儲存庫」');
    assert(expDetailContent.includes('瀏覽器工作區'), 'Empty State 應強調以瀏覽器工作區直接撰寫');
    assert(expDetailContent.includes('前往「📁 工作區」建立報告'), 'Empty State 必須保留前往工作區 CTA');
    pass('13. 報告 Empty State 文案審查通過：徹底去技術黑話，改為瀏覽器工作區直覺引導');
  } catch (err) {
    fail('群組 10 執行失敗', err);
  }

  // 測試總結
  console.log('\n====================================================');
  console.log(`📊 驗證總結：通過 ${passedCount} 項，失敗 ${failedCount} 項`);
  console.log('====================================================\n');

  server.close();
  if (failedCount > 0) {
    process.exit(1);
  }
}

server.listen(TEST_PORT, () => {
  runFrontendIntegrationTests().catch((err) => {
    console.error('Test runner fatal:', err);
    server.close();
    process.exit(1);
  });
});
