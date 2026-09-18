# 實驗 {{EXPERIMENT_ID}}｜{{EXPERIMENT_NAME}}

> 歡迎使用「實驗課 GitHub 工作區」。本 Repository 是本節實驗的所有數據、照片、分析與報告的唯一來源。

---

## 📌 實驗基本資訊

| 項目 | 內容 |
| :--- | :--- |
| **所屬課程** | {{COURSE_NAME}} ({{COURSE_ID}}) |
| **實驗編號** | {{EXPERIMENT_ID}} |
| **實驗名稱** | {{EXPERIMENT_NAME}} |
| **報告模式** | `{{REPORT_MODE}}` (shared: 共同撰寫 / separate: 個別報告) |
| **目前狀態** | `{{STATUS}}` |
| **範本版本** | Template v{{TEMPLATE_VERSION}} / Skill v{{SKILL_VERSION}} |

### 👥 組員名單
{{MEMBERS_LIST}}

---

## 📂 資料夾用途說明

請依照以下規劃存放資料，切勿隨意建立未定義的資料夾：

* 📸 **`photos/`**：存放課堂上拍攝的照片（例如麵包板接線、三用電表讀數、示波器波形）。
* 📁 **`raw/`**：**原始量測數據存放區（唯讀聖域）**。放入後請勿直接在此修改，以確保原始數據永遠保留。
* 🧹 **`processed/`**：整理清洗後的標準數據（由 Agent 或分析腳本將 `raw/` 轉換而來）。
* 📊 **`analysis/`**：繪圖程式碼（Python/Jupyter）、數據計算統計表與產出的曲線圖檔（`.png`, `.svg`）。
* 📝 **`report/`**：實驗報告本體。若為共同模式，檔案為 `report/report.md`；若為獨立模式，為 `report/report-<你的GitHub帳號>.md`。

---

## 🚀 快速上手教學

### 1. 如何上傳資料？
* **方式 A（網頁端最簡單）**：開啟實驗課 Web 操作入口，點擊「快速上傳」，直接拖曳照片至 `photos/` 或數據檔至 `raw/`。
* **方式 B（GitHub 網頁版）**：進入本 Repo 對應資料夾，點擊右上角 `Add file` $\rightarrow$ `Upload files`。
* **方式 C（Git 本地推送）**：將檔案放入本地資料夾後執行 `git add .`、`git commit`、`git push`。

### 2. 如何使用 AI Agent 協助你？
打開你的 AI 助手（如 Antigravity、Cursor、Claude Code 或 VS Code），Agent 會自動讀取本 Repo 中的 `.github/skills/experiment-report/SKILL.md`。

你可以直接用白話對 Agent 說：
* 💬 *「幫我把 photos/ 裡的照片按照實驗步驟分類」*
* 💬 *「幫我把 raw/measurements.csv 的數據整理並計算平均值，輸出到 processed/」*
* 💬 *「幫我畫出這次實驗的特性曲線圖，標註好單位並存到 analysis/」*
* 💬 *「幫我根據量測結果，起草這次的實驗報告初稿」*

> ⚠️ **注意**：Agent 在修改任何檔案或 Commit 之前，**一定會先列出清單徵求你的同意**，請確認無誤後回覆「確認」，Agent 才會進行修改。

---

## 📄 報告位置
* 共同報告：[`report/report.md`](report/report.md)
* 匯出 PDF：請於完成報告後透過 Web UI 一鍵列印/匯出 PDF 存入 `report/`。

---

## 📋 最近工作紀錄
* 請查看 Repository 的 [Git Commit 歷史](../../commits/main) 或於 Web UI 查看即時時間軸活動紀錄。
