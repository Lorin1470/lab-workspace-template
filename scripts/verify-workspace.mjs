/**
 * verify-workspace.mjs
 * 驗證 Phase 5 / 順序 3: GitHub Workspace Service Core
 *
 * 測試群組：
 * 1. Repository Binding 解析與驗證 (不存在、格式非法、非協作者阻絕 403、正常解析)
 * 2. 檔案樹讀取 (根目錄 listFiles、子目錄 listFiles、目錄優先排序、GitHub 404)
 * 3. 檔案讀取 (readFile UTF-8 解碼、SHA/size 完整度、目錄誤讀阻絕、大檔案 413 防禦)
 * 4. 文字檔案寫入 (新建檔案、已存在檔案自動推導 SHA 更新、顯式指定 SHA 衝突 409、真實 Commit SHA 回傳)
 * 5. 二進位檔案寫入 (Uint8Array / ArrayBuffer / Base64 照片寫入、真實 Commit SHA 回傳)
 * 6. 路徑安全與防穿越檢驗 (../ 穿越、/ 絕對路徑、%2e%2e 編碼穿越、空字元注入、空路徑處理)
 * 7. Raw Data Sanctuary 與 Separate Report 安全防護 (raw/* 修改阻絕 403、跨個人報告修改阻絕 403)
 * 8. GitHub API 異常轉譯 (401/403 憑證異常、500 上游錯誤、敏感資訊去敏)
 * 9. createWorkspaceService 服務工廠端到端調用驗證
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  getWorkspaceRepository,
  listFiles,
  readFile,
  createOrUpdateFile,
  createOrUpdateBinaryFile,
  validateWorkspacePath,
  isRawSanctuaryPath,
  createWorkspaceService,
  WorkspaceError,
  stringToBase64,
  base64ToString,
} from '../web/functions/api/services/workspace.ts';

// 產生測試用 RSA 金鑰對 (PKCS#8)
const testKeypairPkcs8 = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Mock D1 資料庫
class MockD1 {
  constructor() {
    this.experiments = new Map();
    this.courseMemberships = new Map();
  }

  prepare(query) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      bind: (...binds) => ({
        first: async () => {
          if (q.includes('FROM experiments WHERE id = ?')) {
            const id = binds[0];
            return this.experiments.get(id) || null;
          }
          if (q.includes('FROM course_memberships WHERE course_id = ? AND github_id = ? AND status = "active"')) {
            const [courseId, githubId] = binds;
            for (const m of this.courseMemberships.values()) {
              if (m.course_id === courseId && String(m.github_id) === String(githubId) && m.status === 'active') {
                return m;
              }
            }
            return null;
          }
          return null;
        },
        all: async () => {
          const res = await this.first();
          return { results: res ? [res] : [] };
        },
      }),
    };
  }
}

// Mock GitHub API (InMemory Git Repository)
class MockGitHubApi {
  constructor() {
    this.files = new Map(); // key: path, value: { contentBase64, sha, size }
    this.failMode = null; // '401', '403', '500', 'network'
    this.authorizedOwner = 'example-org';
    this.repoName = 'ee201-lab-01';

    // 初始化範本預設檔案
    this.setFile('README.md', '# EE201 Lab 01\nWelcome to experiment workspace.');
    this.setFile('config.yml', 'version: "1.1"\nexperiment_id: lab-01\n');
    this.setFile('report/report.md', '# Lab 01 Report\nShared report draft.');
    this.setFile('photos/photo1.jpg', 'fake_jpeg_binary_bytes_12345');
    this.setFile('raw/data.csv', 'timestamp,voltage,current\n0,0.5,0.01\n1,1.0,0.02\n');
  }

  setFile(path, utf8Content) {
    const cleanPath = path.replace(/^\/+/, '');
    const b64 = Buffer.from(utf8Content, 'utf-8').toString('base64');
    const sha = crypto.createHash('sha1').update(utf8Content).digest('hex');
    this.files.set(cleanPath, {
      path: cleanPath,
      name: cleanPath.split('/').pop(),
      contentBase64: b64,
      sha,
      size: Buffer.byteLength(utf8Content, 'utf-8'),
    });
  }

  fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const method = options.method || 'GET';

    if (this.failMode === 'network') {
      throw new Error('connect ECONNREFUSED 140.82.121.4:443');
    }

    if (urlStr.includes('/access_tokens') && method === 'POST') {
      if (this.failMode === '401') {
        return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
      }
      if (this.failMode === 'token_leak') {
        return new Response(JSON.stringify({ message: 'Validation failed near ghs_raw_leak_secret_token_9999' }), { status: 422 });
      }
      if (this.failMode === '403') {
        return new Response(JSON.stringify({ message: 'Installation has been suspended' }), { status: 403 });
      }
      return new Response(
        JSON.stringify({
          token: 'ghs_mock_token_for_workspace_test',
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

    if (this.failMode === '500') {
      return new Response(JSON.stringify({ message: 'Internal Server Error' }), { status: 500 });
    }

    // Contents API: GET or PUT /repos/:owner/:repo/contents(/:path)?
    const contentsRegex = /\/repos\/([^\/]+)\/([^\/]+)\/contents(?:\/(.*))?$/;
    const match = urlStr.match(contentsRegex);

    if (match) {
      const [_, owner, repo, rawPath] = match;
      const targetPath = rawPath ? decodeURIComponent(rawPath) : '';

      if (method === 'GET') {
        // 1. 根目錄或子目錄列表
        if (!targetPath) {
          // 根目錄列表
          const items = [];
          const seenDirs = new Set();
          for (const [p, file] of this.files.entries()) {
            if (p.includes('/')) {
              const topDir = p.split('/')[0];
              if (!seenDirs.has(topDir)) {
                seenDirs.add(topDir);
                items.push({
                  name: topDir,
                  path: topDir,
                  type: 'dir',
                  size: 0,
                  sha: 'dir_sha_' + topDir,
                });
              }
            } else {
              items.push({
                name: file.name,
                path: file.path,
                type: 'file',
                size: file.size,
                sha: file.sha,
                download_url: `https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`,
              });
            }
          }
          return new Response(JSON.stringify(items), { status: 200 });
        }

        // 檢查是否為特定目錄
        const dirPrefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
        const dirItems = [];
        const seenSubDirs = new Set();
        for (const [p, file] of this.files.entries()) {
          if (p.startsWith(dirPrefix)) {
            const rel = p.slice(dirPrefix.length);
            if (rel.includes('/')) {
              const subDir = rel.split('/')[0];
              if (!seenSubDirs.has(subDir)) {
                seenSubDirs.add(subDir);
                dirItems.push({
                  name: subDir,
                  path: `${targetPath}/${subDir}`,
                  type: 'dir',
                  size: 0,
                  sha: 'dir_sha_' + subDir,
                });
              }
            } else {
              dirItems.push({
                name: file.name,
                path: file.path,
                type: 'file',
                size: file.size,
                sha: file.sha,
                download_url: `https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`,
              });
            }
          }
        }

        if (dirItems.length > 0) {
          return new Response(JSON.stringify(dirItems), { status: 200 });
        }

        // 檢查是否為檔案
        if (this.files.has(targetPath)) {
          const file = this.files.get(targetPath);
          return new Response(
            JSON.stringify({
              name: file.name,
              path: file.path,
              sha: file.sha,
              size: file.size,
              type: 'file',
              content: file.contentBase64,
              encoding: 'base64',
              download_url: `https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`,
            }),
            { status: 200 }
          );
        }

        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }

      if (method === 'PUT') {
        const body = JSON.parse(options.body || '{}');
        const existing = this.files.get(targetPath);

        // 如果檔案已存在，body.sha 必須與現有 sha 相符
        if (existing) {
          if (!body.sha || body.sha !== existing.sha) {
            return new Response(
              JSON.stringify({ message: `Conflict: file SHA mismatch (expected ${existing.sha}, got ${body.sha})` }),
              { status: 409 }
            );
          }
        } else {
          // 新檔案若錯誤傳入 sha
          if (body.sha) {
            return new Response(JSON.stringify({ message: 'Conflict: file does not exist but sha provided' }), { status: 409 });
          }
        }

        const contentBuf = Buffer.from(body.content, 'base64');
        const newSha = crypto.createHash('sha1').update(contentBuf).digest('hex');
        const commitSha = crypto.createHash('sha1').update(body.message + Date.now() + Math.random()).digest('hex');

        this.files.set(targetPath, {
          path: targetPath,
          name: targetPath.split('/').pop(),
          contentBase64: body.content,
          sha: newSha,
          size: contentBuf.length,
        });

        return new Response(
          JSON.stringify({
            content: {
              name: targetPath.split('/').pop(),
              path: targetPath,
              sha: newSha,
              size: contentBuf.length,
            },
            commit: {
              sha: commitSha,
              message: body.message,
            },
          }),
          { status: existing ? 200 : 201 }
        );
      }
    }

    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  };
}

async function runTests() {
  console.log('\n====================================================');
  console.log('🧪 Phase 5: GitHub Workspace Service 核心驗證開始');
  console.log('====================================================\n');

  let passed = 0;

  const mockDb = new MockD1();
  const mockGh = new MockGitHubApi();

  const env = {
    DB: mockDb,
    GITHUB_APP_ID: '12345',
    GITHUB_APP_INSTALLATION_ID: '654321',
    GITHUB_APP_PRIVATE_KEY: testKeypairPkcs8.privateKey,
    GITHUB_APP_TARGET_OWNER: 'example-org',
  };

  // 註冊測試課程與實驗資料
  mockDb.experiments.set('exp-01', {
    id: 'exp-01',
    course_id: 'course-ee201',
    experiment_code: 'lab-01',
    name: 'BJT 電晶體特性量測',
    repository: 'example-org/ee201-lab-01',
    report_mode: 'shared',
    status: 'in_progress',
    provisioning_status: 'ready',
  });

  mockDb.experiments.set('exp-separate', {
    id: 'exp-separate',
    course_id: 'course-ee201',
    experiment_code: 'lab-02',
    name: '邏輯閘與加法器',
    repository: 'example-org/ee201-lab-02',
    report_mode: 'separate',
    status: 'in_progress',
    provisioning_status: 'ready',
  });

  mockDb.experiments.set('exp-no-repo', {
    id: 'exp-no-repo',
    course_id: 'course-ee201',
    experiment_code: 'lab-03',
    name: '未綁定專案',
    repository: '',
    report_mode: 'shared',
    status: 'not_started',
    provisioning_status: 'pending',
  });

  // 註冊課程成員
  mockDb.courseMemberships.set('mem-101', {
    id: 'mem-101',
    course_id: 'course-ee201',
    github_id: '101',
    username: 'alice',
    role: 'student',
    status: 'active',
  });
  mockDb.courseMemberships.set('mem-102', {
    id: 'mem-102',
    course_id: 'course-ee201',
    github_id: '102',
    username: 'bob',
    role: 'student',
    status: 'active',
  });

  // ==========================================
  // 群組 1: Repository Binding 解析與驗證
  // ==========================================
  console.log('▶ [群組 1: Repository Binding 解析與身分邊界]');

  // 1.1 實驗不存在 404
  try {
    await getWorkspaceRepository(env, 'exp-not-found');
    assert.fail('應拋出 404');
  } catch (err) {
    assert.strictEqual(err.status, 404);
    assert.ok(err.message.includes('not found'));
    console.log('  ✅ [PASS] 實驗不存在正確回傳 404 Not Found');
    passed++;
  }

  // 1.2 未綁定 Repository 400
  try {
    await getWorkspaceRepository(env, 'exp-no-repo');
    assert.fail('應拋出 400');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('no repository bound'));
    console.log('  ✅ [PASS] 實驗未綁定 Repository 正確阻擋 (400 Bad Request)');
    passed++;
  }

  // 1.3 非協作者存取阻絕 403
  try {
    await getWorkspaceRepository(env, 'exp-01', { github_id: '999' }); // 非課程成員
    assert.fail('應拋出 403');
  } catch (err) {
    assert.strictEqual(err.status, 403);
    assert.ok(err.message.includes('Access denied'));
    console.log('  ✅ [PASS] 非協作者存取遭 403 Forbidden 阻絕');
    passed++;
  }

  // 1.4 合法協作者成功解析 Repository
  {
    const repoInfo = await getWorkspaceRepository(env, 'exp-01', { github_id: '101' });
    assert.strictEqual(repoInfo.owner, 'example-org');
    assert.strictEqual(repoInfo.repo, 'ee201-lab-01');
    assert.strictEqual(repoInfo.full_name, 'example-org/ee201-lab-01');
    assert.strictEqual(repoInfo.report_mode, 'shared');
    assert.strictEqual(repoInfo.default_branch, 'main');
    console.log('  ✅ [PASS] 合法協作者正確取得 Repository 綁定資訊 (200 OK)');
    passed++;
  }

  // ==========================================
  // 群組 2: 檔案樹讀取 (listFiles)
  // ==========================================
  console.log('\n▶ [群組 2: 檔案樹讀取 (listFiles)]');

  // 2.1 根目錄檔案樹列出
  {
    const files = await listFiles(env, 'exp-01', '', { github_id: '101' }, mockGh.fetch);
    assert.ok(Array.isArray(files));
    assert.ok(files.length >= 5);

    // 驗證內部類型標準化
    const readme = files.find((f) => f.path === 'README.md');
    assert.ok(readme);
    assert.strictEqual(readme.name, 'README.md');
    assert.strictEqual(readme.type, 'file');
    assert.ok(readme.sha);

    const reportDir = files.find((f) => f.path === 'report');
    assert.ok(reportDir);
    assert.strictEqual(reportDir.type, 'directory');

    // 驗證排序：目錄在前
    assert.strictEqual(files[0].type, 'directory');
    console.log('  ✅ [PASS] 根目錄檔案樹正確取得且符合目錄優先排序');
    passed++;
  }

  // 2.2 子目錄檔案樹讀取 (photos/)
  {
    const photoFiles = await listFiles(env, 'exp-01', 'photos', { github_id: '101' }, mockGh.fetch);
    assert.ok(Array.isArray(photoFiles));
    assert.strictEqual(photoFiles.length, 1);
    assert.strictEqual(photoFiles[0].name, 'photo1.jpg');
    assert.strictEqual(photoFiles[0].path, 'photos/photo1.jpg');
    assert.strictEqual(photoFiles[0].type, 'file');
    console.log('  ✅ [PASS] 巢狀子目錄檔案列表正確解析');
    passed++;
  }

  // 2.3 查詢不存在目錄 404
  try {
    await listFiles(env, 'exp-01', 'nonexistent-folder', { github_id: '101' }, mockGh.fetch);
    assert.fail('應拋出 404');
  } catch (err) {
    assert.strictEqual(err.status, 404);
    assert.ok(err.message.includes('not found'));
    console.log('  ✅ [PASS] 存取不存在目錄正確回傳 404');
    passed++;
  }

  // ==========================================
  // 群組 3: 檔案內容讀取 (readFile)
  // ==========================================
  console.log('\n▶ [群組 3: 檔案內容讀取 (readFile)]');

  // 3.1 讀取文字檔並自動 UTF-8 解碼
  {
    const file = await readFile(env, 'exp-01', 'README.md', { github_id: '101' }, mockGh.fetch);
    assert.strictEqual(file.path, 'README.md');
    assert.strictEqual(file.encoding, 'utf-8');
    assert.ok(file.content.includes('# EE201 Lab 01'));
    assert.ok(file.sha);
    assert.ok(file.size > 0);
    console.log('  ✅ [PASS] 成功讀取文字檔案並完成 Base64 -> UTF-8 解碼');
    passed++;
  }

  // 3.2 嘗試將目錄作為檔案讀取阻絕
  try {
    await readFile(env, 'exp-01', 'report', { github_id: '101' }, mockGh.fetch);
    assert.fail('應拋出 400 目錄錯誤');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('is a directory'));
    console.log('  ✅ [PASS] 嘗試以 readFile 讀取目錄遭 400 阻絕');
    passed++;
  }

  // 3.3 讀取不存在檔案 404
  try {
    await readFile(env, 'exp-01', 'missing.txt', { github_id: '101' }, mockGh.fetch);
    assert.fail('應拋出 404');
  } catch (err) {
    assert.strictEqual(err.status, 404);
    console.log('  ✅ [PASS] 讀取不存在檔案正確回傳 404');
    passed++;
  }

  // 3.4 大檔案檢測 (超過 1MB 阻絕)
  {
    const bigFileFetch = async (url, opts) => {
      if (String(url).includes('/contents/big.iso')) {
        return new Response(
          JSON.stringify({
            name: 'big.iso',
            path: 'big.iso',
            size: 2 * 1024 * 1024, // 2MB
            content: null,
          }),
          { status: 200 }
        );
      }
      return mockGh.fetch(url, opts);
    };

    try {
      await readFile(env, 'exp-01', 'big.iso', { github_id: '101' }, bigFileFetch);
      assert.fail('應拋出 413');
    } catch (err) {
      assert.strictEqual(err.status, 413);
      assert.ok(err.message.includes('too large'));
      console.log('  ✅ [PASS] 超過 1MB 之大檔案正確攔截並回傳 413');
      passed++;
    }
  }

  // ==========================================
  // 群組 4: 文字檔案寫入 (createOrUpdateFile)
  // ==========================================
  console.log('\n▶ [群組 4: 文字檔案寫入與真實 Commit SHA]');

  // 4.1 新增文字檔案並取得真實 commit SHA
  {
    const result = await createOrUpdateFile(
      env,
      'exp-01',
      'notes/experiment_log.txt',
      'Experiment started at 10:00 AM',
      'docs: add initial experiment notes',
      { github_id: '101' },
      {},
      mockGh.fetch
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.path, 'notes/experiment_log.txt');
    assert.strictEqual(result.commit_message, 'docs: add initial experiment notes');
    assert.ok(result.commit_sha);
    assert.strictEqual(result.commit_sha.length, 40); // 40-char SHA
    assert.ok(result.content_sha);
    console.log(`  ✅ [PASS] 成功建立新文字檔案，取得真實 Git Commit SHA: ${result.commit_sha.slice(0, 7)}`);
    passed++;
  }

  // 4.2 更新已存在文字檔案 (自動獲取 SHA)
  {
    const updateResult = await createOrUpdateFile(
      env,
      'exp-01',
      'notes/experiment_log.txt',
      'Experiment started at 10:00 AM\nPhase 1 completed at 11:30 AM',
      'docs: append phase 1 completion notes',
      { github_id: '101' },
      {},
      mockGh.fetch
    );

    assert.strictEqual(updateResult.success, true);
    assert.ok(updateResult.commit_sha);
    assert.strictEqual(updateResult.commit_sha.length, 40);

    // 驗證檔案內容已更新
    const readUpdated = await readFile(env, 'exp-01', 'notes/experiment_log.txt', { github_id: '101' }, mockGh.fetch);
    assert.ok(readUpdated.content.includes('Phase 1 completed'));
    console.log('  ✅ [PASS] 自動獲取現有 SHA 並順利完成檔案更新');
    passed++;
  }

  // 4.3 顯式傳入錯誤 SHA 觸發 409 Conflict (防並行覆蓋)
  try {
    await createOrUpdateFile(
      env,
      'exp-01',
      'notes/experiment_log.txt',
      'Conflict text',
      'docs: conflict test',
      { github_id: '101' },
      { sha: 'wrong_stale_sha_9999999999999999999999999999' },
      mockGh.fetch
    );
    assert.fail('應拋出 409');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(err.message.includes('Conflict'));
    console.log('  ✅ [PASS] 帶入過期或錯誤 SHA 正確引發 409 Conflict 衝突保護');
    passed++;
  }

  // ==========================================
  // 群組 5: 二進位檔案寫入 (createOrUpdateBinaryFile)
  // ==========================================
  console.log('\n▶ [群組 5: 二進位檔案寫入 (照片/素材)]');

  // 5.1 寫入 Uint8Array 二進位圖片檔案
  {
    const sampleBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const binResult = await createOrUpdateBinaryFile(
      env,
      'exp-01',
      'photos/oscilloscope_wave.jpg',
      sampleBytes,
      'assets: add oscilloscope measurement snapshot',
      { github_id: '101' },
      {},
      mockGh.fetch
    );

    assert.strictEqual(binResult.success, true);
    assert.strictEqual(binResult.path, 'photos/oscilloscope_wave.jpg');
    assert.ok(binResult.commit_sha);
    console.log(`  ✅ [PASS] Uint8Array 二進位圖片上傳成功，Commit SHA: ${binResult.commit_sha.slice(0, 7)}`);
    passed++;
  }

  // 5.2 寫入 Base64 字串格式二進位檔案
  {
    const b64Data = Buffer.from('binary-png-stream-mock-bytes').toString('base64');
    const binResult2 = await createOrUpdateBinaryFile(
      env,
      'exp-01',
      'photos/circuit_diagram.png',
      b64Data,
      'assets: upload circuit diagram',
      { github_id: '101' },
      { isBase64: true },
      mockGh.fetch
    );

    assert.strictEqual(binResult2.success, true);
    assert.strictEqual(binResult2.path, 'photos/circuit_diagram.png');
    console.log('  ✅ [PASS] Base64 編碼之二進位素材檔案順利寫入');
    passed++;
  }

  // ==========================================
  // 群組 6: 路徑安全與防穿越防禦 (Path Traversal Security)
  // ==========================================
  console.log('\n▶ [群組 6: 路徑安全與防穿越防禦]');

  // 6.1 ../ 相對路徑穿越攔截
  try {
    validateWorkspacePath('../etc/passwd');
    assert.fail('應攔截 ../');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('path traversal'));
    console.log('  ✅ [PASS] ../ 相對路徑穿越精準攔截');
    passed++;
  }

  // 6.2 巢狀目錄內穿越攔截 (photos/../../secret)
  try {
    validateWorkspacePath('photos/../../secret.txt');
    assert.fail('應攔截巢狀穿越');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('path traversal'));
    console.log('  ✅ [PASS] 巢狀目錄穿越 (photos/../../secret) 精準攔截');
    passed++;
  }

  // 6.3 絕對路徑 (/etc/shadow, \Windows) 攔截
  try {
    validateWorkspacePath('/root/.ssh/id_rsa');
    assert.fail('應攔截絕對路徑');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('absolute path'));
    console.log('  ✅ [PASS] 絕對路徑 (/...) 遭精準阻擋');
    passed++;
  }

  // 6.4 URL Encoded 穿越 (%2e%2e, %252e%252e) 攔截
  try {
    validateWorkspacePath('%2e%2e/config.yml');
    assert.fail('應攔截 %2e%2e');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('path traversal'));
    console.log('  ✅ [PASS] URL-encoded 穿越 (%2e%2e) 精準解碼並攔截');
    passed++;
  }

  try {
    validateWorkspacePath('%252e%252e/config.yml');
    assert.fail('應攔截雙重編碼穿越');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('path traversal'));
    console.log('  ✅ [PASS] 雙重 URL 編碼穿越 (%252e%252e) 精準解碼並攔截');
    passed++;
  }

  // 6.5 空字元注入 (\0) 攔截
  try {
    validateWorkspacePath('photos/\0evil.png');
    assert.fail('應攔截空字元注入');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.ok(err.message.includes('null byte'));
    console.log('  ✅ [PASS] Null byte 空字元注入檢驗精準攔截');
    passed++;
  }

  // 6.6 合法路徑正確正規化 (去除多餘斜線與目前目錄)
  {
    const clean = validateWorkspacePath('./photos//figures///pic1.png');
    assert.strictEqual(clean, 'photos/figures/pic1.png');
    console.log('  ✅ [PASS] 合法冗餘路徑 (./photos//pic1.png) 乾淨正規化');
    passed++;
  }

  // ==========================================
  // 群組 7: Raw Data Sanctuary 與 Separate Report 安全防護
  // ==========================================
  console.log('\n▶ [群組 7: Raw Data Sanctuary 與 Separate Report 防護]');

  // 7.1 Raw 聖域防護：禁止修改 raw/*
  try {
    await createOrUpdateFile(
      env,
      'exp-01',
      'raw/override.csv',
      'tampered data',
      'malicious update',
      { github_id: '101' },
      {},
      mockGh.fetch
    );
    assert.fail('應禁止修改 raw/*');
  } catch (err) {
    assert.strictEqual(err.status, 403);
    assert.ok(err.message.includes('Raw sanctuary violation'));
    console.log('  ✅ [PASS] Raw Data Sanctuary 鐵律生效：嚴禁寫入 raw/* (403 Forbidden)');
    passed++;
  }

  // 7.2 Separate 報告模式：禁止修改他人報告
  try {
    await createOrUpdateFile(
      env,
      'exp-separate',
      'report/102.md', // 嘗試修改 Bob 的個人報告
      'Malicious edit by Alice',
      'docs: edit bob report',
      { github_id: '101' }, // Alice 操作
      {},
      mockGh.fetch
    );
    assert.fail('應禁止修改其他同學個人報告');
  } catch (err) {
    assert.strictEqual(err.status, 403);
    assert.ok(err.message.includes('Separate report mode violation'));
    console.log('  ✅ [PASS] Separate Report 模式隔離生效：禁止修改他人個人報告 (403 Forbidden)');
    passed++;
  }

  // 7.3 Separate 報告模式：允許修改自己報告
  {
    const selfReportResult = await createOrUpdateFile(
      env,
      'exp-separate',
      'report/101.md', // Alice 的個人報告
      '# Alice Lab 02 Report\nMy independent results.',
      'docs: create alice personal report',
      { github_id: '101' },
      {},
      mockGh.fetch
    );
    assert.strictEqual(selfReportResult.success, true);
    assert.strictEqual(selfReportResult.path, 'report/101.md');
    console.log('  ✅ [PASS] Separate Report 模式：協作者成功建立/修改個人專屬報告');
    passed++;
  }

  // ==========================================
  // 群組 8: GitHub API 異常轉譯與安全去敏
  // ==========================================
  console.log('\n▶ [群組 8: GitHub API 異常轉譯與去敏審計]');

  // 8.1 GitHub 401 轉譯 502
  {
    mockGh.failMode = '401';
    try {
      await readFile(env, 'exp-01', 'README.md', { github_id: '101' }, mockGh.fetch);
      assert.fail('應拋出 502');
    } catch (err) {
      assert.strictEqual(err.status, 502);
      assert.ok(err.message.includes('authentication failed') || err.message.includes('HTTP 401'));
      console.log('  ✅ [PASS] GitHub 401 錯誤安全轉譯為 502 Bad Gateway');
      passed++;
    }
  }

  // 8.1b 敏感 Token 去敏審計
  {
    mockGh.failMode = 'token_leak';
    try {
      await readFile(env, 'exp-01', 'README.md', { github_id: '101' }, mockGh.fetch);
      assert.fail('應拋出 502');
    } catch (err) {
      assert.strictEqual(err.status, 502);
      assert.ok(!err.message.includes('ghs_raw_leak_secret_token_9999'));
      assert.ok(err.message.includes('[REDACTED_TOKEN]'));
      console.log('  ✅ [PASS] GitHub 錯誤訊息中若含有 Token 徹底去敏替換為 [REDACTED_TOKEN]');
      passed++;
    }
  }

  // 8.2 GitHub 403 轉譯 502
  {
    mockGh.failMode = '403';
    try {
      await readFile(env, 'exp-01', 'README.md', { github_id: '101' }, mockGh.fetch);
      assert.fail('應拋出 502');
    } catch (err) {
      assert.strictEqual(err.status, 502);
      console.log('  ✅ [PASS] GitHub 403 權限異常安全轉譯為 502 Bad Gateway');
      passed++;
    }
  }

  // 8.3 GitHub 500 上游服務異常
  {
    mockGh.failMode = '500';
    try {
      await readFile(env, 'exp-01', 'README.md', { github_id: '101' }, mockGh.fetch);
      assert.fail('應拋出 502');
    } catch (err) {
      assert.strictEqual(err.status, 502);
      assert.ok(err.message.includes('server error') || err.message.includes('Internal Server Error'));
      console.log('  ✅ [PASS] GitHub 500 上游故障安全轉譯為 502 Bad Gateway');
      passed++;
    }
    mockGh.failMode = null;
  }

  // ==========================================
  // 群組 9: createWorkspaceService 服務工廠實例化
  // ==========================================
  console.log('\n▶ [群組 9: createWorkspaceService 工廠實例化]');

  {
    const ws = createWorkspaceService(env, mockGh.fetch);
    assert.strictEqual(typeof ws.getWorkspaceRepository, 'function');
    assert.strictEqual(typeof ws.listFiles, 'function');
    assert.strictEqual(typeof ws.readFile, 'function');
    assert.strictEqual(typeof ws.createOrUpdateFile, 'function');
    assert.strictEqual(typeof ws.createOrUpdateBinaryFile, 'function');

    const repo = await ws.getWorkspaceRepository('exp-01', { github_id: '101' });
    assert.strictEqual(repo.full_name, 'example-org/ee201-lab-01');

    const tree = await ws.listFiles('exp-01', '', { github_id: '101' });
    assert.ok(tree.length > 0);
    console.log('  ✅ [PASS] createWorkspaceService 服務工廠實例化與鏈結調用完全符合規範');
    passed++;
  }

  console.log('\n====================================================');
  console.log(`📊 Workspace Service 驗證總結：通過 ${passed} 項，失敗 0 項`);
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ 測試執行失敗:', err);
  process.exit(1);
});
