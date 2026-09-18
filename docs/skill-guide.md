# Agent Skill 完整指南與操作規範

本規範說明 AI Agent 如何在實驗 Repo 內遵循 `.github/skills/experiment-report/SKILL.md` 執行任務。

---

## 一、Agent-First 的工作定位
Agent 是學生的主要協作工作夥伴。在實驗進行與結報過程中，學生可以向 Agent 發出指令：

```text
「幫我把 photos/ 裡的照片按實驗步驟分類，確認示波器數值。」
「幫我清洗 raw/measurements.csv，去除雜訊並計算平均增益。」
「幫我用 Python 畫出輸出特性曲線，存成 high-res SVG 到 analysis/。」
「幫我根據量測結果，起草 report/report.md 討論章節。」
```

---

## 二、強制使用者確認機制（Git 安全鎖）

> [!CAUTION]
> 為確保學術資料誠信與防止誤覆寫，Agent 在執行任何寫入、提交、刪除或推送前，**必須停下並輸出以下結構化確認區塊**：

```text
==================== 變更預覽確認 ====================
【新增檔案】:
  - analysis/plot_curve.py (特性曲線繪圖腳本)
  - analysis/curve.svg (向量特性曲線圖)
【修改檔案】:
  - report/report.md (嵌入圖表並補充理論誤差分析)
【刪除檔案】:
  - 無
【預計 Commit Message】:
  [lab-01] 新增特性曲線繪圖腳本並補充實驗報告討論

請確認是否允許執行上述變更與 Commit？(回覆「確認」或「approve」後繼續)
====================================================
```

### 變更重置原則
若在使用者確認後，實際產生的 Diff 內容、受影響檔案或 Commit Message 發生任何變更，**Agent 必須立即作廢前次確認，重新輸出清單再次徵求使用者核准**。

---

## 三、原始數據不可變性 (Sacred Raw Data)
* `raw/` 內的任何檔案均為原始數據證據，**絕對禁止編輯、覆蓋、刪除或直接原地修改**。
* 任何清洗或運算成果，一律輸出至 `processed/`。

---

## 四、報告模式切換機制 (Shared vs Separate)
系統透過 `config.yml` 的 `report_mode` 欄位控制行為：

* **`shared` (共同模式)**：
  - 全組組員共同維護 `report/report.md`。
  - 適用於分工撰寫同一份完整結報。
* **`separate` (獨立模式)**：
  - 數據（`raw/`）、照片（`photos/`）與分析（`analysis/`）依然共享。
  - 各組員獨立維護各自的報告：`report/report-<github_user>.md`。
  - Agent 在協助特定組員時，僅操作該組員名下的報告檔案。
