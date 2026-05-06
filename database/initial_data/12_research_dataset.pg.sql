-- [Research] 研究用 DBH 校準資料集
-- 由管理員透過「研究資料蒐集」頁手動建立，與 production tree_survey 完全隔離。
-- 用途：
--   1. 收集「捲尺實測周長 + 拍攝距離 + 1~3 張手機照」的乾淨樣本
--   2. 用於 (a) 距離偏差線性校正 α,β 擬合；(b) leakage-free 評估集
-- 設計重點：
--   * circumference_cm 是現場捲尺量測的「樹幹周長」(cm)，於 1.3m 高度繞一圈
--   * true_dbh_cm = circumference_cm / π 由 generated column 自動計算，避免人為輸入誤差
--   * photos 直接存 Cloudinary URL 陣列（reuse cloudinaryService），最多 3 張
--   * evidence_photo_url 存「捲尺貼在樹幹上、可看出讀數」的證據照
--   * 不放 FK 到 tree_survey / users（除 created_by 軟引用），避免污染 production schema

CREATE TABLE IF NOT EXISTS research_dataset (
    id SERIAL PRIMARY KEY,
    tree_id TEXT NOT NULL,                                          -- 使用者命名的樹編號（如 "NDHU-001"）
    circumference_cm REAL NOT NULL CHECK (circumference_cm > 0),    -- 捲尺實測周長 (cm)
    true_dbh_cm REAL GENERATED ALWAYS AS (circumference_cm / 3.141592653589793) STORED,
    capture_distance_m REAL NOT NULL CHECK (capture_distance_m > 0),-- 拍攝距離 (m)
    species TEXT,                                                   -- 樹種（中文/學名皆可）
    phone_model TEXT,                                               -- 拍攝手機型號（device_info_plus 自動）
    focal_length_px REAL,                                           -- 焦距 (px)，由 EXIF / 校準推得
    image_width_px INTEGER,                                         -- 拍攝原圖寬（px）
    image_height_px INTEGER,                                        -- 拍攝原圖高（px）
    gps_lat DOUBLE PRECISION,
    gps_lng DOUBLE PRECISION,
    notes TEXT,                                                     -- 任意備註（光線/葉幕/地形…）
    photo_urls TEXT[] NOT NULL DEFAULT '{}',                        -- Cloudinary 主照 URL（1~3 張）
    evidence_photo_url TEXT,                                        -- Cloudinary 證據照 URL
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by INTEGER                                              -- users.id（軟引用，刪用戶不影響資料）
);

CREATE INDEX IF NOT EXISTS idx_research_dataset_created_at
    ON research_dataset (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_dataset_tree_id
    ON research_dataset (tree_id);
