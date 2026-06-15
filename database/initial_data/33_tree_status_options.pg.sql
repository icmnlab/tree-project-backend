-- ============================================================
-- 33_tree_status_options.pg.sql
-- 樹況選項目錄（可共享、可自訂） + 狀況→生命週期對照
-- ============================================================
-- 目的：
--   1. 提供「新增／維護量測」表單的樹況下拉選單（內建 + 使用者自訂）。
--   2. 使用者自訂的新狀況寫入此表後，其他使用者也能於日後選用（共享）。
--   3. 每個狀況對應一個 lifecycle（active|dead|fallen|removed），
--      「是否存活（活立木）」依此判定——依政府「活立木生物量法」
--      （環境部 AR-TMS0001、林業署森林碳匯調查與監測手冊 表6-4）：
--      枯立木／枯死／倒塌／移除 = 非活立木，不計入活立木碳儲量總計。
--
-- 正規化（2NF/3NF）：
--   - 代理主鍵 id（SERIAL）；name 為候選鍵（UNIQUE）。
--   - 所有非鍵欄位（lifecycle/is_builtin/created_by/sort_order/created_at）
--     皆完全相依於主鍵；lifecycle 相依於候選鍵 name，屬合法相依，符合 2NF/3NF。
--   - tree_survey.status 維持文字快照（沿用既有反正規化快取策略），
--     此表為「選單與語意來源」，不強制 FK 以相容歷史自由文字。
-- ============================================================

CREATE TABLE IF NOT EXISTS tree_status_options (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL,
    lifecycle   VARCHAR(20)  NOT NULL DEFAULT 'active'
                CHECK (lifecycle IN ('active', 'dead', 'fallen', 'removed')),
    is_builtin  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,   -- 軟停用（不刪資料，避免破壞歷史引用）
    created_by  INTEGER,                              -- 自訂者 user id（內建為 NULL）
    sort_order  INTEGER      NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- name 唯一（大小寫/前後空白已於應用層 trim）；多人同時新增同名靠此約束 + ON CONFLICT 收斂
CREATE UNIQUE INDEX IF NOT EXISTS uq_tree_status_options_name ON tree_status_options(name);
CREATE INDEX IF NOT EXISTS idx_tree_status_options_active ON tree_status_options(is_active, sort_order);

COMMENT ON TABLE  tree_status_options          IS '樹況選單目錄（內建+自訂可共享）；lifecycle 決定是否為活立木';
COMMENT ON COLUMN tree_status_options.lifecycle IS 'active=活立木；dead=枯死/枯立木；fallen=倒塌；removed=移除（非活立木不計活立木碳匯）';
COMMENT ON COLUMN tree_status_options.is_builtin IS 'TRUE=系統內建（不可刪除，可軟停用）';
COMMENT ON COLUMN tree_status_options.is_active  IS 'FALSE=軟停用（不再出現於新選單，仍保留歷史語意）';
COMMENT ON COLUMN tree_status_options.created_by IS '自訂該狀況的使用者 id；內建為 NULL';

-- 內建狀況種子（參考 tree_survey_data.csv 既有狀況：正常/枯萎/枯立木/傾斜）
-- 是否存活依專業判定：
--   正常/傾斜/病蟲害/枯萎 = 仍為活立木（傾斜為結構性、枯萎為可回復之逆境壓力）→ active
--   枯立木/枯死 = 立枯死木（snag）→ dead；倒塌 → fallen；已移除 → removed
INSERT INTO tree_status_options (name, lifecycle, is_builtin, sort_order) VALUES
    ('正常',   'active',  TRUE, 10),
    ('傾斜',   'active',  TRUE, 20),
    ('病蟲害', 'active',  TRUE, 30),
    ('枯萎',   'active',  TRUE, 40),
    ('枯立木', 'dead',    TRUE, 50),
    ('枯死',   'dead',    TRUE, 60),
    ('倒塌',   'fallen',  TRUE, 70),
    ('已移除', 'removed', TRUE, 80)
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 修正 migration 31 漏網：枯立木（立枯死木）為非活立木，應為 dead
-- （migration 31 僅認「枯死/死亡」，漏掉「枯立木」，導致誤計入活立木碳匯）
-- ------------------------------------------------------------
UPDATE tree_survey
   SET lifecycle_status = 'dead',
       retired_at     = COALESCE(retired_at, updated_at, CURRENT_TIMESTAMP),
       retired_reason = COALESCE(retired_reason, status)
 WHERE lifecycle_status = 'active'
   AND status IS NOT NULL
   AND status LIKE '%枯立%';
