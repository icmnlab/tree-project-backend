"""Benchmark the 31-tree NDHU field dataset through the local ML endpoint."""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
import time
from pathlib import Path

import requests


DEFAULT_DATASET_DIR = Path(r"C:\projects\tree_project\研究資料備份\2026-05-06_162406")


def load_rows(csv_path: Path) -> list[dict]:
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-8"):
        try:
            with open(csv_path, "r", encoding=encoding) as file:
                rows = list(csv.DictReader(file))
            if rows and "tree_id" in rows[0]:
                return rows
        except UnicodeError:
            continue
    raise RuntimeError(f"Cannot decode dataset CSV: {csv_path}")


def compute_focal_35mm(focal_px: float, image_width_px: int) -> float:
    return focal_px * 36.0 / float(image_width_px)


def build_headers(api_key: str) -> dict[str, str]:
    return {"X-ML-API-Key": api_key} if api_key else {}


def call_endpoint(endpoint: str, image_path: Path, fields: dict, headers: dict,
                  timeout: float) -> tuple[dict, float]:
    started = time.time()
    with open(image_path, "rb") as file:
        response = requests.post(
            endpoint,
            headers=headers,
            files={"image": (image_path.name, file, "image/jpeg")},
            data=fields,
            timeout=timeout,
        )
    elapsed = time.time() - started
    try:
        body = response.json()
    except Exception:
        body = {"_body": response.text[:500]}
    if response.status_code != 200:
        body["_http_status"] = response.status_code
    return body, elapsed


def summarize(records: list[dict]) -> dict:
    ok = [record for record in records if record.get("status") == "OK"]
    summary = {
        "n_total": len(records),
        "n_ok": len(ok),
        "n_fail": len(records) - len(ok),
    }
    if not ok:
        return summary

    errors = [record["error_cm"] for record in ok]
    abs_errors = [record["abs_error_cm"] for record in ok]
    abs_pct = [record["abs_pct"] for record in ok]
    latencies = [record["latency_s"] for record in ok if record.get("latency_s")]
    summary.update({
        "mae_cm": statistics.mean(abs_errors),
        "medae_cm": statistics.median(abs_errors),
        "rmse_cm": math.sqrt(statistics.mean(error * error for error in errors)),
        "bias_cm": statistics.mean(errors),
        "mape_pct": statistics.mean(abs_pct),
        "within_10pct": sum(1 for value in abs_pct if value <= 10.0) / len(abs_pct) * 100.0,
        "within_20pct": sum(1 for value in abs_pct if value <= 20.0) / len(abs_pct) * 100.0,
        "median_latency_s": statistics.median(latencies) if latencies else 0.0,
    })

    bins: dict[str, list[dict]] = {
        "0.0-0.5m": [],
        "0.5-1.0m": [],
        "1.0-1.5m": [],
        ">=1.5m": [],
    }
    for record in ok:
        distance = record["capture_distance_m"]
        if distance < 0.5:
            bins["0.0-0.5m"].append(record)
        elif distance < 1.0:
            bins["0.5-1.0m"].append(record)
        elif distance < 1.5:
            bins["1.0-1.5m"].append(record)
        else:
            bins[">=1.5m"].append(record)
    summary["by_distance"] = {
        label: {
            "n": len(items),
            "mae_cm": statistics.mean(item["abs_error_cm"] for item in items),
            "bias_cm": statistics.mean(item["error_cm"] for item in items),
        }
        for label, items in bins.items()
        if items
    }
    return summary


def run_config(rows: list[dict], dataset_dir: Path, base_url: str, api_key: str,
               config_name: str, use_ref_distance: bool, out_dir: Path,
               timeout: float, gap_s: float) -> dict:
    endpoint = base_url.rstrip("/") + "/api/v1/auto-measure-dbh"
    photo_root = dataset_dir / "photos"
    headers = build_headers(api_key)
    records: list[dict] = []

    print(f"\n=== NDHU field benchmark: {config_name} ===")
    for index, row in enumerate(rows, 1):
        if index > 1 and gap_s > 0:
            time.sleep(gap_s)
        tree_id = row["tree_id"]
        image_path = photo_root / tree_id / "main_1.jpg"
        true_dbh_cm = float(row["true_dbh_cm"])
        capture_distance_m = float(row["capture_distance_m"])
        if not image_path.exists():
            records.append({
                "tree_id": tree_id,
                "true_dbh_cm": true_dbh_cm,
                "capture_distance_m": capture_distance_m,
                "status": "MISSING_IMAGE",
                "raw_json": "",
            })
            print(f"[{index:02d}/{len(rows)}] {tree_id} missing main_1.jpg")
            continue

        focal_35mm = compute_focal_35mm(
            float(row["focal_length_px"]),
            int(row["image_width_px"]),
        )
        fields = {
            "focal_length_35mm": f"{focal_35mm:.6f}",
            "phone_make": "Xiaomi",
            "phone_model": row.get("phone_model") or "Xiaomi Mi A1",
            "use_server_yolo_mask": "true",
            "server_yolo_conf": "0.15",
            "return_visualization": "false",
            "return_detection_visualization": "false",
        }
        if use_ref_distance:
            fields["distance_strategy"] = "external_override"
            fields["reference_distance"] = f"{capture_distance_m:.4f}"

        response, elapsed = call_endpoint(endpoint, image_path, fields, headers, timeout)
        result = response.get("result", response)
        predicted = result.get("dbh_cm")
        success = bool(result.get("success", False)) and predicted is not None
        record = {
            "tree_id": tree_id,
            "true_dbh_cm": true_dbh_cm,
            "capture_distance_m": capture_distance_m,
            "predicted_dbh_cm": None,
            "error_cm": None,
            "abs_error_cm": None,
            "abs_pct": None,
            "latency_s": elapsed,
            "status": "OK" if success else "FAIL",
            "depth_source": result.get("depth_source") or "",
            "trunk_pixel_width": result.get("trunk_pixel_width"),
            "trunk_depth_m": result.get("trunk_depth_m"),
            "confidence": result.get("confidence"),
            "raw_json": json.dumps(response, ensure_ascii=False)[:2000],
        }
        if success:
            predicted_float = float(predicted)
            error = predicted_float - true_dbh_cm
            abs_error = abs(error)
            record.update({
                "predicted_dbh_cm": predicted_float,
                "error_cm": error,
                "abs_error_cm": abs_error,
                "abs_pct": abs_error / true_dbh_cm * 100.0,
            })
            print(
                f"[{index:02d}/{len(rows)}] {tree_id} d={capture_distance_m:.2f}m "
                f"true={true_dbh_cm:.1f} pred={predicted_float:.1f} "
                f"err={error:+.1f}cm t={elapsed:.1f}s"
            )
        else:
            print(f"[{index:02d}/{len(rows)}] {tree_id} FAIL {str(response)[:120]}")
        records.append(record)

    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / f"{config_name}.csv"
    fieldnames = [
        "tree_id", "true_dbh_cm", "capture_distance_m", "predicted_dbh_cm",
        "error_cm", "abs_error_cm", "abs_pct", "latency_s", "status",
        "depth_source", "trunk_pixel_width", "trunk_depth_m", "confidence",
        "raw_json",
    ]
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({name: record.get(name) for name in fieldnames})

    summary = summarize(records)
    summary.update({
        "tag": config_name,
        "use_ref_distance": use_ref_distance,
        "base_url": base_url,
        "out_csv": str(csv_path),
    })
    json_path = out_dir / f"{config_name}.json"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", default=str(DEFAULT_DATASET_DIR))
    parser.add_argument("--url", default="http://127.0.0.1:8100")
    parser.add_argument("--api-key", default=os.environ.get("ML_API_KEY", ""))
    parser.add_argument("--out-dir", default=str(DEFAULT_DATASET_DIR / "local_endpoint_results"))
    parser.add_argument("--timeout", type=float, default=240.0)
    parser.add_argument("--gap", type=float, default=0.0)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    rows = load_rows(dataset_dir / "research_dataset.csv")
    if args.limit > 0:
        rows = rows[:args.limit]

    headers = build_headers(args.api_key)
    health = requests.get(args.url.rstrip("/") + "/health", headers=headers, timeout=10).json()
    print(f"[health] {health.get('status')} / {health.get('model')} / backend={health.get('backend', {}).get('detected_backend')}")

    out_dir = Path(args.out_dir)
    run_config(rows, dataset_dir, args.url, args.api_key, "ndhu_noref", False, out_dir, args.timeout, args.gap)
    run_config(rows, dataset_dir, args.url, args.api_key, "ndhu_refdist", True, out_dir, args.timeout, args.gap)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())