-- 移除錯誤同義詞：糖槭（Acer 槭樹）≠ 九丁榕（Ficus）
-- 來源：PlantNet 低信心辨識 Acer saccharinum 時誤寫入 species_synonyms
DELETE FROM species_synonyms
WHERE canonical_species_id = '0002'
  AND variant_name IN ('糖槭', '银枫树', '水楓', '銀楓樹');

-- 修正 tree_species 0002 學名（九丁榕 ≠ Ficus benjamina 垂葉細葉榕）
UPDATE tree_species
SET scientific_name = 'Ficus nervosa'
WHERE id = '0002'
  AND LOWER(scientific_name) = 'ficus benjamina';
