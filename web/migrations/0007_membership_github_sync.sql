-- ==========================================
-- 成員 GitHub 協作者權限同步架構遷移
-- ==========================================

-- 1. 獨立的 Repository Collaborators 狀態表
CREATE TABLE IF NOT EXISTS repository_collaborators (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    github_id TEXT NOT NULL,
    username TEXT NOT NULL,
    permission TEXT NOT NULL DEFAULT 'push',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'failed', 'removed')),
    error_message TEXT,
    synced_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repository, github_id)
);

CREATE INDEX IF NOT EXISTS idx_repo_collab_repo ON repository_collaborators(repository);
CREATE INDEX IF NOT EXISTS idx_repo_collab_user ON repository_collaborators(github_id);

-- 2. 擴充 course_memberships 表格
ALTER TABLE course_memberships ADD COLUMN github_permission_status TEXT NOT NULL DEFAULT 'pending' CHECK(github_permission_status IN ('pending', 'ready', 'failed', 'removed'));
ALTER TABLE course_memberships ADD COLUMN github_permission_error TEXT;
ALTER TABLE course_memberships ADD COLUMN github_synced_at DATETIME;

-- 3. 擴充 experiment_memberships 表格
ALTER TABLE experiment_memberships ADD COLUMN github_permission_status TEXT NOT NULL DEFAULT 'pending' CHECK(github_permission_status IN ('pending', 'ready', 'failed', 'removed'));
ALTER TABLE experiment_memberships ADD COLUMN github_permission_error TEXT;
ALTER TABLE experiment_memberships ADD COLUMN github_synced_at DATETIME;
