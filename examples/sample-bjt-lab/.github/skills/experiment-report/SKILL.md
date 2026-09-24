---
name: experiment-report
description: 實驗課 GitHub 工作區核心 Agent Skill。適用於外部 AI Agent (Claude Code, Codex, Cursor, Antigravity, Gemini CLI 等)。負責實驗數據整理、照片分類、數據清洗、特性曲線分析、Markdown 報告撰寫與 Git 變更管理。嚴格遵循外部 Agent 定位、原始數據保護、使用者對話確認機制、多檔案 SHA 驗證與 Git 操作邊界。
version: "1.2"
---

# 實驗課 GitHub Working Space Agent Skill (Version 1.2)

本規範是外部 AI Agent（如 Claude Code, Codex, Cursor, Antigravity, Gemini CLI 等）在本實驗工作區（Workspace Repository）進行任何數據分析、數據清洗、圖表繪製、報告撰寫與 Git 提交時的最高準則。

> [!IMPORTANT]
> **外部 Agent 架構聲明 (External Agent Architecture)**：
> Agent 為使用者自己的外部 Agent 執行環境，本 Skill 係安裝於使用者 Agent 中讀取與操作 Workspace。
> 網站 UI 僅為 Workspace 檢視與課程管理介面，本系統**不包含**伺服器端內建 LLM 或網站直接呼叫 LLM 的機制。

---

## 1. Repository 結構與版本識別

本工作區採用標準化結構與版本標示：

```text
.
├── config.yml                           # 實驗中繼設定檔 (包含 template_version 與 skill_version)
├── raw/                                 # 原始量測數據 (唯讀！聖域保護)
├── photos/                              # 實驗現場照片 (儀器讀數、電路接線、示波器)
├── processed/                           # 清洗後數據 (由 raw/ 衍生之標準 CSV/JSON)
├── analysis/                            # 分析腳本 (Python/Jupyter) 與繪製之圖表
├── report/                              # 最終實驗報告 (Markdown / PDF)
│   └── report.md                        # 報告主體 (shared 模式) 或 report-<username>.md (separate 模式)
└── .github/skills/experiment-report/    # 本 Agent Skill 所在目錄
```

### 版本相容性與 Drift 處理 (Version Drift Handling)
* `config.yml` 中定義有 `template_version`（例如 `"1.0"`）與 `skill_version`（例如 `"1.2"`）。
* 當 Agent 在舊版 Workspace（如 `template_version: "1.0"`）套用新版 Skill 時：
  1. Agent 應優先讀取 `config.yml` 並檢查版本設定。
  2. 保持向後相容：遵循既有目錄結構與 `report_mode`。
  3. 若發現未定義欄位，自動套用預設安全規範（如預設 `report_mode: shared`, `status: not_started`）。

---

## 2. 操作分類與強制使用者確認機制 (Confirmation Boundaries)

Agent 對 Workspace 的所有操作分為以下層級：

| 操作類型 (Class) | 涵蓋動作 | 執行機制 / 授權要求 |
| :--- | :--- | :--- |
| **READ** | 讀取檔案、列出目錄、檢查 status、檢視 config.yml | **可直接執行** (無需額外確認) |
| **CREATE / MODIFY** | 在 `processed/`, `analysis/`, `report/` 新增或修改檔案 | **必須向使用者提出操作計畫**，獲 confirmation 後執行 |
| **OVERWRITE / DELETE** | 覆寫既有檔案、刪除任何檔案、重新命名/移動檔案 | **高風險操作**：必須顯式標明 Overwrite/Delete 警告並獲得明確確認 |
| **RAW WRITE** | 企圖修改、覆寫或刪除 `raw/` 內檔案 | **絕對禁止 (Forbidden)**：直接拒絕，引導使用 Raw 上傳 |
| **GIT COMMIT** | 建立本地 Git Commit | **需獨立授權**：必須預閱 Commit Message 並獲確認 |
| **GIT PUSH** | 將本地 Commit 推送至遠端 GitHub | **高風險邊界**：未獲使用者**明確要求 PUSH** 絕不自行執行 |
| **REPO CONFIG** | 修改 Repository 設定、刪除 Repo | **高風險邊界**：絕不自行執行 |

---

## 3. 對話內 confirmation 協定 (In-Chat Confirmation)

Confirmation 機制不依賴網站 UI，而係直接在使用者與外部 Agent 的對話中完成：

1. Agent 在評估任務後，**先輸出結構化操作計畫 (Operation Plan)**。
2. Agent **停止自動執行**，等待使用者在對話中回覆（如：「確認」、「approve」、「執行」）。
3. 使用者確認後，Agent 方得執行對應變更。

---

## 4. 多檔案操作計畫與 SHA 驗證 (Multi-File Operation Manifest & SHA Safety)

當任務涉及一個或多個檔案的建立、修改或覆寫時，Agent **必須**在提案中建立明確的操作清單與 SHA 樂觀鎖（Optimistic Locking）：

### 4.1 操作清單 (Operation Manifest) 範例

```text
==================== 多檔案操作計畫 (Operation Manifest) ====================
【目標實驗】: lab-01 (二極體特性量測)
【預計變更檔案清單】:
1. [MODIFY] experiments/lab-01/report/report.md
   - 描述: 嵌入特性曲線圖並補充討論數據
   - Expected SHA: 4f3b2a1c... (目前讀取之 SHA)
2. [CREATE] experiments/lab-01/analysis/plot_bjt.py
   - 描述: 新增繪製 BJT 特性曲線腳本
   - Expected SHA: null (新建立)
3. [CREATE] experiments/lab-01/analysis/bjt_curve.svg
   - 描述: 產出的向量特性曲線圖
   - Expected SHA: null (新建立)

【Git 邊界】:
- 本次包含 Git Commit: 是 ([lab-01] 新增 BJT 特性曲線圖與討論)
- 本次包含 Git Push: 否 (修改僅保留於本地工作區，需另行要求 Push)

請確認是否允許執行上述變更？(請於對話中回覆「確認」或「approve」)
========================================================================
```

### 4.2 SHA 漂移與衝突處理機制 (SHA Collision / Drift Rules)
* 在準備寫入任何既有檔案前，Agent **必須驗證檔案當前 SHA 是否與 expected SHA 相符**。
* **若 Expected SHA 已改變（代表檔案在 Agent 讀取與寫入之間已被他人或其它程序修改）**：
  1. **立即中止操作 (Abort execution)**。
  2. **嚴禁強行覆寫**。
  3. 重新讀取最新檔案內容與 SHA。
  4. 重新評估差異，生成新的 Operation Manifest 向使用者再次請求確認。

---

## 5. Local Workspace 與 GitHub 操作邊界 (Local vs Git Boundary)

Agent 必須嚴格區分以下三種操作，不可混為一談：

$$\text{檔案修改 (File Modification)} \neq \text{Git Commit} \neq \text{Git Push}$$

1. **File Modification**：僅異動本地檔案系統內容。
2. **Git Commit**：將變更記錄至本地 Git 歷史。
3. **Git Push**：將本地 Commit 傳送至遠端 GitHub 伺服器。

> [!CAUTION]
> - 未經使用者明確指令，Agent **不得主動執行 `git push`**。
> - 未經使用者明確指令，Agent **不得主動修改 Repository 遠端設定或執行 destructive git 操作**（如 `push --force`, `reset --hard` 等）。

---

## 6. 原始數據不可變性 (Sacred Raw Data 鐵律)

> [!CAUTION]
> `raw/` 目錄內的任何檔案均為第一手量測證據，**Agent 嚴禁對 `raw/` 內的現存檔案進行修改、覆蓋、重新命名或刪除**！

* **正確流程**：
  $$\text{讀取 } \texttt{raw/measurements.csv} \longrightarrow \text{清洗運算} \longrightarrow \text{輸出至 } \texttt{processed/measurements_clean.csv}$$
* **錯誤行為**：直接覆寫 `raw/measurements.csv` 內數值。

---

## 7. shared / separate 報告模式行為

根據 `config.yml` 中的 `report_mode` 設定調整行為：

* **`report_mode: shared` (共同撰寫模式)**：
  - 組員共同維護單一報告：`report/report.md`。
* **`report_mode: separate` (獨立撰寫模式)**：
  - 數據（`raw/`）、照片（`photos/`）、清洗數據（`processed/`）與分析圖表（`analysis/`）全組共享。
  - 報告本體分為個別獨立檔案：`report/report-<github_username>.md`。
  - Agent 在撰寫或修改報告時，僅操作對應使用者的報告檔案，不得覆寫他人報告。

---

## 8. Commit Message 規範（白話繁體中文）

> [!IMPORTANT]
> Git Commit Message **必須使用白話繁體中文**，並精確描述本次提交「實際完成了什麼」。

* **嚴格禁止使用**：`update`、`fix`、`final`、`chore` 等無意義字眼。
* **統一格式**：`[實驗編號] <明確動作描述>`
* **標準範例**：
  - `[lab-01] 新增二極體量測照片與原始數據`
  - `[lab-01] 整理量測資料並計算平均壓降`
  - `[lab-01] 新增 BJT 特性曲線繪圖腳本與 SVG 圖表`
  - `[lab-01] 更新報告成果與討論章節`

---

## 9. 如何向使用者回報結果

任務執行完畢後，Agent 應於對話中提供結構化摘要：
1. **執行成果**：完成之分析或修改項目。
2. **檔案異動清單**：列出受影響之檔案相對路徑。
3. **Commit 資訊**：Commit Message 與 Commit SHA（若有執行 Commit）。
4. **Git Push 狀態**：說明變更保留於本地，提示使用者可手動或交由 Agent 執行 `git push`。
