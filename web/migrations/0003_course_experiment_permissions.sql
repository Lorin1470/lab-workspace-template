-- ========================================================
-- 0003: 課程、實驗與成員權限架構 (Course / Experiment / Membership)
-- ========================================================

-- 1. 課程資料表 (courses)
-- 建立者僅記錄 created_by_github_id，角色唯一權威來源為 course_memberships
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,                       -- 系統 UUID (例如 "c_...")
    course_code TEXT NOT NULL,                 -- 課程代號 (例如 "EE201")
    name TEXT NOT NULL,                        -- 課程全名 (例如 "電子學實驗")
    semester TEXT NOT NULL,                    -- 學期 (例如 "114-1")
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, experiment_code)
);

CREATE INDEX IF NOT EXISTS idx_experiments_repo ON experiments(repository);
CREATE INDEX IF NOT EXISTS idx_experiments_course ON experiments(course_id);

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
