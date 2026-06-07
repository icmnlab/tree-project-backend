-- Migration 22: 移除已廢棄的 RAG / 舊碳匯表（migrate 已不再建立）
-- 安全：IF EXISTS；若表內仍有資料請先備份再套用

DROP TABLE IF EXISTS tree_knowledge_embeddings_v2 CASCADE;
DROP TABLE IF EXISTS tree_knowledge_embeddings CASCADE;
DROP TABLE IF EXISTS tree_carbon_data CASCADE;
DROP TABLE IF EXISTS species_region_score CASCADE;
DROP TABLE IF EXISTS emission_factors CASCADE;
