"""
aggregate_benchmark.py
======================
Read every <model>__<mask>__<dist>.json + .csv in benchmark_matrix/
and produce:

  benchmark_matrix/_summary.csv           one row per config (flat)
  benchmark_matrix/_summary.md            paper-friendly table
  benchmark_matrix/_factor_analysis.md    isolate effect of each factor

Usage:
  python aggregate_benchmark.py [--dir benchmark_matrix] [--out-prefix _summary]
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from statistics import mean, median, pstdev


def fmt(v, n=2):
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:.{n}f}"
    return str(v)


def load_summaries(d: Path) -> list[dict]:
    rows = []
    for j in sorted(d.glob("*.json")):
        if j.name.startswith("_"):
            continue
        try:
            data = json.loads(j.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[skip] {j.name}: {e}")
            continue
        # tag convention: <model>__<mask>__<dist>
        tag = data.get("tag") or j.stem
        parts = tag.split("__")
        data["model_key"] = parts[0] if len(parts) >= 1 else "?"
        data["mask_mode"] = parts[1] if len(parts) >= 2 else "?"
        data["dist_mode"] = parts[2] if len(parts) >= 3 else "?"
        rows.append(data)
    return rows


def write_csv(rows: list[dict], path: Path):
    cols = [
        "tag", "model_key", "depth_model", "depth_model_params_m",
        "mask_mode", "dist_mode",
        "n_total", "n_ok", "n_fail",
        "mae_cm", "medae_cm", "rmse_cm", "bias_cm", "mape_pct",
        "within_10pct", "within_20pct",
        "avg_latency_s", "total_wall_s",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def write_master_md(rows: list[dict], path: Path):
    lines = []
    lines.append("# Xiang Benchmark — Master Table\n")
    lines.append("Sorted by MAE ascending. n=294 photos per row unless n_ok < n_total.\n")
    lines.append("")
    lines.append("| Rank | Depth Model | Params (M) | Mask | Dist | n_ok | MAE (cm) | RMSE | MAPE % | ≤10% | ≤20% | Bias | t/img (s) |")
    lines.append("|---:|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    sorted_rows = sorted(
        [r for r in rows if r.get("n_ok", 0) > 0],
        key=lambda r: r.get("mae_cm", 9e9),
    )
    for i, r in enumerate(sorted_rows, 1):
        lines.append(
            f"| {i} | {r.get('depth_model','?')} | "
            f"{fmt(r.get('depth_model_params_m'),0)} | "
            f"{r.get('mask_mode','?')} | {r.get('dist_mode','?')} | "
            f"{r.get('n_ok','?')} | "
            f"{fmt(r.get('mae_cm'))} | {fmt(r.get('rmse_cm'))} | "
            f"{fmt(r.get('mape_pct'))} | "
            f"{fmt(r.get('within_10pct'),1)} | {fmt(r.get('within_20pct'),1)} | "
            f"{fmt(r.get('bias_cm'))} | {fmt(r.get('avg_latency_s'),2)} |"
        )
    path.write_text("\n".join(lines), encoding="utf-8")


def factor_means(rows: list[dict], factor: str) -> dict:
    """Average MAE/RMSE/MAPE by a single factor, marginalising others."""
    buckets: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("n_ok", 0) <= 0:
            continue
        key = str(r.get(factor, "?"))
        buckets.setdefault(key, []).append(r)
    result = {}
    for k, v in buckets.items():
        result[k] = {
            "n_configs": len(v),
            "mean_mae_cm": mean(r["mae_cm"] for r in v),
            "median_mae_cm": median(r["mae_cm"] for r in v),
            "mean_mape_pct": mean(r["mape_pct"] for r in v),
            "mean_rmse_cm": mean(r["rmse_cm"] for r in v),
            "mean_within_20pct": mean(r["within_20pct"] for r in v),
            "mean_latency_s": mean(r["avg_latency_s"] for r in v),
        }
    return result


def write_factor_analysis(rows: list[dict], path: Path):
    lines = ["# Factor Analysis — what drives DBH error?\n"]
    for factor, label in [
        ("model_key", "Depth model"),
        ("mask_mode", "Segmentation mode"),
        ("dist_mode", "Distance source"),
    ]:
        lines.append(f"\n## Factor: {label} ({factor})\n")
        means = factor_means(rows, factor)
        if not means:
            lines.append("_(no data)_")
            continue
        lines.append("| Level | # configs | mean MAE (cm) | median MAE | mean MAPE % | mean RMSE | mean ≤20% | mean t/img (s) |")
        lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")
        for k, v in sorted(means.items(), key=lambda kv: kv[1]["mean_mae_cm"]):
            lines.append(
                f"| {k} | {v['n_configs']} | "
                f"{fmt(v['mean_mae_cm'])} | {fmt(v['median_mae_cm'])} | "
                f"{fmt(v['mean_mape_pct'])} | {fmt(v['mean_rmse_cm'])} | "
                f"{fmt(v['mean_within_20pct'],1)} | {fmt(v['mean_latency_s'],2)} |"
            )
        # spread (best - worst MAE among levels) signals factor importance
        maes = [v["mean_mae_cm"] for v in means.values()]
        if len(maes) > 1:
            lines.append(
                f"\n**Spread (worst − best mean MAE): {max(maes)-min(maes):.2f} cm** — "
                f"larger ⇒ this factor matters more.\n"
            )

    # Best config
    ok = [r for r in rows if r.get("n_ok", 0) > 0]
    if ok:
        best = min(ok, key=lambda r: r["mae_cm"])
        worst = max(ok, key=lambda r: r["mae_cm"])
        lines.append("\n## Extremes\n")
        lines.append(f"- **Best**:  `{best.get('tag')}` → MAE {best['mae_cm']:.2f} cm, "
                     f"MAPE {best['mape_pct']:.1f}%, ≤20% {best['within_20pct']:.0f}%")
        lines.append(f"- **Worst**: `{worst.get('tag')}` → MAE {worst['mae_cm']:.2f} cm, "
                     f"MAPE {worst['mape_pct']:.1f}%, ≤20% {worst['within_20pct']:.0f}%")
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="benchmark_matrix")
    ap.add_argument("--out-prefix", default="_summary")
    args = ap.parse_args()

    d = Path(args.dir)
    if not d.exists():
        print(f"[ERR] {d} does not exist")
        return 1
    rows = load_summaries(d)
    if not rows:
        print(f"[ERR] no *.json found in {d}")
        return 1
    print(f"[aggregate] loaded {len(rows)} configs from {d}")

    csv_path = d / f"{args.out_prefix}.csv"
    md_path = d / f"{args.out_prefix}.md"
    factor_path = d / "_factor_analysis.md"
    write_csv(rows, csv_path)
    write_master_md(rows, md_path)
    write_factor_analysis(rows, factor_path)

    print(f"[aggregate] wrote:")
    print(f"  {csv_path}")
    print(f"  {md_path}")
    print(f"  {factor_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
