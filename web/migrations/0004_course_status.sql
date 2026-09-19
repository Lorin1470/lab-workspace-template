-- ========================================================
-- 0004: 課程狀態欄位 (Course Status)
-- ========================================================

-- 為 courses 資料表新增 status 欄位，支援 active, archived, inactive
ALTER TABLE courses ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'inactive'));
