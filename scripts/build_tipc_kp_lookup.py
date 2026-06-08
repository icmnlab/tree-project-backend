"""Build TIPC K_sp lookup table from `database/initial_data/tree_survey_data.csv`.

Methodology:
  TIPC carbon_storage = round(K_sp · DBH_cm² · H_m, 2) [kg CO₂]
  K_sp = F · (π/4) · BEF · (1+R) · CF · (44/12) · 0.1 · D_wood

Constants from 林業署森林碳匯調查與監測手冊式 6-4 / 環境部 AR-TMS0001:
  F          = 0.45 (broadleaf) | 0.50 (conifer)   stem form factor
  π/4 ≈ 0.79  cross-section coefficient (cylinder)
  BEF        = 1.40                                biomass expansion factor
  R          = 0.24                                root-to-shoot ratio
  CF         = 0.4691                              carbon fraction
  44/12 ≈ 3.667                                    CO₂/C molar mass ratio
  0.1                                              unit conversion (cm² m → m³ kg)
  D_wood     = species-specific basic specific gravity (oven-dry / green volume)

Per-species K_sp is determined by: for each row, the K consistent with rounded
storage value lies in [(s−0.005)/(D²·H), (s+0.005)/(D²·H)]. The intersection of
these intervals across all rows of a species yields the single TIPC K_sp.

Output: `backend/data/tipc_kp_lookup.json`
"""

from __future__ import annotations

import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "dev-fixtures" / "tree_survey_data.csv"
OUT_PATH = ROOT / "data" / "tipc_kp_lookup.json"
DART_OUT_PATH = (
    ROOT.parent
    / "frontend"
    / "lib"
    / "services"
    / "generated"
    / "tipc_kp_lookup.g.dart"
)

# AR-TMS0001 / 林業署手冊式 6-4 常數
F_BROADLEAF = 0.45
F_CONIFER = 0.50
PI_OVER_4 = 0.79  # TIPC uses this rounded value (verified by reverse engineering)
BEF = 1.40
R = 0.24
CF = 0.4691
CO2_C = 44.0 / 12.0
UNIT = 0.1

NON_DWOOD_FACTOR = PI_OVER_4 * BEF * (1 + R) * CF * CO2_C * UNIT
# = 0.235893333...
COEF_BROADLEAF = F_BROADLEAF * NON_DWOOD_FACTOR  # ≈ 0.106152
COEF_CONIFER = F_CONIFER * NON_DWOOD_FACTOR      # ≈ 0.117946

DEFAULT_DWOOD = 0.530  # TIPC platform default for unidentified species

# Conifer list (Taiwan urban-tree taxa observed in CSV; matched by name)
CONIFER_NAMES = {
    "肯氏南洋杉", "小葉南洋杉", "龍柏", "黑松", "臺灣杉", "台灣杉",
    "紅檜", "臺灣肖楠", "台灣肖楠", "落羽松", "柳杉",
    "臺灣五葉松", "台灣五葉松", "華山松", "琉球松",
    "羅漢松", "蘭嶼羅漢松", "圓柏", "刺柏",
}


def is_conifer(name: str) -> bool:
    return name in CONIFER_NAMES


def load_rows():
    rows = []
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                d = float(r["dbh_cm"])
                h = float(r["tree_height_m"])
                s_str = r["carbon_storage"]
                s = float(s_str)
            except (ValueError, KeyError):
                continue
            if d > 0 and h > 0 and s > 0:
                rows.append(
                    {
                        "sp": (r["species_name"] or "").strip(),
                        "d": d,
                        "h": h,
                        "s": s,
                        "s_str": s_str,
                    }
                )
    return rows


def solve_species_k(rs: list[dict]) -> tuple[float | None, float, float, int]:
    """Return (k_sp, max_lo, min_hi, n) — k_sp is None if interval is empty."""
    los = [(r["s"] - 0.005) / (r["d"] ** 2 * r["h"]) for r in rs]
    his = [(r["s"] + 0.005) / (r["d"] ** 2 * r["h"]) for r in rs]
    max_lo = max(los)
    min_hi = min(his)
    if max_lo <= min_hi:
        return (max_lo + min_hi) / 2.0, max_lo, min_hi, len(rs)
    return None, max_lo, min_hi, len(rs)


def build_lookup(rows):
    by_sp: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["sp"]:
            by_sp[r["sp"]].append(r)

    species_entries: dict[str, dict] = {}
    for sp, rs in sorted(by_sp.items(), key=lambda kv: -len(kv[1])):
        k, lo, hi, n = solve_species_k(rs)
        coni = is_conifer(sp)
        f = F_CONIFER if coni else F_BROADLEAF
        coef = COEF_CONIFER if coni else COEF_BROADLEAF

        if k is not None:
            d_wood = k / coef
            # If implied D_wood is suspiciously close to TIPC default 0.530, mark as default
            uses_default = abs(d_wood - DEFAULT_DWOOD) < 0.001
            source = (
                "tipc_default_0.530"
                if uses_default
                else "tipc_reverse_engineered"
            )
            species_entries[sp] = {
                "K_sp": round(k, 7),
                "F": f,
                "D_wood": round(d_wood, 4),
                "n_samples": n,
                "source": source,
                "interval": [round(lo, 7), round(hi, 7)],
            }
        else:
            # Single K does not fit → use median K as best estimate and flag
            ks = [r["s"] / (r["d"] ** 2 * r["h"]) for r in rs]
            k_med = statistics.median(ks)
            species_entries[sp] = {
                "K_sp": round(k_med, 7),
                "F": f,
                "D_wood": round(k_med / coef, 4),
                "n_samples": n,
                "source": "tipc_non_uniform_median",
                "interval": [round(lo, 7), round(hi, 7)],
            }

    return species_entries


def sanity_check(rows, species_entries):
    fallback_broad = round(COEF_BROADLEAF * DEFAULT_DWOOD, 7)  # 0.0562420
    fallback_coni = round(COEF_CONIFER * DEFAULT_DWOOD, 7)
    matches_strict = 0  # |predicted − actual| < 0.005
    matches_loose = 0   # |predicted − actual| < 0.01
    by_source = defaultdict(lambda: [0, 0])
    for r in rows:
        sp = r["sp"]
        entry = species_entries.get(sp)
        if entry:
            k = entry["K_sp"]
            src = entry["source"]
        else:
            k = fallback_coni if is_conifer(sp) else fallback_broad
            src = "default_fallback"
        pred = round(k * r["d"] ** 2 * r["h"], 2)
        diff = abs(pred - r["s"])
        by_source[src][1] += 1
        if diff < 0.005:
            matches_strict += 1
            by_source[src][0] += 1
        if diff < 0.01:
            matches_loose += 1
    return {
        "total": len(rows),
        "match_strict_<0.005kg": matches_strict,
        "match_loose_<0.01kg": matches_loose,
        "by_source": {
            src: {"matched": m, "total": t, "rate": round(m / t * 100, 2)}
            for src, (m, t) in by_source.items()
        },
    }


def main():
    rows = load_rows()
    print(f"Loaded {len(rows)} valid rows from {CSV_PATH.name}")
    species_entries = build_lookup(rows)
    print(f"Solved K_sp for {len(species_entries)} species")

    report = sanity_check(rows, species_entries)
    print("\n=== Sanity check ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))

    payload = {
        "_meta": {
            "description": "TIPC carbon_storage K_sp lookup (kg CO₂ per DBH²·H).",
            "formula": "carbon_storage_kg = round(K_sp · DBH_cm² · H_m, 2)",
            "K_decomposition": "K_sp = F · (π/4) · BEF · (1+R) · CF · (44/12) · 0.1 · D_wood",
            "constants": {
                "F_broadleaf": F_BROADLEAF,
                "F_conifer": F_CONIFER,
                "pi_over_4": PI_OVER_4,
                "BEF": BEF,
                "R": R,
                "CF": CF,
                "CO2_per_C": round(CO2_C, 4),
                "unit_factor": UNIT,
                "default_D_wood": DEFAULT_DWOOD,
            },
            "coefficient_broadleaf_x_Dwood": round(COEF_BROADLEAF, 7),
            "coefficient_conifer_x_Dwood": round(COEF_CONIFER, 7),
            "default_K_broadleaf": round(COEF_BROADLEAF * DEFAULT_DWOOD, 7),
            "default_K_conifer": round(COEF_CONIFER * DEFAULT_DWOOD, 7),
            "source_definitions": {
                "tipc_reverse_engineered": "Single K_sp fits all CSV rows within rounding tolerance (±0.005 kg).",
                "tipc_default_0.530": "Implied D_wood within 0.001 of TIPC platform default 0.530.",
                "tipc_non_uniform_median": "No single K fits all rows; median K used (rare; investigate).",
                "default_fallback": "Species not in CSV; runtime falls back to broadleaf/conifer default K.",
            },
            "references": [
                "環境部 (2023). 溫室氣體減量方法學 AR-TMS0001 造林與植林碳匯專案",
                "農業部林業及自然保育署 (2024). 森林碳匯調查與監測手冊, 表 6-4",
            ],
            "build_script": "backend/scripts/build_tipc_kp_lookup.py",
            "csv_source": "database/initial_data/tree_survey_data.csv",
            "validation": report,
        },
        "default_broadleaf": {
            "K_sp": round(COEF_BROADLEAF * DEFAULT_DWOOD, 7),
            "F": F_BROADLEAF,
            "D_wood": DEFAULT_DWOOD,
            "source": "tipc_default_0.530",
        },
        "default_conifer": {
            "K_sp": round(COEF_CONIFER * DEFAULT_DWOOD, 7),
            "F": F_CONIFER,
            "D_wood": DEFAULT_DWOOD,
            "source": "tipc_default_0.530",
        },
        "species": species_entries,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nWrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes)")

    write_dart(species_entries, report)


def write_dart(species_entries: dict, report: dict) -> None:
    """Emit a Dart constant file mirroring the JSON for offline frontend use."""
    lines = [
        "// GENERATED FILE - DO NOT EDIT.",
        "// Source: backend/scripts/build_tipc_kp_lookup.py",
        "// Origin: backend/database/initial_data/tree_survey_data.csv",
        "// Formula: carbon_storage_kg = round(K_sp · DBH_cm² · H_m, 2)",
        "// Reference: 環境部 AR-TMS0001 / 林業署森林碳匯調查與監測手冊式 6-4",
        "",
        "/// TIPC species K_sp coefficient (kg CO₂ per cm² · m).",
        "class TipcKspEntry {",
        "  final double kSp;",
        "  final double f;",
        "  final double dWood;",
        "  final int nSamples;",
        "  final String source;",
        "  const TipcKspEntry({",
        "    required this.kSp,",
        "    required this.f,",
        "    required this.dWood,",
        "    required this.nSamples,",
        "    required this.source,",
        "  });",
        "}",
        "",
        f"const double kTipcDefaultKspBroadleaf = {round(COEF_BROADLEAF * DEFAULT_DWOOD, 7)};",
        f"const double kTipcDefaultKspConifer   = {round(COEF_CONIFER * DEFAULT_DWOOD, 7)};",
        f"const double kTipcDefaultDWood        = {DEFAULT_DWOOD};",
        f"const double kTipcFBroadleaf          = {F_BROADLEAF};",
        f"const double kTipcFConifer            = {F_CONIFER};",
        "",
        "const Set<String> kTipcConiferNames = {",
    ]
    for n in sorted(CONIFER_NAMES):
        lines.append(f"  '{n}',")
    lines.append("};")
    lines.append("")
    lines.append(
        f"/// Sanity check at build time: strict match {report['match_strict_<0.005kg']}/{report['total']} "
        f"(<0.005 kg), loose match {report['match_loose_<0.01kg']}/{report['total']} (<0.01 kg)."
    )
    lines.append("const Map<String, TipcKspEntry> kTipcKspLookup = {")
    # Sort by sample count descending for readability
    for sp, v in sorted(
        species_entries.items(), key=lambda kv: -kv[1]["n_samples"]
    ):
        sp_escaped = sp.replace("'", r"\'")
        lines.append(
            f"  '{sp_escaped}': TipcKspEntry(kSp: {v['K_sp']}, f: {v['F']}, "
            f"dWood: {v['D_wood']}, nSamples: {v['n_samples']}, source: '{v['source']}'),"
        )
    lines.append("};")
    lines.append("")

    DART_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    DART_OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {DART_OUT_PATH} ({DART_OUT_PATH.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
