#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
從《森林碳匯調查與監測手冊》第六章表 6-2、6-3 建立 coa_volume_equations.json。
資料來源：COA_森林碳匯手冊.pdf 第六章（與林務局 1995 材積式彙整表）。

執行:
  python backend/scripts/build_coa_volume_equations.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "coa_volume_equations.json"


def entry(
    eid: str,
    species_labels: list[str],
    *,
    table: str,
    eq_type: str,
    reference: str,
    region: str = "全臺",
    priority: int = 50,
    **coeffs,
):
    row = {
        "id": eid,
        "species_labels": species_labels,
        "table": table,
        "region": region,
        "type": eq_type,
        "reference": reference,
        "priority": priority,
    }
    row.update(coeffs)
    return row


# fmt: off
ENTRIES = [
    # ---------- 表 6-2 針葉樹 — power（全臺優先）----------
    entry("t62_柳杉", ["柳杉"], table="6-2", eq_type="power",
          a=5.979663e-5, b=1.8753322, c=0.9740340, reference="表6-2 柳杉 全臺", priority=10),
    entry("t62_二葉松", ["二葉松"], table="6-2", eq_type="power",
          a=1.547675e-4, b=1.700988, c=0.721114, reference="表6-2 二葉松 全臺", priority=10),
    entry("t62_松類組", ["松類", "濕地松", "琉球松"], table="6-2", eq_type="power",
          a=0.0001430, b=1.7009164, c=0.7410436,
          reference="表6-2 松類/濕地松/琉球松 全臺(林相變更20年以下)", priority=12),
    entry("t62_其他松類", ["其他松類"], table="6-2", eq_type="power",
          a=0.0000625, b=1.77924, c=1.05866, reference="表6-2 其他松類 全臺", priority=15),
    entry("t62_鐵杉", ["鐵杉"], table="6-2", eq_type="power",
          a=0.0000728, b=1.944924, c=0.800221, reference="表6-2 鐵杉 全臺", priority=10),
    entry("t62_臺灣杉", ["臺灣杉", "台灣杉"], table="6-2", eq_type="power",
          a=0.0000944, b=1.994741, c=0.656961, reference="表6-2 臺灣杉 全臺", priority=10),
    entry("t62_young_conifer_mix", ["臺灣杉", "杉木", "香杉", "柳杉"], table="6-2", eq_type="power",
          a=0.0000702, b=1.8942224, c=0.8869654,
          reference="表6-2 臺灣杉/杉木/香杉/柳杉 全臺(林相變更20年以下)", priority=20),
    entry("t62_紅檜young", ["紅檜", "臺灣杉", "臺灣肖楠", "台灣肖楠"], table="6-2", eq_type="power",
          a=0.0000996, b=1.8505211, c=0.7734288,
          reference="表6-2 紅檜/臺灣杉/臺灣肖楠 全臺(林相變更20年以下)", priority=25),
    entry("t62_紅檜_大雪山", ["紅檜"], table="6-2", eq_type="power", region="大雪山",
          a=0.00010092, b=1.541061, c=1.155141, reference="表6-2 紅檜 大雪山", priority=5),
    entry("t62_其他針葉_log", ["其他針葉樹", "其他針葉"], table="6-2", eq_type="log_d_h",
          a=-3.4692, b=2.0052, c=0.5598, v_times_10=True,
          reference="表6-2 其他針葉樹 全臺 log(V×10)", priority=40),
    entry("t62_柳杉_logd2h", ["柳杉"], table="6-2", eq_type="log_d2h",
          a=-4.193148, b=0.933828, reference="表6-2 柳杉 臺大實驗林 logV-log(D²H)", priority=35),
    # 針葉 — 區域二次式（僅 D，手冊常見）
    entry("t62_紅檜扁柏_北", ["紅檜", "扁柏", "黃檜"], table="6-2", eq_type="quadratic", region="北部",
          a=1.1439, b=-0.0455, c=0.0014, reference="表6-2 紅檜/扁柏 北部", priority=30),
    entry("t62_紅檜扁柏_中", ["紅檜", "扁柏", "黃檜"], table="6-2", eq_type="quadratic", region="中部",
          a=-0.7640, b=0.015717, c=0.000655, reference="表6-2 紅檜/扁柏 中部", priority=30),
    entry("t62_紅檜扁柏_南", ["紅檜", "扁柏", "黃檜"], table="6-2", eq_type="quadratic", region="南部",
          a=-0.5977, b=0.009593, c=0.000735, reference="表6-2 紅檜/扁柏 南部", priority=30),
    entry("t62_松類_北", ["松類", "黑松", "琉球松", "濕地松", "二葉松", "華山松", "臺灣五葉松", "台灣五葉松"],
          table="6-2", eq_type="quadratic", region="北部",
          a=0.4564, b=-0.0396, c=0.0013, reference="表6-2 松類 北部", priority=32),
    entry("t62_松類_中", ["松類", "黑松", "琉球松", "濕地松", "二葉松"],
          table="6-2", eq_type="quadratic", region="中部",
          a=0.3877, b=-0.027164, c=0.000919, reference="表6-2 松類 中部", priority=32),
    entry("t62_松類_南", ["松類", "黑松", "琉球松", "濕地松", "二葉松"],
          table="6-2", eq_type="quadratic", region="南部",
          a=0.4092, b=-0.027500, c=0.000920, reference="表6-2 松類 南部", priority=32),
    entry("t62_冷杉_北", ["冷杉"], table="6-2", eq_type="quadratic", region="北部",
          a=-0.5066, b=0.005367, c=0.000696, reference="表6-2 冷杉 北部", priority=35),
    entry("t62_雲杉_中", ["雲杉"], table="6-2", eq_type="quadratic", region="中部",
          a=-0.694737, b=0.006194, c=0.000834, reference="表6-2 雲杉 中部", priority=35),
    entry("t62_雲杉_南", ["雲杉"], table="6-2", eq_type="quadratic", region="南部",
          a=-0.735678, b=0.006270, c=0.000828, reference="表6-2 雲杉 南部", priority=35),
    entry("t62_杉木_1", ["杉木"], table="6-2", eq_type="quadratic", region="全臺",
          a=-1.0731, b=0.021053, c=0.000797, reference="表6-2 杉木", priority=35),
    entry("t62_香杉_logd", ["香杉"], table="6-2", eq_type="log_d",
          a=-3.72573, b=2.37078, reference="表6-2 香杉 中埔 LogV-LogD", priority=38),
    # ---------- 表 6-3 闘葉樹 — power ----------
    entry("t63_樟樹", ["樟樹"], table="6-3", eq_type="power",
          a=0.0000489823, b=1.60450, c=1.25502, reference="表6-3 樟樹 全臺", priority=10),
    entry("t63_相思", ["相思樹", "相思"], table="6-3", eq_type="power",
          a=0.0002045, b=1.4366684, c=0.8480426, reference="表6-3 相思樹", priority=10),
    entry("t63_光臘樹", ["光臘樹"], table="6-3", eq_type="power",
          a=0.0000772, b=1.8780277, c=0.8124601, reference="表6-3 光臘樹 東部/南部", priority=12),
    entry("t63_桂竹", ["桂竹"], table="6-3", eq_type="power",
          a=26.032, b=1.5777, c=1.1237, reference="表6-3 桂竹 中/南部", priority=10),
    entry("t63_楠樟young", ["楠木", "樟樹", "楠木類"], table="6-3", eq_type="power",
          a=0.0000464, b=1.53575, c=1.50657,
          reference="表6-3 楠木/樟樹 全臺(林相變更20年以下)", priority=18),
    entry("t63_闘葉young_mix", [
        "赤楊", "摩鹿加合歡", "泡桐", "桉樹", "柚木", "楓香", "臺灣櫸", "台灣櫸",
        "大葉桃花心木", "木油桐", "銀合歡",
    ], table="6-3", eq_type="power",
          a=0.0000834, b=1.8761885, c=0.8058127,
          reference="表6-3 多種闘葉 全臺(林相變更20年以下)", priority=25),
    entry("t63_其他闘葉_power", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="power",
          a=0.0000862, b=1.8742, c=0.8671, reference="表6-3 其他闘葉樹 power", priority=45),
    entry("t63_楠木_dh", ["楠木", "楠木類"], table="6-3", eq_type="linear_dh",
          a=0.0000853, reference="表6-3 楠木類 V=0.0000853·D·H", priority=15),
    entry("t63_木油桐_log", ["木油桐"], table="6-3", eq_type="log_d_h",
          a=-4.109545, b=1.770289, c=0.982390, reference="表6-3 木油桐 log", priority=30),
    entry("t63_櫧櫟_log", ["櫧櫟", "櫧櫟類", "楠木", "樟樹"], table="6-3", eq_type="log_d_h",
          a=-4.0038576, b=1.8751297, c=0.745544, reference="表6-3 櫧櫟類 全臺 LogV", priority=28),
    # 大葉桃花心木 — 區域 DH 式
    entry("t63_桃花心木_中埔", ["大葉桃花心木"], table="6-3", eq_type="quadratic_dh", region="中埔",
          a=0.0100, b=-0.00871296, c=0.00060626, d=0.00047815,
          reference="表6-3 大葉桃花心木 中埔", priority=8),
    entry("t63_桃花心木_六龜", ["大葉桃花心木"], table="6-3", eq_type="quadratic_dh", region="六龜",
          a=0.0101, b=-0.00679346, c=0.00058996, d=0.00033654,
          reference="表6-3 大葉桃花心木 六龜", priority=8),
    entry("t63_桃花心木_恆春", ["大葉桃花心木"], table="6-3", eq_type="quadratic_dh", region="恆春",
          a=0.0096, b=-0.00850270, c=0.00028041, d=0.00086209,
          reference="表6-3 大葉桃花心木 恆春", priority=8),
    # 其他闘葉樹 — 氣候帶 × 區域（僅 D 二次式，手冊表 6-3）
    entry("t63_ob_熱帶_北", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="北部", climate_zone="熱帶",
          a=0.2262, b=-0.012267, c=0.000596, reference="表6-3 其他闘葉(熱帶)北部", priority=50),
    entry("t63_ob_熱帶_中", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="中部", climate_zone="熱帶",
          a=-0.3721, b=0.007362, c=0.000489, reference="表6-3 其他闘葉(熱帶)中部", priority=50),
    entry("t63_ob_熱帶_南", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="南部", climate_zone="熱帶",
          a=-0.3159, b=0.006255, c=0.000505, reference="表6-3 其他闘葉(熱帶)南部", priority=50),
    entry("t63_ob_亞熱帶_北", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="北部", climate_zone="亞熱帶",
          a=0.2072, b=-0.013181, c=0.000642, reference="表6-3 其他闘葉(亞熱帶)北部", priority=50),
    entry("t63_ob_亞熱帶_中", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="中部", climate_zone="亞熱帶",
          a=-1.5211, b=0.053, c=0.000177, reference="表6-3 其他闘葉(亞熱帶)中部", priority=50),
    entry("t63_ob_亞熱帶_南", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="南部", climate_zone="亞熱帶",
          a=-0.2675, b=0.005054, c=0.000507, reference="表6-3 其他闘葉(亞熱帶)南部", priority=50),
    entry("t63_ob_溫帶_北", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="北部", climate_zone="溫帶",
          a=0.0038, b=-0.013205, c=0.000639, reference="表6-3 其他闘葉(溫帶)北部", priority=50),
    entry("t63_ob_溫帶_中", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="中部", climate_zone="溫帶",
          a=-1.4719, b=0.052453, c=0.000119, reference="表6-3 其他闘葉(溫帶)中部", priority=50),
    entry("t63_ob_溫帶_南", ["其他闘葉樹", "其他闘葉"], table="6-3", eq_type="quadratic",
          region="南部", climate_zone="溫帶",
          a=-1.1744, b=0.03820, c=0.000270, reference="表6-3 其他闘葉(溫帶)南部", priority=50),
    # 樟楠/櫧櫟 分區二次式（摘錄）
    entry("t63_樟楠_熱帶_北", ["樟樹", "楠木", "楠木類"], table="6-3", eq_type="quadratic",
          region="北部", climate_zone="熱帶",
          a=-0.309942, b=0.004553, c=0.000505, reference="表6-3 楠木樟樹(熱帶)北部", priority=42),
    entry("t63_樟楠_亞熱帶_北", ["樟樹", "楠木", "楠木類"], table="6-3", eq_type="quadratic",
          region="北部", climate_zone="亞熱帶",
          a=0.75894, b=-0.039825, c=0.000833, reference="表6-3 楠木樟樹(亞熱帶)北部", priority=42),
]
# fmt: on

try:
    from coa_handbook_entries_ext import ENTRIES_EXT
except ImportError:
    from scripts.coa_handbook_entries_ext import ENTRIES_EXT  # type: ignore

ALL_ENTRIES = ENTRIES + ENTRIES_EXT

# 去重：同 id 保留先出現者（基礎 ENTRIES 優先）
_seen = set()
DEDUPED_ENTRIES = []
for _e in ALL_ENTRIES:
    if _e["id"] in _seen:
        continue
    _seen.add(_e["id"])
    DEDUPED_ENTRIES.append(_e)

CONIFER_LABELS = sorted(
    {
        lbl
        for e in DEDUPED_ENTRIES
        if e["table"] == "6-2"
        for lbl in e["species_labels"]
    }
)

BAMBOO_LABELS = ["桂竹", "孟宗竹", "綠竹", "毛竹"]


def main():
    doc = {
        "_meta": {
            "source": "農業部林業及自然保育署《森林碳匯調查與監測手冊》表6-2、6-3",
            "pdf": "COA_森林碳匯手冊.pdf 第六章",
            "equation_count": len(DEDUPED_ENTRIES),
            "dbh_unit": "cm",
            "height_unit": "m",
            "volume_unit": "m3",
            "fallback": "form_factor",
            "build_script": "backend/scripts/build_coa_volume_equations.py",
        },
        "entries": DEDUPED_ENTRIES,
        "conifer_species_hints": CONIFER_LABELS,
        "bamboo_species_hints": BAMBOO_LABELS,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(DEDUPED_ENTRIES)} entries ({len(ENTRIES)} base + {len(ENTRIES_EXT)} ext) -> {OUT}")


if __name__ == "__main__":
    main()
