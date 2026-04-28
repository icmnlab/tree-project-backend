"""Quick test: load UniDepthV2 ViT-L from HF and run on one sample image."""
import os, sys, time
import numpy as np
import torch
from PIL import Image

from unidepth.models import UniDepthV2

SAMPLE = r"C:\projects\tree_project\tree_Xiang\treeRGB"

# Pick first jpg
files = [f for f in os.listdir(SAMPLE) if f.lower().endswith(".jpg")]
img_path = os.path.join(SAMPLE, files[0])
print(f"[test] image: {img_path}")

print("[test] loading UniDepthV2 ViT-L from HF...")
t0 = time.time()
model = UniDepthV2.from_pretrained("lpiccinelli/unidepth-v2-vitl14")
model.eval()
print(f"[test] loaded in {time.time()-t0:.1f}s")

img = Image.open(img_path).convert("RGB")
print(f"[test] image size: {img.size}")
arr = np.array(img)
rgb = torch.from_numpy(arr).permute(2, 0, 1)  # CHW

print("[test] inference...")
t0 = time.time()
with torch.no_grad():
    preds = model.infer(rgb)
print(f"[test] inference took {time.time()-t0:.2f}s")

depth = preds["depth"].squeeze().cpu().numpy()
print(f"[test] depth shape={depth.shape} min={depth.min():.3f} max={depth.max():.3f} mean={depth.mean():.3f}")

if "intrinsics" in preds:
    K = preds["intrinsics"].squeeze().cpu().numpy()
    print(f"[test] intrinsics fx={K[0,0]:.1f} fy={K[1,1]:.1f} cx={K[0,2]:.1f} cy={K[1,2]:.1f}")

print("[test] OK")
