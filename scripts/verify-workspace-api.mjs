#!/usr/bin/env node

/**
 * verify-workspace-api.mjs
 * 驗證 Phase 5: Workspace HTTP API 與 Activity Log 整合
 *
 * 測試項目涵蓋全部 34 個指定測試情境：
 * 1-4.   Authentication：未登入 GET / PUT / POST raw / POST photos -> 401
 * 5-7.   Authorization：非 collaborator -> 403，合法 collaborator 讀寫均放行
 * 8-17.  File：根目錄樹、子目錄樹、讀檔、建檔、更新檔、過期 SHA 409、路徑穿越 400、編碼穿越 400、目錄讀取 400、超大檔案 413
 * 18-21. Raw：一般 API 寫入 raw/ 遭 403、專用 raw 上傳成功、raw 覆寫遭 409 (聖域鐵律)、raw 穿越 400
 * 22-23. Separate Report：自身報告成功、修改他人報告遭 403
 * 24-27. Photos：JPEG 上傳成功、PNG 上傳成功、非圖片 MIME 遭 400、超大圖片 (5MB+) 遭 413
 * 28-31. Activity Log：建檔、更新檔、raw 上傳、photo 上傳皆記錄真實 40 位元 commit_sha
 * 32-34. Security：回應不含 token、不含私鑰、不得接受任意 owner/repo
 */

import http from "node:http";
import assert from "node:assert";
import crypto from "node:crypto";
import { onRequest } from "../web/functions/api/[[route]].ts";

const TEST_PORT = 9005;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// 產生測試用 RSA 私鑰
const testKeypair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Mock D1 資料庫實作
class MockWorkspaceApiD1 {
  constructor() {
    this.courses = new Map();
    this.experiments = new Map();
    this.courseMemberships = new Map();
    this.experimentMemberships = new Map();
    this.sessions = new Map();
    this.activityLogs = [];
  }

  prepare(query) {
    const q = query.replace(/\s+/g, " ").trim();
    return {
      bind: (...binds) => ({
        run: async () => {
          if (q.startsWith("INSERT INTO activity_logs")) {
            const logEntry = {
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
            };
            this.activityLogs.push(logEntry);
            return { success: true };
          }
          if (q.startsWith("DELETE FROM user_sessions")) {
            const sid = binds[0];
            this.sessions.delete(sid);
            return { success: true };
          }
          return { success: true };
        },
        first: async () => {
          if (q.includes("FROM user_sessions WHERE session_id = ?")) {
            const hashedId = binds[0];
            const s = this.sessions.get(hashedId);
            return s ? { ...s } : null;
          }
          if (q.includes("FROM experiments WHERE id = ?")) {
            const id = binds[0];
            const exp = this.experiments.get(id);
            return exp ? { ...exp } : null;
          }
          if (q.includes("FROM experiments WHERE repository = ?")) {
            const repo = binds[0];
            for (const exp of this.experiments.values()) {
              if (exp.repository === repo) return { ...exp };
            }
            return null;
          }
          if (q.includes("FROM courses WHERE id = ?")) {
            const cid = binds[0];
            const c = this.courses.get(cid);
            return c ? { ...c } : null;
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
          if (q.includes("FROM activity_logs WHERE repo_name = ?")) {
            const repo = binds[0];
            const list = this.activityLogs.filter((l) => l.repo_name === repo);
            return { results: list };
          }
          return { results: [] };
        },
      }),
    };
  }
}

// 模擬 GitHub API
class MockGitHubApi {
  constructor() {
    this.files = new Map();
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
    const authHeader = headers.Authorization || headers.authorization || "";

    // 1. App Installation Token Exchange
    if (urlStr.includes("/access_tokens") && method === "POST") {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          token: "ghs_mock_installation_token_secure_456",
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

    // 3. Contents API: GET or PUT
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
            // Root
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

        // Optimistic concurrency check
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

async function runAllTests() {
  console.log("\n====================================================");
  console.log("🧪 Phase 5: Workspace HTTP API & Activity Log 驗證開始");
  console.log("====================================================\n");

  const mockDb = new MockWorkspaceApiD1();
  const mockGh = new MockGitHubApi();

  mockDb.courses.set("c-ee201", {
    id: "c-ee201",
    course_code: "EE201",
    name: "電子學實驗",
    semester: "114-1",
    status: "active",
  });

  mockDb.experiments.set("exp-01", {
    id: "exp-01",
    course_id: "c-ee201",
    experiment_code: "lab-01",
    name: "BJT 放大電路",
    repository: "TestLabOrg/ee201-lab-01",
    report_mode: "shared",
    status: "in_progress",
  });

  mockDb.experiments.set("exp-02", {
    id: "exp-02",
    course_id: "c-ee201",
    experiment_code: "lab-02",
    name: "MOSFET 特性曲線",
    repository: "TestLabOrg/ee201-lab-02",
    report_mode: "separate",
    status: "in_progress",
  });

  mockDb.courseMemberships.set("cm-alice", {
    id: "cm-alice",
    course_id: "c-ee201",
    github_id: "1001",
    username: "alice",
    role: "student",
    status: "active",
  });

  mockDb.courseMemberships.set("cm-bob", {
    id: "cm-bob",
    course_id: "c-ee201",
    github_id: "1002",
    username: "bob",
    role: "student",
    status: "active",
  });

  mockDb.experimentMemberships.set("em-alice-1", {
    id: "em-alice-1",
    experiment_id: "exp-01",
    github_id: "1001",
    username: "alice",
    role: "student",
    status: "active",
  });

  mockDb.experimentMemberships.set("em-bob-1", {
    id: "em-bob-1",
    experiment_id: "exp-01",
    github_id: "1002",
    username: "bob",
    role: "student",
    status: "active",
  });

  mockDb.experimentMemberships.set("em-alice-2", {
    id: "em-alice-2",
    experiment_id: "exp-02",
    github_id: "1001",
    username: "alice",
    role: "student",
    status: "active",
  });

  mockDb.experimentMemberships.set("em-bob-2", {
    id: "em-bob-2",
    experiment_id: "exp-02",
    github_id: "1002",
    username: "bob",
    role: "student",
    status: "active",
  });

  const aliceToken = "session-alice-secret-token-111";
  const bobToken = "session-bob-secret-token-222";
  const eveToken = "session-eve-secret-token-333";

  const expiresFuture = new Date(Date.now() + 86400 * 1000).toISOString();

  mockDb.sessions.set(sha256(aliceToken), {
    session_id: sha256(aliceToken),
    github_id: "1001",
    username: "alice",
    display_name: "Alice Cooper",
    avatar_url: "https://github.com/alice.png",
    expires_at: expiresFuture,
  });

  mockDb.sessions.set(sha256(bobToken), {
    session_id: sha256(bobToken),
    github_id: "1002",
    username: "bob",
    display_name: "Bob Marley",
    avatar_url: "https://github.com/bob.png",
    expires_at: expiresFuture,
  });

  mockDb.sessions.set(sha256(eveToken), {
    session_id: sha256(eveToken),
    github_id: "9999",
    username: "eve",
    display_name: "Eve Hacker",
    avatar_url: "https://github.com/eve.png",
    expires_at: expiresFuture,
  });

  mockGh.setFile("TestLabOrg/ee201-lab-01", "README.md", "# Lab 01 BJT\nInitial README.");
  mockGh.setFile("TestLabOrg/ee201-lab-01", "photos", "", true);
  mockGh.setFile("TestLabOrg/ee201-lab-01", "photos/existing.png", "fake_png_data");
  mockGh.setFile("TestLabOrg/ee201-lab-01", "raw", "", true);
  mockGh.setFile("TestLabOrg/ee201-lab-01", "raw/existing_raw.csv", "timestamp,voltage\n1,3.3");

  const largeContent = "A".repeat(1048577);
  mockGh.setFile("TestLabOrg/ee201-lab-01", "oversized.txt", largeContent);

  mockGh.setFile("TestLabOrg/ee201-lab-02", "README.md", "# Lab 02 MOSFET");
  mockGh.setFile("TestLabOrg/ee201-lab-02", "report", "", true);
  mockGh.setFile("TestLabOrg/ee201-lab-02", "report/1001.md", "# Alice Report");
  mockGh.setFile("TestLabOrg/ee201-lab-02", "report/1002.md", "# Bob Report");

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
        if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      }

      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body: body ? body : undefined,
      });

      const response = await onRequest({ request, env, params: {} });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      const resBody = await response.text();
      res.end(resBody);
    } catch (err) {
      console.error("Test server error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  await new Promise((resolve) => server.listen(TEST_PORT, "127.0.0.1", resolve));

  async function api(path, options = {}) {
    const url = `${BASE_URL}${path.startsWith("/") ? path : "/" + path}`;
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (body && typeof body === "object" && !(body instanceof Buffer) && !(body instanceof Uint8Array)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const fetchOptions = {
      method: options.method || "GET",
      headers,
      body,
    };
    const res = await fetch(url, fetchOptions);
    let data = null;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, headers: res.headers, data, text };
  }

  const aliceCookie = `app_session=${aliceToken}`;
  const bobCookie = `app_session=${bobToken}`;
  const eveCookie = `app_session=${eveToken}`;

  try {
    // ----------------------------------------------------
    // 群組 1: Authentication 身分驗證 (測試 1-4)
    // ----------------------------------------------------
    console.log("▶ [群組 1: Authentication 身分驗證 (401)]");

    // 1. 未登入 GET
    {
      const res = await api("/experiments/exp-01/workspace/files");
      assert.strictEqual(res.status, 401);
      pass("1. 未登入 GET /workspace/files 回傳 401 Unauthorized");
    }

    // 2. 未登入 PUT
    {
      const res = await api("/experiments/exp-01/workspace/file", {
        method: "PUT",
        body: { path: "test.md", content: "test", message: "add test" },
      });
      assert.strictEqual(res.status, 401);
      pass("2. 未登入 PUT /workspace/file 回傳 401 Unauthorized");
    }

    // 3. 未登入 POST raw
    {
      const res = await api("/experiments/exp-01/workspace/raw", {
        method: "POST",
        body: { path: "raw/data.csv", content: "1,2,3", message: "raw data" },
      });
      assert.strictEqual(res.status, 401);
      pass("3. 未登入 POST /workspace/raw 回傳 401 Unauthorized");
    }

    // 4. 未登入 POST photos
    {
      const res = await api("/experiments/exp-01/workspace/photos", {
        method: "POST",
        body: { path: "photos/pic.jpg", content: "fake_jpg", mime_type: "image/jpeg" },
      });
      assert.strictEqual(res.status, 401);
      pass("4. 未登入 POST /workspace/photos 回傳 401 Unauthorized");
    }

    // ----------------------------------------------------
    // 群組 2: Authorization 授權邊界 (測試 5-7)
    // ----------------------------------------------------
    console.log("\n▶ [群組 2: Authorization 協作者授權邊界 (403 vs 200)]");

    // 5. 非 collaborator -> 403
    {
      const resGet = await api("/experiments/exp-01/workspace/files", {
        headers: { Cookie: eveCookie },
      });
      assert.strictEqual(resGet.status, 403);

      const resPut = await api("/experiments/exp-01/workspace/file", {
        method: "PUT",
        headers: { Cookie: eveCookie },
        body: { path: "hacked.md", content: "eve", message: "hack" },
      });
      assert.strictEqual(resPut.status, 403);
      pass("5. 非工作區成員存取 (GET / PUT) 均被阻擋 (403 Forbidden)");
    }

    // 6. 合法 collaborator 讀取
    {
      const res = await api("/experiments/exp-01/workspace/files", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.items));
      pass("6. 合法 Collaborator 正確讀取檔案清單 (200 OK)");
    }

    // 7. 合法 collaborator 寫入
    let createdNotesSha = "";
    {
      const res = await api("/experiments/exp-01/workspace/file", {
        method: "PUT",
        headers: { Cookie: aliceCookie },
        body: { path: "notes.md", content: "# Lab Notes\nCreated by Alice.", message: "docs: add notes" },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.action, "created");
      assert.ok(res.data.commit_sha && res.data.commit_sha.length === 40);
      createdNotesSha = res.data.content_sha;
      pass("7. 合法 Collaborator 順利建立檔案並取得真實 40 位元 commit_sha");
    }

    // ----------------------------------------------------
    // 群組 3: File 操作與異常防護 (測試 8-17)
    // ----------------------------------------------------
    console.log("\n▶ [群組 3: File 操作與防護 (8-17)]");

    // 8. list root
    {
      const res = await api("/experiments/exp-01/workspace/files", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.items));
      assert.strictEqual(res.data.items[0].type, "directory");
      pass("8. list root 正確回傳標準 internal JSON 且目錄優先排序");
    }

    // 9. list nested directory
    {
      const res = await api("/experiments/exp-01/workspace/files?path=photos", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.items));
      const hasPic = res.data.items.some((i) => i.name === "existing.png");
      assert.strictEqual(hasPic, true);
      pass("9. list nested directory (?path=photos) 正確讀取子目錄檔案列表");
    }

    // 10. read file
    let readmeSha = "";
    {
      const res = await api("/experiments/exp-01/workspace/file?path=README.md", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.path, "README.md");
      assert.ok(res.data.content.includes("# Lab 01 BJT"));
      readmeSha = res.data.sha;
      pass("10. read file 成功讀取文字檔案並完成 Base64->UTF-8 解碼");
    }

    // 11. create file
    let extraFileSha = "";
    {
      const res = await api("/experiments/exp-01/workspace/file", {
        method: "PUT",
        headers: { Cookie: bobCookie },
        body: { path: "summary.txt", content: "Experiment summary.", message: "docs: add summary" },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.action, "created");
      extraFileSha = res.data.content_sha;
      pass("11. create file 成功建立新檔案 (action: created)");
    }

    // 12. update file
    {
      const res = await api("/experiments/exp-01/workspace/file", {
        method: "PUT",
        headers: { Cookie: bobCookie },
        body: {
          path: "summary.txt",
          content: "Experiment summary updated.",
          message: "docs: update summary",
          sha: extraFileSha,
        },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.action, "modified");
      assert.ok(res.data.commit_sha && res.data.commit_sha.length === 40);
      pass("12. update file 帶入目前 SHA 成功更新檔案 (action: modified)");
    }

    // 13. stale SHA -> 409
    {
      const res = await api("/experiments/exp-01/workspace/file", {
        method: "PUT",
        headers: { Cookie: aliceCookie },
        body: {
          path: "summary.txt",
          content: "Concurrent edit from Alice.",
          message: "docs: concurrent edit",
          sha: "stale_sha_9999999999",
        },
      });
      assert.strictEqual(res.status, 409);
      assert.ok(res.data.error.includes("Conflict"));
      pass("13. stale SHA 傳入引發 409 Conflict 樂觀鎖保護 (防止覆蓋他人成果)");
    }

    // 14. traversal -> 400
    {
      const res = await api("/experiments/exp-01/workspace/file?path=../secret.txt", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes("traversal"));
      pass("14. ../ 相對路徑穿越攔截 (400 Bad Request)");
    }

    // 15. encoded traversal -> 400
    {
      const res = await api("/experiments/exp-01/workspace/file?path=%2e%2e/secret.txt", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes("traversal"));
      pass("15. %2e%2e URL 編碼路徑穿越攔截 (400 Bad Request)");
    }

    // 16. directory read -> 400
    {
      const res = await api("/experiments/exp-01/workspace/file?path=photos", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes("is a directory"));
      pass("16. 以 read file 嘗試讀取目錄遭 400 阻擋 (is a directory, not a file)");
    }

    // 17. oversized file -> 413
    {
      const res = await api("/experiments/exp-01/workspace/file?path=oversized.txt", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 413);
      assert.ok(res.data.error.includes("too large"));
      pass("17. 讀取超過 1MB 之大檔案正確回傳 413 Payload Too Large");
    }

    // ----------------------------------------------------
    // 群組 4: Raw Data Sanctuary 聖域鐵律 (測試 18-21)
    // ----------------------------------------------------
    console.log("\n▶ [群組 4: Raw Data Sanctuary 聖域鐵律 (18-21)]");

    // 18. generic write raw/ -> 403
    {
      const res = await api("/experiments/exp-01/workspace/file", {
        method: "PUT",
        headers: { Cookie: aliceCookie },
        body: { path: "raw/data.csv", content: "1,2,3", message: "hack raw" },
      });
      assert.strictEqual(res.status, 403);
      assert.ok(res.data.error.includes("Raw sanctuary violation"));
      pass("18. 通用 File PUT 寫入 raw/* 遭聖域鐵律阻絕 (403 Forbidden)");
    }

    // 19. valid raw upload -> 成功
    let rawCommitSha = "";
    {
      const res = await api("/experiments/exp-01/workspace/raw", {
        method: "POST",
        headers: { Cookie: aliceCookie },
        body: {
          path: "raw/scope_capture.csv",
          content: "t,ch1,ch2\n0.0,0.1,0.2\n0.1,0.5,0.6",
          message: "data: raw oscilloscope capture",
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.action, "raw_uploaded");
      assert.ok(res.data.commit_sha && res.data.commit_sha.length === 40);
      rawCommitSha = res.data.commit_sha;
      pass("19. 專用 /workspace/raw 端點合法上傳原始實驗數據 (201 Created)");
    }

    // 20. raw overwrite -> 409
    {
      const res = await api("/experiments/exp-01/workspace/raw", {
        method: "POST",
        headers: { Cookie: bobCookie },
        body: {
          path: "raw/scope_capture.csv",
          content: "tampered,data",
          message: "tamper with raw",
        },
      });
      assert.strictEqual(res.status, 409);
      assert.ok(res.data.error.includes("cannot be overwritten"));
      pass("20. Raw Data 覆寫企圖遭 409 Conflict 阻擋 (不可竄改原始數據鐵律)");
    }

    // 21. raw traversal -> 400
    {
      const res = await api("/experiments/exp-01/workspace/raw", {
        method: "POST",
        headers: { Cookie: aliceCookie },
        body: {
          path: "raw/../escape.csv",
          content: "evil",
          message: "escape raw",
        },
      });
      assert.strictEqual(res.status, 400);
      pass("21. Raw 上傳路徑穿越企圖攔截 (400 Bad Request)");
    }

    // ----------------------------------------------------
    // 群組 5: Separate Report 個人報告模式隔離 (測試 22-23)
    // ----------------------------------------------------
    console.log("\n▶ [群組 5: Separate Report 個人報告隔離 (22-23)]");

    // 22. 自己的 report -> 成功
    {
      const res = await api("/experiments/exp-02/workspace/file", {
        method: "PUT",
        headers: { Cookie: aliceCookie },
        body: {
          path: "report/1001.md",
          content: "# Alice Lab 02 Independent Report\nSelf written.",
          message: "docs: update alice personal report",
        },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      pass("22. Separate 報告模式：協作者成功建立/更新自己之個人報告");
    }

    // 23. 修改其他人的 report -> 403
    {
      const res = await api("/experiments/exp-02/workspace/file", {
        method: "PUT",
        headers: { Cookie: aliceCookie },
        body: {
          path: "report/1002.md",
          content: "# Tampered Bob Report by Alice",
          message: "docs: tamper bob report",
        },
      });
      assert.strictEqual(res.status, 403);
      assert.ok(res.data.error.includes("Separate report mode violation"));
      pass("23. Separate 報告模式：協作者企圖修改他人個人報告遭 403 阻絕");
    }

    // ----------------------------------------------------
    // 群組 6: Photos 實驗照片上傳與驗證 (測試 24-27)
    // ----------------------------------------------------
    console.log("\n▶ [群組 6: Photos 實驗照片上傳 (24-27)]");

    // 24. JPEG upload -> 成功
    let photoCommitSha = "";
    {
      const res = await api("/experiments/exp-01/workspace/photos", {
        method: "POST",
        headers: { Cookie: aliceCookie },
        body: {
          path: "photos/circuit_setup.jpg",
          content: Buffer.from("mock_jpeg_binary_content").toString("base64"),
          isBase64: true,
          mime_type: "image/jpeg",
          message: "photo: circuit setup",
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.action, "photo_uploaded");
      assert.ok(res.data.commit_sha && res.data.commit_sha.length === 40);
      photoCommitSha = res.data.commit_sha;
      pass("24. JPEG 圖片順利上傳 (image/jpeg, 201 Created)");
    }

    // 25. PNG upload -> 成功
    {
      const res = await api("/experiments/exp-01/workspace/photos", {
        method: "POST",
        headers: { Cookie: bobCookie },
        body: {
          path: "waveform.png",
          content: Buffer.from("mock_png_binary_content").toString("base64"),
          isBase64: true,
          mime_type: "image/png",
          message: "photo: oscilloscope waveform",
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.path, "photos/waveform.png");
      pass("25. PNG 圖片順利上傳且檔名自動正規化至 photos/ (201 Created)");
    }

    // 26. 非圖片 MIME -> 400
    {
      const res = await api("/experiments/exp-01/workspace/photos", {
        method: "POST",
        headers: { Cookie: aliceCookie },
        body: {
          path: "photos/malicious.sh",
          content: "echo evil",
          mime_type: "text/x-shellscript",
        },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes("extension") || res.data.error.includes("MIME"));
      pass("26. 非圖片副檔名或 MIME 類型遭 400 阻絕");
    }

    // 27. 超大圖片 -> 413
    {
      const hugeData = "B".repeat(5.5 * 1024 * 1024);
      const res = await api("/experiments/exp-01/workspace/photos", {
        method: "POST",
        headers: { Cookie: aliceCookie },
        body: {
          path: "photos/huge.jpg",
          content: hugeData,
          isBase64: false,
          mime_type: "image/jpeg",
        },
      });
      assert.strictEqual(res.status, 413);
      assert.ok(res.data.error.includes("5MB limit"));
      pass("27. 超過 5MB 之圖片上傳遭 413 Payload Too Large 阻絕");
    }

    // ----------------------------------------------------
    // 群組 7: Activity Log 真實 Commit SHA 審計 (測試 28-31)
    // ----------------------------------------------------
    console.log("\n▶ [群組 7: Activity Log 真實 Commit SHA 鏈結 (28-31)]");

    // 28. generic create -> activity log 有真實 commit_sha
    {
      const createLog = mockDb.activityLogs.find(
        (l) => l.action === "file_created" && l.target === "notes.md"
      );
      assert.ok(createLog, "activity_logs 應有 file_created 紀錄");
      assert.strictEqual(createLog.commit_sha.length, 40);
      assert.strictEqual(createLog.actor_id, "alice");
      assert.strictEqual(createLog.approval_status, "approved");
      pass("28. 通用檔案建立 (file_created) 寫入 Activity Log 並具備真實 40 位元 commit_sha");
    }

    // 29. generic update -> activity log 有真實 commit_sha
    {
      const updateLog = mockDb.activityLogs.find(
        (l) => l.action === "file_modified" && l.target === "summary.txt"
      );
      assert.ok(updateLog, "activity_logs 應有 file_modified 紀錄");
      assert.strictEqual(updateLog.commit_sha.length, 40);
      assert.strictEqual(updateLog.actor_id, "bob");
      pass("29. 通用檔案更新 (file_modified) 寫入 Activity Log 並具備真實 commit_sha");
    }

    // 30. raw upload -> activity log 有真實 commit_sha
    {
      const rawLog = mockDb.activityLogs.find(
        (l) => l.action === "raw_uploaded" && l.target === "raw/scope_capture.csv"
      );
      assert.ok(rawLog, "activity_logs 應有 raw_uploaded 紀錄");
      assert.strictEqual(rawLog.commit_sha, rawCommitSha);
      assert.strictEqual(rawLog.commit_sha.length, 40);
      pass("30. 原始數據上傳 (raw_uploaded) 寫入 Activity Log 且 commit_sha 與 GitHub 回傳一致");
    }

    // 31. photo upload -> activity log 有真實 commit_sha
    {
      const photoLog = mockDb.activityLogs.find(
        (l) => l.action === "photo_uploaded" && l.target === "photos/circuit_setup.jpg"
      );
      assert.ok(photoLog, "activity_logs 應有 photo_uploaded 紀錄");
      assert.strictEqual(photoLog.commit_sha, photoCommitSha);
      assert.strictEqual(photoLog.commit_sha.length, 40);
      pass("31. 照片上傳 (photo_uploaded) 寫入 Activity Log 且 commit_sha 與 GitHub 回傳一致");
    }

    // ----------------------------------------------------
    // 群組 8: Security 敏感資訊與邊界防護 (測試 32-34)
    // ----------------------------------------------------
    console.log("\n▶ [群組 8: Security 敏感資訊與邊界防護 (32-34)]");

    // 32. response 不得包含 GitHub token
    {
      const res = await api("/experiments/exp-01/workspace/files", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.text.includes("ghs_"), false);
      assert.strictEqual(res.text.includes("ghp_"), false);
      assert.strictEqual(res.text.includes("installation_token"), false);
      pass("32. API 回應絕無洩漏 GitHub Token (ghs_ / ghp_)");
    }

    // 33. response 不得包含 private key
    {
      const res = await api("/experiments/exp-01/workspace/file?path=not_found.txt", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.text.includes("PRIVATE KEY"), false);
      pass("33. API 錯誤與成功回應絕無洩漏 RSA 私鑰或敏感設定");
    }

    // 34. 不得接受任意 owner/repo (強制依賴 D1 綁定)
    {
      const res = await api("/experiments/exp-arbitrary-hacked/workspace/files", {
        headers: { Cookie: aliceCookie },
      });
      assert.strictEqual(res.status, 404);
      pass("34. 嚴格強制依賴 D1 唯一 Repository 綁定，阻絕任意 owner/repo 存取企圖");
    }

    console.log("\n====================================================");
    console.log(`📊 Workspace HTTP API 驗證總結：通過 ${passedCount} 項，失敗 0 項`);
    console.log("====================================================\n");
  } finally {
    server.close();
  }
}

runAllTests().catch((err) => {
  console.error("\n❌ 測試執行遭遇嚴重失敗：", err);
  process.exit(1);
});
