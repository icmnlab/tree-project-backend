-- [精簡] 移除無用資料表 / 過時示範資料
--
-- 1) system_settings：建立後從未被任何程式讀寫（原 JWT 過渡期設定已不使用）→ 直接移除。
-- 2) tree_management_actions：清除 2025 匯入的示範資料（created_by = 0），
--    保留資料表結構供未來「AI 管理建議」功能重啟使用。

DROP TABLE IF EXISTS system_settings;

DELETE FROM tree_management_actions WHERE created_by = 0;
