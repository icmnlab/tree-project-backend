-- ============================================================
-- 樹木影像資料表（2NF 正規化版本）— 冪等遷移腳本
-- ============================================================
-- 同時處理：
--   A) 全新安裝：直接建立 2NF 結構
--   B) 舊表遷移：從 tree_survey_id/pending_measurement_id 遷移到 owner_type/owner_id
-- ============================================================

-- Step 1: 建立表格（全新安裝時使用）
CREATE TABLE IF NOT EXISTS tree_images (
    id SERIAL PRIMARY KEY,
    
    -- 2NF 多型關聯（取代原本兩個 nullable FK）
    owner_type VARCHAR(20) NOT NULL,   -- 'survey' | 'pending'
    owner_id   INTEGER     NOT NULL,   -- 對應 tree_survey.id 或 pending_tree_measurements.id
    
    -- 影像類型
    image_type VARCHAR(50) NOT NULL,   -- 'overview', 'trunk', 'leaf', 'fruit', 'flower', 'bark', 'damage', 'other'
    
    -- 雲端儲存路徑
    cloud_url       TEXT,              -- Cloudinary secure_url
    cloud_public_id VARCHAR(255),      -- Cloudinary public_id（用於刪除）
    thumbnail_url   TEXT,              -- Cloudinary 動態縮圖 URL
    storage_type    VARCHAR(20) DEFAULT 'cloudinary', -- 'cloudinary', 'local'(legacy)
    
    -- 時間戳記
    captured_at TIMESTAMP,             -- 拍攝時間
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 上傳時間
    
    -- 元數據 (JSONB)
    metadata JSONB DEFAULT '{}',

    -- 可選：對應某一次量測歷史 tree_survey_measurements.id（軟連結，無硬 FK）
    measurement_id BIGINT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: 若舊表存在（有 tree_survey_id 欄位），執行遷移
DO $$ BEGIN
  -- 偵測舊 schema
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tree_images' AND column_name = 'tree_survey_id'
  ) THEN
    RAISE NOTICE '[tree_images] Detected old schema — migrating to 2NF...';

    -- 2a. 新增 2NF 欄位（若尚未存在）
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS owner_type VARCHAR(20);
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS owner_id INTEGER;
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS cloud_url TEXT;
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS cloud_public_id VARCHAR(255);
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS storage_type VARCHAR(20) DEFAULT 'cloudinary';
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP;
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE tree_images ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

    -- 2b. 遷移資料
    UPDATE tree_images SET owner_type = 'survey',  owner_id = tree_survey_id
      WHERE tree_survey_id IS NOT NULL AND owner_type IS NULL;

    UPDATE tree_images SET owner_type = 'pending', owner_id = pending_measurement_id
      WHERE pending_measurement_id IS NOT NULL AND owner_type IS NULL;

    UPDATE tree_images SET owner_type = 'unknown', owner_id = 0
      WHERE owner_type IS NULL;

    -- 2c. 複製 image_path → cloud_url
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tree_images' AND column_name = 'image_path'
    ) THEN
      UPDATE tree_images SET cloud_url = image_path
        WHERE cloud_url IS NULL AND image_path IS NOT NULL;
    END IF;

    -- 2d. 設定 NOT NULL（只在無 NULL 值時）
    IF NOT EXISTS (SELECT 1 FROM tree_images WHERE owner_type IS NULL LIMIT 1) THEN
      ALTER TABLE tree_images ALTER COLUMN owner_type SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tree_images WHERE owner_id IS NULL LIMIT 1) THEN
      ALTER TABLE tree_images ALTER COLUMN owner_id SET NOT NULL;
    END IF;

    -- 2e. 移除舊欄位
    ALTER TABLE tree_images DROP COLUMN IF EXISTS tree_survey_id;
    ALTER TABLE tree_images DROP COLUMN IF EXISTS pending_measurement_id;
    ALTER TABLE tree_images DROP COLUMN IF EXISTS image_path;
    ALTER TABLE tree_images DROP COLUMN IF EXISTS thumbnail_path;

    -- 2f. 移除舊索引
    DROP INDEX IF EXISTS idx_tree_images_survey_id;
    DROP INDEX IF EXISTS idx_tree_images_pending_id;

    RAISE NOTICE '[tree_images] Migration to 2NF complete.';
  ELSE
    RAISE NOTICE '[tree_images] Already using 2NF schema — no migration needed.';
  END IF;
END $$;

-- Step 3: 建立索引（冪等）
CREATE INDEX IF NOT EXISTS idx_tree_images_owner ON tree_images(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_tree_images_type ON tree_images(image_type);
CREATE INDEX IF NOT EXISTS idx_tree_images_cloud_public_id ON tree_images(cloud_public_id);
CREATE INDEX IF NOT EXISTS idx_tree_images_measurement ON tree_images(measurement_id);

-- Step 4: 觸發器
CREATE OR REPLACE FUNCTION update_tree_images_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_tree_images_updated_at ON tree_images;
CREATE TRIGGER trigger_update_tree_images_updated_at
    BEFORE UPDATE ON tree_images
    FOR EACH ROW
    EXECUTE FUNCTION update_tree_images_updated_at();
