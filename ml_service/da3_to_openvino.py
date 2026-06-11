#!/usr/bin/env python3
"""
🚀 Export DA3METRIC-LARGE to OpenVINO IR (FP16) + smoke test on Intel iGPU
==========================================================================
Three-tier strategy:
  Tier A: openvino.convert_model() directly on a PyTorch wrapper (cleanest)
  Tier B: torch.onnx.export → openvino.convert_model on the .onnx
  Tier C: torch.jit.trace → openvino.convert_model on the traced module

Output:
  openvino_models/da3_metric_large/openvino_model.xml + .bin (FP16)
  openvino_models/da3_metric_large/_smoke_report.txt

Validation:
  - Run 5 Xiang sample images on PyTorch FP32 vs OV-iGPU
  - Compare per-pixel depth (median ratio, MAPE)
  - Pass criterion: median |OV - PT| / PT < 5%
"""

from __future__ import annotations

import os
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import torch
from PIL import Image

# Ensure DA3 third_party is on sys.path
ROOT = Path(__file__).resolve().parent
DA3_SRC = ROOT / "third_party" / "depth-anything-3" / "src"
sys.path.insert(0, str(DA3_SRC))

# Default OUT_DIR points at the production 504x378 IR; CLI --out-dir overrides.
DEFAULT_OUT_DIR = ROOT / "openvino_models" / "da3_metric_large"

XIANG_RGB_DIR = Path(r"C:\projects\tree_project\trunk_training_data\xiang_zenodo\data and code\tree\treeRGB")
# Default export shape: 504x378 (matches DA3 InputProcessor portrait output;
# trees are always portrait phone photos). DA3 has positional embeddings that
# bake into the graph at trace time, so dynamic H/W is not supported.
# CLI --export-h / --export-w override these defaults (and update the smoke
# preprocessor accordingly so the input shape matches the IR).
EXPORT_H = 504
EXPORT_W = 378

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


# --------------------------------------------------------------------------
# Wrapper: monocular DA3 with fixed signature for ONNX/OV export
# --------------------------------------------------------------------------
class DA3MonoWrapper(torch.nn.Module):
    """Single-view DA3 forward: image (1,3,H,W) → depth (1,H,W)."""

    def __init__(self, da3_model):
        super().__init__()
        # Inner model is the actual DA3Model net (without input/output processors)
        self.net = da3_model.model
        self.net.eval()

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        # Reshape (1,3,H,W) → (1,1,3,H,W) for B=1 N=1
        if image.dim() == 4:
            image = image.unsqueeze(1)
        # NOTE: DA3 has a bug — when export_feat_layers=None it does
        # `if i in None` and crashes. Pass [] for "no aux features".
        out = self.net(
            image,                # (B, N, 3, H, W)
            None,                 # extrinsics
            None,                 # intrinsics
            [],                   # export_feat_layers (NOT None — DA3 bug)
            False,                # infer_gs
            False,                # use_ray_pose
            "saddle_balanced",    # ref_view_strategy
        )
        # out is dict; pick metric depth
        # Common keys: 'depth', 'metric_depth', 'depth_metric'
        for key in ("metric_depth", "depth_metric", "depth"):
            if key in out:
                d = out[key]
                break
        else:
            raise KeyError(f"No depth key in DA3 output. Got: {list(out.keys())}")
        # d shape: (B, N, H, W) or (B, N, 1, H, W) — squeeze N
        if d.dim() == 5:
            d = d[:, 0, 0]
        elif d.dim() == 4:
            d = d[:, 0]
        return d  # (B, H_proc, W_proc)


def load_da3():
    print("[load] DepthAnything3.from_pretrained ...")
    from depth_anything_3.api import DepthAnything3
    m = DepthAnything3.from_pretrained("depth-anything/DA3METRIC-LARGE")
    m.eval()
    return m


def make_dummy_input(h: int = EXPORT_H, w: int = EXPORT_W):
    return torch.randn(1, 3, h, w, dtype=torch.float32)


# --------------------------------------------------------------------------
# Tier A: openvino.convert_model on PyTorch wrapper
# --------------------------------------------------------------------------
def tier_a(wrapper: torch.nn.Module, dummy: torch.Tensor, out_dir: Path) -> bool:
    print(f"\n=== Tier A: openvino.convert_model (PyTorch frontend, fixed {tuple(dummy.shape)}) ===")
    try:
        import openvino as ov
        wrapper.eval()
        with torch.no_grad():
            ov_model = ov.convert_model(wrapper, example_input=dummy)
        ov.save_model(ov_model, str(out_dir / "openvino_model.xml"), compress_to_fp16=True)
        print(f"  ✅ Saved → {out_dir / 'openvino_model.xml'}")
        return True
    except Exception as e:
        print(f"  ❌ Tier A failed: {type(e).__name__}: {e}")
        traceback.print_exc(limit=3)
        return False


# --------------------------------------------------------------------------
# Tier B: torch.onnx.export → openvino.convert_model
# --------------------------------------------------------------------------
def tier_b(wrapper: torch.nn.Module, dummy: torch.Tensor, out_dir: Path) -> bool:
    print("\n=== Tier B: torch.onnx.export (dynamo) → ov.convert_model ===")
    onnx_path = out_dir / "da3_mono.onnx"
    try:
        wrapper.eval()
        with torch.no_grad():
            # PyTorch 2.11 dynamo exporter handles None outputs / dict-returning
            # internal modules far more reliably than torchscript trace.
            torch.onnx.export(
                wrapper,
                (dummy,),
                str(onnx_path),
                input_names=["image"],
                output_names=["depth"],
                opset_version=18,
                dynamo=True,
                external_data=False,
                verbose=False,
            )
        size_mb = onnx_path.stat().st_size / 1024**2
        print(f"  ✓ ONNX exported: {size_mb:.1f} MB")
    except Exception as e:
        print(f"  ❌ ONNX export failed: {type(e).__name__}: {e}")
        traceback.print_exc(limit=3)
        return False

    try:
        import openvino as ov
        ov_model = ov.convert_model(str(onnx_path))
        ov.save_model(ov_model, str(out_dir / "openvino_model.xml"), compress_to_fp16=True)
        print(f"  ✅ OV IR saved → {out_dir / 'openvino_model.xml'}")
        return True
    except Exception as e:
        print(f"  ❌ OV convert failed: {type(e).__name__}: {e}")
        traceback.print_exc(limit=3)
        return False


# --------------------------------------------------------------------------
# Tier C: torch.jit.trace → openvino.convert_model
# --------------------------------------------------------------------------
def tier_c(wrapper: torch.nn.Module, dummy: torch.Tensor, out_dir: Path) -> bool:
    print("\n=== Tier C: torch.jit.trace → ov.convert_model ===")
    try:
        wrapper.eval()
        with torch.no_grad():
            traced = torch.jit.trace(wrapper, dummy, strict=False)
        import openvino as ov
        ov_model = ov.convert_model(traced, example_input=dummy)
        ov.save_model(ov_model, str(out_dir / "openvino_model.xml"), compress_to_fp16=True)
        print(f"  ✅ Traced + OV IR saved → {out_dir / 'openvino_model.xml'}")
        return True
    except Exception as e:
        print(f"  ❌ Tier C failed: {type(e).__name__}: {e}")
        traceback.print_exc(limit=3)
        return False


# --------------------------------------------------------------------------
# Smoke test: 5 Xiang images, OV-iGPU vs PyTorch FP32
# --------------------------------------------------------------------------
def smoke_test(da3_pytorch, out_dir: Path, export_h: int, export_w: int,
               n: int = 5, device_label: str = "GPU") -> str:
    print(f"\n=== Smoke test: {n} Xiang images, OV {device_label} vs PyTorch FP32 "
          f"(IR shape {export_h}x{export_w}) ===")
    if not XIANG_RGB_DIR.exists():
        return f"❌ Xiang dir not found: {XIANG_RGB_DIR}"
    files = sorted([f for f in XIANG_RGB_DIR.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")])[:n]
    if not files:
        return "❌ No Xiang images"

    import openvino as ov
    core = ov.Core()
    devices = core.available_devices
    print(f"  OV devices available: {devices}")
    target_device = device_label if device_label in devices else "CPU"
    print(f"  Using OV device: {target_device}")

    ov_model = core.read_model(str(out_dir / "openvino_model.xml"))
    # NPU requires fully-static shapes. The PyTorch tracer often leaves
    # input rank-dynamic even when given a fixed example_input, so reshape
    # explicitly here. Safe for GPU/CPU too (no-op when already static).
    try:
        ov_model.reshape({0: ov.PartialShape([1, 3, export_h, export_w])})
    except Exception as e:
        print(f"  ⚠ reshape({1},{3},{export_h},{export_w}) failed: {e}")
    compiled = core.compile_model(ov_model, target_device)
    output_node = compiled.outputs[0]

    lines = [f"Smoke report ({n} images, OV={target_device} vs PT-CPU FP32)"]
    diffs_pct = []
    ov_times, pt_times = [], []

    # Preprocess to the IR's exact static shape (PIL resize is W,H).
    target_size = (export_w, export_h)
    process_long_edge = max(export_h, export_w)
    for img_p in files:
        img = Image.open(img_p).convert("RGB")
        img_proc = img.resize(target_size, Image.BILINEAR)
        arr = np.array(img_proc, dtype=np.float32) / 255.0
        # ImageNet norm
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        arr = (arr - mean) / std
        arr = arr.transpose(2, 0, 1)[None, :, :, :].astype(np.float32)

        # OV inference
        t0 = time.time()
        ov_out = compiled([arr])[output_node]
        ov_times.append(time.time() - t0)
        ov_depth = np.asarray(ov_out).squeeze().astype(np.float32)

        # PyTorch FP32 reference (use the original DA3 inference path so it's fair)
        t0 = time.time()
        with torch.no_grad():
            pred = da3_pytorch.inference([img], export_dir=None, process_res=process_long_edge)
        pt_times.append(time.time() - t0)
        pt_depth = np.asarray(pred.depth[0], dtype=np.float32)

        # Resize to common size for comparison
        h_target, w_target = pt_depth.shape[-2:]
        if ov_depth.shape != (h_target, w_target):
            from PIL import Image as PImg
            ov_depth_r = np.array(PImg.fromarray(ov_depth).resize((w_target, h_target), PImg.BILINEAR), dtype=np.float32)
        else:
            ov_depth_r = ov_depth

        # Median absolute pct diff
        mask = (pt_depth > 0.05) & (pt_depth < 50.0)
        if mask.sum() == 0:
            mask = np.ones_like(pt_depth, dtype=bool)
        diff_pct = np.abs(ov_depth_r[mask] - pt_depth[mask]) / np.maximum(pt_depth[mask], 1e-3) * 100
        med = float(np.median(diff_pct))
        p95 = float(np.percentile(diff_pct, 95))
        diffs_pct.append(med)
        line = (f"  {img_p.name}: ov={ov_times[-1]*1000:.0f}ms pt={pt_times[-1]*1000:.0f}ms "
                f"PT[{pt_depth.min():.2f},{pt_depth.max():.2f}m] OV[{ov_depth_r.min():.2f},{ov_depth_r.max():.2f}m] "
                f"|d| med={med:.2f}% p95={p95:.2f}%")
        print(line)
        lines.append(line)

    overall_med = float(np.median(diffs_pct)) if diffs_pct else float("nan")
    pass_fail = "✅ PASS" if overall_med < 5.0 else ("⚠️ MARGINAL" if overall_med < 15.0 else "❌ FAIL")
    summary = (f"\nOverall: median diff = {overall_med:.2f}%  → {pass_fail}\n"
               f"  ov_avg = {np.mean(ov_times)*1000:.0f}ms  pt_avg = {np.mean(pt_times)*1000:.0f}ms\n"
               f"  speedup = {np.mean(pt_times)/max(np.mean(ov_times),1e-6):.1f}x")
    print(summary)
    lines.append(summary)
    report_path = out_dir / f"_smoke_report_{target_device}.txt"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return summary


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-export", action="store_true",
                    help="skip export, only run smoke (OV IR must already exist)")
    ap.add_argument("--skip-smoke", action="store_true",
                    help="skip the built-in smoke test")
    ap.add_argument("--smoke-n", type=int, default=5)
    ap.add_argument("--device", default="GPU",
                    help="OV device for smoke (GPU / CPU / NPU)")
    ap.add_argument("--export-h", type=int, default=EXPORT_H,
                    help=f"IR static height (default {EXPORT_H})")
    ap.add_argument("--export-w", type=int, default=EXPORT_W,
                    help=f"IR static width (default {EXPORT_W})")
    ap.add_argument("--out-dir", default=None,
                    help="Override output dir. Default: openvino_models/"
                         "da3_metric_large{,_<H>x<W>} (only the default "
                         "504x378 lands in the prod path; non-default shapes "
                         "go to a sibling dir to avoid clobbering production).")
    args = ap.parse_args()

    if args.out_dir:
        out_dir = Path(args.out_dir)
    elif args.export_h == EXPORT_H and args.export_w == EXPORT_W:
        out_dir = DEFAULT_OUT_DIR
    else:
        out_dir = ROOT / "openvino_models" / f"da3_metric_large_{args.export_h}x{args.export_w}"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[info] export dir: {out_dir}")

    da3 = load_da3()

    if not args.skip_export:
        wrapper = DA3MonoWrapper(da3)
        dummy = make_dummy_input(h=args.export_h, w=args.export_w)
        print(f"[info] dummy input shape: {tuple(dummy.shape)}")

        ok = tier_a(wrapper, dummy, out_dir)
        if not ok:
            ok = tier_b(wrapper, dummy, out_dir)
        if not ok:
            ok = tier_c(wrapper, dummy, out_dir)
        if not ok:
            print("\n💥 All export tiers failed. See errors above.")
            sys.exit(2)

    ir_path = out_dir / "openvino_model.xml"
    if not ir_path.exists():
        print(f"❌ OV IR not found at {ir_path}")
        sys.exit(2)

    if args.skip_smoke:
        print("[ok] skipping built-in smoke test")
        return

    summary = smoke_test(da3, out_dir=out_dir,
                         export_h=args.export_h, export_w=args.export_w,
                         n=args.smoke_n, device_label=args.device)
    print(f"\n📄 Smoke report: {out_dir / f'_smoke_report_{args.device}.txt'}")


if __name__ == "__main__":
    main()
