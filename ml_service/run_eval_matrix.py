"""Run the DA3 evaluation matrix used to choose deployment defaults.

The runner groups benchmark rows by service configuration so DA3/OpenVINO and
server YOLO are compiled once, warmed once, and then reused for several runs.
This keeps cold-start compile time out of per-image latency metrics.
"""
from __future__ import annotations

import argparse
import csv
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import requests

from benchmark_xiang import (
    CSV_PATH,
    RGB_DIR,
    load_analysis_map,
    run_one,
)


ROOT = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = ROOT / "benchmark_matrix_eval"


@dataclass(frozen=True)
class ServiceConfig:
    name: str
    da3_device: str
    da3_ir_dir: str

    @property
    def shape_label(self) -> str:
        return "602x448" if "602x448" in self.da3_ir_dir else "504x378"


@dataclass(frozen=True)
class BenchRun:
    suffix: str
    args: tuple[str, ...]


SERVICES = [
    ServiceConfig("504x378_gpu", "GPU", "openvino_models/da3_metric_large"),
    ServiceConfig("504x378_npu", "NPU", "openvino_models/da3_metric_large"),
    ServiceConfig("602x448_gpu", "GPU", "openvino_models/da3_metric_large_602x448"),
    ServiceConfig("602x448_npu", "NPU", "openvino_models/da3_metric_large_602x448"),
]

RUNS = [
    BenchRun("gtmask__refdist", ("--use-gt-mask", "--use-ref-distance")),
    BenchRun("gtmask__nodist", ("--use-gt-mask",)),
    BenchRun(
        "serveryolo_gtbbox__refdist",
        ("--use-server-yolo-mask", "--use-gt-bbox", "--use-ref-distance"),
    ),
    BenchRun(
        "serveryolo_gtbbox__nodist",
        ("--use-server-yolo-mask", "--use-gt-bbox"),
    ),
    BenchRun(
        "serveryolo_phonebbox__nodist",
        ("--use-server-yolo-mask", "--use-yolo-bbox"),
    ),
]


def _wait_health(base_url: str, timeout_s: float = 90.0) -> None:
    deadline = time.time() + timeout_s
    last_error = None
    while time.time() < deadline:
        try:
            r = requests.get(base_url + "/health", timeout=3)
            if r.status_code == 200:
                return
            last_error = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as exc:
            last_error = str(exc)
        time.sleep(1.0)
    raise RuntimeError(f"ML service did not become healthy: {last_error}")


def _start_service(service: ServiceConfig, port: int, log_path: Path) -> subprocess.Popen:
    env = os.environ.copy()
    env.update({
        "ML_API_KEY": "",
        "ML_DEPTH_MODEL": "da3_metric_large",
        "ML_USE_OPENVINO": "true",
        "ML_DA3_OV_DEVICE": service.da3_device,
        "ML_DA3_OV_DIR": service.da3_ir_dir,
        "ML_SERVER_YOLO_DEVICE": "intel:gpu",
        "ML_SERVER_YOLO_IMGSZ": "832",
        "ML_ENABLE_SAM": "false",
        "ML_BENCHMARK_MODE": "true",
        "ML_RATE_LIMIT": "100000",
        "PORT": str(port),
    })
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_f = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(ROOT),
        env=env,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        text=True,
    )
    proc._eval_log_file = log_f  # type: ignore[attr-defined]
    return proc


def _stop_service(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=15)
    log_f = getattr(proc, "_eval_log_file", None)
    if log_f is not None:
        log_f.close()


def _warm_up(base_url: str) -> None:
    rows = list(csv.DictReader(open(CSV_PATH, "r", encoding="utf-8-sig")))
    if not rows:
        raise RuntimeError(f"No Xiang rows found: {CSV_PATH}")
    analysis_map = load_analysis_map()
    row = rows[0]
    rgb_path = RGB_DIR / f"rgb-{row['Name']}.jpg"
    res = run_one(
        base_url=base_url,
        rgb_path=rgb_path,
        row=row,
        use_ref_distance=True,
        use_gt_mask=False,
        use_yolo_mask=False,
        use_yolo_m_mask=False,
        use_server_yolo_mask=True,
        use_gt_bbox=True,
        use_yolo_bbox=False,
        server_yolo_conf=0.15,
        analysis_row=analysis_map.get(row["Name"]),
        upload_long_edge=0,
        jpeg_quality=95,
        timeout=240.0,
    )
    if not res.get("ok"):
        raise RuntimeError(f"Warm-up request failed: {res}")


def _run_benchmark(base_url: str, service: ServiceConfig, run: BenchRun,
                   out_dir: Path, limit: int, timeout: float,
                   upload_long_edge: int, jpeg_quality: int,
                   logs_dir: Path) -> Path:
    tag = f"da3_{service.shape_label}_{service.da3_device.lower()}__{run.suffix}"
    out_csv = out_dir / f"{tag}.csv"
    cmd = [
        sys.executable, "benchmark_xiang.py",
        "--url", base_url,
        "--tag", tag,
        "--out", str(out_csv),
        "--timeout", str(timeout),
        "--jpeg-quality", str(jpeg_quality),
    ]
    if limit > 0:
        cmd += ["--limit", str(limit)]
    if upload_long_edge > 0:
        cmd += ["--upload-long-edge", str(upload_long_edge)]
    cmd += list(run.args)

    log_path = logs_dir / f"{tag}.log"
    with open(log_path, "w", encoding="utf-8") as log_f:
        t0 = time.time()
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            stdout=log_f,
            stderr=subprocess.STDOUT,
            text=True,
        )
        elapsed = time.time() - t0
    if proc.returncode != 0:
        tail = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-30:]
        raise RuntimeError(
            f"benchmark failed for {tag} (exit {proc.returncode}). Tail:\n" + "\n".join(tail)
        )

    json_path = out_csv.with_suffix(".json")
    print(f"  [{tag}] done in {elapsed/60:.1f} min -> {json_path.name}")
    return json_path


def _analyze(out_dir: Path) -> Path:
    report = out_dir / "_analysis.md"
    subprocess.run(
        [sys.executable, "analyze_benchmark.py", "--dir", str(out_dir), "--auto-pairs", "--out", str(report)],
        cwd=str(ROOT),
        check=True,
    )
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--limit", type=int, default=0, help="0=all 294 Xiang samples")
    ap.add_argument("--timeout", type=float, default=240.0)
    ap.add_argument("--upload-long-edge", type=int, default=0)
    ap.add_argument("--jpeg-quality", type=int, default=95)
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("--service-filter", default="",
                    help="substring filter for service config name, e.g. 504x378_gpu")
    ap.add_argument("--run-filter", default="",
                    help="substring filter for run suffix, e.g. gtmask__refdist")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    logs_dir = out_dir / "logs"
    out_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    print("=== DA3 evaluation matrix ===")
    print(f"out_dir={out_dir}")
    print(f"limit={'all' if args.limit == 0 else args.limit}")
    print(f"upload_long_edge={args.upload_long_edge or 'original'} jpeg_quality={args.jpeg_quality}")
    selected_services = [s for s in SERVICES if not args.service_filter or args.service_filter in s.name]
    selected_runs = [r for r in RUNS if not args.run_filter or args.run_filter in r.suffix]
    if not selected_services:
        raise RuntimeError(f"No service matched --service-filter={args.service_filter!r}")
    if not selected_runs:
        raise RuntimeError(f"No run matched --run-filter={args.run_filter!r}")

    print(f"Runs: {len(selected_services)} service configs × {len(selected_runs)} mask/distance configs "
          f"= {len(selected_services) * len(selected_runs)} cells\n")

    base_url = f"http://127.0.0.1:{args.port}"
    for service in selected_services:
        service_log = logs_dir / f"service_{service.name}.log"
        print(f"[service] {service.name}: device={service.da3_device}, ir={service.da3_ir_dir}")
        proc = _start_service(service, args.port, service_log)
        try:
            _wait_health(base_url)
            print("  warming DA3 + server YOLO (cold compile excluded from benchmark rows)...")
            _warm_up(base_url)
            for run in selected_runs:
                tag = f"da3_{service.shape_label}_{service.da3_device.lower()}__{run.suffix}"
                if args.skip_existing and (out_dir / f"{tag}.json").exists():
                    print(f"  [{tag}] skip existing")
                    continue
                _run_benchmark(
                    base_url=base_url,
                    service=service,
                    run=run,
                    out_dir=out_dir,
                    limit=args.limit,
                    timeout=args.timeout,
                    upload_long_edge=args.upload_long_edge,
                    jpeg_quality=args.jpeg_quality,
                    logs_dir=logs_dir,
                )
        finally:
            _stop_service(proc)
        print("")

    report = _analyze(out_dir)
    print(f"\n[done] report: {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())