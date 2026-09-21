#!/usr/bin/env node

/**
 * verify-course-mode.mjs
 * 驗證 Course Mode (共享 Repository架構) 與 Legacy Experiment Mode 完整相容性
 *
 * 核心驗證項目：
 * 1. Course Mode 建立與 repository 格式檢驗 (預設 course mode，必須 owner/repo)
 * 2. 多個 Experiment 在同一 Course 共享 course.github_repository (repository 欄位存 NULL)
 * 3. 相同 Course 下 experiment_code 唯一性保護 (409 Conflict)，跨 Course 允許同名
 * 4. Provisioning 在 Course Mode 下的等冪性 (第一實驗建立 Repo，第二實驗 detected already_existed)
 * 5. GitHub API 呼叫永遠嚴格使用 owner/repo，絕不把 experiments/<code\> 拼入 repository 名稱
 * 6. Scoped Path 透明轉換：客戶端操作相對路徑，後端映射至 experiments/<code\>/...
 * 7. Scoped Path 目錄隔離：Exp 1 看不到、碰不到 Exp 2 的檔案
 * 8. 路徑穿越防護：../../ 或 URL 編碼穿越遭 400 阻絕
 * 9. Raw Data 聖域鐵律：PUT raw/* 遭 403，專用上傳可寫入 scoped raw/，重複上傳遭 409
 * 10. 報告模式 (Shared vs Separate) 在 Scoped Path 下的權限隔離
 * 11. Agent Context 與 Task 執行在 Scoped Path 下正常運作
 * 12. Activity Log 正確記錄 course.github_repository 作為 repo_name，避免 SQLite NOT NULL 違反
 * 13. 舊版 Experiment Mode 保持 100% 向後相容
 */

import http from "node:http";
import assert from "node:assert";
import crypto from "node:crypto";
import { onRequest } from "../web/functions/api/[[route]].ts";

const TEST_PORT = 9008;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// 產生測試用 RSA 私鑰 (GitHub App JWT 簽署)
const testKeypair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Mock D1 資料庫
class MockCourseModeD1 {
  constructor() {
    this.courses = new Map();
    this.experiments = new Map();
    this.courseMemberships = new Map();
    this.experimentMemberships = new Map();
    this.sessions = new Map();
    this.activityLogs = [];
    this.provisionHistory = [];
  }

  prepare(query) {
    const q = query.replace(/\s+/g, " ").trim();
    return {
      bind: (...binds) => ({
        run: async () => {
          if (q.startsWith("INSERT INTO courses")) {
            const [id, course_code, name, semester, status, mode, github_repository, created_by_github_id, created_at, updated_at] = binds;
            for (const c of this.courses.values()) {
              if (c.course_code === course_code && c.semester === semester) {
                throw new Error("UNIQUE constraint failed: courses.course_code, courses.semester");
              }
              if (github_repository && c.github_repository && c.github_repository.toLowerCase() === github_repository.toLowerCase()) {
                throw new Error("UNIQUE constraint failed: courses.github_repository");
              }
            }
            this.courses.set(id, {
              id,
              course_code,
              name,
              semester,
              status: status || "active",
              created_by_github_id,
              mode: mode || "course",
              github_repository: github_repository || null,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith("INSERT INTO experiments")) {
            const [id, course_id, experiment_code, name, repository, report_mode, config_version, status, created_at, updated_at] = binds;
            for (const exp of this.experiments.values()) {
              if (exp.course_id === course_id && exp.experiment_code === experiment_code) {
                throw new Error("UNIQUE constraint failed: experiments.course_id, experiments.experiment_code");
              }
              if (repository && exp.repository && exp.repository.toLowerCase() === repository.toLowerCase()) {
                throw new Error("UNIQUE constraint failed: experiments.repository");
              }
            }
            this.experiments.set(id, {
              id,
              course_id,
              experiment_code,
              name,
              repository: repository || null,
              report_mode: report_mode || "shared",
              config_version: config_version || "1.0",
              status: status || "not_started",
              provisioning_status: "pending",
              provisioning_error: null,
              provisioned_at: null,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith("INSERT INTO course_memberships")) {
            const [id, course_id, github_id, username, role, status, created_at, updated_at] = binds;
            this.courseMemberships.set(id, {
              id,
              course_id,
              github_id: String(github_id),
              username,
              role: role || "student",
              status: status || "active",
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith("INSERT INTO experiment_memberships")) {
            const [id, experiment_id, github_id, username, role, group_name, status, created_at, updated_at] = binds;
            this.experimentMemberships.set(id, {
              id,
              experiment_id,
              github_id: String(github_id),
              username,
              role: role || "student",
              group_name: group_name || null,
              status: status || "active",
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith("INSERT INTO activity_logs")) {
            const [id, repo_name, experiment_id, timestamp, actor_type, actor_id, actor_name, actor_avatar, requested_by, approved_by, approval_status, action, target, summary, files_changed, commit_sha] = binds;
            if (!repo_name) {
              throw new Error("NOT NULL constraint failed: activity_logs.repo_name");
            }
            this.activityLogs.push({
              id,
              repo_name,
              experiment_id,
              timestamp,
              actor_type,
              actor_id,
              actor_name,
              actor_avatar,
              requested_by,
              approved_by,
              approval_status,
              action,
              target,
              summary,
              files_changed,
              commit_sha,
            });
            return { success: true };
          }

          if (q.startsWith("INSERT INTO experiment_provisionings")) {
            const [id, experiment_id, repository, status, error_summary, trigger_by_github_id, created_at, updated_at] = binds;
            this.provisionHistory.push({
              id,
              experiment_id,
              repository,
              status,
              error_summary,
              trigger_by_github_id,
              created_at: created_at || new Date().toISOString(),
              updated_at: updated_at || new Date().toISOString(),
            });
            return { success: true };
          }

          if (q.startsWith("UPDATE experiments SET")) {
            const id = binds[binds.length - 1];
            const exp = this.experiments.get(id);
            if (exp) {
              if (q.includes('provisioning_status = "creating"') || q.includes("provisioning_status = 'creating'")) {
                exp.provisioning_status = 'creating';
                exp.provisioning_error = null;
              } else if (q.includes('provisioning_status = "ready"') || q.includes("provisioning_status = 'ready'")) {
                exp.provisioning_status = 'ready';
                exp.provisioning_error = null;
                exp.provisioned_at = binds[0];
              } else if (q.includes('provisioning_status = "failed"') || q.includes("provisioning_status = 'failed'")) {
                exp.provisioning_status = 'failed';
                exp.provisioning_error = binds[0];
              }
              exp.updated_at = new Date().toISOString();
            }
            return { success: true };
          }

          return { success: true };
        },

        first: async () => {
          if (q.includes("FROM user_sessions WHERE session_id = ?")) {
            return this.sessions.get(binds[0]) || null;
          }
          if (q.includes("FROM courses WHERE id = ?")) {
            return this.courses.get(binds[0]) || null;
          }
          if (q.includes("FROM courses WHERE github_repository = ?")) {
            const repo = binds[0];
            for (const c of this.courses.values()) {
              if (c.github_repository && c.github_repository.toLowerCase() === repo.toLowerCase()) {
                return { ...c };
              }
            }
            return null;
          }
          if (q.includes("FROM courses WHERE course_code = ? AND semester = ?")) {
            const [code, sem] = binds;
            for (const c of this.courses.values()) {
              if (c.course_code === code && c.semester === sem) return { ...c };
            }
            return null;
          }
          if (q.includes("FROM experiments WHERE id = ?")) {
            return this.experiments.get(binds[0]) || null;
          }
          if (q.includes("FROM experiments WHERE course_id = ? AND experiment_code = ?")) {
            const [cid, code] = binds;
            for (const exp of this.experiments.values()) {
              if (exp.course_id === cid && exp.experiment_code === code) return { ...exp };
            }
            return null;
          }
          if (q.includes("FROM experiments WHERE repository = ?")) {
            const repo = binds[0];
            for (const exp of this.experiments.values()) {
              if (exp.repository && exp.repository.toLowerCase() === repo.toLowerCase()) return { ...exp };
            }
            return null;
          }
          if (q.includes("FROM experiments WHERE course_id = ?")) {
            const cid = binds[0];
            for (const exp of this.experiments.values()) {
              if (exp.course_id === cid) return { ...exp };
            }
            return null;
          }
          if (q.includes("FROM course_memberships WHERE id = ?")) {
            return this.courseMemberships.get(binds[0]) || null;
          }
          if (q.includes("FROM experiment_memberships WHERE id = ?")) {
            return this.experimentMemberships.get(binds[0]) || null;
          }
          if (q.includes("FROM course_memberships WHERE course_id = ? AND github_id = ?")) {
            const [cid, gid] = binds;
            for (const cm of this.courseMemberships.values()) {
              if (cm.course_id === cid && cm.github_id === String(gid) && cm.status === "active") {
                return { ...cm };
              }
            }
            return null;
          }
          if (q.includes("FROM experiment_memberships WHERE experiment_id = ? AND github_id = ?")) {
            const [eid, gid] = binds;
            for (const em of this.experimentMemberships.values()) {
              if (em.experiment_id === eid && em.github_id === String(gid) && em.status === "active") {
                return { ...em };
              }
            }
            return null;
          }
          return null;
        },

        all: async () => {
          if (q.includes("FROM courses")) {
            return { results: Array.from(this.courses.values()) };
          }
          if (q.includes("FROM experiments WHERE course_id = ?")) {
            const cid = binds[0];
            const list = Array.from(this.experiments.values()).filter((e) => e.course_id === cid);
            return { results: list };
          }
          if (q.includes("FROM activity_logs WHERE repo_name = ?")) {
            const repo = binds[0];
            const list = this.activityLogs.filter((l) => l.repo_name.toLowerCase() === repo.toLowerCase());
            return { results: list };
          }
          if (q.includes("FROM experiment_provisionings WHERE experiment_id = ?")) {
            const expId = binds[0];
            const list = this.provisionHistory.filter((p) => p.experiment_id === expId);
            return { results: list };
          }
          return { results: [] };
        },
      }),
    };
  }

  batch(statements) {
    return Promise.all(statements.map((s) => s.run()));
  }
}

// 模擬 GitHub API
class MockGitHubApi {
  constructor() {
    this.files = new Map();
    this.repositories = new Set();
    this.apiCalls = [];
    this.commitCounter = 1000;
  }

  setFile(ownerRepo, filePath, content, isDir = false) {
    const key = `${ownerRepo.toLowerCase()}:${filePath}`;
    const sha = crypto.createHash("sha1").update(content || filePath).digest("hex");
    this.files.set(key, {
      content: content || "",
      sha,
      size: Buffer.byteLength(content || "", "utf8"),
      type: isDir ? "dir" : "file",
    });
  }

  fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const method = options.method || "GET";
    const headers = options.headers || {};
    this.apiCalls.push({ url: urlStr, method, body: options.body });

    // 1. App Installation Token Exchange
    if (urlStr.includes("/access_tokens") && method === "POST") {
      return new Response(
        JSON.stringify({
          token: "ghs_mock_course_mode_token_12345",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
        { status: 201 }
      );
    }

    // 2. Query App Installation
    if (urlStr.includes("/app/installations/") && method === "GET") {
      return new Response(
        JSON.stringify({
          id: 1234567,
          account: { login: "TestLabOrg", type: "Organization" },
        }),
        { status: 200 }
      );
    }

    // 3. Template Generation
    if (urlStr.includes("/generate") && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      const fullName = `${body.owner}/${body.name}`.toLowerCase();
      this.repositories.add(fullName);
      return new Response(
        JSON.stringify({
          id: 998877,
          name: body.name,
          full_name: `${body.owner}/${body.name}`,
          private: true,
          default_branch: "main",
          owner: { login: body.owner },
        }),
        { status: 201 }
      );
    }

    // 4. Repo check (GET /repos/:owner/:repo without contents)
    const repoMatch = urlStr.match(/\/repos\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (repoMatch && method === "GET") {
      const [_, owner, repo] = repoMatch;
      const fullName = `${owner}/${repo}`.toLowerCase();
      if (this.repositories.has(fullName)) {
        return new Response(
          JSON.stringify({
            id: 998877,
            name: repo,
            full_name: `${owner}/${repo}`,
            default_branch: "main",
            owner: { login: owner },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }

    // 5. Contents API
    const contentsMatch = urlStr.match(/\/repos\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/contents\/?(.*)$/);
    if (contentsMatch) {
      const [_, owner, repo, rawPath] = contentsMatch;
      const ownerRepo = `${owner}/${repo}`.toLowerCase();
      const filePath = decodeURIComponent(rawPath.split("?")[0]);

      if (method === "GET") {
        const prefix = filePath ? `${filePath}/` : "";
        const matchingEntries = [];
        const seenDirs = new Set();

        for (const [k, v] of this.files.entries()) {
          if (!k.startsWith(`${ownerRepo}:`)) continue;
          const relPath = k.slice(ownerRepo.length + 1);

          if (filePath === "") {
            const topPart = relPath.split("/")[0];
            if (relPath.includes("/")) {
              if (!seenDirs.has(topPart)) {
                seenDirs.add(topPart);
                matchingEntries.push({
                  name: topPart,
                  path: topPart,
                  sha: crypto.createHash("sha1").update(topPart).digest("hex"),
                  size: 0,
                  type: "dir",
                });
              }
            } else {
              matchingEntries.push({
                name: relPath,
                path: relPath,
                sha: v.sha,
                size: v.size,
                type: "file",
              });
            }
          } else if (relPath === filePath && v.type === "dir") {
            continue;
          } else if (relPath.startsWith(prefix)) {
            const remainder = relPath.slice(prefix.length);
            const subPart = remainder.split("/")[0];
            if (remainder.includes("/")) {
              if (!seenDirs.has(subPart)) {
                seenDirs.add(subPart);
                matchingEntries.push({
                  name: subPart,
                  path: `${prefix}${subPart}`,
                  sha: crypto.createHash("sha1").update(subPart).digest("hex"),
                  size: 0,
                  type: "dir",
                });
              }
            } else {
              matchingEntries.push({
                name: subPart,
                path: relPath,
                sha: v.sha,
                size: v.size,
                type: "file",
              });
            }
          }
        }

        const directKey = `${ownerRepo}:${filePath}`;
        const exactFile = this.files.get(directKey);

        if (exactFile && exactFile.type === "file") {
          return new Response(
            JSON.stringify({
              name: filePath.split("/").pop(),
              path: filePath,
              sha: exactFile.sha,
              size: exactFile.size,
              type: "file",
              encoding: "base64",
              content: Buffer.from(exactFile.content).toString("base64"),
            }),
            { status: 200 }
          );
        }

        if (exactFile && exactFile.type === "dir") {
          return new Response(JSON.stringify(matchingEntries), { status: 200 });
        }

        if (matchingEntries.length > 0 || filePath === "") {
          return new Response(JSON.stringify(matchingEntries), { status: 200 });
        }

        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }

      if (method === "PUT") {
        const body = JSON.parse(options.body || "{}");
        const directKey = `${ownerRepo}:${filePath}`;
        const existing = this.files.get(directKey);

        if (body.sha && (!existing || existing.sha !== body.sha)) {
          return new Response(
            JSON.stringify({
              message: `Resource is at ${existing ? existing.sha : "none"} but expected ${body.sha}`,
            }),
            { status: 409 }
          );
        }

        const isNew = !existing;
        const decodedContent = Buffer.from(body.content || "", "base64").toString("utf8");
        const newFileSha = crypto.createHash("sha1").update(decodedContent).digest("hex");
        this.commitCounter++;
        const newCommitSha = crypto
          .createHash("sha1")
          .update(`commit-${this.commitCounter}-${filePath}`)
          .digest("hex");

        this.files.set(directKey, {
          content: decodedContent,
          sha: newFileSha,
          size: Buffer.byteLength(decodedContent, "utf8"),
          type: "file",
        });

        return new Response(
          JSON.stringify({
            content: {
              name: filePath.split("/").pop(),
              path: filePath,
              sha: newFileSha,
              size: Buffer.byteLength(decodedContent, "utf8"),
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

    return new Response(JSON.stringify({ message: `Not handled in mock: ${method} ${urlStr}` }), {
      status: 404,
    });
  };
}

let passedCount = 0;
function pass(msg) {
  passedCount++;
  console.log(`  ✅ [PASS] ${msg}`);
}

async function runCourseModeVerification() {
  console.log("\n====================================================");
  console.log("🧪 Course Mode Architecture Refactor 核心驗證開始");
  console.log("====================================================\n");

  const mockDb = new MockCourseModeD1();
  const mockGh = new MockGitHubApi();

  const aliceToken = "session-alice-token-teacher";
  const bobToken = "session-bob-token-student";
  const eveToken = "session-eve-token-outsider";

  const expiresFuture = new Date(Date.now() + 86400 * 1000).toISOString();

  // Alice: Teacher (GitHub ID 1001)
  mockDb.sessions.set(sha256(aliceToken), {
    session_id: sha256(aliceToken),
    github_id: "1001",
    username: "alice_teacher",
    display_name: "Alice Teacher",
    avatar_url: "https://github.com/alice.png",
    expires_at: expiresFuture,
  });

  // Bob: Student (GitHub ID 1002)
  mockDb.sessions.set(sha256(bobToken), {
    session_id: sha256(bobToken),
    github_id: "1002",
    username: "bob_student",
    display_name: "Bob Student",
    avatar_url: "https://github.com/bob.png",
    expires_at: expiresFuture,
  });

  // Eve: Outsider (GitHub ID 9999)
  mockDb.sessions.set(sha256(eveToken), {
    session_id: sha256(eveToken),
    github_id: "9999",
    username: "eve_outsider",
    display_name: "Eve Outsider",
    avatar_url: "https://github.com/eve.png",
    expires_at: expiresFuture,
  });

  const env = {
    DB: mockDb,
    GITHUB_APP_ID: "12345",
    GITHUB_APP_INSTALLATION_ID: "67890",
    GITHUB_APP_PRIVATE_KEY: testKeypair.privateKey,
    FETCH: mockGh.fetch,
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      let body = null;
      if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
        const buffers = [];
        for await (const chunk of req) buffers.push(chunk);
        if (buffers.length > 0) body = Buffer.concat(buffers);
      }

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          v.forEach((val) => headers.append(k, val));
        } else if (v !== undefined) {
          headers.set(k, v);
        }
      }

      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        duplex: "half",
        body: (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") ? body : null,
      });

      const ctx = {
        request,
        env,
        params: {},
        waitUntil: () => {},
        next: () => {},
        data: {},
      };

      const response = await onRequest(ctx);

      res.statusCode = response.status;
      for (const [hk, hv] of response.headers.entries()) {
        res.setHeader(hk, hv);
      }

      const resBuf = await response.arrayBuffer();
      res.end(Buffer.from(resBuf));
    } catch (e) {
      console.error("Server error:", e);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  const authHeader = (tok) => ({
    Cookie: `app_session=${tok}`,
  });

  try {
    // -------------------------------------------------------------
    // [群組 1: Course Mode 建立與 repository 檢驗]
    // -------------------------------------------------------------
    console.log("▶ [群組 1: Course Mode 建立與 repository 檢驗]");

    // 1.1 Course 預設 mode = 'course' 當給予 github_repository 時
    const c1Res = await fetch(`${BASE_URL}/courses`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_code: "EE301",
        name: "訊號與系統實驗",
        semester: "114-1",
        github_repository: "TestLabOrg/ee301-course-repo",
      }),
    });
    assert.strictEqual(c1Res.status, 201, `Expected 201, got ${c1Res.status}`);
    const c1Data = await c1Res.json();
    assert.strictEqual(c1Data.course.mode, "course");
    assert.strictEqual(c1Data.course.github_repository, "TestLabOrg/ee301-course-repo");
    pass("1. Course 建立預設使用 mode='course' 並正確儲存 github_repository");

    const courseId = c1Data.course.id;

    // 1.2 Course Mode 缺少 github_repository 應遭 400 阻絕
    const cInvalidRes = await fetch(`${BASE_URL}/courses`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_code: "EE302",
        name: "通訊系統實驗",
        semester: "114-1",
        mode: "course",
      }),
    });
    assert.strictEqual(cInvalidRes.status, 400);
    pass("2. Course 模式下未提供 github_repository 遭 400 阻絕");

    // 1.3 Course Mode 格式非 owner/repo 應遭 400 阻絕
    const cBadFormatRes = await fetch(`${BASE_URL}/courses`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_code: "EE303",
        name: "數位訊號處理",
        semester: "114-1",
        mode: "course",
        github_repository: "invalid-repo-name-no-slash",
      }),
    });
    assert.strictEqual(cBadFormatRes.status, 400);
    pass("3. Course 模式下非 owner/repo 格式之 github_repository 遭 400 阻絕");

    // 1.4 重複 github_repository 跨課程綁定回傳 409 Conflict
    const cDupRepoRes = await fetch(`${BASE_URL}/courses`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_code: "EE304",
        name: "重試綁定相同倉庫",
        semester: "114-1",
        mode: "course",
        github_repository: "TestLabOrg/ee301-course-repo",
      }),
    });
    assert.strictEqual(cDupRepoRes.status, 409);
    pass("4. 重複綁定相同 github_repository 跨課程遭 409 Conflict 阻絕");

    // 1.5 舊版 experiment mode 課程建立可不帶 github_repository
    const cLegacyRes = await fetch(`${BASE_URL}/courses`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_code: "CS101",
        name: "計算機概論實驗 (舊架構)",
        semester: "114-1",
        mode: "experiment",
      }),
    });
    assert.strictEqual(cLegacyRes.status, 201);
    const cLegacyData = await cLegacyRes.json();
    assert.strictEqual(cLegacyData.course.mode, "experiment");
    assert.strictEqual(cLegacyData.course.github_repository, null);
    pass("5. 舊版 experiment mode 課程建立可為空 github_repository，維持相容性");

    // -------------------------------------------------------------
    // [群組 2: 多個 Experiment 在同一 Course 共享倉庫]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 2: 多個 Experiment 在同一 Course 共享倉庫]");

    // 2.1 建立 Experiment 1 (不用帶 repository)
    const exp1Res = await fetch(`${BASE_URL}/experiments`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_id: courseId,
        experiment_code: "lab-01",
        name: "取樣定理與重構",
        report_mode: "shared",
      }),
    });
    assert.strictEqual(exp1Res.status, 201);
    const exp1Data = await exp1Res.json();
    assert.strictEqual(exp1Data.experiment.repository, null);
    assert.strictEqual(exp1Data.experiment.experiment_code, "lab-01");
    const exp1Id = exp1Data.experiment.id;
    pass("6. Course 模式下建立 Experiment 1 無需 repository (D1 存 NULL)");

    // 2.2 建立 Experiment 2 在同一 Course (亦不用帶 repository)
    const exp2Res = await fetch(`${BASE_URL}/experiments`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_id: courseId,
        experiment_code: "lab-02",
        name: "傅立葉轉換與頻譜分析",
        report_mode: "separate",
      }),
    });
    assert.strictEqual(exp2Res.status, 201);
    const exp2Data = await exp2Res.json();
    assert.strictEqual(exp2Data.experiment.repository, null);
    assert.strictEqual(exp2Data.experiment.experiment_code, "lab-02");
    const exp2Id = exp2Data.experiment.id;
    pass("7. 同一 Course 下成功建立 Experiment 2 (兩實驗無 repository 唯一衝突)");

    // 2.3 相同 Course 下嘗試建立同名 experiment_code 遭 409 阻斷
    const expDupRes = await fetch(`${BASE_URL}/experiments`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_id: courseId,
        experiment_code: "lab-01",
        name: "重複實驗代碼",
      }),
    });
    assert.strictEqual(expDupRes.status, 409);
    pass("8. 同一 Course 下重複 experiment_code 遭 409 Conflict 阻斷");

    // 2.4 在另一 Course 建立同名 experiment_code 應被允許
    const expOtherCourseRes = await fetch(`${BASE_URL}/experiments`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_id: cLegacyData.course.id,
        experiment_code: "lab-01",
        name: "不同課程的 lab-01",
        repository: "TestLabOrg/cs101-lab-01",
      }),
    });
    assert.strictEqual(expOtherCourseRes.status, 201);
    const expOtherData = await expOtherCourseRes.json();
    pass("9. 不同 Course 允許相同 experiment_code (唯一性作用於 (course_id, experiment_code))");

    // 將 Bob 加入 Course 與 Experiment 成員以供後續權限測試
    const addCmRes = await fetch(`${BASE_URL}/courses/${courseId}/members`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        github_id: "1002",
        username: "bob_student",
        role: "student",
      }),
    });
    assert.strictEqual(addCmRes.status, 201);

    const addEm1Res = await fetch(`${BASE_URL}/experiments/${exp1Id}/members`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        github_id: "1002",
        username: "bob_student",
        role: "student",
      }),
    });
    assert.strictEqual(addEm1Res.status, 201);

    const addEm2Res = await fetch(`${BASE_URL}/experiments/${exp2Id}/members`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        github_id: "1002",
        username: "bob_student",
        role: "student",
      }),
    });
    assert.strictEqual(addEm2Res.status, 201);

    // -------------------------------------------------------------
    // [群組 3: Provisioning 在 Course Mode 下的等冪性與 URL 規範]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 3: Provisioning 在 Course Mode 下的等冪性與 URL 規範]");

    // 3.1 第一個實驗觸發 Provisioning：建立 course.github_repository
    const prov1Res = await fetch(`${BASE_URL}/experiments/${exp1Id}/provision`, {
      method: "POST",
      headers: authHeader(aliceToken),
    });
    assert.strictEqual(prov1Res.status, 200);
    const prov1Data = await prov1Res.json();
    assert.strictEqual(prov1Data.success, true);
    assert.strictEqual(prov1Data.repository.full_name, "TestLabOrg/ee301-course-repo");
    assert.strictEqual(prov1Data.status, "ready");
    pass("10. 第一個實驗觸發 Provisioning 成功建立 Course 專屬儲存庫");

    // 3.2 驗證 GitHub API 呼叫嚴格使用 owner/repo，絕未將 experiments/lab-01 拼入 repository 名稱
    const generateCalls = mockGh.apiCalls.filter((c) => c.url.includes("/generate"));
    assert.strictEqual(generateCalls.length, 1);
    const genBody = JSON.parse(generateCalls[0].body);
    assert.strictEqual(genBody.owner, "TestLabOrg");
    assert.strictEqual(genBody.name, "ee301-course-repo");
    assert(!genBody.name.includes("experiments"), "Repository name must NOT contain scoped path 'experiments'");
    pass("11. GitHub API Template Generate 嚴格傳送 owner/name，未將 experiments/<code\> 拼入名稱");

    // 3.3 第二個實驗觸發 Provisioning：發現 Course Repo 已存在，等冪回傳 already_existed
    const prov2Res = await fetch(`${BASE_URL}/experiments/${exp2Id}/provision`, {
      method: "POST",
      headers: authHeader(aliceToken),
    });
    assert.strictEqual(prov2Res.status, 200);
    const prov2Data = await prov2Res.json();
    assert.strictEqual(prov2Data.success, true);
    assert.strictEqual(prov2Data.already_existed, true);
    assert.strictEqual(prov2Data.repository.full_name, "TestLabOrg/ee301-course-repo");
    assert.strictEqual(prov2Data.status, "ready");
    pass("12. 同課程第二個實驗 Provisioning 正確回傳 already_existed: true 與 status: ready");

    // 3.4 查詢兩個實驗的 Provisioning 狀態均顯示就緒
    const qProv1 = await fetch(`${BASE_URL}/experiments/${exp1Id}/provision`, { headers: authHeader(aliceToken) });
    const qProv1Data = await qProv1.json();
    assert.strictEqual(qProv1Data.repository, "TestLabOrg/ee301-course-repo");
    assert.strictEqual(qProv1Data.provisioning_status, "ready");

    const qProv2 = await fetch(`${BASE_URL}/experiments/${exp2Id}/provision`, { headers: authHeader(aliceToken) });
    const qProv2Data = await qProv2.json();
    assert.strictEqual(qProv2Data.repository, "TestLabOrg/ee301-course-repo");
    assert.strictEqual(qProv2Data.provisioning_status, "ready");
    pass("13. GET /provision 正確解析 course.github_repository 並回傳就緒狀態");

    // -------------------------------------------------------------
    // [群組 4: Scoped Path 透明轉換、隔離性與穿越防護]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 4: Scoped Path 透明轉換、隔離性與穿越防護]");

    // 在 Mock GitHub 中預先塞入 Exp 1 與 Exp 2 的檔案
    const courseRepo = "TestLabOrg/ee301-course-repo";
    mockGh.setFile(courseRepo, "experiments/lab-01/README.md", "# Lab 01 README\nSample Theorem.");
    mockGh.setFile(courseRepo, "experiments/lab-01/code/script.py", "print('lab 01')");
    mockGh.setFile(courseRepo, "experiments/lab-02/README.md", "# Lab 02 README\nFourier Transform.");
    mockGh.setFile(courseRepo, "experiments/lab-02/secret.txt", "TOP SECRET LAB 02 DATA");

    // 4.1 Exp 1 讀取根目錄檔案清單：必須回傳相對路徑，前綴 experiments/lab-01/ 已被剝除
    const listExp1Res = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/files`, {
      headers: authHeader(bobToken),
    });
    assert.strictEqual(listExp1Res.status, 200);
    const { items: exp1Files } = await listExp1Res.json();
    const exp1Paths = exp1Files.map((f) => f.path);
    assert(exp1Paths.includes("README.md"), "Expected README.md in Exp 1 files");
    assert(exp1Paths.includes("code"), "Expected code directory in Exp 1 files");
    assert(!exp1Paths.some((p) => p.startsWith("experiments/")), "Returned path MUST NOT include experiments/ prefix");
    pass("14. Exp 1 listFiles 正確回傳相對路徑 (README.md, code)，已自動剝除 experiments/lab-01/ 前綴");

    // 4.2 隔離性驗證：Exp 1 的檔案清單絕對不含 Exp 2 的檔案
    assert(!exp1Paths.includes("secret.txt"), "Exp 1 MUST NOT see Exp 2 secret.txt");
    pass("15. Scoped Path 隔離性：Exp 1 檔案清單未洩漏 Exp 2 檔案");

    // 4.3 Exp 2 讀取根目錄檔案清單：正確回傳 Exp 2 的相對路徑
    const listExp2Res = await fetch(`${BASE_URL}/experiments/${exp2Id}/workspace/files`, {
      headers: authHeader(bobToken),
    });
    assert.strictEqual(listExp2Res.status, 200);
    const { items: exp2Files } = await listExp2Res.json();
    const exp2Paths = exp2Files.map((f) => f.path);
    assert(exp2Paths.includes("README.md"));
    assert(exp2Paths.includes("secret.txt"));
    pass("16. Exp 2 listFiles 正確回傳 Exp 2 相對路徑且包含 secret.txt");

    // 4.4 Exp 1 讀取檔案內容：GET /workspace/file?path=README.md
    const readExp1Res = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file?path=README.md`, {
      headers: authHeader(bobToken),
    });
    assert.strictEqual(readExp1Res.status, 200);
    const readExp1Data = await readExp1Res.json();
    assert.strictEqual(readExp1Data.path, "README.md");
    assert(readExp1Data.content.includes("Sample Theorem."));
    pass("17. Exp 1 readFile 成功讀取並回傳相對路徑與正確內容");

    // 4.5 Exp 1 寫入檔案：PUT /workspace/file (path=analysis/calc.py)
    const writeExp1Res = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file`, {
      method: "PUT",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "analysis/calc.py",
        content: "import numpy as np\nprint('Done')",
        message: "新增運算程式碼",
      }),
    });
    assert.strictEqual(writeExp1Res.status, 200);
    const writeExp1Data = await writeExp1Res.json();
    assert.strictEqual(writeExp1Data.action, "created");
    assert(writeExp1Data.commit_sha);
    const savedFile = mockGh.files.get(`${courseRepo.toLowerCase()}:experiments/lab-01/analysis/calc.py`);
    assert(savedFile, "File must be written to experiments/lab-01/analysis/calc.py on GitHub");
    assert.strictEqual(savedFile.content, "import numpy as np\nprint('Done')");
    pass("18. Exp 1 writeFile 正確寫入 GitHub experiments/lab-01/analysis/calc.py 並產生 Commit");

    // 4.6 樂觀鎖 (409 Conflict) 驗證：帶入錯誤/過期 SHA
    const staleShaRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file`, {
      method: "PUT",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "analysis/calc.py",
        content: "conflict test",
        sha: "0000000000000000000000000000000000000000",
        message: "衝突測試",
      }),
    });
    assert.strictEqual(staleShaRes.status, 409);
    pass("19. Scoped Path 下更新檔案之樂觀鎖 (409 Conflict) 正常觸發");

    // 4.7 路徑穿越攔截：嘗試跳出自身 scoped path
    const traversal1Res = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file?path=../../experiments/lab-02/secret.txt`, {
      headers: authHeader(bobToken),
    });
    assert.strictEqual(traversal1Res.status, 400);

    const traversal2Res = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file?path=%2e%2e%2flab-02%2fsecret.txt`, {
      headers: authHeader(bobToken),
    });
    assert.strictEqual(traversal2Res.status, 400);

    const traversalWriteRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file`, {
      method: "PUT",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "../lab-02/hacked.txt",
        content: "pwned",
        message: "attempt escape",
      }),
    });
    assert.strictEqual(traversalWriteRes.status, 400);
    pass("20. 路徑穿越企圖 (../, %2e%2e, 跨目錄讀寫) 全數遭 400 阻絕");

    // -------------------------------------------------------------
    // [群組 5: Raw Data 聖域鐵律在 Course Mode 下的防護]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 5: Raw Data 聖域鐵律在 Course Mode 下的防護]");

    // 5.1 一般 PUT 寫入 raw/ 遭聖域鐵律 403 阻絕
    const putRawRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file`, {
      method: "PUT",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "raw/tampered.csv",
        content: "time,v\n0,5.0",
        message: "非法竄改",
      }),
    });
    assert.strictEqual(putRawRes.status, 403);
    pass("21. 一般 Workspace File PUT 寫入 raw/* 遭聖域鐵律 403 阻絕");

    // 5.2 專用 Raw 上傳端點合法寫入 scoped raw/
    const boundary = "----TestBoundaryCourseMode123";
    const rawContent = "sample_idx,freq,amp\n1,1000,3.3\n2,2000,2.1";
    const rawMultipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="raw_sample.csv"',
      "Content-Type: text/csv",
      "",
      rawContent,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const uploadRawRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/raw`, {
      method: "POST",
      headers: {
        ...authHeader(bobToken),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: rawMultipart,
    });
    assert.strictEqual(uploadRawRes.status, 201);
    const uploadRawData = await uploadRawRes.json();
    assert.strictEqual(uploadRawData.path, "raw/raw_sample.csv");
    const savedRaw = mockGh.files.get(`${courseRepo.toLowerCase()}:experiments/lab-01/raw/raw_sample.csv`);
    assert(savedRaw, "Raw data must be stored under experiments/lab-01/raw/ on GitHub");
    assert.strictEqual(savedRaw.content, rawContent);
    pass("22. 專用 /workspace/raw 成功寫入 experiments/lab-01/raw/raw_sample.csv");

    // 5.3 重複上傳相同 Raw File 遭 409 阻斷 (Raw 不可竄改鐵律)
    const uploadDupRawRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/raw`, {
      method: "POST",
      headers: {
        ...authHeader(bobToken),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: rawMultipart,
    });
    assert.strictEqual(uploadDupRawRes.status, 409);
    pass("23. 重複上傳同名 Raw 檔案遭 409 Conflict 阻擋 (不可竄改原始數據鐵律)");

    // 5.4 照片上傳端點：寫入 scoped photos/ 目錄
    const photoContent = "fake_jpeg_binary_bytes";
    const photoMultipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="scope_test.jpg"',
      "Content-Type: image/jpeg",
      "",
      photoContent,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const uploadPhotoRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/photos`, {
      method: "POST",
      headers: {
        ...authHeader(bobToken),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: photoMultipart,
    });
    assert.strictEqual(uploadPhotoRes.status, 201);
    const uploadPhotoData = await uploadPhotoRes.json();
    assert.strictEqual(uploadPhotoData.path, "photos/scope_test.jpg");
    assert(mockGh.files.has(`${courseRepo.toLowerCase()}:experiments/lab-01/photos/scope_test.jpg`));
    pass("24. 照片上傳端點正確寫入 experiments/lab-01/photos/scope_test.jpg");

    // -------------------------------------------------------------
    // [群組 6: Separate vs Shared Report 在 Scoped Path 下的隔離]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 6: Separate vs Shared Report 在 Scoped Path 下的隔離]");

    // 6.1 Exp 1 為 shared 模式：協作者成功建立 report/report.md
    const sharedReportRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/workspace/file`, {
      method: "PUT",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "report/report.md",
        content: "# 共同實驗報告\n全體成員撰寫",
        message: "更新共同報告",
      }),
    });
    assert.strictEqual(sharedReportRes.status, 200);
    assert(mockGh.files.has(`${courseRepo.toLowerCase()}:experiments/lab-01/report/report.md`));
    pass("25. Shared 模式下協作者成功建立 experiments/lab-01/report/report.md");

    // 6.2 Exp 2 為 separate 模式：Bob (github_id: 1002) 建立個人報告 report/report-1002.md
    const sepReportBobRes = await fetch(`${BASE_URL}/experiments/${exp2Id}/workspace/file`, {
      method: "PUT",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "report/report-1002.md",
        content: "# Bob 的個人報告",
        message: "Bob 建立報告",
      }),
    });
    assert.strictEqual(sepReportBobRes.status, 200);
    assert(mockGh.files.has(`${courseRepo.toLowerCase()}:experiments/lab-02/report/report-1002.md`));
    pass("26. Separate 模式下 Bob 成功建立 experiments/lab-02/report/report-1002.md");

    // 6.3 Exp 2 為 separate 模式：Bob 企圖撰寫他人報告 report/report-1001.md 遭 403 阻絕
    const sepReportTamperRes = await fetch(`${BASE_URL}/experiments/${exp2Id}/workspace/file`, {
      method: "PUT",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "report/report-1001.md",
        content: "# 冒充 Alice 報告",
        message: "惡意覆寫",
      }),
    });
    assert.strictEqual(sepReportTamperRes.status, 403);
    pass("27. Separate 模式下 Bob 嘗試撰寫 Alice 之 report-1001.md 遭 403 阻絕");

    // -------------------------------------------------------------
    // [群組 7: Agent Context 與 Task 執行在 Scoped Path 下正常運作]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 7: Agent Context 與 Task 執行在 Scoped Path 下正常運作]");

    // 7.1 Agent Context 查詢：repository 為 course.github_repository，且 root_files 為相對路徑
    const agentCtxRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/agent/context`, {
      headers: authHeader(bobToken),
    });
    assert.strictEqual(agentCtxRes.status, 200);
    const agentCtx = await agentCtxRes.json();
    assert.strictEqual(agentCtx.context.experiment.repository, "TestLabOrg/ee301-course-repo");
    assert.strictEqual(agentCtx.context.experiment.code, "lab-01");
    const rootFilePaths = agentCtx.context.root_files.map((f) => f.path);
    assert(!rootFilePaths.some((p) => p.startsWith("experiments/")), "Agent root_files must be relative paths");
    pass("28. Agent Context 正確提供 course.github_repository 與相對路徑清單");

    // 7.2 Agent Task Propose & Execute
    const proposeRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/agent/task/propose`, {
      method: "POST",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "請更新 README.md 加入實驗結論",
      }),
    });
    assert.strictEqual(proposeRes.status, 200);
    const proposeData = await proposeRes.json();
    assert(proposeData.task.plan_hash);
    pass("29. Agent Task Propose 成功產生提案與 hash");

    const execRes = await fetch(`${BASE_URL}/experiments/${exp1Id}/agent/task/execute`, {
      method: "POST",
      headers: { ...authHeader(bobToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "請更新 README.md 加入實驗結論",
        plan_hash: proposeData.task.plan_hash,
        confirmed: true,
      }),
    });
    assert.strictEqual(execRes.status, 200);
    const execData = await execRes.json();
    assert(execData.commit_sha);
    pass("30. Agent Task Execute 成功在 scoped path 下提交更新並取得 commit_sha");

    // -------------------------------------------------------------
    // [群組 8: Activity Log 稽核日誌與 Shared Repository 關聯]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 8: Activity Log 稽核日誌與 Shared Repository 關聯]");

    // 8.1 驗證所有 activity_logs 的 repo_name 均填入 course.github_repository (無 NULL 違規)
    assert(mockDb.activityLogs.length > 0, "Expected activity logs to be recorded");
    for (const log of mockDb.activityLogs) {
      assert(log.repo_name, "activity_logs.repo_name must NOT be null or empty");
      assert.strictEqual(log.repo_name, "TestLabOrg/ee301-course-repo");
    }
    pass("31. 所有 Workspace 操作之 Activity Log 正確寫入 course.github_repository (零 NULL 違規)");

    // 8.2 查詢 Activity Log
    const actRes = await fetch(`${BASE_URL}/activity?repo=TestLabOrg/ee301-course-repo`, {
      headers: authHeader(bobToken),
    });
    assert.strictEqual(actRes.status, 200);
    const actData = await actRes.json();
    assert(actData.logs.length >= 4, "Expected at least 4 recorded activity logs");
    assert(actData.logs.some((l) => l.action === "raw_uploaded"));
    assert(actData.logs.some((l) => l.action === "photo_uploaded"));
    pass("32. GET /api/activity 成功查詢該共享 Course Repo 下之各實驗操作日誌");

    // -------------------------------------------------------------
    // [群組 9: 舊版 Experiment Mode 保持 100% 向後相容]
    // -------------------------------------------------------------
    console.log("\n▶ [群組 9: 舊版 Experiment Mode 保持 100% 向後相容]");

    // 9.1 舊版課程建立實驗專案：強制要求 repository 欄位
    const legNoRepoRes = await fetch(`${BASE_URL}/experiments`, {
      method: "POST",
      headers: { ...authHeader(aliceToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        course_id: cLegacyData.course.id,
        experiment_code: "lab-legacy-err",
        name: "缺少倉庫",
      }),
    });
    assert.strictEqual(legNoRepoRes.status, 400);
    pass("33. 舊版 Experiment Mode 課程建立實驗時若未提供 repository 遭 400 阻擋");

    // 9.2 舊版實驗 Provisioning：針對實驗自身之 repository
    mockGh.repositories.add("testlaborg/cs101-lab-01");
    mockGh.setFile("TestLabOrg/cs101-lab-01", "README.md", "# CS101 Legacy Lab");

    const legProvRes = await fetch(`${BASE_URL}/experiments/${expOtherData.experiment.id}/provision`, {
      method: "POST",
      headers: authHeader(aliceToken),
    });
    assert.strictEqual(legProvRes.status, 200);
    pass("34. 舊版 Experiment Mode 實驗專案維持獨立儲存庫 Provisioning 運作");

    console.log("\n====================================================");
    console.log(`📊 Course Mode 驗證總結：通過 ${passedCount} 項，失敗 0 項`);
    console.log("====================================================\n");
  } finally {
    server.close();
  }
}

runCourseModeVerification().catch((err) => {
  console.error("❌ 驗證失敗:", err);
  process.exit(1);
});
