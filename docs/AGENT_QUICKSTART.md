# 學生 Agent 快速入門指南 (Agent Quickstart Guide)

歡迎使用 Agent-first 實驗工作區！本指南旨在幫助學生快速上手，使用自己的 AI Agent (如 Claude Code, Codex, Cursor, Antigravity, Gemini CLI 等) 搭配本 Repository 進行實驗資料處理與報告撰寫。

---

## 核心觀念

* **Agent 是你自己的**：你使用個人慣用的外部 AI Agent 工具。
* **Skill 是工作區提供的**：本 Repository 提供 `.github/skills/experiment-report/SKILL.md` 給你的 Agent 閱讀，約束與引導 Agent 遵循實驗規範。
* **真實源頭 (Source of Truth)**：所有數據與報告儲存在你的 GitHub Workspace。
* **安全確認 (Safety Lock)**：Agent 在修改你的工作區檔案或執行 Git 提交前，會先向你提出修改計畫，由你在對話中確認後才執行。

---

## 快速使用 5 步驟

### 1. 建立並 Clone 工作區
點擊 GitHub Repository 頁面上的 **「Use this template」** 建立自己的實驗工作區，然後將其 Clone 至本機：

```bash
git clone https://github.com/<your-username>/<your-lab-repo>.git
cd <your-lab-repo>
```

### 2. 為你的 Agent 安裝 / 載入 Skill
將 `.github/skills/experiment-report/SKILL.md` 設定或載入至你的 AI Agent：
* **Claude Code / Codex / Antigravity / Gemini CLI**：開啟本機工作區目錄，Agent 會自動讀取或可輸入指令引導其讀取 `.github/skills/experiment-report/SKILL.md`。
* **Cursor / Windsurf**：可將 `.github/skills/experiment-report/SKILL.md` 加入專案 Prompt 或 Rules 中。

### 3. 放妥實驗原始資料與照片
* 將儀器導出的原始數據檔放入 `raw/`（如 `raw/measurements.csv`）。
* 將實驗現場照片放入 `photos/`（如 `photos/circuit.jpg`）。

### 4. 告訴 Agent 你想做什麼
在你的 Agent 對話視窗中輸入需求，例如：

> 「幫我清洗 `raw/measurements.csv` 的數據，繪製二極體 V-I 特性曲線圖存到 `analysis/`，並更新 `report/report.md`。」

### 5. 審閱 Agent 的操作計畫並確認
Agent 讀取工作區後，會在對話中輸出**變更預覽清單 (Operation Manifest)**：
* 預計新增/修改哪些檔案
* 是否覆蓋既有內容
* 預計 Commit Message

**審閱無誤後，在對話中回覆「確認」或「approve」**，Agent 才會執行寫入與 Commit。

---

## 注意事項與 Git 邊界

1. **`raw/` 是不可變聖域**：Agent 不會修改或覆寫 `raw/` 內的檔案，所有清洗成果會寫入 `processed/`。
2. **Commit $\neq$ Push**：Agent 完成檔案修改與 Commit 後，除非你明確要求 Push，否則變更保留於本地工作區。
3. **推送到遠端**：確認報告內容無誤後，可在對話中請 Agent「幫我 Push 到 GitHub」，或手動執行 `git push`。
