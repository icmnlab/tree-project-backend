"""Smoke test: load DA3METRIC-LARGE from HF and run on one sample image."""
import os, time
import numpy as np
import torch
from PIL import Image

from depth_anything_3.api import DepthAnything3

SAMPLE = r"C:\projects\tree_project\tree_Xiang\treeRGB"
files = [f for f in os.listdir(SAMPLE) if f.lower().endswith(".jpg")]
img_path = os.path.join(SAMPLE, files[0])
print(f"[test] image: {img_path}")

print("[test] loading DA3METRIC-LARGE from HF (first time will download ~1.6GB)...")
t0 = time.time()
model = DepthAnything3.from_pretrained("depth-anything/DA3METRIC-LARGE")
model.eval()
print(f"[test] loaded in {time.time()-t0:.1f}s")

img = Image.open(img_path).convert("RGB")
print(f"[test] image size: {img.size}")

print("[test] inference (single view, no extrinsics/intrinsics)...")
t0 = time.time()
with torch.no_grad():
    pred = model.inference([img], export_dir=None)
print(f"[test] inference took {time.time()-t0:.2f}s")

depth = pred.depth[0]
print(f"[test] depth shape={depth.shape} min={depth.min():.3f} max={depth.max():.3f} mean={depth.mean():.3f} is_metric={pred.is_metric}")

if pred.intrinsics is not None:
    K = pred.intrinsics[0]
    print(f"[test] intrinsics fx={K[0,0]:.1f} fy={K[1,1]:.1f} cx={K[0,2]:.1f} cy={K[1,2]:.1f}")
print("[test] OK")
