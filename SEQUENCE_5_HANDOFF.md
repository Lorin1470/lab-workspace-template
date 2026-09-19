# Sequence 5 交接封存報告 (SEQUENCE_5_HANDOFF.md)

本文件建立於 **2026-09-19**，旨在為下一個接手的 Agent 提供完全無縫銜接的系統架構、現有程式碼現況、Sequence 5 實作成果與後續規劃指引。**即使下一個 Agent 沒有看過先前的對話紀錄，亦可藉由本文件掌握所有細節並直接開展工作。**

---

## 一、專案定位 (Core Product Identity)

- **同儕平等協作的「實驗課 GitHub 工作區」**：
  - 本專案是使用者與其同學之間平等的協作平台，目標是一起管理實驗專案、GitHub 儲存庫、實驗數據、原始照片與報告。
  - **嚴禁階級觀念**：系統**沒有** Teacher / Assistant / Student 的管理階級。所有已加入工作區的成員皆為平等的協作者（Collaborators）。
  - **這不是 LMS**：**嚴格禁止**自行加入教師管理、學生審查、點名、成績打分、教師專屬操作按鈕等 LMS 功能。
  - **GitHub 是 Source of Truth**：所有實驗檔案、照片、量測數據與報告的真實存放地是各實驗對應的 GitHub Repository。Cloudflare D1 僅保存課程、成員、實驗對映、Provisioning 狀態與 Activity Log 等 metadata。

---

## 二、目前完成進度 (Roadmap Status)

至本階段為止，專案已依序完成下列階段重構與實作：

1. **Sequence 1：後端權限平權化** (`bd980e5`)：
   - 移除 Teacher 階級限制、移除 Last Active Teacher 保護、移除 Bootstrap Admin 提權邏輯。
   - 所有認證協作者皆具備建立課程、建立實驗、觸發 Provisioning 與操作工作區之同等權限。
2. **Sequence 2：前端 UI 平權化** (`e2a22d7`)：
   - 清除前端所有 `isTeacher` 等角色判斷門檻，解鎖所有協作者的操作按鈕。
3. **Sequence 3：GitHub Workspace Service 核心** (`d68006b`)：
   - 建立 `web/functions/api/services/workspace.ts`，提供 Repository Binding 查詢、檔案樹讀取、檔案讀取、文字檔寫入、二進位寫入、路徑穿越防禦與真實 Commit SHA 解析。
4. **Sequence 4：Workspace HTTP API 與 Activity Log 整合** (`08e494a`)：
   - 於 `web/functions/api/[[route]].ts` 實作標準 RESTful Workspace HTTP 端點，並與 D1 Activity Log 深度整合，寫入真實 40 位元 Commit SHA。
5. **Sequence 5：Web 前端 Workspace 檔案管理與協作介面** (`73d62ed`，本次完成)：
   - 打造全功能 `WorkspaceManager.tsx` 元件並無縫掛載於 `ExperimentDetail.tsx`。接通真實 GitHub 檔案樹、Markdown 預覽、文字編輯器、409 Conflict 良好 UX、Raw Data 聖域上傳、照片上傳與真實 Commit SHA 展示。

---

## 三、目前 Git 狀態 (Git Status & Commits)

- **最新 Commit Hash**：`73d62ed`
- **最新 Commit Message**：`[web] 實作 Workspace 檔案管理與協作介面`
- **Working Tree 狀態**：`clean`（無任何未暫存或未提交之異動）
- **遠端同步狀態**：**尚未 push 至遠端 origin/main**（保留於本機 main 分支）
- **部署狀態**：**尚未 deploy 至 Cloudflare Pages**

---

## 四、Sequence 5 修改與新增檔案詳情

| 檔案路徑 | 異動狀態 | 職責與實作說明 |
| :--- | :--- | :--- |
| **`web/src/types/index.ts`** | 修改 | 定義 Workspace 前端型別：`WorkspaceFileItem`（包含 `name`, `path`, `type: 'file' | 'dir' | 'directory'`, `size?`, `sha?`）、`WorkspaceFileContent`、`WorkspaceWriteResponse`。 |
| **`web/src/api/client.ts`** | 修改 | 新增 `api.workspace` 模組：`listFiles(expId, path?)`、`readFile(expId, path)`、`saveFile(expId, data)`、`uploadRaw(expId, formData)`、`uploadPhoto(expId, formData)`。沿用現有 Session 鑑權，完整支援 JSON 與 FormData。 |
| **`web/src/components/WorkspaceManager.tsx`** | **[NEW]** | 全新核心工作區元件（1,200+ 行）：<br>• 左側檔案樹：動態列出真實檔案、支援多層子目錄展開收合、即時重新整理。<br>• 右側檢視器：Markdown 乾淨排版渲染、等寬程式碼/文字預覽、照片預覽卡片與 GitHub 連結。<br>• 編輯器：支援編輯與儲存並攜帶原始 SHA，即時取得真實 40 位元 commit_sha。<br>• 409 衝突處理：樂觀鎖衝突橫幅與「重新載入最新版本」按鈕（拒絕自動偷偷覆寫）。<br>• 上傳 Modal：Raw Data 聖域上傳（自動導向 `raw/`）與照片上傳（5MB 前端驗證，自動導向 `photos/`）。<br>• Separate Report 隔離：非本人報告禁用編輯。 |
| **`web/src/components/ExperimentDetail.tsx`** | 修改 | • 將原本的 `files` 分頁升級為 `📁 工作區 (Workspace)`，掛載 `WorkspaceManager`。<br>• 徹底移除舊版寫死的靜態假目錄列表，並將原假 upload 分頁引導至工作區。<br>• 檔案儲存與上傳成功後，自動觸發 `loadActivityLogs()` 刷新專案日誌。 |
| **`scripts/verify-frontend.mjs`** | 修改 | • 擴充 MockGitHubApi 支援 Contents API（GET/PUT）與 SHA 樂觀鎖模擬。<br>• 新增「群組 9: Workspace 前端整合、API Client 與錯誤轉譯驗證」（10 個測試案例，全數通過）。 |

---

## 五、現有 Workspace 后端 API (DO NOT RE-IMPLEMENT)

後端 API 與服務已於 Sequence 3 與 4 完整實作並通過 65 項測試，**請下一個 Agent 絕對不要重新實作或修改以下架構**：

1. **`GET /api/experiments/:id/workspace/files?path=`**：
   - 讀取實驗 Repository 檔案樹（根目錄或子目錄）。
   - 僅限該實驗之合法協作者（Session 鑑權）。
2. **`GET /api/experiments/:id/workspace/file?path=`**：
   - 讀取單一檔案內容（UTF-8 解碼、大小、現行 `sha`）。
3. **`PUT /api/experiments/:id/workspace/file`**：
   - 建立或更新文字檔案。
   - 要求欄位：`path`, `content`, `message`, `sha`。
   - 嚴格比對 `sha`（樂觀鎖）；若不符合回傳 `409 Conflict`。
   - 嚴格禁止向 `raw/*` 提交（違反聖域回傳 `403 Forbidden`）。
   - 成功後回傳真實 `commit_sha` 與 `content_sha`，並寫入 D1 Activity Log。
4. **`POST /api/experiments/:id/workspace/raw`**：
   - 專屬原始數據上傳端點（支援 JSON 或 `multipart/form-data`）。
   - 自動置於 `raw/` 目錄。
   - **若同名檔案已存在，嚴格回傳 409 Conflict（Raw Sanctuary 鐵律：不可覆寫）**。
5. **`POST /api/experiments/:id/workspace/photos`**：
   - 專屬實驗照片上傳端點（支援 JSON 或 `multipart/form-data`）。
   - 自動置於 `photos/` 目錄。
   - 限制副檔名：`jpg`, `jpeg`, `png`, `webp`；限制 MIME：`image/jpeg`, `image/png`, `image/webp`。
   - 限制大小：單檔不可超過 5MB（超過回傳 `413 Payload Too Large`）。

**重要備註**：
- 所有 Repository 資訊完全依據 D1 之 `experiments.repository` 綁定，嚴格禁止 caller / 前端自行指定任意 `owner/repo`。
- 後端使用 GitHub App Installation Token 進行 API 操作，不需要另外新增 OAuth 或 PAT 邏輯。

---

## 六、安全邊界與保護模型 (Security Principles)

1. **Raw Data 聖域保護 (Raw Data Sanctuary)**：
   - 原始儀器量測數據存放於 `raw/` 目錄。
   - 通用文字編輯 API 嚴格禁止寫入 `raw/*`。
   - 專屬 Raw 上傳端點在目標檔案已存在時，一律回傳 409 Conflict 阻絕覆寫。
   - 前端絕不提供「強制覆寫」選項。
2. **樂觀鎖並行控制 (Optimistic Concurrency Control)**：
   - 檔案編輯必須使用讀取時取得的原始 `sha`。
   - 當收到 409 Conflict 時，前端必須明確告知使用者「這個檔案已經被其他同學修改，請重新載入最新版本後再編輯。」並提供手動重新載入按鈕。
   - **嚴禁自動私下重新取得最新 SHA 並覆蓋他人成果**。
3. **個人報告隔離 (Separate Report Isolation)**：
   - 當實驗設定為 `report_mode === 'separate'` 時，協作者僅能編輯自己的個人報告（`report/<github_id>.md`）。
   - 檢視其他同學的報告時，前端禁用編輯功能並提示說明；後端亦有 403 阻絕保護。
4. **真實 Commit SHA 保證**：
   - 寫入成功後，後端與前端展示的 `commit_sha` 必為 GitHub API 回傳之真實 40 位元 SHA。
   - 嚴格禁止在前端自行假造 SHA。

---

## 七、Sequence 5 前端完成功能檢驗

- [x] **真實 GitHub 檔案樹**：無任何寫死 Mock 資料，動態載入根目錄與巢狀子目錄。
- [x] **檔案瀏覽與閱讀**：支援點擊目錄展開/收合、點擊檔案讀取、顯示檔案大小與現行 SHA。
- [x] **Markdown 預覽**：純前端輕量渲染標題、引文、列表、程式碼區塊、水平線。
- [x] **程式碼與文字編輯**：支援等寬文字編輯、預設 Commit 說明（更新實驗筆記/報告）、提交儲存。
- [x] **409 Conflict 良好處理**：黃色警示橫幅，明確引導同學「重新載入最新版本」，不偷偷覆蓋。
- [x] **Raw Data 聖域上傳**：專屬檔案選擇器，自動前綴 `raw/`，409 重複阻擋提示「原始資料已存在，Raw Data 不允許覆寫。」
- [x] **實驗照片上傳**：限制 JPG/PNG/WEBP，前端 5MB 防護與後端 413 雙重檢查，自動前綴 `photos/`。
- [x] **Separate Report 防護**：他人報告切換唯讀，禁用編輯按鈕並呈現友善說明。
- [x] **Commit SHA 與 GitHub 連結**：顯示 40 位元 SHA，支援一鍵複製與在 GitHub 查看 Commit。
- [x] **活動紀錄即時連動**：儲存/上傳成功後，自動刷新 `loadActivityLogs()`。
- [x] **工作區重新整理**：提供「重新整理」按鈕，快速同步遠端變動。

---

## 八、全套自動化測試結果 (Test Suite Results)

所有測試皆於本機環境 100% 通過：

| 指令 | 驗證項目 | 結果 | 說明 |
| :--- | :--- | :--- | :--- |
| `npm run test:frontend` | 前端整合測試 | ✅ **46/46 通過** | 包含 10 項全新 Group 9 Workspace 前端整合案例 |
| `npm run test:workspace` | Workspace 服務核心 | ✅ **31/31 通過** | 路徑穿越、檔案樹、讀寫、聖域、報告隔離等 |
| `npm run test:workspace-api`| Workspace HTTP API | ✅ **34/34 通過** | 401/403/404/409/413、真實 commit_sha、Activity Log |
| `npm run test:management` | 管理 API 驗證 | ✅ **49/49 通過** | 課程、實驗、成員、SQLite Migration 0004 |
| `npm run test:permissions` | 權限模型驗證 | ✅ **37/37 通過** | 移除階級限制之平權模型 |
| `npm run test:auth` | OAuth 與 Session | ✅ **37/37 通過** | Opaque Session、CSRF、身分鎖定 |
| `npm run test:activity` | Activity Log 驗證 | ✅ **41/41 通過** | Append-Only、真實 SHA 防偽 |
| `npm run test:provisioning` | 儲存庫建立後端 | ✅ **25/25 通過** | RS256 JWT、狀態機、等冪性、自癒重試 |
| `npm run validate` | Template 結構驗證 | ✅ **通過** | 母倉庫 Template 規範與 SKILL.md v1.1 合格 |
| `npm run web:build` | 前端打包編譯 | ✅ **通過** | TypeScript 型別與 Vite 生產打包零錯誤 |
| `git diff --check` | 排版與空白檢查 | ✅ **通過** | 零 Whitespace 異常與零衝突標記 |

> [!NOTE]
> **重要標記**：上述自動化測試主要驗證系統邏輯、API Client 流程與 Mock GitHub API 機制；**尚未等同於在真實 GitHub 遠端環境進行端到端手動驗證**。

---

## 九、下一步：下一個 Agent 接手指南 (Next Steps)

下一個 Agent 接手後，**請勿重複實作 Sequence 5**。第一步應依序執行以下工作：

### 步驟 1：接手檢查
1. 閱讀本份 `SEQUENCE_5_HANDOFF.md`。
2. 執行 `git log -n 5 --oneline` 確認當前分支狀態。
3. 執行 `git status` 確認 working tree 保持 clean。
4. 執行 `npm run web:build` 確認編譯無異常。

### 步驟 2：真實 GitHub Workspace 手動 E2E 驗證
在具備有效 GitHub App 與 Cloudflare 環境下，驗證完整操作流程：
1. **GitHub Login**：以同學身分登入系統。
2. **Course & Experiment**：進入課程與已 Provision 之實驗。
3. **開啟「📁 工作區」**：
   - 根目錄檔案樹是否自真實 GitHub Repo 正確載入？
   - 展開資料夾（如 `report/`、`photos/`）是否能動態取得子項目？
   - 點選 `README.md` 是否呈現真實內容與 SHA？
4. **修改與儲存**：
   - 編輯文字檔（如 `notes.md`），按下「儲存並產生 Commit」。
   - 檢查是否成功取得真實 40 位元 Commit SHA？
   - 檢查 GitHub 遠端儲存庫是否確實多了一筆 Git Commit？
   - 檢查「📋 活動紀錄」是否已更新此筆操作與相同 Commit SHA？
5. **409 樂觀鎖驗證**：
   - 在另一視窗或本機 git 修改相同檔案並 push。
   - 回到工作區嘗試儲存舊內容，確認是否跳出「這個檔案已經被其他同學修改，請重新載入最新版本後再編輯。」黃色橫幅？
   - 點擊「重新載入最新版本」後是否順利載入遠端最新內容？
6. **Raw Data 聖域驗證**：
   - 上傳一份量測檔案（如 `test_data.csv`），確認自動置於 `raw/` 且遠端成功 Commit。
   - 再次上傳同名 `test_data.csv`，確認跳出「原始資料已存在，Raw Data 不允許覆寫。」且阻絕成功。
7. **照片上傳驗證**：
   - 上傳一張大於 5MB 的圖片，確認前端即時阻絕（「照片不能超過 5MB。」）。
   - 上傳一張正常的 JPG/PNG，確認自動進入 `photos/` 且遠端成功 Commit。
8. **Separate Report 模式驗證**：
   - 切換至 Separate Report 模式實驗，點選其他同學的報告，確認編輯功能已禁用。

### 步驟 3：後續 Sequence 6 規劃（現在禁止實作）
當且僅當 Sequence 5 手動驗證確認完全符合預期後，方可開啟 **Sequence 6：Agent 工作流**：
- **預定目標**：
  - 同學於本機拍攝之實驗照片與原始數據 $\rightarrow$ staging 暫存。
  - AI Agent 協助分類至 `photos/` 與 `raw/`。
  - AI Agent 協助清洗數據至 `processed/`、繪製圖表至 `analysis/`。
  - AI Agent 依據模板與量測數據起草實驗報告。
  - 使用者手動審閱並確認 $\rightarrow$ 透過工作區 Commit 至 GitHub。
- **嚴格守則**：**現在禁止開始實作 Sequence 6**。

---

## 十、目前已知注意事項 (Known Issues & Precautions)

1. **零 Mock 資料**：
   - 前端已徹底清理寫死的靜態結構與假 dropzone，所有資料皆從 `/api/experiments/:id/workspace/*` 取得。
2. **零 Teacher / Student Hierarchy UI**：
   - 前端與後端已全面平權化，協作者皆具備操作權限。
3. **零 Backend Scope Drift**：
   - 本次完全沒有修改 `workspace.ts` 服務核心、沒有修改 D1 Schema、沒有新增 Migration。
4. **手動 E2E 尚未於 Production 執行**：
   - 由於目前保留於本機 commit 未 push，線上 GitHub App 整合有賴後續環境配置進行最後手動確認。
5. **建置與型別狀態**：
   - TypeScript 編譯與 Vite 打包目前為 0 錯誤、0 警告。`git diff --check` 完全通過。
