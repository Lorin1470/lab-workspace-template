# Agent Skill 完整指南與操作規範

本系統提供雙 Agent Skill 架構，分別處理 GitHub 儲存庫直接操作與實驗報告專業撰寫，確保資料安全與學術誠信。

---

## 一、雙 Skill 專業分工與定位

| Skill 名稱 | 定位與核心職責 | 適用情境與典型指令 |
| :--- | :--- | :--- |
| **`github-workspace`**<br>`v1.0` | **直接 GitHub 工作區操作**<br>• 辨識儲存庫與課程/實驗模式 (Course vs Experiment Mode)<br>• 探索工作區目錄與檔案清單<br>• 讀取文字檔與二進位素材<br>• 安全建立檔案與上傳照片/素材 (防覆蓋檢查)<br>• 路徑安全防穿越與個人報告隔離 (`report_mode`)<br>• 寫入後提取真實 Git Commit SHA 嚴格驗證 | 💬 *「檢查目前工作區有哪些實驗數據與照片」*<br>💬 *「上傳剛拍好的電路照片到 photos/」*<br>💬 *「確認目前是哪種架構模式與報告模式」*<br>💬 *「驗證剛剛建立的檔案是否已成功推送到 GitHub」* |
| **`experiment-report`**<br>`v1.1` | **實驗專業分析與報告撰寫**<br>• 原始數據清洗與正規化（輸出至 `processed/`）<br>• 國際標準單位校驗與異常數值標註<br>• 特性曲線擬合與繪圖代碼（輸出至 `analysis/`）<br>• 理論值與實測值之百分誤差計算<br>• 完整實驗結報章節與 Markdown 公式撰寫 | 💬 *「幫我清洗 raw/data.csv 並計算平均增益」*<br>💬 *「用 Python 繪製 BJT 特性曲線並存到 analysis/」*<br>💬 *「依據量測數據起草 report/report.md 初稿」*<br>💬 *「幫我計算理論值與實測值的百分誤差」* |

> [!NOTE]
> **操作原則**：所有針對 GitHub 的檔案探索、讀寫與素材上傳均直接透過 GitHub 工具或 API 執行，**嚴禁依賴外部 Web API 站台**。

---

## 二、工作流程協同範例

兩套 Skill 互相配合，形成清晰的單向資料處理流：

```text
[探索工作區]           github-workspace: 讀取 config.yml，定位模式與目錄 (Course/Experiment)
      │
[素材上傳]             github-workspace: 安全上傳原始數據 (raw/) 與照片 (photos/)
      │
[數據清洗與分析]       experiment-report: raw/ -> processed/ -> analysis/ 繪圖與誤差計算
      │
[報告起草]             experiment-report: 撰寫 report/report.md 或 report/report-<user>.md
      │
[安全寫入與驗證]       github-workspace: 防覆蓋檢查 -> 使用者確認 -> 寫入 GitHub -> 驗證 Commit SHA
```

---

## 三、強制使用者確認機制（Git 安全鎖）

> [!CAUTION]
> 為確保學術資料誠信與防止誤覆寫，Agent 在執行任何寫入、提交、刪除或推送前，**必須停下並輸出以下結構化確認區塊**：

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

### 分步授權原則
* 使用者批准修改檔案 $\neq$ 批准 Commit $\neq$ 批准 Push。
* 每一階段必須獨立取得授權，不可自動繼承。
* 嚴禁 `git push --force`，嚴禁刪除或篡改既有 Commit 歷史。
* 若在使用者確認後，實際產生的 Diff 內容、受影響檔案或 Commit Message 發生任何變更，**Agent 必須立即作廢前次確認，重新輸出清單再次徵求使用者核准**。

---

## 四、原始數據不可變性 (Sacred Raw Data)
* `raw/` 內的任何檔案均為原始數據證據，**絕對禁止編輯、覆蓋、刪除或直接原地修改**。
* 任何清洗或運算成果，一律輸出至 `processed/`。
* 新增原始數據檔案時，若遠端已存在同名檔案，一律視為衝突（409 Conflict）拒絕覆寫。

---

## 五、報告模式切換機制 (Shared vs Separate)
系統透過 `config.yml` 的 `report_mode` 欄位控制行為：

* **`shared` (共同模式)**：
  - 全組組員共同維護 `report/report.md`。
  - 適用於分工撰寫同一份完整結報。
* **`separate` (獨立模式)**：
  - 數據（`raw/`）、照片（`photos/`）與分析（`analysis/`）依然共享。
  - 各組員獨立維護各自的報告：`report/report-<github_user>.md`。
  - Agent 在協助特定組員時，僅能操作該組員名下的報告檔案。
  - 若無法可靠確認目前操作者的 GitHub 身分，**嚴禁寫入他人報告，亦不得退回共用報告**。
