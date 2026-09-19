-- ========================================================
-- 0005: 實驗儲存庫自動建立狀態 (Repository Provisioning)
-- ========================================================

-- 1. 為 experiments 新增 provisioning 狀態欄位
-- 預設值為 'pending'，已有實驗專案將批次更新為 'ready'
ALTER TABLE experiments ADD COLUMN provisioning_status TEXT NOT NULL DEFAULT 'pending' CHECK(provisioning_status IN ('pending', 'creating', 'ready', 'failed'));
ALTER TABLE experiments ADD COLUMN provisioning_error TEXT;
ALTER TABLE experiments ADD COLUMN provisioned_at DATETIME;

-- 將 Migration 0005 之前已存在之既有實驗儲存庫標記為 ready
UPDATE experiments SET provisioning_status = 'ready', provisioned_at = CURRENT_TIMESTAMP WHERE provisioning_status = 'pending';

-- 2. 建立專門記錄 Provisioning 操作歷程與稽核狀態表
CREATE TABLE IF NOT EXISTS experiment_provisionings (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    repository TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'creating', 'ready', 'failed')),
    error_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exp_prov_exp_id ON experiment_provisionings(experiment_id);
CREATE INDEX IF NOT EXISTS idx_exp_prov_repo ON experiment_provisionings(repository);
