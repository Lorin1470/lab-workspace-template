-- ==========================================
-- 0002: 使用者工作階段查詢索引
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_github ON user_sessions(github_id);
