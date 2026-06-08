--
-- tree_management_actions：儲存對特定樹木的「建議管理措施」。
--
-- 現況：此為保留中的功能表（AI 管理建議），目前前端尚無入口、後端保留 API 供未來重啟。
-- 因此本檔改為「冪等建表、不灌示範資料、不破壞性 DROP」，避免每次全新安裝塞入過時 demo。
-- 既有資料庫中殘留的 2025 demo 資料由 migration 25 清除。
--

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_category') THEN
        CREATE TYPE action_category AS ENUM ('健康維護','碳吸存優化','長期規劃');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS tree_management_actions (
  action_id SERIAL PRIMARY KEY,
  tree_id INT NOT NULL,
  category action_category NOT NULL,
  action_text VARCHAR(255) NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  due_date DATE,
  created_by INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE tree_management_actions IS '儲存對特定樹木的建議管理措施（功能保留，前端暫無入口）';
COMMENT ON COLUMN tree_management_actions.tree_id IS '對應的樹木 ID（對應 tree_survey.id）';
COMMENT ON COLUMN tree_management_actions.category IS '操作類別';
COMMENT ON COLUMN tree_management_actions.action_text IS '操作內容描述';
COMMENT ON COLUMN tree_management_actions.is_done IS '是否已完成';
COMMENT ON COLUMN tree_management_actions.due_date IS '預計完成日期';
COMMENT ON COLUMN tree_management_actions.created_by IS '建立此操作的使用者 ID';
