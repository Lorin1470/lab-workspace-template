---
name: experiment-report
description: 實驗課 GitHub 工作區核心 Agent Skill。負責實驗數據整理、照片分類、數據清洗、特性曲線分析、Markdown 報告撰寫與 Git 變更管理。嚴格遵循原始數據保護、白話中文 Commit 規範與強制使用者確認機制。
version: "1.0"
---

# 實驗課 GitHub 工作區 Agent Skill (Version 1.0)

本規範是 AI Agent 在本實驗 Repository 內進行任何分析、整理、代碼編寫與 Git 提交時的最高準則。任何 Agent 進入工作區時，必須嚴格遵守以下所有規則。

---

## 1. Repository 結構說明

本實驗工作區採用單一標準化的結構，確保數據源頭與分析過程具備可追溯性：

```text
.
├── config.yml                           # 實驗中繼設定檔 (課程、實驗名稱、成員、模式)
├── raw/                                 # 原始量測數據 (唯讀！聖域保護)
├── photos/                              # 實驗現場量測照片 (儀器讀數、電路接線、波形)
├── processed/                           # 清洗後數據 (由 raw/ 衍生之標準 CSV/JSON)
├── analysis/                            # 分析腳本 (Python/Jupyter) 與繪製之圖表
├── report/                              # 最終實驗報告 (Markdown / PDF)
│   └── report.md                        # 報告主體
└── .github/skills/experiment-report/    # 本 Agent Skill 所在目錄
```

---

## 2. 目錄用途與職責劃分

* **`raw/` (原始數據)**：儀器直接匯出之原始檔案（如 `.xlsx`, `.csv`, `.dat`, `.txt`）。此目錄為「不可變源頭（Immutable Source）」。
* **`photos/` (實驗照片)**：現場拍攝之電路實體圖、示波器畫面、電表螢幕等影像。
* **`processed/` (衍生數據)**：由 Agent 或腳本從 `raw/` 讀取並轉換清洗後的數據（例如去除表頭雜訊、統一單位、填補合理缺失值、格式正規化之 `.csv`）。
* **`analysis/` (分析成果)**：數據處理腳本（如繪圖 Python 代碼）、計算數值、統計表格與產出的曲線圖（`.png`, `.svg`）。
* **`report/` (實驗報告)**：最終產出之完整 Markdown 報告（`report.md`）或編譯後之 PDF。

---

## 3. 原始資料保護規則（鐵律）

> [!CAUTION]
> `raw/` 目錄內的任何檔案均為第一手量測證據，**Agent 嚴禁對 `raw/` 內的現存檔案進行修改、覆蓋、重新命名或刪除**！

* **正確做法**：
  $$\text{讀取 } \texttt{raw/measurements.xlsx} \longrightarrow \text{清洗運算} \longrightarrow \text{輸出至 } \texttt{processed/measurements_clean.csv}$$
* **錯誤做法（絕對禁止）**：直接在 `raw/measurements.xlsx` 內修改數值或覆寫。

---

## 4. 資料處理流程（Pipeline）

所有資料流轉必須單向推進，嚴禁逆流：
$$\text{raw/ (原始)} \xrightarrow{\text{清洗與正規化}} \text{processed/ (乾淨)} \xrightarrow{\text{統計與擬合}} \text{analysis/ (圖表)} \xrightarrow{\text{整合撰寫}} \text{report/ (報告)}$$

1. **檢查數據完整度**：比對照片中儀表讀數與記錄數據是否吻合。
2. **單位標準化**：所有物理量必須標明國際標準單位（如 $\text{V}, \text{mA}, \text{k}\Omega, \text{Hz}$），避免隱式單位。
3. **異常值標註**：若發現物理上不合理之數值（如二極體順向壓降出現負值），必須在 `processed/` 或報告中備註說明，不得擅自竄改原始記錄。

---

## 5. 實驗數據分析規則

1. **圖表規範**：
   - 坐標軸必須具備完整的**物理量名稱與單位**（例如：橫軸 $V_{CE}\ (\text{V})$、縱軸 $I_C\ (\text{mA})$）。
   - 繪製特性曲線時需標明數據點（Scatter）與擬合曲線（Fit line）。
   - 包含多組參數時（例如不同 $I_B$ 條件），必須包含清楚的圖例（Legend）。
   - 圖檔建議優先輸出為高解析度向量圖（`.svg`）或無損點陣圖（`.png`，解析度至少 300 DPI），儲存於 `analysis/`。
2. **誤差計算**：
   - 明確計算理論值、模擬值與實測值之間的百分誤差：
     $$\text{相對誤差} = \left| \frac{\text{實測值} - \text{理論值}}{\text{理論值}} \right| \times 100\%$$
   - 必須提供誤差來源的物理探討（如儀表內阻、導線阻抗、環境溫度、元件容許誤差）。

---

## 6. 報告撰寫規則

1. **標準架構**：
   - 一、實驗目的 (Objective)
   - 二、實驗原理與電路理論 (Theory & Equations)
   - 三、使用器材與儀表 (Equipment)
   - 四、實驗步驟 (Procedures)
   - 五、實驗數據、曲線與分析 (Data & Analysis)
   - 六、問題與討論 (Discussion)
   - 七、實驗心得與結論 (Conclusion)
2. **數學公式語法**：
   - 行內公式使用 `$...$`，例如：$I_C = \beta I_B$。
   - 獨立區塊公式使用 `$$...$$`，例如：
     $$I_D = I_S \left( e^{\frac{qV_D}{\eta k T}} - 1 \right)$$
3. **圖片引用**：
   - 圖片一律使用相對路徑引用，例如：`![BJT輸出特性曲線](../analysis/bjt_output_curve.png)`。

---

## 7. Git 操作規則

1. 保持工作區乾淨，提交前必須檢視 `git status` 與 `git diff`。
2. 避免將無關的作業系統檔案（如 `.DS_Store`）、暫存檔或巨大虛擬環境提交入 Repo。
3. 嚴禁無故執行 `git push --force` 或刪除既有遠端 Commit 歷史。

---

## 8. Commit Message 規範（白話繁體中文）

> [!IMPORTANT]
> Git Commit Message **必須使用白話繁體中文**，並精確描述本次提交「實際完成了什麼」。

* **嚴格禁止使用**：
  - `update`、`fix`、`final`、`chore`、`changes`、`commit` 等無意義籠統字眼。
* **統一格式**：
  `[實驗編號] <明確動作描述>`
* **標準範例**：
  - `[實驗03] 新增今天的量測照片與原始數據`
  - `[實驗03] 整理量測資料並計算平均值`
  - `[實驗03] 新增 BJT 特性曲線繪圖腳本與輸出圖表`
  - `[實驗03] 修正電流平均值計算邏輯`
  - `[實驗03] 更新實驗結果與討論章節`
  - `[實驗03] 完成實驗報告初稿`

---

## 9. 強制使用者確認機制（Git 安全鎖）

> [!CAUTION]
> **Agent 不得在未經使用者明確確認前執行任何以下動作**：
> - `git commit`
> - `git push`
> - 上傳至遠端
> - 建立、刪除或覆寫既有檔案
> - 變更任何 `raw/` 內容
> - 調整 Repository 目錄結構

### 確認觸發流程：
當 Agent 準備進行檔案寫入或 Git 提交時，**必須先在對話中列出以下確認清單**：

```text
==================== 變更預覽確認 ====================
【新增檔案】:
  - analysis/plot_bjt.py (繪製 BJT 特性曲線腳本)
  - analysis/bjt_curve.png (產出的特性曲線圖)
【修改檔案】:
  - report/report.md (嵌入特性曲線圖並補充討論數據)
【刪除檔案】:
  - 無
【預計 Commit Message】:
  [實驗03] 新增 BJT 特性曲線圖並補充報告討論

請確認是否允許執行上述變更與 Commit？(回覆「確認」或「approve」後繼續)
====================================================
```

**若使用者確認後，實際產生的 Diff 或檔案有所異動，必須中止操作並重新向使用者請求確認！**

---

## 10. Activity Log 規則

除了 Git 紀錄之外，系統維護一份操作層級的活動紀錄：
1. **區分操作者**：明確標記發起來源為 `user` (使用者)、`agent` (AI 助手) 或 `web` (網頁端)。
2. **可追溯性**：Agent 執行的任何分析與修改，必須紀錄是由哪位使用者發起（`requested_by`）以及哪位使用者確認（`approved_by`）。
3. **格式規範**：
   `[時間] [角色] [人員] 行動摘要 (關聯 Commit SHA)`

---

## 11. shared / separate 報告模式行為

根據 `config.yml` 中的 `report_mode` 設定調整行為，系統邏輯保持同一套：

* **`report_mode: shared` (共同撰寫模式)**：
  - 所有組員共同維護單一報告檔案：`report/report.md`。
  - Agent 協助統整各成員提出的數據與分析結果，合併至主報告中。
* **`report_mode: separate` (獨立撰寫模式)**：
  - 實驗數據（`raw/`）、照片（`photos/`）、清洗數據（`processed/`）與分析圖表（`analysis/`）依舊為全組共享。
  - 報告本體分為個別獨立檔案：`report/report-<github_username>.md`（例如 `report/report-studentA.md`）。
  - Agent 在撰寫或修改報告時，僅操作對應使用者的報告檔案，不覆寫他人成果。

---

## 12. Agent 禁止事項（Negative Constraints）

1. **嚴禁偽造數據**：禁止因實驗結果不理想而透過程式無中生有捏造測量值。
2. **嚴禁覆寫 raw**：禁止任何理由修改 `raw/` 內容。
3. **嚴禁未確認推送**：嚴禁在未獲得使用者確認前執行 `git commit` 或 `git push`。
4. **嚴禁混淆個人檔案**：在 `separate` 模式下嚴禁修改其他組員的報告檔案。

---

## 13. 如何向使用者回報結果

任務完成後，Agent 必須以簡明、結構化的方式回報：
1. **執行成果摘要**：列出完成的分析項目與數據指標。
2. **檔案異動清單**：列出所有異動檔案與點擊連結。
3. **Commit 資訊**：標註本次生成的 Commit Message 與 SHA。
4. **下一步指引**：提示使用者報告中尚待補充的心得或可繼續進行的分析。
