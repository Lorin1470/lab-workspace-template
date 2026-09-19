# 實驗課 GitHub 工作區系統 (Lab Workspace System)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Template Version](https://img.shields.io/badge/Template%20Version-1.0-emerald.svg)](template/config.yml)
[![Skill Version](https://img.shields.io/badge/Skill%20Version-1.0-purple.svg)](.github/skills/experiment-report/SKILL.md)
[![Platform: Cloudflare](https://img.shields.io/badge/Platform-Cloudflare%20Pages%20%2B%20Workers-orange.svg)](web/)

一套為大專院校工程與科學實驗課程打造的「**課程→多實驗→實驗綁定 Repository**」長期複用型實驗工作區系統。

結合 **GitHub 開放源碼託管（Source of Truth）**、**AI Agent 協作規範（Agent Skill）**、**Cloudflare 集中式網頁介面（Web UI）** 與 **嚴格的使用者審核確認機制**，讓每一節實驗課的數據清洗、波形照片、特性曲線分析與實驗報告撰寫，都能標準化、可追溯且長期維護。

---

## 📑 目錄

1. [這套系統是什麼？](#1-這套系統是什麼)
2. [核心理念：課程→多實驗→實驗綁定 Repository](#2-核心理念課程-多實驗-實驗綁定-repository)
3. [AI Agent Skill 協作規範](#3-ai-agent-skill-協作規範)
4. [Cloudflare Web UI 集中介面](#4-cloudflare-web-ui-集中介面)
5. [資料保存原則：GitHub 為唯一真實源](#5-資料保存原則github-為唯一真實源)
6. [Cloudflare 部署指南](#6-cloudflare-部署指南)
7. [如何建立新的課程與實驗工作區](#7-如何建立新的課程與實驗工作區)
8. [config.yml 規格與成員自訂](#8-configyml-規格與成員自訂)
9. [快速開始使用 (Getting Started)](#9-快速開始使用-getting-started)
10. [系統安全性與機密保護](#10-系統安全性與機密保護)

---

## 1. 這套系統是什麼？

在傳統的大專院校實驗課中，學生與助教常面臨：
* 實驗數據、手機拍攝照片與報告散落在 LINE 群組、隨身碟或個人電腦中，隨學期結束而遺失。
* 數據缺乏標準清洗流程，儀器原始數據容易被手動誤改或覆蓋。
* AI 助手（如 ChatGPT、Cursor、Antigravity）雖能輔助寫報告，但缺乏統一規範，容易隨意竄改檔案、偽造數據或產生混亂的 Git Commit。

本系統提供了一套完備的標準範本（Template）、AI 協作規範（Agent Skill）、互動式快速建置工具（CLI）與集中式管理入口（Web App），讓學生與教學團隊享受現代化軟體工程等級的實驗紀錄體驗。

---

## 2. 核心理念：課程 → 多實驗 → 實驗綁定 Repository

系統採用 **「課程 → 多實驗 → 實驗綁定 Repository」** 的階層模型：
* 一門課程可以容納多個實驗（例如：電子學實驗課包含電路實驗、訊號處理實驗等）
* 每個實驗獨立綁定一個 GitHub Repository 作為其工作區
* 每個實驗 Repository 僅能綁定單一實驗（一對一映射），確保資料隔離與追溯性

```
                       ┌──────────────────────────────────────────────┐
                       │          公開母倉庫 (lab-workspace-template)    │
                       │   (系統程式碼、Template、Web App、CLI、規格文件)  │
                       └──────────────────────┬───────────────────────┘
                                              │ npm run create-lab
                                              ▼
    ┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
    ▼                         ▼                         ▼                         ▼
電子學實驗-01             電子學實驗-02             數位邏輯實驗-01           物理實驗-01
(電子學課程實驗)           (電子學課程實驗)           (數位邏輯課程實驗)        (物理課程實驗)
     │                          │                          │                          │
     ▼                          ▼                          ▼                          ▼
electronics-lab-01      electronics-lab-02      digital-logic-lab-01    physics-lab-01
(單一實驗工作區)          (單一實驗工作區)          (單一實驗工作區)          (單一實驗工作區)
```

### 每個實驗 Repo 的標準結構：
```text
lab-XX-name/
├── config.yml                           # 實驗設定 (課程代碼、名稱、成員、報告模式)
├── raw/                                 # 原始量測數據 (唯讀聖域！嚴禁覆寫)
├── photos/                              # 實驗現場照片 (麵包板接線、儀表讀數、示波器畫面)
├── processed/                           # 清洗後數據 (由 raw/ 衍生，乾淨標準化 CSV)
├── analysis/                            # 分析代碼 (Python/Jupyter) 與向量曲線圖 (.svg, .png)
├── report/                              # 實驗報告 (report.md 或 report-username.md)
├── README.md                            # 學生友善的實驗指引
└── .github/skills/experiment-report/
    └── SKILL.md                         # 本實驗專屬 Agent Skill 規範 (v1.0)
```

### 課程與實驗的資料模型（參考 D1 Schema）：
* **courses 表**：儲存課程資訊（course_code, name, semester 等）
* **experiments 表**：每筆記錄代表一個實驗，包含：
  * `course_id`：所屬課程的外鍵
  * `experiment_code`：實驗代號（如 "lab-01"）
  * `repository`：綁定的 GitHub Repository 全名（唯一限制，確保一個 Repo 只綁定一個實驗）
  * `report_mode`：報告模式（shared 或 separate）
* 一門課程可對應多筆實驗記錄，形成一對多關係
## 3. AI Agent Skill 協作規範

本系統將 AI 協作規範正式封裝為可複用的 Agent Skill：[`.github/skills/experiment-report/SKILL.md`](.github/skills/experiment-report/SKILL.md)。

### 核心鐵律：
1. **原始數據不可變性 (Sacred Raw Data)**：Agent 嚴禁修改、覆寫或刪除 `raw/` 內的原檔，所有處理成果一律寫入 `processed/`。
2. **白話繁體中文 Commit 規範**：一律採用 `[實驗編號] <具體動作描述>`，嚴禁使用 `update`、`fix`、`chore` 等模糊字眼。
3. **強制使用者確認機制（Git 安全鎖）**：
   > Agent 在執行任何 Commit、Push 或修改遠端檔案前，**必須輸出變更預覽清單**（新增/修改/刪除檔案清單與預計 Commit Message），並**等待使用者明確回覆「確認」**。未獲確認前絕不執行。
4. **報告模式切換**：
   * `shared`：全組共同維護 `report/report.md`。
   * `separate`：數據共用，但個別維護 `report/report-<github_username>.md`。

---

## 4. Cloudflare Web UI 集中介面

為避免每建立一個實驗 Repo 就要重複部署一個 Web 系統，本專案設計了**集中式 Cloudflare Web App**（位於 [`web/`](web/)）：

* **多課程支援**：一個 Web 平台集中管理電子學實驗、數位邏輯實驗等多門課程與各週實驗。
* **主要功能**：
  - 📤 **快速上傳**：學生可在手機或電腦瀏覽器拖曳上傳照片至 `photos/` 或數據至 `raw/`。
  - 📥 **打包下載**：從目前 GitHub Workspace 讀取真實檔案後，在瀏覽器端產生照片包、原始數據包或完整專案 ZIP；沒有 Workspace 檔案時不會產生示範內容。
  - 📂 **線上瀏覽**：樹狀圖檢視檔案。
  - 📄 **報告預覽**：線上渲染 Markdown 結報，支援 LaTeX (KaTeX) 數學公式與特性圖展示，支援一鍵列印/匯出 PDF。
  - 📋 **活動紀錄**：展示時間軸（記錄誰在何時透過何者做了什麼）。
  - 🤖 **Agent Task Workflow**：以自然語言提出 Workspace 完成度檢查、照片狀態檢視或報告更新；系統先讀取真實 context 並產生 proposal，寫入前必須明確確認。

---

## 5. 資料保存原則：GitHub 為唯一真實源

* **GitHub Repository 是 Source of Truth**：所有數據、照片、分析腳本與結報均存放在 GitHub。
* **免除第三方儲存依賴**：單檔直接由 Workspace API 讀取 GitHub 內容，批次下載由瀏覽器端（JSZip）打包真實檔案，無需開通或依賴 Cloudflare R2。
* **極高抗災性**：即便 Web App 服務停止，學生只要 `git clone` 自己的 Repo，所有成果依然 100% 完整可用。

---

## 6. Cloudflare 部署指南

Web App 可零成本部署於 Cloudflare 邊緣網路：

```bash
# 1. 進入 web 目錄
cd web

# 2. 建立 D1 資料庫 (儲存 Activity Log)
npx wrangler d1 create experiment-workspace-db
npx wrangler d1 execute experiment-workspace-db --file=schema.sql

# 3. 建置並部署至 Cloudflare Pages
npm install
npm run build
npx wrangler pages deploy dist --project-name=lab-workspace-web
```

* 綁定現有自訂網域：可於 Cloudflare 控制台將自訂子網域（如 `lab.minerdog.qzz.io`）綁定至該 Pages 專案。
* 詳細步驟請參閱：[`docs/cloudflare-deployment.md`](docs/cloudflare-deployment.md)。

---

## 7. 如何建立新的課程與實驗工作區

### 方式 A：使用互動式 CLI (`npm run create-lab`) 【推薦】
在母倉庫根目錄執行：

```bash
npm run create-lab
```

依序輸入課程名稱、實驗名稱、成員名單，系統將自動從 `template/` 複製並完成 `config.yml`、`README.md`、`report.md` 之客製化配置，並完成初始 Commit。

### 方式 B：使用 GitHub Template 功能
點擊本 Repo 右上方 **「Use this template」** $\rightarrow$ **「Create a new repository」**，建立後修改 `config.yml` 即可。

* 詳細步驟請參閱：[`docs/setup-new-course.md`](docs/setup-new-course.md)。

---

## 8. config.yml 規格與成員自訂

每個實驗 Repo 根目錄均有 `config.yml`，範例如下：

```yaml
course_id: "EE201"
course_name: "電子學實驗"
semester: "114-1"

experiment_id: "lab-01"
experiment_name: "二極體特性量測"

template_version: "1.0"
skill_version: "1.0"

report_mode: "shared" # 可選: shared (共同撰寫) 或 separate (個別撰寫)
status: "not_started" # not_started | in_progress | data_processing | report_writing | completed

members:
  - github: "studentA"
    name: "學生A"
    role: "組長"
  - github: "studentB"
    name: "王小明"
    role: "組員"

created_at: "2026-09-18"
```

---

## 9. 快速開始使用 (Getting Started)

### 學生端日常操作：
1. **上傳資料**：透過 Web 介面或 Git 將照片放入 `photos/`，儀器導出數據放入 `raw/`。
2. **呼叫 Agent**：在本地 IDE（Antigravity / Cursor / Claude Code）向 Agent 發送需求：
   * *「幫我清洗 raw/measurements.csv 並計算放大倍率」*
   * *「幫我畫出特性曲線圖，標明單位並存到 analysis/」*
3. **確認變更**：審閱 Agent 輸出的檔案清單與 Commit Message，回覆「確認」。
4. **預覽報告**：開啟 Web 介面檢視即時渲染的 `report/report.md`，確認無誤後匯出 PDF 繳交！

---

## 10. 系統安全性與機密保護

本母倉庫為公開 Repository，恪守以下資安守則：
* 嚴禁放置任何個人私人 Token、GitHub App Private Key 或 Cloudflare API Key。
* 所有認證金鑰一律透過 Cloudflare Workers Secrets 或本機環境變數注入。
* 母倉庫中的範本與範例代碼僅包含通用測試數據與占位符。

---

## 授權條款 (License)
本專案採用 [MIT 授權條款](LICENSE)。歡迎各級學校與工程教學實驗室自由採用與改進。
