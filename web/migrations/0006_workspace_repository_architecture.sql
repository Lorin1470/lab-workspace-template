-- ==========================================
-- 工作區儲存庫架構遷移：課程模式 vs 實驗模式
-- ==========================================

-- 1. 課程模式欄位：新課程預設 course 模式，舊課程維持 experiment 模式相容性
ALTER TABLE courses ADD COLUMN mode TEXT NOT NULL DEFAULT 'course' CHECK(mode IN ('course', 'experiment'));
-- 將既有課程設為 experiment 模式以保持相容性（假設所有既有課程都是實驗模式）
UPDATE courses SET mode = 'experiment' WHERE mode IS NULL OR mode = 'course';

-- 2. 課程儲存庫欄位（僅在 course 模式下使用）
ALTER TABLE courses ADD COLUMN github_repository TEXT; -- 例如 "your-org/electronics-lab-01"

-- 3. 實驗儲存庫欄位調整：在 course 模式下為 NULL，在 experiment 模式下保持原值
-- 由於 SQLite 不支援直接修改 NOT NULL 約束，我們需要重建表格
-- 步驟：建立新表 -> 複製資料 -> 替換舊表
BEGIN TRANSACTION;

-- 建立新的 experiments 表格（repository 欄位允許 NULL）
CREATE TABLE IF NOT EXISTS experiments_new (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    experiment_code TEXT NOT NULL,
    name TEXT NOT NULL,
    repository TEXT, -- 允許 NULL：在 course 模式下為 NULL，在 experiment 模式下填入 repo 全名
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

-- 複製現有資料（保持 repository 原值）
INSERT INTO experiments_new (
    id, course_id, experiment_code, name, repository, report_mode, config_version,
    status, provisioning_status, provisioning_error, provisioned_at, created_at, updated_at
)
SELECT
    id, course_id, experiment_code, name, repository, report_mode, config_version,
    status, provisioning_status, provisioning_error, provisioned_at, created_at, updated_at
FROM experiments;

-- 删除旧表并重命名新表
DROP TABLE experiments;
ALTER TABLE experiments_new RENAME TO experiments;

-- 重建索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_experiments_repo_unique ON experiments(repository) WHERE repository IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiments_repo ON experiments(repository);
CREATE INDEX IF NOT EXISTS idx_experiments_course ON experiments(course_id);

COMMIT;

-- 4. 為了向後相容性，實驗 provisioning 表格保持不變（仍記錄實際 provision 的 repository）
-- 無需變更 experiment_provisionings

-- 5. 增加說明：在 course 模式下，實際的儲存庫路徑為：{course.github_repository}/experiments/{experiment.experiment_code}/
--    在 experiment 模式下，實際的儲存庫路徑為：{experiment.repository}/（根目錄）
--    Workspace Service 將統一解析此邏輯。

-- 6. 更新說明：existing experiments 在 experiment 模式下保持原有 repository 值不變。
--    新建 course 模式課程時，將設定 course.github_repository 並將新實驗的 repository 設為 NULL。