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

是否在 GitHub 建立遠端 Repo 並執行 Push？ [Yes / No] (預設 No): Yes
可見度 [1] private (私有) / [2] public (公開) (預設 1): 1

🚀 正在建立 GitHub Repository: your-org/electronics-lab-01 (--private)...
🎉 遠端 Repository 建立完成！網址: https://github.com/your-org/electronics-lab-01
```

> 📌 **若您選擇不在 CLI 中直接推送到遠端**，系統將輸出分步指引，供您日後獨立確認後手動執行：
> - 步驟 a：`gh repo create <repo> --private`
> - 步驟 b：`git remote add origin https://github.com/<owner>/<repo>.git`
> - 步驟 c：`git push -u origin main`

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
