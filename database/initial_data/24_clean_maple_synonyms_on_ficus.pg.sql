-- 清除 九丁榕(0002) 上誤掛的楓樹俗名（Acer 學名與 Ficus 主種不符）
DELETE FROM species_synonyms ss
USING tree_species ts
WHERE ss.canonical_species_id = ts.id
  AND ss.canonical_species_id = '0002'
  AND ss.scientific_name ILIKE 'Acer%'
  AND ts.scientific_name ILIKE 'Ficus%';
