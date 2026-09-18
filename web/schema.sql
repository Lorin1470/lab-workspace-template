-- ==========================================
-- 實驗課工作區系統 Cloudflare D1 資料表綱要
-- ==========================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,                       -- UUID
    repo_name TEXT NOT NULL,                   -- 例如 "your-org/electronics-lab-01"
    experiment_id TEXT NOT NULL,               -- 例如 "lab-01"
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    actor_type TEXT CHECK(actor_type IN ('user', 'agent', 'web')),
    actor_id TEXT NOT NULL,                    -- GitHub 帳號或 Agent 標籤
    actor_name TEXT NOT NULL,                  -- 顯示姓名
    actor_avatar TEXT,                         -- 頭像 URL
    requested_by TEXT,                         -- 發起要求之使用者帳號
    approved_by TEXT,                          -- 核准變更之使用者帳號
    action TEXT NOT NULL,                      -- 如 "upload_data", "commit_changes", "export_pdf"
    summary TEXT NOT NULL,                     -- 白話中文摘要
    commit_sha TEXT,                           -- 關聯之 Git Commit SHA
    details_json TEXT                          -- 額外中繼資料 (JSON 格式)
);

CREATE INDEX IF NOT EXISTS idx_logs_repo ON activity_logs(repo_name, timestamp DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
    session_id TEXT PRIMARY KEY,
    github_id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);
