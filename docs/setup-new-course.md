# 如何建立新的課程與實驗 Repo

本教學說明如何利用母倉庫，快速建立新的課程實驗工作區（如 `electronics-lab-01`、`digital-logic-lab-01`）。

---

## 方式一：使用互動式 CLI (`npm run create-lab`) 【推薦】

在母倉庫根目錄執行：

```bash
npm run create-lab
```

### 執行示範流程：
```text
======================================================
🧪 實驗課 GitHub 工作區系統 - 建立新實驗 Repo
======================================================

課程名稱 (例如: 電子學實驗): 電子學實驗
課程代碼 (例如: EE201): EE201
實驗編號 (例如: lab-01): lab-01
實驗名稱 (例如: 二極體特性): 二極體特性
報告模式 [shared (共同) / separate (個別)] (預設 shared): shared
成員 (以逗號分隔 GitHub 帳號，例如: userA, userB): studentA, studentB
GitHub Repo (例如: your-org/ee201-lab-01): your-org/electronics-lab-01

======================================================
即將建立：

Repository:
  your-org/electronics-lab-01

將新增：
  README.md
  config.yml
  raw/
  photos/
  processed/
  analysis/
  report/
  .github/skills/experiment-report/SKILL.md

Template Version:
  1.0

詳細設定:
  - 課程: 電子學實驗 (EE201)
  - 實驗: lab-01 - 二極體特性
  - 模式: shared
  - 成員: @studentA (組長), @studentB (組員)
  - 本地目標路徑: /path/to/electronics-lab-01
======================================================

是否建立本地檔案？ [Yes / No] (預設 No): Yes

📦 正在產生實驗工作區檔案...
✅ 本地工作區檔案配置完成！

==================== 本地 Commit 確認 ====================
即將提交以下檔案至本地 Git Repository：
  + README.md
  + config.yml
  + raw/.gitkeep
  + photos/.gitkeep
  + processed/.gitkeep
  + analysis/.gitkeep
  + report/.gitkeep
  + report/report.md
  + .github/skills/experiment-report/SKILL.md
  + .github/skills/experiment-report/references/git-commit-guide.md
  + .github/skills/experiment-report/references/report-template.md
  + .gitignore

預計 Commit Message：
  "[lab-01] 初始化實驗工作區 (Template v1.0)"
========================================================

是否執行初始 Git Commit？ [Yes / No] (預設 No): Yes
✅ 已完成本地 Commit: "[lab-01] 初始化實驗工作區 (Template v1.0)"

==================== 遠端 GitHub 設定確認 ====================
預計建立遠端 Repository:
  your-org/electronics-lab-01
可見度 (Visibility):
  private (預設私有)
即將 Push 的 Commit:
  [lab-01] 初始化實驗工作區 (Template v1.0)
包含檔案:
  所有已提交之實驗規範與範本檔案 (main 分支)
============================================================

是否在 GitHub 建立遠端 Repository？ [Yes / No] (預設 No): Yes
可見度 [1] private (私有) / [2] public (公開) (預設 1): 1

🚀 正在建立 GitHub Repository: your-org/electronics-lab-01 (--private)...
🎉 遠端 Repository 建立完成！網址: https://github.com/your-org/electronics-lab-01

==================== 遠端推送預覽確認 (Git Push) ====================
【目標儲存庫】: your-org/electronics-lab-01
【Remote】: origin
【來源分支】: main
【待推送 Commit SHA】: a1b2c3d...
【Commit Message】: "[lab-01] 初始化實驗工作區 (Template v1.0)"
【安全原則】: 建立遠端 Repo 不等同於獲准 Push；嚴禁未獲授權預設推向 main；必須明確指定來源與目標分支映射。
===================================================================

是否執行遠端 Git Push？ [Yes / No] (預設 No): Yes
請輸入授權推送的目標分支 (來源分支為 main，請明確輸入目標分支名稱，不可空白): main
⚠️ 目標分支為 [main]，請確認是否明確授權推向該分支？ [Yes / No] (預設 No): Yes

🚀 正在推送至遠端: git push origin refs/heads/main:refs/heads/main...
🎉 遠端 Push 完成！分支 refs/heads/main:refs/heads/main 已成功發布。
```

> 📌 **若您選擇不在 CLI 中直接推送到遠端**，系統將輸出分步指引，供您日後獨立確認後手動執行：
> - 步驟 a：`gh repo create <repo> --private`（僅建立遠端 Repo 不自動 push）
> - 步驟 b：`git remote add origin https://github.com/<owner>/<repo>.git`
> - 步驟 c：`git push origin refs/heads/<source_branch>:refs/heads/<target_branch>`（需明確指定來源與目標分支映射，推向 main 需明確專屬授權）

> 🔒 **來源分支與 Commit 安全中斷與 TOCTOU 二次校驗機制**：
> 在執行 Push 前，CLI 會自動檢驗本地目前的來源分支狀態（使用 `git branch --show-current` 與 `git check-ref-format --branch`）及待推送之 Commit SHA（使用 `git rev-parse HEAD` 與 `git rev-parse --show-object-format`）。若分支讀取失敗、結果為空字串、處於 detached HEAD、分支名稱不合法（如以 `+` 開頭或含非法字元），或無法明確確認儲存庫物件格式（僅支援明確之 `sha1` 與 `sha256`）及真實 Commit SHA，CLI 將嚴格遵循安全規範，**絕不預設回退至 main 或推向未確認分支，亦絕不自動切換分支、未知格式默認回退或在未確認 Commit 下推送**，而是直接安全中止 Push 流程。此外，在使用者確認授權推送後、實際發起 `git push` 前，CLI 會進行二次原子狀態校驗；若來源分支改變、分支分離或待推送 Commit SHA 發生漂移，立即中斷推送，杜絕 TOCTOU 時差風險。系統絕不嘗試推送，並提供明確的安全手動操作指引。

---

## 方式二：使用 GitHub Template Repository

1. 開啟母倉庫頁面（例如 `https://github.com/your-github-username/lab-workspace-template`）。
2. 點擊綠色 **「Use this template」** $\rightarrow$ **「Create a new repository」**。
3. 輸入新 Repo 名稱（例如 `digital-logic-lab-01`），選擇 Private 或 Public。
4. 建立後 clone 至本地：
   ```bash
   git clone https://github.com/<你的帳號>/digital-logic-lab-01.git
   cd digital-logic-lab-01
   ```
5. 開啟 `config.yml`，修改課程與實驗資訊及組員帳號。
6. 提交修改：
   ```bash
   git commit -am "[lab-01] 配置課程設定與組員名單"
   git push
   ```
