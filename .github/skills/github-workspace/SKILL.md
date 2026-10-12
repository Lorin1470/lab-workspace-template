---
name: github-workspace
description: 實驗課 GitHub 工作區直接操作 Skill。支援 Course Mode (共享儲存庫) 與 Experiment Mode (獨立儲存庫)，直接透過 GitHub (GitHub API、GitHub CLI 或 Git) 進行目錄探索、安全檔案讀寫與素材上傳。具備路徑防穿越、不可變原始數據 (raw/) 聖域保護、個人報告隔離、寫入後真實 Commit SHA 驗證與強制使用者確認安全鎖。
version: "1.0"
---

# GitHub 實驗工作區 Agent Skill (Version 1.0)

本規範是 AI Agent 在實驗工作區直接透過 GitHub 介面（GitHub API、GitHub CLI 或本機 Git）執行儲存庫辨識、目錄探索、檔案讀取、素材上傳、檔案建立與版本驗證時的最高準則。

---

## 1. Skill 定位與職責分工

本工作區採用雙 Skill 專業分工機制，兩者各司其職且遵循同一套安全標準：

* **`github-workspace` (本 Skill)**：
  - **職責**：儲存庫辨識、工作目錄定位、檔案樹探索、檔案讀取、二進位素材安全上傳、新檔案建立、路徑隔離檢查與寫入後 Git 版本驗證。
  - **核心精神**：安全且可驗證地操作 GitHub 資源，杜絕路徑穿越、誤覆寫與原始數據竄改。
* **`experiment-report` (實驗專業 Skill)**：
  - **職責**：實驗數據清洗、單位標準化、誤差計算、特性曲線擬合、圖表繪製規格與 Markdown 實驗報告撰寫。
  - **核心精神**：維護實驗數據的科學誠信與報告學術結構。

兩者共同遵循原始數據不可變性、分步授權與 Git 安全鎖原則，互不衝突。

---

## 2. 直連 GitHub 鐵律（禁止依賴 Web 站台 API）

> [!CAUTION]
> **嚴禁將 Cloudflare 網站 API 作為 Agent 操作工作區的介面**！
> Agent **絕對不得呼叫** `https://lab.minerdog.qzz.io/api/...`，亦不得將網站登入 Session、Cookie、Cloudflare D1 或網站管理端點作為操作的前提依賴。

所有檔案讀取、建立、上傳與版本查詢必須**直接針對 GitHub Repository** 進行：

### 2.1 可用管道與環境檢測決策樹
Agent 不得預設工具已具備權限，在執行任何實質操作前，必須依序檢測可用環境：
* **管道 1（本機命令列 Git / GitHub CLI）**：
  - **檢測方式**：執行 `gh auth status` 檢查 GitHub 認證狀態與 Token Scopes（確認具備 `repo` 存取範圍）；執行 `git remote -v` 確認遠端儲存庫位址。
  - **適用情境**：本機工作區操作、批次檔案新增、直接利用本機 Git 建立 Commit 並推送。
* **管道 2（GitHub 工具 / MCP Server）**：
  - **檢測方式**：檢查目前 Agent 環境是否註冊了可用的 GitHub MCP 工具（例如 `github-mcp-server` 中的 `get_file_contents`、`create_or_update_file`、`push_files` 等）。
  - **適用情境**：無本機 Git 環境時，由 Agent 直接對遠端 GitHub 儲存庫發起 API 呼叫。
* **管道 3（GitHub REST API 直連）**：
  - **檢測方式**：檢查環境變數 `GITHUB_TOKEN` 或 `GH_TOKEN`，先以 `GET https://api.github.com/repos/{owner}/{repo}` 測試唯讀權限與連線。
  - **適用情境**：由腳本或直連 HTTP 呼叫 GitHub Contents API。

### 2.2 失敗退場原則（不可假裝成功）
* 若所有管道均不可用、權限遭拒（401 Unauthorized / 403 Forbidden）或 Repo 不存在（404 Not Found）：
  $\rightarrow$ **必須立即停止操作**，主動向使用者陳述目前檢測到的障礙（例如未登入 `gh` 或缺乏 `repo` 寫入權限），**絕對嚴禁假報完成**！

### 2.3 憑證安全鐵律
* **嚴禁**將 GitHub Token、密鑰、私鑰或任何敏感憑證寫入 Skill 檔案、Repo 檔案、Commit Message、對話或日誌。錯誤訊息中若含有 Token 字串，必須徹底去敏（Redact）。

---

## 3. 雙模式架構與路徑解析規則 (核心鐵律)

本系統支援兩種架構模式，Agent 必須精確辨識並執行對應的路徑轉換：

```text
【Course Mode (課程共享模式)】
GitHub Repo: owner/course-repo  (例如: TestLabOrg/ee301-course-repo)
工作目錄前綴 (Scope Prefix): experiments/<experiment_code>/
├── experiments/
│   ├── lab-01/          <--- 實驗 1 工作區 (所有讀寫嚴格限定於此目錄)
│   │   ├── config.yml
│   │   ├── raw/
│   │   ├── photos/
│   │   ├── processed/
│   │   ├── analysis/
│   │   └── report/
│   └── lab-02/          <--- 實驗 2 工作區 (禁止 lab-01 存取)

【Experiment Mode (獨立實驗模式)】
GitHub Repo: owner/lab-repo     (例如: your-org/electronics-lab-01)
工作目錄前綴 (Scope Prefix): "" (根目錄)
├── config.yml           <--- 直接位於根目錄
├── raw/
├── photos/
├── processed/
├── analysis/
└── report/
```

### 3.1 Course Mode 規則
* 一門課共用單一 GitHub Repository。
* 實驗工作目錄嚴格定位於 `experiments/<experiment_code>/`（例如 `experiments/lab-01/`）。
* **鐵律 A（儲存庫名稱正確性）**：GitHub Repository 名稱永遠是 `owner/repo`，**絕對不得**將 `experiments/<experiment_code>` 拼入儲存庫名稱。
* **鐵律 B（目錄隔離性）**：所有操作必須限制在該實驗的目錄範圍內。嚴禁讀寫其他實驗目錄（例如在 `lab-01` 中操作 `experiments/lab-02/...`），亦嚴禁操作課程根目錄無關檔案。

### 3.2 Experiment Mode 規則
* 個別實驗綁定專屬的 GitHub Repository。
* 工作目錄直接從該 Repo 根目錄開始（`scopePrefix = ""`）。
* **鐵律**：不得錯誤地附加 Course Mode 的 `experiments/<experiment_code>/` 前綴。

### 3.3 模式自動判定邏輯
1. 檢查目前工作目錄或 Repository 結構：
   - 若根目錄存在 `experiments/` 目錄，或當前位於 `experiments/<experiment_code>/`，或指定的設定檔路徑為 `experiments/<experiment_code>/config.yml`：
     $\rightarrow$ **判定為 Course Mode**。
     - 目錄前綴設定為：`experiments/<experiment_code>/`。
     - 驗證 `<experiment_code>` 必須符合 `^[a-zA-Z0-9_.-]+$`，不得含有斜線或路徑跳躍。
   - 若根目錄直接包含 `config.yml`，且直接包含 `raw/`, `photos/`, `report/` 等：
     $\rightarrow$ **判定為 Experiment Mode**。
     - 目錄前綴設定為：`""`。
2. 若無法可靠辨識目標 Repository 或實驗模式（例如目錄結構混亂或缺少設定檔）：
   $\rightarrow$ **立即停止任何寫入操作**，明確列出目前讀取到的檔案與缺少的資訊，向使用者尋求釐清。

---

## 4. 報告模式與個人報告隔離 (Shared vs Separate)

根據 `config.yml` 中的 `report_mode` 欄位執行隔離：

* **`report_mode: shared` (共同撰寫模式)**：
  - 全組維護單一報告檔案：`report/report.md`（Course Mode 下為 `experiments/<code\>/report/report.md`）。
* **`report_mode: separate` (獨立撰寫模式)**：
  - 實驗數據（`raw/`）、照片（`photos/`）、處理數據（`processed/`）與分析圖表（`analysis/`）為全組共享。
  - 個人報告獨立存放：`report/report-<github_username>.md`。
  - **身分驗證與權限邊界（鐵律）**：
    1. Agent 只能操作與當前 GitHub 使用者帳號完全對應的報告檔案（例如使用者為 `studentA`，只能操作 `report/report-studentA.md`）。
    2. **嚴禁操作他人報告**：禁止寫入、覆寫或刪除其他成員的報告檔案（如 `report/report-studentB.md`）。
    3. **身分不明時的安全鎖**：若無法可靠辨識當前使用者的 GitHub 身分，**絕對不得**退回到共用報告 `report/report.md`，亦不得猜測或隨意選取組員檔案，必須暫停寫入並要求使用者確認身分。

---

## 5. 原始資料保護鐵律 (Raw Data Sanctuary)

> [!CAUTION]
> `raw/` 目錄存放儀器第一手量測數據，為不可變的聖域（Immutable Source of Truth）！

1. **現存檔案唯讀**：
   - 可以讀取、分析 `raw/` 內的現存原始數據。
   - **嚴禁對 `raw/` 內的現存檔案進行修改、覆蓋、重新命名或刪除**！
2. **禁止一般寫入通道替代**：
   - 不得將一般文字檔案修改/覆寫操作當成原始數據上傳的替代方式。
3. **專用新增流程**：
   - 新增原始數據檔案時，**必須先確認目標檔案在遠端並不存在**。若已存在，必須終止並回報衝突（409 Conflict），嚴格防止同名覆蓋。
   - 新增前必須取得使用者明確確認。
4. **禁止就地修改要求**：
   - 即便使用者下達「幫我整理或修復原始資料」等指令，Agent 也**嚴禁直接改寫 `raw/` 檔案**，必須將整理後的成果輸出至 `processed/`。

---

## 6. 路徑安全與穿越防禦規範

所有檔案路徑在轉換為 GitHub 遠端路徑前，必須通過安全驗證：

1. **嚴禁路徑穿越**：
   - 禁止包含 `../`、`..\\`、`/../`。
   - 禁止 URL 編碼穿越（如 `%2e%2e`、`%252e%252e`）。
   - 禁止空字元注入（`\0`、`%00`）。
2. **禁止絕對路徑**：
   - 禁止以 `/`、`\\` 開頭之路徑，禁止 Windows 磁碟代號（如 `C:`）。
3. **正規化與邊界檢查**：
   - 先對路徑進行多重解碼與斜線正規化，移除冗餘的 `./`。
   - 組合前綴後計算最終路徑：
     $$\text{真實路徑} = \text{scopePrefix} + \text{正規化相對路徑}$$
   - 在 Course Mode 下，最終路徑必須嚴格以 `experiments/<experiment_code>/` 開頭，不得溢出該目錄。

---

## 7. 第一版功能操作指引

### 7.1 自動探索 (Discovery)
1. **讀取 `config.yml`**：
   - 解析 `course_id`, `experiment_id` (或 `experiment_code`), `course_name`, `experiment_name`, `report_mode`, `members`。
2. **判定模式與工作區範圍**：
   - 確認是 Course Mode 還是 Experiment Mode，取得對應之 `scopePrefix`。
3. **目錄結構檢視**：
   - 列出目前工作區的主要目錄（`raw/`, `photos/`, `processed/`, `analysis/`, `report/`）與檔案清單。
4. **優先使用已知資訊**：
   - 優先從已讀取的 `config.yml` 與 Git remote 提取資訊，不要重複詢問使用者已存在的資料。

### 7.2 檔案讀取 (Read)
1. **文字檔案**：
   - 讀取 Markdown, YAML, CSV, JSON, Python 腳本等，確保以 UTF-8 正確解碼。
   - 記錄檔案的目前 SHA 與大小，以供後續比對或樂觀鎖使用。
2. **二進位檔案（照片 `photos/`、圖表 `analysis/*.png`、素材）**：
   - 讀取二進位檔案時，必須保持原始位元組完整性：
     - **GitHub API 管道**：透過 Contents API 取得原始 Base64 字串，或加上 Header `Accept: application/vnd.github.raw` 取得原始二進位串流。**嚴禁以 UTF-8 文字解碼二進位內容**！
     - **大檔案處理限制**：GitHub Contents API GET 在檔案 > 1MB 時不會直接回傳 base64 `content`。此時必須改以 Raw 端點 (`https://raw.githubusercontent.com/...` 或 `Accept: application/vnd.github.raw`) 或 Git Data Blobs API (`GET /repos/{owner}/{repo}/git/blobs/{sha}`) 讀取，不可誤認檔案為空。
     - **本地環境管道**：以二進位 Buffer / Uint8Array 方式讀取，不可透過文字編輯器管道讀寫。
   - **工具能力防禦（鐵律）**：若 Agent 目前可用的工具僅支援純文字輸入/輸出，而無法安全傳遞原始二進位串流或 Base64：
     $\rightarrow$ **必須主動聲明工具限制並終止二進位讀取**，嚴禁將二進位資料當作文字亂碼解碼後宣稱讀取成功！

### 7.3 安全建立與素材上傳 (Create & Upload)
區分兩種不同操作途徑的具體流程：

#### 途徑 A：直接透過 GitHub API / MCP 工具操作
1. **防覆寫檢查（鐵律）**：
   - 建立新檔案前，先向 GitHub 發送 `GET` 請求確認該路徑目前傳回 `404 Not Found`。
   - 若遠端已存在該檔案，**禁止覆寫**，應終止操作並提示檔案已存在。
2. **文字檔案建立**：
   - 將 UTF-8 文字轉換為標準 Base64 字串。
   - 發送 `PUT /repos/{owner}/{repo}/contents/{path}`，payload: `{ message: "[實驗編號] <動作>", content: "<base64>" }`。
3. **二進位素材上傳（照片、圖表）**：
   - 直接將原始二進位 bytes 轉換為 Base64（禁止經由 UTF-8 中轉）。
   - GitHub Contents API PUT 建議單檔不超過 100MB（超過需透過 Git LFS 或分塊）。
   - 發送 `PUT` 請求建立，接收 HTTP 201 Created 回應，取得 GitHub 伺服器端真正生成的 `commit.sha`。

#### 途徑 B：本機 Git CLI (`git` / `gh`) 操作
1. **本地建立/複製檔案**：
   - 先於本地工作區寫入文字檔案或複製二進位照片至正確目錄（如 `photos/`）。
   - 檢查目標檔案是否原本已存在，避免誤覆蓋。
2. **獨立分步授權流程（不可混淆或跳步）**：
   - **步驟 1（檔案寫入授權）**：取得使用者對檔案變更的確認。
   - **步驟 2（本地 Commit 授權）**：取得使用者對 Commit Message 的獨立確認後，執行 `git add <file>` 與 `git commit -m "[實驗編號] <動作>"`。取得本地真實 Commit SHA。
   - **步驟 3（遠端 Push 授權）**：取得使用者對遠端推送的獨立確認後，執行 `git push origin main`。
   - **防混淆提醒**：本地 Commit 成功不等於遠端推送成功；未執行 Push 前不得回報遠端已更新！

### 7.4 寫入後驗證 (Post-Write Verification)
> [!IMPORTANT]
> 任何寫入操作完成後，必須經過真實驗證才可向使用者回報成功！

1. **提取真實 Commit SHA**：
   - 記錄 GitHub 實際回傳的 40 位元 Commit SHA（或本地 `git rev-parse HEAD` 經 push 後的真實 SHA），不得填入預測或假造的數值。
2. **存在性與內容雙重校驗**：
   - **重新查詢遠端狀態**：透過 GitHub API GET 或 `git status` / `git ls-remote` 重新檢視該檔案是否存在於遠端儲存庫。
   - **完整性雜湊比對**：比對遠端檔案之 Blob SHA 或 SHA-256 雜湊值，確認與本地上傳之一致，無傳輸中斷或截斷。
3. **嚴禁假報成功與盲目重試**：
   - 若寫入遭到拒絕（例如 409 Conflict、403 Forbidden、404 Not Found）或驗證讀取失敗，**嚴禁宣稱成功**。
   - 發生衝突或失敗時，**嚴禁自動重複重試**可能造成重複寫入或歷史混亂的操作，必須停下並說明實際發生的錯誤。

---

## 8. 強制使用者確認機制（Git 安全鎖）

沿用實驗工作區最高安全標準，Agent 在執行任何寫入前必須取得明確授權：

```text
==================== 變更預覽確認 ====================
【目標 Repository】: <owner>/<repo>
【架構模式】: Course Mode (路徑: experiments/<code\>/) / Experiment Mode
【操作類型】: 建立新檔案 / 上傳素材
【目標路徑】: <工作區相對路徑> (遠端路徑: <GitHub真實路徑>)
【預期內容摘要】: <說明內容或檔案大小/格式>
【預計 Commit Message】: [<實驗編號>] <明確動作描述>

請確認是否允許執行上述檔案寫入？(回覆「確認」或「approve」後繼續)
====================================================
```

### 分步授權原則（不可繼承）
1. **建立/修改檔案 $\neq$ Commit**。
2. **Commit $\neq$ Push**。
3. 每一階段必須獨立取得授權，不可自動繼承或越權假設。
4. **禁止危險操作**：嚴禁執行 `git push --force`，嚴禁刪除或重寫既有 Commit 歷史。
5. **變更重置原則**：若確認後目標路徑、內容或 Commit Message 有所變更，前次確認立即作廢，必須重新請求確認。

---

## 9. 任務完成回報格式

當所有操作與寫入後驗證均順利完成後，以簡潔結構回報使用者：

```markdown
### ✅ GitHub 工作區操作完成

* **目標儲存庫**：`<owner>/<repo>`
* **運作模式**：`Course Mode` (`experiments/<code\>/`) / `Experiment Mode`
* **變更檔案**：
  - `<工作區相對路徑>` (操作: 建立/上傳)
* **驗證資訊**：
  - Git Commit SHA: `<真正的Commit SHA>`
  - 狀態: 遠端驗證通過，檔案完整存在
* **後續建議**：
  - 可交由 `experiment-report` Skill 進行後續數據分析或報告章節撰寫。
```
