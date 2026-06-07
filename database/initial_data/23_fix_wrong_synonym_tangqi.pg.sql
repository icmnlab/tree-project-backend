-- 移除錯誤同義詞：糖槭（楓樹 Acer）≠ 九丁榕（Ficus）
-- 此筆會導致 Pl@ntNet/俗名「糖槭」誤匹配到 tree_species id=0002
DELETE FROM species_synonyms
WHERE canonical_species_id = '0002' AND variant_name = '糖槭';
