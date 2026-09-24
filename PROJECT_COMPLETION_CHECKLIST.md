# Lab Workspace System 專案完成清單

本清單以「同學能透過外部 Agent 安裝 Skill，與真實 GitHub Workspace 協作完成實驗數據與報告」為完成標準，不把 mock/demo 回應視為 Production 功能。

## Agent-First 核心架構

- [x] Agent 定位確立：外部 Agent (Claude Code / Codex / Cursor / Antigravity / Gemini CLI) 為使用者工具
- [x] Skill 獨立封裝：`.github/skills/experiment-report/SKILL.md` 作為外部 Agent 規範
- [x] 網站不充當內建 LLM 或網站直接呼叫 LLM（外部 Agent 獨立運作）
- [/] N/A: 接入網站內建 LLM provider（不適用：已確立為 external-agent-first 架構，網站不內建 LLM）
- [x] 多檔案操作計畫 (Operation Manifest) 規範與標準範例
- [x] 逐檔 expected SHA 樂觀鎖驗證與衝突中止機制
- [x] 對話內 explicit confirmation 協定（不依賴網站 UI 進行 confirmation）
- [x] File Modification vs Git Commit vs Git Push 權限與操作邊界隔離
- [x] 原始數據 (Raw Sanctuary) 不可變性鐵律
- [x] shared / separate 報告模式隔離與授權規則
- [x] 版本相容性 (template_version & skill_version) 與 Version Drift 處理規範
- [x] 學生導引文件 (`docs/AGENT_QUICKSTART.md`)

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
- [x] Workspace API 提供外部/受控 Agent 專用 context/read/write 介面
- [x] Activity Log 缺少 D1 時明確回傳錯誤，不回傳示範資料
- [x] ZIP 下載來源改為目前 Workspace 的真實 GitHub 檔案

## 產品技術債與驗證

- [x] 結構驗證工具 (`scripts/validate-repo.mjs`) 強化 config.yml 與 skill_version 檢驗
- [x] CORS 跨域安全性修復 (預防任意 Origin 鏡像)
- [x] 範本部署獨立性：移除 `wrangler.toml` 固定 D1 ID，改為標準範本引導
- [x] GitHub Actions CI workflow 設定與本機驗證
- [x] 本機 `npm run validate`
- [x] 本機 `npm run test:workspace`
- [x] 本機 `npm run test:workspace-api`
- [x] 本機 `npm run test:permissions`
- [x] 本機 `npm run test:course-mode`
- [x] 本機 `npm run web:build`
- [x] 本機 `git diff --check`
