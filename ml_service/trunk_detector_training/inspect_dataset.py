#!/usr/bin/env python3
"""
🔍 樹幹偵測訓練資料 — 本機稽核腳本（Windows 原生路徑）
=================================================================
目的：在訓練前徹底了解每個資料來源的「真實樣貌」，避免垃圾進垃圾出。

來源（與 prepare_merged_local.py 的資料來源同步）：
  1. Roboflow × 5：tree-trunk-detection-bi-axe / cherry-trunks /
     tree_trunk-weppw / tree-trunk-detection-369pz / tree-trunk-segmentation-ixblx
  2. Kaggle: erickendric/tree-dataset-of-urban-street-segmentation-trunk
     (需確認是不是中國路樹資料集)
  3. Zenodo: 10.5281/zenodo.10650629 (Xiang et al. 2024)

產出：
  - <DATA_ROOT>/dataset_audit_report.md      逐來源統計 + 警告
  - <DATA_ROOT>/_audit_samples/<source>/     每來源隨機抽 20 張 mask overlay
  - <DATA_ROOT>/_audit_stats.json            機器可讀統計

使用方式：
  cd C:\\projects\\tree_project\\project_code\\backend\\ml_service\\trunk_detector_training
  python inspect_dataset.py --data-root C:\\projects\\tree_project\\trunk_training_data
  python inspect_dataset.py --skip-download   # 已下載過再跑稽核
=================================================================
"""

import argparse
import glob
import hashlib
import json
import os
import random
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

# 讓中文 print 不爆
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


# ╔═══════════════════════════════════════════════════════════════╗
# ║  Config                                                        ║
# ╚═══════════════════════════════════════════════════════════════╝

# 金鑰一律由環境變數提供，勿寫死於程式。
#   set ROBOFLOW_API_KEY / KAGGLE_USERNAME / KAGGLE_KEY（或用 .env）
ROBOFLOW_API_KEY = os.environ.get("ROBOFLOW_API_KEY", "")
KAGGLE_USERNAME = os.environ.get("KAGGLE_USERNAME", "")
KAGGLE_KEY = os.environ.get("KAGGLE_KEY", "")

ROBOFLOW_DATASETS = [
    ("tree-trunks", "tree-trunk-detection-bi-axe", 1, "Roboflow 主資料集 ~1.3k"),
    ("tree-trunks", "cherry-trunks", 2, "櫻桃樹幹 ~337"),
    ("imageprocessing-mo6fy", "tree_trunk-weppw", 1, "6 classes ~1.1k"),
    ("tree-trunks", "tree-trunk-detection-369pz", 5, "seg ~1.1k"),
    ("wurdataset", "tree-trunk-segmentation-ixblx", 1, "精確標註 ~172"),
]

KAGGLE_SLUG = "erickendric/tree-dataset-of-urban-street-segmentation-trunk"
ZENODO_DOI = "10.5281/zenodo.10650629"

EXTRA_TRUNK_OVERRIDES = {"tree_trunk-weppw": {"0", "2"}}

SAMPLE_OVERLAY_COUNT = 20
RNG_SEED = 42


# ╔═══════════════════════════════════════════════════════════════╗
# ║  Helpers                                                       ║
# ╚═══════════════════════════════════════════════════════════════╝

def fast_file_hash(filepath: str) -> str:
    st = os.stat(filepath)
    with open(filepath, "rb") as f:
        head = f.read(4096)
    return hashlib.md5(f"{st.st_size}:{head}".encode("latin-1")).hexdigest()


def is_image(name: str) -> bool:
    return name.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))


def parse_yolo_label(path: str):
    """Return list[(cls:int, polygon_or_bbox: list[float])] or [] if missing/empty."""
    if not os.path.exists(path):
        return None  # 缺標籤
    rows = []
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            try:
                cls = int(parts[0])
                vals = [float(x) for x in parts[1:]]
            except ValueError:
                continue
            rows.append((cls, vals))
    return rows


def load_image_size(path: str):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size  # (w, h)
    except Exception:
        return None


def overlay_one(img_path: str, lines, out_path: str, classes_to_show=(0,)):
    """畫 polygon overlay；支援 seg polygon (>=6 vals) 與 bbox (4 vals)。"""
    import cv2
    img = cv2.imread(img_path)
    if img is None:
        return False
    h, w = img.shape[:2]
    overlay = img.copy()
    for cls, vals in lines or []:
        if cls not in classes_to_show:
            continue
        if len(vals) >= 6 and len(vals) % 2 == 0:
            pts = np.array(
                [[int(vals[i] * w), int(vals[i + 1] * h)] for i in range(0, len(vals), 2)],
                dtype=np.int32,
            )
            cv2.fillPoly(overlay, [pts], (0, 255, 0))
            cv2.polylines(img, [pts], True, (0, 255, 0), 2)
        elif len(vals) == 4:
            cx, cy, bw, bh = vals
            x1, y1 = int((cx - bw / 2) * w), int((cy - bh / 2) * h)
            x2, y2 = int((cx + bw / 2) * w), int((cy + bh / 2) * h)
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 200, 255), 2)
    blend = cv2.addWeighted(img, 0.7, overlay, 0.3, 0)
    cv2.imwrite(out_path, blend)
    return True


# ╔═══════════════════════════════════════════════════════════════╗
# ║  Phase 1: Download                                             ║
# ╚═══════════════════════════════════════════════════════════════╝

def step_download_roboflow(data_root: Path, log: list):
    out_dirs = []
    try:
        from roboflow import Roboflow
    except ImportError:
        print("❌ roboflow 未安裝；pip install roboflow")
        return out_dirs

    rf = Roboflow(api_key=ROBOFLOW_API_KEY)
    for i, (ws, proj, ver, desc) in enumerate(ROBOFLOW_DATASETS, 1):
        loc = data_root / f"roboflow_{i:02d}_{proj}"
        if loc.exists() and any(loc.iterdir()):
            print(f"  [{i}/{len(ROBOFLOW_DATASETS)}] {proj} 已存在 → {loc}")
            out_dirs.append(loc)
            continue
        try:
            print(f"  [{i}/{len(ROBOFLOW_DATASETS)}] download {ws}/{proj} v{ver} ...")
            project = rf.workspace(ws).project(proj)
            project.version(ver).download(
                model_format="yolov8", location=str(loc), overwrite=False
            )
            out_dirs.append(loc)
        except Exception as e:
            log.append(f"⚠️ Roboflow {proj} 下載失敗: {e}")
            print(f"     ✗ {e}")
    return out_dirs


def step_download_kaggle(data_root: Path, log: list) -> Path | None:
    out_dir = data_root / "kaggle_urban_street"
    if out_dir.exists() and any(out_dir.iterdir()):
        print(f"  Urban Street 已存在 → {out_dir}")
        return out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    os.environ["KAGGLE_USERNAME"] = KAGGLE_USERNAME
    os.environ["KAGGLE_KEY"] = KAGGLE_KEY
    kaggle_exe = Path(sys.executable).parent / "kaggle.exe"
    if not kaggle_exe.exists():
        kaggle_exe = Path("kaggle")  # fallback to PATH
    cmd = f'"{kaggle_exe}" datasets download -d {KAGGLE_SLUG} -p "{out_dir}" --unzip'
    print(f"  $ {cmd}")
    ret = os.system(cmd)
    if ret != 0:
        log.append(f"⚠️ Kaggle 下載失敗 (code={ret})；確認 kaggle CLI 已安裝")
        return None
    return out_dir


def step_download_xiang(data_root: Path, log: list) -> Path | None:
    out_dir = data_root / "xiang_zenodo"
    if out_dir.exists() and any(out_dir.iterdir()):
        print(f"  Xiang 已存在 → {out_dir}")
        return out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # 優先 zenodo_get；失敗就用 requests 拉 zip
    zenodo_exe = Path(sys.executable).parent / "zenodo_get.exe"
    if not zenodo_exe.exists():
        zenodo_exe = Path("zenodo_get")
    try:
        import zenodo_get  # noqa: F401
        cmd = f'cd /d "{out_dir}" && "{zenodo_exe}" {ZENODO_DOI}'
        ret = os.system(cmd)
    except ImportError:
        ret = 1

    if ret != 0:
        try:
            import requests
            url = "https://zenodo.org/records/10650629/files/data%20and%20code.zip?download=1"
            zip_path = out_dir / "data_and_code.zip"
            print(f"  fallback: requests download → {zip_path}")
            with requests.get(url, stream=True, timeout=60) as r:
                r.raise_for_status()
                with open(zip_path, "wb") as f:
                    for chunk in r.iter_content(8192):
                        f.write(chunk)
        except Exception as e:
            log.append(f"⚠️ Xiang 下載失敗: {e}")
            return None

    # 解壓所有 zip
    import zipfile
    for z in out_dir.rglob("*.zip"):
        try:
            with zipfile.ZipFile(z) as zf:
                zf.extractall(out_dir)
            print(f"  unzip {z.name}")
        except Exception as e:
            log.append(f"⚠️ unzip {z}: {e}")
    return out_dir


# ╔═══════════════════════════════════════════════════════════════╗
# ║  Phase 2: Audit                                                ║
# ╚═══════════════════════════════════════════════════════════════╝

def audit_yolo_split_dir(
    name: str,
    img_dirs: list[Path],
    lbl_dirs: list[Path],
    classes_filter,
    samples_out: Path,
    seen_hashes: set,
):
    """
    img_dirs / lbl_dirs 同 index 對應。
    classes_filter: callable(class_id:int, names_list) -> bool, 或 set of ints
    回傳 dict 統計 + 抽樣 list[(img_path, lines)]
    """
    rng = random.Random(RNG_SEED + hash(name) % 10000)

    stats = {
        "name": name,
        "images_total": 0,
        "images_with_trunk_label": 0,
        "images_no_label": 0,
        "images_empty_label": 0,
        "images_duplicate": 0,
        "polygons_total": 0,
        "polygons_too_small": 0,
        "image_resolutions": Counter(),
        "image_aspect_buckets": Counter(),  # portrait / square / landscape
        "polygon_per_image": Counter(),
        "warnings": [],
    }

    candidates_for_sample = []

    for img_dir, lbl_dir in zip(img_dirs, lbl_dirs):
        if not img_dir.exists():
            continue
        for img_file in sorted(os.listdir(img_dir)):
            if not is_image(img_file):
                continue
            img_path = img_dir / img_file
            try:
                h = fast_file_hash(str(img_path))
            except Exception:
                continue
            if h in seen_hashes:
                stats["images_duplicate"] += 1
                continue
            seen_hashes.add(h)

            stats["images_total"] += 1
            size = load_image_size(str(img_path))
            if size is None:
                stats["warnings"].append(f"unreadable {img_path}")
                continue
            w, h_px = size
            stats["image_resolutions"][f"{w}x{h_px}"] += 1
            ar = w / max(h_px, 1)
            if ar < 0.9:
                stats["image_aspect_buckets"]["portrait"] += 1
            elif ar > 1.1:
                stats["image_aspect_buckets"]["landscape"] += 1
            else:
                stats["image_aspect_buckets"]["square"] += 1

            stem = os.path.splitext(img_file)[0]
            lbl_path = lbl_dir / f"{stem}.txt"
            rows = parse_yolo_label(str(lbl_path))
            if rows is None:
                stats["images_no_label"] += 1
                continue
            if not rows:
                stats["images_empty_label"] += 1
                continue

            trunk_rows = []
            for cls, vals in rows:
                if isinstance(classes_filter, set):
                    if cls not in classes_filter:
                        continue
                else:
                    if not classes_filter(cls):
                        continue
                # 大小過濾僅統計
                if len(vals) >= 6 and len(vals) % 2 == 0:
                    pts = np.array(vals).reshape(-1, 2)
                    bbox_w = (pts[:, 0].max() - pts[:, 0].min()) * w
                    bbox_h = (pts[:, 1].max() - pts[:, 1].min()) * h_px
                    if bbox_w * bbox_h < 100 * 100:
                        stats["polygons_too_small"] += 1
                trunk_rows.append((0, vals))  # 統一 cls=0

            if trunk_rows:
                stats["images_with_trunk_label"] += 1
                stats["polygons_total"] += len(trunk_rows)
                stats["polygon_per_image"][len(trunk_rows)] += 1
                candidates_for_sample.append((str(img_path), trunk_rows))

    # 抽 SAMPLE_OVERLAY_COUNT 張存 overlay
    samples_out.mkdir(parents=True, exist_ok=True)
    if candidates_for_sample:
        rng.shuffle(candidates_for_sample)
        for i, (ip, lines) in enumerate(candidates_for_sample[:SAMPLE_OVERLAY_COUNT]):
            out = samples_out / f"sample_{i:02d}.jpg"
            try:
                overlay_one(ip, lines, str(out))
            except Exception as e:
                stats["warnings"].append(f"overlay fail {ip}: {e}")

    # 把 Counter 轉 dict 方便 JSON
    stats["image_resolutions_top10"] = dict(stats["image_resolutions"].most_common(10))
    stats["image_aspect_buckets"] = dict(stats["image_aspect_buckets"])
    stats["polygon_per_image"] = dict(sorted(stats["polygon_per_image"].items()))
    del stats["image_resolutions"]

    return stats, candidates_for_sample


def audit_roboflow(loc: Path, samples_root: Path, seen: set):
    import yaml
    cfg_path = loc / "data.yaml"
    if not cfg_path.exists():
        return None
    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    names = cfg.get("names", [])
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names.keys())]

    ds_basename = loc.name
    extra_trunk = set()
    for key, val in EXTRA_TRUNK_OVERRIDES.items():
        if key in ds_basename:
            extra_trunk = val
            break
    trunk_ids = set()
    for idx, name in enumerate(names):
        n = str(name).lower().strip()
        if "trunk" in n or str(idx) in extra_trunk:
            trunk_ids.add(idx)
    if not trunk_ids and len(names) == 1:
        trunk_ids = {0}

    img_dirs, lbl_dirs = [], []
    for split in ["train", "valid", "test"]:
        img_dirs.append(loc / split / "images")
        lbl_dirs.append(loc / split / "labels")

    return audit_yolo_split_dir(
        name=loc.name,
        img_dirs=img_dirs,
        lbl_dirs=lbl_dirs,
        classes_filter=trunk_ids,
        samples_out=samples_root / loc.name,
        seen_hashes=seen,
    ) + ({"trunk_ids": sorted(trunk_ids), "names": names},)


def audit_kaggle_voc(loc: Path, samples_root: Path, seen: set):
    """Urban Street 是 VOC 格式：JPEGImages + SegmentationClass。"""
    import cv2

    voc_root = None
    for root, dirs, files in os.walk(loc):
        if "JPEGImages" in dirs and "SegmentationClass" in dirs:
            voc_root = Path(root)
            break
    if not voc_root:
        return None, [], {"name": loc.name, "warning": "找不到 VOC 結構"}

    jpeg_dir = voc_root / "JPEGImages"
    seg_dir = voc_root / "SegmentationClass"

    stats = {
        "name": loc.name,
        "format": "VOC (JPEGImages + SegmentationClass)",
        "voc_root": str(voc_root),
        "images_total": 0,
        "images_with_trunk_label": 0,
        "images_no_mask": 0,
        "images_duplicate": 0,
        "polygons_total": 0,
        "image_resolutions": Counter(),
        "image_aspect_buckets": Counter(),
        "warnings": [],
    }

    rng = random.Random(RNG_SEED + 99)
    candidates = []
    mask_files = sorted([f for f in os.listdir(seg_dir) if f.lower().endswith(".png")])

    for mask_fname in mask_files:
        stem = os.path.splitext(mask_fname)[0]
        img_path = None
        for ext in [".jpg", ".jpeg", ".png", ".JPG", ".JPEG"]:
            cand = jpeg_dir / f"{stem}{ext}"
            if cand.exists():
                img_path = cand
                break
        if img_path is None:
            stats["images_no_mask"] += 1
            continue
        try:
            h = fast_file_hash(str(img_path))
        except Exception:
            continue
        if h in seen:
            stats["images_duplicate"] += 1
            continue
        seen.add(h)

        stats["images_total"] += 1
        size = load_image_size(str(img_path))
        if size is None:
            continue
        w, hp = size
        stats["image_resolutions"][f"{w}x{hp}"] += 1
        ar = w / max(hp, 1)
        if ar < 0.9:
            stats["image_aspect_buckets"]["portrait"] += 1
        elif ar > 1.1:
            stats["image_aspect_buckets"]["landscape"] += 1
        else:
            stats["image_aspect_buckets"]["square"] += 1

        # mask → polygon
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
            pts = []
            for pt in approx:
                pts.extend([
                    max(0.0, min(1.0, pt[0][0] / w)),
                    max(0.0, min(1.0, pt[0][1] / hp)),
                ])
            lines.append((0, pts))
        if lines:
            stats["images_with_trunk_label"] += 1
            stats["polygons_total"] += len(lines)
            candidates.append((str(img_path), lines))

    stats["image_resolutions_top10"] = dict(stats["image_resolutions"].most_common(10))
    stats["image_aspect_buckets"] = dict(stats["image_aspect_buckets"])
    del stats["image_resolutions"]

    # overlay
    out_dir = samples_root / loc.name
    out_dir.mkdir(parents=True, exist_ok=True)
    rng.shuffle(candidates)
    for i, (ip, lines) in enumerate(candidates[:SAMPLE_OVERLAY_COUNT]):
        try:
            overlay_one(ip, lines, str(out_dir / f"sample_{i:02d}.jpg"))
        except Exception:
            pass

    return stats, candidates, {"format": "voc"}


def audit_xiang(loc: Path, samples_root: Path, seen: set):
    """Xiang 用 treeRGB + treeSeg-tm.png mask。"""
    import cv2

    rgb_dirs = list(loc.rglob("treeRGB"))
    seg_dirs = list(loc.rglob("treeSeg"))
    if not rgb_dirs or not seg_dirs:
        return None, [], {"name": "xiang", "warning": "找不到 treeRGB / treeSeg"}

    rgb_dir, seg_dir = rgb_dirs[0], seg_dirs[0]
    stats = {
        "name": "xiang_zenodo",
        "rgb_dir": str(rgb_dir),
        "seg_dir": str(seg_dir),
        "images_total": 0,
        "images_with_trunk_label": 0,
        "images_no_mask": 0,
        "images_duplicate": 0,
        "polygons_total": 0,
        "image_resolutions": Counter(),
        "image_aspect_buckets": Counter(),
        "warnings": [],
    }

    rgb_files = sorted([f for f in rgb_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp")])
    candidates = []

    for rgb_path in rgb_files:
        stem = rgb_path.stem
        possible_masks = [
            seg_dir / f"{stem}-tm.jpg", seg_dir / f"{stem}-tm.png",
            seg_dir / f"{stem}_mask.jpg", seg_dir / f"{stem}_mask.png",
            seg_dir / f"{stem}.jpg", seg_dir / f"{stem}.png",
        ]
        mask_path = next((mp for mp in possible_masks if mp.exists()), None)
        if not mask_path:
            stats["images_no_mask"] += 1
            continue
        try:
            h = fast_file_hash(str(rgb_path))
        except Exception:
            continue
        if h in seen:
            stats["images_duplicate"] += 1
            continue
        seen.add(h)

        stats["images_total"] += 1
        size = load_image_size(str(rgb_path))
        if size is None:
            continue
        w, hp = size
        stats["image_resolutions"][f"{w}x{hp}"] += 1
        ar = w / max(hp, 1)
        if ar < 0.9:
            stats["image_aspect_buckets"]["portrait"] += 1
        elif ar > 1.1:
            stats["image_aspect_buckets"]["landscape"] += 1
        else:
            stats["image_aspect_buckets"]["square"] += 1

        mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        _, binary = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        lines = []
        for cnt in contours:
            if cv2.contourArea(cnt) < 500:
                continue
            eps = 0.005 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, eps, True)
            if len(approx) < 3:
                continue
            pts = []
            for pt in approx:
                pts.extend([
                    max(0.0, min(1.0, pt[0][0] / w)),
                    max(0.0, min(1.0, pt[0][1] / hp)),
                ])
            lines.append((0, pts))
        if lines:
            stats["images_with_trunk_label"] += 1
            stats["polygons_total"] += len(lines)
            candidates.append((str(rgb_path), lines))

    stats["image_resolutions_top10"] = dict(stats["image_resolutions"].most_common(10))
    stats["image_aspect_buckets"] = dict(stats["image_aspect_buckets"])
    del stats["image_resolutions"]

    out_dir = samples_root / "xiang_zenodo"
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(RNG_SEED + 1)
    rng.shuffle(candidates)
    for i, (ip, lines) in enumerate(candidates[:SAMPLE_OVERLAY_COUNT]):
        try:
            overlay_one(ip, lines, str(out_dir / f"sample_{i:02d}.jpg"))
        except Exception:
            pass

    return stats, candidates, {"format": "rgb_mask_pair"}


# ╔═══════════════════════════════════════════════════════════════╗
# ║  Phase 3: Report                                               ║
# ╚═══════════════════════════════════════════════════════════════╝

def write_report(report_path: Path, all_stats: list, log: list, samples_root: Path):
    lines = []
    p = lines.append
    p("# 樹幹偵測訓練資料 — 稽核報告")
    p("")
    p(f"產生時間：{time.strftime('%Y-%m-%d %H:%M:%S')}")
    p(f"樣本 overlay 路徑：`{samples_root}`")
    p("")
    p("## 摘要")
    total_imgs = sum(s.get("images_with_trunk_label", 0) for s in all_stats)
    total_polys = sum(s.get("polygons_total", 0) for s in all_stats)
    p(f"- 來源數: **{len(all_stats)}**")
    p(f"- 含 trunk 標註影像總數（去重後）: **{total_imgs}**")
    p(f"- trunk polygon 總數: **{total_polys}**")
    p("")

    if log:
        p("## ⚠️ 警告 / 錯誤")
        for l in log:
            p(f"- {l}")
        p("")

    p("## 各來源統計")
    for s in all_stats:
        p(f"### {s.get('name', '?')}")
        for k in ("format", "voc_root", "rgb_dir", "seg_dir", "trunk_ids", "names"):
            if k in s:
                p(f"- {k}: `{s[k]}`")
        for k in (
            "images_total", "images_with_trunk_label", "images_no_label",
            "images_no_mask", "images_empty_label", "images_duplicate",
            "polygons_total", "polygons_too_small",
        ):
            if k in s:
                p(f"- {k}: **{s[k]}**")
        if "image_aspect_buckets" in s and s["image_aspect_buckets"]:
            p(f"- 縱橫比分布: {s['image_aspect_buckets']}")
        if "image_resolutions_top10" in s and s["image_resolutions_top10"]:
            p(f"- 解析度 Top10: {s['image_resolutions_top10']}")
        if "polygon_per_image" in s and s["polygon_per_image"]:
            p(f"- 每張 polygon 數分布: {s['polygon_per_image']}")
        if s.get("warnings"):
            p(f"- ⚠️ warnings (前 5): {s['warnings'][:5]}")
        p("")

    p("## 人工檢查 checklist")
    p("- [ ] 開 `_audit_samples/kaggle_urban_street/` 看影像是不是中國/路樹（確認資料地理來源）")
    p("- [ ] 各 Roboflow 來源 mask 邊緣品質")
    p("- [ ] xiang_zenodo 是否影像數 = 294（與 tree_log.csv 對齊）")
    p("- [ ] 是否有人臉/車牌等隱私問題")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n✅ 報告寫入: {report_path}")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  Main                                                          ║
# ╚═══════════════════════════════════════════════════════════════╝

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--data-root",
        default=r"C:\projects\tree_project\trunk_training_data",
        help="所有資料集的下載/快取根目錄",
    )
    ap.add_argument("--skip-download", action="store_true", help="只跑稽核，不重新下載")
    ap.add_argument("--skip-roboflow", action="store_true")
    ap.add_argument("--skip-kaggle", action="store_true")
    ap.add_argument("--skip-xiang", action="store_true")
    args = ap.parse_args()

    data_root = Path(args.data_root)
    data_root.mkdir(parents=True, exist_ok=True)
    samples_root = data_root / "_audit_samples"
    if samples_root.exists():
        shutil.rmtree(samples_root)
    samples_root.mkdir(parents=True, exist_ok=True)

    log: list[str] = []

    # ---- Phase 1: download ----
    print("\n=== Phase 1: download ===")
    roboflow_dirs = []
    kaggle_dir = None
    xiang_dir = None
    if not args.skip_download:
        if not args.skip_roboflow:
            print("\n[Roboflow]")
            roboflow_dirs = step_download_roboflow(data_root, log)
        if not args.skip_kaggle:
            print("\n[Kaggle Urban Street]")
            kaggle_dir = step_download_kaggle(data_root, log)
        if not args.skip_xiang:
            print("\n[Xiang Zenodo]")
            xiang_dir = step_download_xiang(data_root, log)
    else:
        # 僅指向已存在目錄
        roboflow_dirs = [d for d in sorted(data_root.glob("roboflow_*")) if d.is_dir()]
        if (data_root / "kaggle_urban_street").exists():
            kaggle_dir = data_root / "kaggle_urban_street"
        if (data_root / "xiang_zenodo").exists():
            xiang_dir = data_root / "xiang_zenodo"

    # ---- Phase 2: audit ----
    print("\n=== Phase 2: audit ===")
    seen_hashes: set[str] = set()
    all_stats: list[dict] = []

    for d in roboflow_dirs:
        print(f"\n[audit] {d.name}")
        out = audit_roboflow(d, samples_root, seen_hashes)
        if not out:
            log.append(f"⚠️ Roboflow {d} 缺 data.yaml")
            continue
        stats, _candidates, extra = out
        stats.update(extra)
        all_stats.append(stats)

    if kaggle_dir:
        print(f"\n[audit] {kaggle_dir.name}")
        stats, _c, extra = audit_kaggle_voc(kaggle_dir, samples_root, seen_hashes)
        if stats:
            stats.update(extra)
            all_stats.append(stats)

    if xiang_dir:
        print("\n[audit] xiang_zenodo")
        stats, _c, extra = audit_xiang(xiang_dir, samples_root, seen_hashes)
        if stats:
            stats.update(extra)
            all_stats.append(stats)

    # ---- Phase 3: report ----
    print("\n=== Phase 3: report ===")
    (data_root / "_audit_stats.json").write_text(
        json.dumps(all_stats, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    write_report(data_root / "dataset_audit_report.md", all_stats, log, samples_root)

    print("\n✓ 全部完成")
    print(f"  → 報告: {data_root / 'dataset_audit_report.md'}")
    print(f"  → JSON: {data_root / '_audit_stats.json'}")
    print(f"  → 抽樣: {samples_root}")
    print("\n下一步：")
    print(f"  1. 開報告檢查每個來源（特別是 kaggle_urban_street 是否中國路樹）")
    print(f"  2. 開 {samples_root}\\kaggle_urban_street\\ 肉眼看影像")
    print(f"  3. 確認 OK 後跑 prepare_merged_local.py 生成訓練集")


if __name__ == "__main__":
    main()
