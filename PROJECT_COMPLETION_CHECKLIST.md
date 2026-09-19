# Lab Workspace System 專案完成清單

本清單以「同學能透過真實 GitHub Workspace 協作完成實驗資料與報告」為完成標準，不把 mock/demo 回應視為 Production 功能。

## 核心流程

- [x] GitHub OAuth 登入與 D1 session
- [x] Course 建立、查詢與成員加入
- [x] Experiment 建立與正式 GitHub App repository provisioning
- [x] D1 authoritative repository binding
- [x] Workspace 檔案樹與檔案讀取
- [x] 文字檔 SHA optimistic locking 與 409 UX
- [x] Raw Data 專用上傳與不可覆寫保護
- [x] 照片上傳、MIME 驗證與 5MB 限制
- [x] shared/separate report backend isolation
- [x] 真實 GitHub commit SHA 與 Activity Log
- [x] Agent context/read/explicit-confirm write
- [x] Agent Task proposal → confirmation → Workspace Service write
- [x] Agent proposal hash 綁定確認內容，避免 proposal 與實際寫入漂移
- [x] Activity Log 缺少 D1 時明確回傳錯誤，不回傳示範資料
- [x] ZIP 下載來源改為目前 Workspace 的真實 GitHub 檔案

## Agent Task Workflow

- [x] 報告更新 proposal（可寫入，必須明確確認）
- [x] Workspace 完成度檢查（唯讀）
- [x] 照片保存狀態檢視（唯讀）
- [x] 不假設瀏覽器可任意讀取 Desktop
- [x] 不允許 Agent 直接寫入 `raw/`
- [ ] 接入真正的 LLM provider（目前使用可測試的 deterministic planner，沒有假裝具備模型推理）
- [ ] 多檔案操作計畫與逐檔 SHA 驗證
- [ ] 照片重新命名/分類（需要明確的使用者確認與安全 rename/move API，尚未開放）
- [ ] 數據清洗、圖表生成與分析 workflow（屬後續 scope，不能由目前 UI 假裝已完成）

## 仍需處理的產品技術債

- [ ] 將既有資料庫中的 legacy `teacher/assistant/student` role 欄位完全遷移為平等協作者語義；目前 UI 已不再顯示階級，但 API/schema 仍保留相容欄位。
- [ ] 將 legacy `LabList`/`LabDetail` 呼叫鏈完全移除；目前 `LabDetail` 已改為明確停用頁，不再提供 fake files、commits 或下載內容。
- [ ] 補充正式 Production smoke/E2E：本批本機變更尚未 deploy，因此尚未宣稱 Production 通過。
- [ ] 補充下載流程的瀏覽器自動化測試（API 的真實 file list/read 已有測試）。

## 安全與驗收門檻

- [x] Secrets、tokens、private keys 不進 source、frontend bundle、log 或測試輸出
- [x] 所有 GitHub 寫入經過 Workspace Service
- [x] 所有可變更 GitHub 的 Agent task 需要明確 confirmation
- [x] Raw Sanctuary backend boundary
- [x] Separate report backend boundary
- [x] 409 不自動 retry 或偷偷覆寫
- [x] 本機 `npm run validate`
- [x] 本機 `npm run web:build`
- [x] 本機 `git diff --check`
- [ ] 本批變更 commit、push、Production deploy 與真實 E2E（需另行明確授權）
