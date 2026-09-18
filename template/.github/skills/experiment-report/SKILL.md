---
name: experiment-report
description: 實驗課 GitHub 工作區核心 Agent Skill。負責實驗數據整理、照片分類、數據清洗、特性曲線分析、Markdown 報告撰寫與 Git 變更管理。嚴格遵循原始數據保護、白話中文 Commit 規範與強制使用者確認機制。
version: "1.1"
---

# 實驗課 GitHub 工作區 Agent Skill (Version 1.1)

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

## 10. Activity Log 規則與真實性鐵律 (Truthfulness & Integrity)

除了 Git 歷史之外，系統維護一份操作層級的活動紀錄（Activity Log）。**Activity Log 必須 100% 反映實際發生的客觀操作，嚴禁由 Agent 自行推測、補寫、誇大或美化不存在的操作**。

### 10.1 核心欄位規範（10 大真實性指標）

1. **`target`（目標資源真實性）**：
   - 必須精確對應實際被讀取、分析、建立、修改或刪除之檔案路徑（如 `report/report-studentA.md`）。
   - **嚴禁記錄未實際接觸的檔案**（例如未曾讀寫 `analysis/` 則不可將其列為 target）。
2. **`action`（階段精準性）**：
   - 動作動詞必須客觀反映當前操作階段，嚴禁將「計畫中」寫成「已完成」。標準操作動詞定義：
     * `request_proposal`：提出變更預覽與分析計畫（尚未執行修改）。
     * `file_created`：目標檔案已實際建立於本地。
     * `file_modified`：目標檔案已實際修改完成。
     * `commit_created`：本地 Git Commit 已實際成功建立。
     * `push_completed`：遠端 GitHub Push 已實際成功完成。
     * `request_rejected`：因安全規則或權限越界直接拒絕之操作。
3. **`files_changed`（差異可證性）**：
   - 凡涉及檔案異動之事件，異動清單必須以實際 `git diff`、`git status` 或 Commit 歷史為唯一客觀依據。
   - **嚴禁虛報未出現在實際差異中的檔案**。
4. **`commit_sha`（提交存在性）**：
   - 只有在本地或遠端實際成功產生 Git Commit 後方可填入對應的 Commit SHA。
   - **未 Commit 前必須嚴格保持 `null` 或為空**，不得填入預測或假造的 SHA。
5. **`push`（推送真實性）**：
   - 只有在遠端推送實際成功後方可記錄 `push_completed`。
   - 提出 Push 規劃或僅完成本地 Commit 時，嚴禁記錄為推送完成。
6. **`approval`（授權獨立性）**：
   - 必須精準反映使用者的授權狀態：`pending`（等待中）、`approved`（已授權）、`rejected`（已拒絕）。
   - **分步授權原則（不可混淆）**：
     * 使用者批准「修改檔案」$\neq$ 批准「Commit」。
     * 使用者批准「Commit」$\neq$ 批准「Push」。
     * 每一階段必須獨立取得授權，不可自動繼承或越權假設。
7. **`requested_by`（發起人真實性）**：
   - 必須如實記錄實際發出指令之使用者帳號（如 `studentA`）。
   - Agent 嚴禁自行偽造或任意代換操作者。
8. **`actor`（執行主體區分）**：
   - 必須明確區分提出要求之使用者（`user` / 使用者帳號）與實際執行任務的 Agent（`agent:<名稱>`）。
9. **`summary` 與【嚴禁紀錄漂移（No Record Drift）】**：
   - 摘要內容必須完全依據實際發生之變更與使用者明確授權之項目撰寫。
   - **嚴禁紀錄漂移（Hallucinated Summaries）**：例如使用者僅授權撰寫「實驗目的與原理」，摘要中**嚴禁自行補寫未經授權且實際 diff 不存在的「器材清單」、「分析圖表」或「量測結果」**。
10. **安全拒絕紀錄（`request_rejected`）**：
    - 被 Skill 規則直接拒絕的越權請求（如跨員修改他人報告、企圖寫入 `raw/`）應記錄為 `request_rejected`。
    - 必須明確聲明「0 檔案變更、未產生任何 Commit」，Commit SHA 必須為 `null`。

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
