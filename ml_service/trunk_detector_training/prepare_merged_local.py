#!/usr/bin/env python3
"""
🧱 Merge cleaned datasets → YOLO seg merged_*  (Windows native paths)
=================================================================
產出兩個版本：
  - merged_no_xiang/    （論文用，無 leak）
  - merged_with_xiang/  （ablation 對照組，含 Xiang 訓練 leak）

差異於：
  - no_xiang  : Roboflow + Urban Street            （Xiang 完全當 held-out test）
  - with_xiang: 加上 Xiang 80% (oversample 可調) 進 train

設計：
  - 先用 inspect_dataset.py 已下載完的 trunk_training_data/
  - 含去重 / class 過濾 / VOC→YOLO 轉換規則
  - 80/15/5 split (seed=42)
  - 保留沒有任何 trunk 的影像作為 negative samples (10% Roboflow / 5% Urban / 0% Xiang)
  - **EXTRA_TRUNK_OVERRIDES 預設關閉**（user 須以 --include-post 開啟才把 weppw 的 'post' class 當 trunk）
=================================================================
"""

import argparse
import hashlib
import os
import random
import shutil
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

RNG_SEED = 42
SAMPLE_NEGATIVE_RATE_ROBOFLOW = 0.10
SAMPLE_NEGATIVE_RATE_URBAN = 0.05
EXTRA_TRUNK_OVERRIDES = {"tree_trunk-weppw": {0, 2}}  # 仍保留定義，但 default 不啟用


def fast_file_hash(filepath: str) -> str:
    st = os.stat(filepath)
    with open(filepath, "rb") as f:
        head = f.read(4096)
    return hashlib.md5(f"{st.st_size}:{head}".encode("latin-1")).hexdigest()


def is_image(name: str) -> bool:
    return name.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))


def collect_roboflow(loc: Path, include_post_in_weppw: bool) -> list[tuple[str, list[str]]]:
    """Return [(img_path, [yolo_lines_with_cls_0])]."""
    import yaml
    cfg = yaml.safe_load((loc / "data.yaml").read_text(encoding="utf-8"))
    names = cfg.get("names", [])
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names.keys())]

    extra_trunk: set[int] = set()
    if include_post_in_weppw:
        for key, val in EXTRA_TRUNK_OVERRIDES.items():
            if key in loc.name:
                extra_trunk = val
                break

    trunk_ids: set[int] = set()
    for idx, name in enumerate(names):
        n = str(name).lower().strip()
        if "trunk" in n or idx in extra_trunk:
            trunk_ids.add(idx)
    if not trunk_ids and len(names) == 1:
        trunk_ids = {0}

    out = []
    for split in ["train", "valid", "test"]:
        img_dir = loc / split / "images"
        lbl_dir = loc / split / "labels"
        if not img_dir.exists():
            continue
        for img_file in sorted(os.listdir(img_dir)):
            if not is_image(img_file):
                continue
            img_path = img_dir / img_file
            stem = os.path.splitext(img_file)[0]
            lbl_path = lbl_dir / f"{stem}.txt"
            trunk_lines: list[str] = []
            if lbl_path.exists():
                for line in lbl_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    parts = line.strip().split()
                    if len(parts) < 5:
                        continue
                    try:
                        cls = int(parts[0])
                    except ValueError:
                        continue
                    if cls in trunk_ids:
                        parts[0] = "0"
                        trunk_lines.append(" ".join(parts))
            out.append((str(img_path), trunk_lines))
    return out


def collect_urban_street(loc: Path) -> list[tuple[str, list[str]]]:
    """VOC -> YOLO seg lines (cls=0)."""
    import cv2
    voc_root: Path | None = None
    for root, dirs, _ in os.walk(loc):
        if "JPEGImages" in dirs and "SegmentationClass" in dirs:
            voc_root = Path(root)
            break
    if not voc_root:
        return []
    jpeg_dir = voc_root / "JPEGImages"
    seg_dir = voc_root / "SegmentationClass"

    out = []
    mask_files = sorted([f for f in os.listdir(seg_dir) if f.lower().endswith(".png")])
    for mask_fname in mask_files:
        stem = os.path.splitext(mask_fname)[0]
        img_path: Path | None = None
        for ext in [".jpg", ".jpeg", ".png", ".JPG", ".JPEG"]:
            cand = jpeg_dir / f"{stem}{ext}"
            if cand.exists():
                img_path = cand
                break
        if img_path is None:
            continue
        try:
            from PIL import Image
            with Image.open(img_path) as im:
                w, h = im.size
        except Exception:
            continue
        mask = cv2.imread(str(seg_dir / mask_fname), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        if mask.max() <= 1:
            binary = (mask > 0).astype(np.uint8) * 255
        else:
            binary = np.zeros_like(mask)
            binary[(mask > 0) & (mask < 255)] = 255
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_L1)
        lines = []
        for cnt in contours:
            if cv2.contourArea(cnt) < 100:
                continue
            eps = 0.001 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, eps, True)
            if len(approx) < 3:
                continue
            pts: list[str] = []
            for pt in approx:
                pts.extend([
                    f"{max(0.0, min(1.0, pt[0][0] / w)):.6f}",
                    f"{max(0.0, min(1.0, pt[0][1] / h)):.6f}",
                ])
            lines.append("0 " + " ".join(pts))
        if lines:
            out.append((str(img_path), lines))
    return out


def collect_xiang(loc: Path) -> list[tuple[str, list[str]]]:
    """Xiang treeRGB + treeSeg-tm masks."""
    import cv2
    rgb_dirs = list(loc.rglob("treeRGB"))
    seg_dirs = list(loc.rglob("treeSeg"))
    if not rgb_dirs or not seg_dirs:
        return []
    rgb_dir, seg_dir = rgb_dirs[0], seg_dirs[0]
    out = []
    for rgb_path in sorted(rgb_dir.iterdir()):
        if rgb_path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".bmp"):
            continue
        stem = rgb_path.stem
        possible = [
            seg_dir / f"{stem}-tm.jpg", seg_dir / f"{stem}-tm.png",
            seg_dir / f"{stem}_mask.jpg", seg_dir / f"{stem}_mask.png",
            seg_dir / f"{stem}.jpg", seg_dir / f"{stem}.png",
        ]
        mask_path = next((mp for mp in possible if mp.exists()), None)
        if not mask_path:
            continue
        mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        _, binary = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        h, w = mask.shape[:2]
        lines = []
        for cnt in contours:
            if cv2.contourArea(cnt) < 500:
                continue
            eps = 0.005 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, eps, True)
            if len(approx) < 3:
                continue
            pts: list[str] = []
            for pt in approx:
                pts.extend([
                    f"{max(0.0, min(1.0, pt[0][0] / w)):.6f}",
                    f"{max(0.0, min(1.0, pt[0][1] / h)):.6f}",
                ])
            lines.append("0 " + " ".join(pts))
        if lines:
            out.append((str(rgb_path), lines))
    return out


def write_split(merged_dir: Path, split: str, pairs: list[tuple[str, list[str]]]):
    img_out = merged_dir / split / "images"
    lbl_out = merged_dir / split / "labels"
    img_out.mkdir(parents=True, exist_ok=True)
    lbl_out.mkdir(parents=True, exist_ok=True)
    for i, (src_img, lines) in enumerate(pairs):
        ext = os.path.splitext(src_img)[1]
        new_name = f"{split}_{i:05d}"
        dst_img = img_out / f"{new_name}{ext}"
        try:
            os.link(src_img, dst_img)
        except OSError:
            shutil.copy2(src_img, dst_img)
        (lbl_out / f"{new_name}.txt").write_text(
            "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8"
        )


def build_variant(
    variant_name: str,
    out_root: Path,
    roboflow_pairs: list[tuple[str, list[str]]],
    urban_pairs: list[tuple[str, list[str]]],
    xiang_pairs: list[tuple[str, list[str]]],
    include_xiang_in_train: bool,
    xiang_oversample: int,
):
    print(f"\n=== variant: {variant_name} ===")
    merged_dir = out_root / variant_name
    if merged_dir.exists():
        shutil.rmtree(merged_dir)
    merged_dir.mkdir(parents=True)

    rng = random.Random(RNG_SEED)
    seen: set[str] = set()
    bag: list[tuple[str, list[str]]] = []

    def push(pairs, neg_rate=0.0, label="?"):
        added_pos = added_neg = dup = 0
        for ip, lines in pairs:
            try:
                h = fast_file_hash(ip)
            except Exception:
                continue
            if h in seen:
                dup += 1
                continue
            seen.add(h)
            if lines:
                bag.append((ip, lines)); added_pos += 1
            elif rng.random() < neg_rate:
                bag.append((ip, [])); added_neg += 1
        print(f"  [{label}] +pos={added_pos} +neg={added_neg} dup={dup}")

    push(roboflow_pairs, neg_rate=SAMPLE_NEGATIVE_RATE_ROBOFLOW, label="roboflow")
    push(urban_pairs, neg_rate=SAMPLE_NEGATIVE_RATE_URBAN, label="urban")

    # 處理 Xiang：80/20 split with seed=42（與舊腳本對齊），train 80% 才能進 bag
    xiang_train: list[tuple[str, list[str]]] = []
    xiang_held: list[tuple[str, list[str]]] = []
    if xiang_pairs:
        rng_x = random.Random(RNG_SEED)
        idxs = list(range(len(xiang_pairs)))
        rng_x.shuffle(idxs)
        n_train_x = int(len(idxs) * 0.8)
        for rank, idx in enumerate(idxs):
            target = xiang_train if rank < n_train_x else xiang_held
            target.append(xiang_pairs[idx])
        print(f"  [xiang] train_pool={len(xiang_train)} held_out={len(xiang_held)}")

    if include_xiang_in_train and xiang_train:
        for _ in range(max(1, xiang_oversample)):
            for ip, lines in xiang_train:
                # Xiang 沒有 dup（不同 hash），允許重複進 bag 達到 oversample
                bag.append((ip, lines))
        print(f"  [xiang] injected with oversample x{xiang_oversample} (total {len(xiang_train) * xiang_oversample})")

    rng.shuffle(bag)
    n = len(bag)
    n_train = int(n * 0.80)
    n_valid = int(n * 0.15)
    train_split = bag[:n_train]
    valid_split = bag[n_train:n_train + n_valid]
    test_split = bag[n_train + n_valid:]

    # Xiang held-out 永遠進 test (擴充 test set)，但只在 no_xiang variant 進 valid+test
    if xiang_held and not include_xiang_in_train:
        # 把 80% Xiang train pool + 20% held 全部當 held-out test
        held_all = xiang_train + xiang_held
        # 不進 train，避開 leak。其中一半進 valid（給 val 看 Xiang 風格分布以早停）
        rng_h = random.Random(RNG_SEED + 1)
        rng_h.shuffle(held_all)
        n_h = len(held_all)
        # 為了完全避免 train leak，這 variant 把所有 Xiang 都丟到 test
        test_split = test_split + held_all
        print(f"  [no_xiang] += {len(held_all)} Xiang held-out 進 test")

    write_split(merged_dir, "train", train_split)
    write_split(merged_dir, "valid", valid_split)
    write_split(merged_dir, "test", test_split)

    # data.yaml — 用相對路徑，搬機可移植
    yaml_text = (
        f"path: {merged_dir.as_posix()}\n"
        "train: train/images\n"
        "val: valid/images\n"
        "test: test/images\n"
        "nc: 1\n"
        "names: ['tree_trunk']\n"
    )
    (merged_dir / "data.yaml").write_text(yaml_text, encoding="utf-8")

    print(f"  ✅ {variant_name}: train={len(train_split)} valid={len(valid_split)} test={len(test_split)} | path={merged_dir}")
    return {
        "variant": variant_name,
        "train": len(train_split),
        "valid": len(valid_split),
        "test": len(test_split),
        "include_xiang_in_train": include_xiang_in_train,
        "xiang_oversample": xiang_oversample if include_xiang_in_train else 0,
        "data_yaml": str(merged_dir / "data.yaml"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", default=r"C:\projects\tree_project\trunk_training_data")
    ap.add_argument("--out-root", default=r"C:\projects\tree_project\trunk_training_data\merged")
    ap.add_argument("--include-post", action="store_true",
                    help="把 weppw 的 class 0 'post' 也當 trunk (預設關閉)")
    ap.add_argument("--xiang-oversample", type=int, default=1,
                    help="with_xiang variant 的 oversample 次數 (與舊腳本一致 default=1)")
    ap.add_argument("--only", choices=["no_xiang", "with_xiang", "both"], default="both")
    args = ap.parse_args()

    data_root = Path(args.data_root)
    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    # ---- Phase A: collect ----
    print("=== Phase A: collect labels ===")
    roboflow_pairs: list[tuple[str, list[str]]] = []
    for d in sorted(data_root.glob("roboflow_*")):
        if not (d / "data.yaml").exists():
            continue
        # 跳過 04 (與 03 完全重複)
        if "tree-trunk-detection-369pz" in d.name:
            print(f"  skip {d.name} (duplicate of weppw)")
            continue
        pairs = collect_roboflow(d, include_post_in_weppw=args.include_post)
        n_pos = sum(1 for _, l in pairs if l)
        print(f"  + {d.name}: {n_pos} pos / {len(pairs)} total")
        roboflow_pairs.extend(pairs)

    urban_pairs: list[tuple[str, list[str]]] = []
    if (data_root / "kaggle_urban_street").exists():
        print("  collecting urban_street ...")
        urban_pairs = collect_urban_street(data_root / "kaggle_urban_street")
        print(f"  + urban_street: {len(urban_pairs)} pos")

    xiang_pairs: list[tuple[str, list[str]]] = []
    if (data_root / "xiang_zenodo").exists():
        print("  collecting xiang ...")
        xiang_pairs = collect_xiang(data_root / "xiang_zenodo")
        print(f"  + xiang: {len(xiang_pairs)} pos")

    # ---- Phase B: build variants ----
    print("\n=== Phase B: build merged variants ===")
    summary = []
    if args.only in ("no_xiang", "both"):
        summary.append(build_variant(
            "merged_no_xiang", out_root,
            roboflow_pairs, urban_pairs, xiang_pairs,
            include_xiang_in_train=False, xiang_oversample=0,
        ))
    if args.only in ("with_xiang", "both"):
        summary.append(build_variant(
            "merged_with_xiang", out_root,
            roboflow_pairs, urban_pairs, xiang_pairs,
            include_xiang_in_train=True, xiang_oversample=args.xiang_oversample,
        ))

    print("\n=== summary ===")
    for s in summary:
        print(f"  {s['variant']}: train={s['train']} valid={s['valid']} test={s['test']}")
        print(f"    data.yaml: {s['data_yaml']}")
    print("\n下一步：")
    print(f"  python train_local.py --data {summary[0]['data_yaml']} --model n")


if __name__ == "__main__":
    main()
