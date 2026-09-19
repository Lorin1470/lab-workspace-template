-- ==========================================
-- 實驗課工作區系統 Cloudflare D1 資料表綱要
-- ==========================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,                       -- UUID
    repo_name TEXT NOT NULL,                   -- 例如 "your-org/electronics-lab-01"
    experiment_id TEXT NOT NULL,               -- 例如 "lab-01"
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'agent', 'web')),
    actor_id TEXT NOT NULL,                    -- GitHub 帳號或 Agent 標籤
    actor_name TEXT NOT NULL,                  -- 顯示姓名
    actor_avatar TEXT,                         -- 頭像 URL
    requested_by TEXT,                         -- 發起要求之使用者帳號
    approved_by TEXT,                          -- 核准變更之使用者帳號
    approval_status TEXT NOT NULL DEFAULT 'none' CHECK(approval_status IN ('pending', 'approved', 'rejected', 'none')),
    action TEXT NOT NULL,                      -- 如 "request_proposal", "file_created", "commit_created"
    target TEXT,                               -- 目標檔案/資源路徑 (如 "report/report-studentA.md")
    summary TEXT NOT NULL,                     -- 白話中文摘要 (嚴禁紀錄漂移)
    files_changed TEXT,                        -- 異動檔案清單 (JSON array 字串)
    commit_sha TEXT,                           -- 關聯之 Git Commit SHA
    details_json TEXT                          -- 額外中繼資料 (JSON 格式)
);

CREATE INDEX IF NOT EXISTS idx_logs_repo_exp ON activity_logs(repo_name, experiment_id, timestamp DESC);
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

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_github ON user_sessions(github_id);

-- 1. 課程資料表 (courses)
-- 建立者僅記錄 created_by_github_id，角色唯一權威來源為 course_memberships
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,                       -- 系統 UUID (例如 "c_...")
    course_code TEXT NOT NULL,                 -- 課程代號 (例如 "EE201")
    name TEXT NOT NULL,                        -- 課程全名 (例如 "電子學實驗")
    semester TEXT NOT NULL,                    -- 學期 (例如 "114-1")
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'inactive')), -- 課程狀態
    created_by_github_id TEXT,                 -- 建立者 GitHub ID (不代表權限)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_code, semester)
);

CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(course_code);

-- 2. 實驗資料表 (experiments)
-- 嚴格限制 repository TEXT NOT NULL UNIQUE (一個 Repo 僅能綁定一個 Experiment)
-- 實驗代號使用 experiment_code (例如 "lab-01")，與系統 UUID id 區隔
CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,                       -- 系統 UUID (例如 "exp_...")
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    experiment_code TEXT NOT NULL,             -- 實驗代號 (例如 "lab-01")
    name TEXT NOT NULL,                        -- 實驗名稱 (例如 "BJT 雙極性接面電晶體特性量測")
    repository TEXT NOT NULL UNIQUE,           -- 關聯之 GitHub Repo 全名 (唯一綁定)
    report_mode TEXT NOT NULL DEFAULT 'shared' CHECK(report_mode IN ('shared', 'separate')),
    config_version TEXT NOT NULL DEFAULT '1.0',
    status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started', 'in_progress', 'data_processing', 'report_writing', 'completed')),
    provisioning_status TEXT NOT NULL DEFAULT 'pending' CHECK(provisioning_status IN ('pending', 'creating', 'ready', 'failed')),
    provisioning_error TEXT,
    provisioned_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, experiment_code)
);

CREATE INDEX IF NOT EXISTS idx_experiments_repo ON experiments(repository);
CREATE INDEX IF NOT EXISTS idx_experiments_course ON experiments(course_id);

-- 2.1 實驗儲存庫建立歷程與稽核表 (experiment_provisionings)
CREATE TABLE IF NOT EXISTS experiment_provisionings (
    id TEXT PRIMARY KEY,                       -- 系統 UUID (例如 "prov_...")
    experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    repository TEXT NOT NULL,                  -- 目標 GitHub Repo 全名
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'creating', 'ready', 'failed')),
    error_summary TEXT,                        -- 失敗摘要 (絕不包含 Secret)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exp_prov_exp_id ON experiment_provisionings(experiment_id);
CREATE INDEX IF NOT EXISTS idx_exp_prov_repo ON experiment_provisionings(repository);

-- 3. 課程成員表 (course_memberships)
-- Course 角色唯一權威來源 (teacher, assistant, student)
CREATE TABLE IF NOT EXISTS course_memberships (
    id TEXT PRIMARY KEY,                       -- 系統 UUID
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    github_id TEXT NOT NULL,                   -- 使用者不可變 GitHub ID
    username TEXT NOT NULL,                    -- 顯示與查詢快取 (可變)
    role TEXT NOT NULL CHECK(role IN ('teacher', 'assistant', 'student')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, github_id)
);

CREATE INDEX IF NOT EXISTS idx_cm_user ON course_memberships(github_id);
CREATE INDEX IF NOT EXISTS idx_cm_course ON course_memberships(course_id);

-- 4. 實驗成員表 (experiment_memberships)
-- 實驗組別與成員綁定 (student, assistant)
CREATE TABLE IF NOT EXISTS experiment_memberships (
    id TEXT PRIMARY KEY,                       -- 系統 UUID
    experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    github_id TEXT NOT NULL,                   -- 使用者不可變 GitHub ID
    username TEXT NOT NULL,                    -- 顯示與查詢快取 (可變)
    role TEXT NOT NULL CHECK(role IN ('student', 'assistant')),
    group_name TEXT,                           -- 組別 (例如 "第 1 組")
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(experiment_id, github_id)
);

CREATE INDEX IF NOT EXISTS idx_em_user ON experiment_memberships(github_id);
CREATE INDEX IF NOT EXISTS idx_em_exp ON experiment_memberships(experiment_id);
