# 實驗課 GitHub 工作區系統：架構設計規範

本系統旨在為大專院校與工程教學實驗建立一套標準化、具長期複用性之實驗工作區。

---

## 一、核心架構哲學

### 1. 「一節課 = 一個 GitHub Repository」
* 每一節實驗課（如：`electronics-lab-01`、`digital-logic-lab-02`）均為獨立的 GitHub Repository。
* 不將整學期的不同實驗混雜在同一個大型 Repo，確保：
  - 數據界線清晰，權限與版本互不干擾。
  - 單一實驗的提交歷史純粹，易於查閱評分。
  - 大量照片與原始數據不致隨時間膨脹單一 Repo 容量。

### 2. Repository 雙層次區分
系統嚴格劃分兩種不同職責的 Repository：

```
                       ┌──────────────────────────────────────────────┐
                       │           公開母倉庫 (Master Repo)             │
                       │           lab-workspace-template             │
                       │                                              │
                       │  • Template/      • Agent Skill              │
                       │  • Web App (web/) • CLI (create-lab)         │
                       │  • 文件庫 (docs/)  • 示範範例 (examples/)      │
                       └──────────────────────┬───────────────────────┘
                                              │
                                              │ 衍生 / 初始化 (Template / CLI)
                                              ▼
    ┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
    ▼                         ▼                         ▼                         ▼
實際實驗 Repo             實際實驗 Repo             實際實驗 Repo             實際實驗 Repo
electronics-lab-01        electronics-lab-02        digital-logic-lab-01      physics-lab-01
(僅包含實驗數據/報告/Skill)   (僅包含實驗數據/報告/Skill)   (僅包含實驗數據/報告/Skill)   (僅包含實驗數據/報告/Skill)
```

* **A. 公開母倉庫 (`lab-workspace-template`)**：
  系統的開源發源地，包含 Template 規範、Web App、CLI、規格文件與範例。
* **B. 實際實驗 Repo (`lab-XX-name`)**：
  由母倉庫衍生之個別實驗工作區，**絕不包含 Web App 本體**，保持最純粹的實驗資料結構。

---

## 二、雲端服務與資料流架構

```
                          ┌────────────────────────────────┐
                          │   使用者瀏覽器 (學生 / 助教)     │
                          └───────────────┬────────────────┘
                                          │ HTTPS
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │  Cloudflare 集中式 Web 服務 (Pages + Worker) │
                   │  (單一實體管理多個課程與所有實驗 Repo)          │
                   └──────────────┬───────────────────────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
      ┌─────────────────────────┐     ┌─────────────────────────┐
      │   Cloudflare D1 資料庫   │     │    GitHub REST API      │
      │   (集中儲存 Activity Log)│     │  (讀取檔案/提交/下載串流) │
      └─────────────────────────┘     └───────────┬─────────────┘
                                                  │
                            ┌─────────────────────┴─────────────────────┐
                            ▼                                           ▼
                 electronics-lab-01                          digital-logic-lab-01
                 [Source of Truth]                           [Source of Truth]
```

### 1. GitHub 為唯一真實資料源 (Source of Truth)
- 實驗數據（`raw/`）、照片（`photos/`）、分析（`analysis/`）與報告（`report/`）完全儲存在 GitHub Repo 中。
- **免除 R2 依賴**：單檔直接經由 GitHub Raw 串流，整包打包經由 GitHub 原生 Zipball 串流，簡化架構且零成本。
- **極致韌性**：即便 Cloudflare 服務暫停或下線，任何人只要 `git clone` 實驗 Repo，依舊能取得 100% 完整的實驗成果與報告。

### 2. Activity Log 與 Git History 雙軌機制
系統明確區分兩種層次的紀錄：
* **Git Commit History**：
  - 回答：「**實際修改了什麼程式碼與檔案？**」
  - 儲存於：各實驗 Repo 的 Git 物件樹中。
  - 格式：嚴格採用白話繁體中文（如 `[lab-01] 整理量測資料並計算平均值`）。
* **Activity Log (活動紀錄)**：
  - 回答：「**誰在什麼時間、透過什麼介面、做了什麼操作？是由誰要求並由誰確認的？**」
  - 儲存於：集中式 Cloudflare D1 資料庫。
  - 核心欄位：
    - `actor_type`: `user` | `agent` | `web`
    - `requested_by`: 發起人帳號
    - `approved_by`: 確認核准人帳號
    - `commit_sha`: 關聯之 Git Commit
