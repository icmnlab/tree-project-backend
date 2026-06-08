#!/usr/bin/env python3
"""
🌲 YOLOv8-seg 樹幹偵測 — 訓練 Nano + Small 模型
==================================================
已有 yolov8m-seg (54.6MB)，這個腳本只訓練 n 和 s 兩個輕量版本。
資料集沿用 train_all_in_one.py 的資料準備流程。

使用方式（Colab Pro）：
1. Runtime → Change runtime type → L4 GPU（性價比最高，推薦）
   - L4 (22.5GB): 輕量模型最佳選擇，VRAM 足夠 batch=64-128
   - T4 (15GB):   也可以，稍慢，batch 需降至 32-64
   - A100 (40GB): 太貴（費用是 T4 的 7-8x），對 n/s 模型無明顯加速
2. 上傳此檔案到 Colab
3. !python train_n_s_models.py

預估時間（L4 GPU）：
  - yolov8n-seg: ~20-30 分鐘
  - yolov8s-seg: ~30-45 分鐘
  - 資料準備（首次）: ~10-15 分鐘
  - 總計: ~60-90 分鐘
==================================================
"""

import os, sys
os.environ['PYTHONUNBUFFERED'] = '1'
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None

import time, shutil, glob, random, hashlib, gc
import numpy as np
from pathlib import Path
from collections import defaultdict

# ╔══════════════════════════════════════════════════════╗
# ║  Step -1：清理殘留記憶體（防止 OOM）                    ║
# ╚══════════════════════════════════════════════════════╝
print('🧹 清理殘留記憶體...')

# 清理 Python 垃圾回收
gc.collect()

# 清理 GPU 記憶體（如果之前有 PyTorch 載入）
try:
    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        # 釋放所有 CUDA tensors
        for obj in gc.get_objects():
            try:
                if torch.is_tensor(obj) and obj.is_cuda:
                    del obj
            except:
                pass
        gc.collect()
        torch.cuda.empty_cache()
        allocated = torch.cuda.memory_allocated() / 1024**2
        reserved = torch.cuda.memory_reserved() / 1024**2
        print(f'  GPU 記憶體: allocated={allocated:.0f}MB, reserved={reserved:.0f}MB')

        # 如果殘留 >5GB，說明之前的訓練沒有被正確釋放
        if allocated > 5000:
            print(f'\n❌ GPU 仍有 {allocated:.0f}MB 殘留記憶體！')
            print('   Python 層面無法釋放其他 process 的 CUDA 記憶體。')
            print('   請執行以下步驟：')
            print('   1. Runtime → Restart runtime（或 Ctrl+M .）')
            print('   2. 重啟後再次執行此腳本')
            print('   （merged_dataset 在磁碟上，重啟不會消失）')
            sys.exit(1)
except ImportError:
    pass

# 清理先前訓練的殘留 runs 目錄（釋放磁碟空間）
# ⚠️ 不要刪除 exported_models！裡面可能有已完成模型的 best.pt
for old_run in ['/content/runs']:
    if os.path.exists(old_run):
        shutil.rmtree(old_run)
        print(f'  🗑️ 已刪除 {old_run}')

# 強制 gc
gc.collect()
print('✓ 記憶體清理完成\n')

# ╔══════════════════════════════════════════════════════╗
# ║  可調參數                                             ║
# ╚══════════════════════════════════════════════════════╝

# 金鑰一律由環境變數提供，勿寫死於程式（set ROBOFLOW_API_KEY / KAGGLE_USERNAME / KAGGLE_KEY）
# --- Roboflow ---
ROBOFLOW_API_KEY = os.environ.get('ROBOFLOW_API_KEY', '')

# --- Kaggle ---
KAGGLE_USERNAME = os.environ.get('KAGGLE_USERNAME', '')
KAGGLE_KEY = os.environ.get('KAGGLE_KEY', '')

# --- 要訓練的模型尺寸 ---
# m 已經有了，只練 n 和 s
MODELS_TO_TRAIN = [
    ('yolov8n-seg.pt', 'nano',  'tree_trunk_seg_n'),
]

# --- 訓練參數 ---
EPOCHS = 60
IMAGE_SIZE = 640
BATCH_SIZE_OVERRIDE = 0  # 0 = 自動偵測最佳 batch size

# --- 學術資料加權 ---
URBAN_OVERSAMPLE = 0
XIANG_OVERSAMPLE = 1

# --- Roboflow 資料集清單 ---
DATASETS = [
    ('tree-trunks', 'tree-trunk-detection-bi-axe', 1, '主資料集 1.3k 張'),
    ('tree-trunks', 'cherry-trunks', 2, '櫻桃樹幹 337 張'),
    ('imageprocessing-mo6fy', 'tree_trunk-weppw', 1, '6 classes 1.1k 張'),
    ('tree-trunks', 'tree-trunk-detection-369pz', 5, 'seg 1.1k 張 (trunk+sprinkler+post)'),
    ('wurdataset', 'tree-trunk-segmentation-ixblx', 1, '精確標註 172 張'),
]

# --- 路徑 ---
MERGED_DIR = '/content/merged_dataset'
URBAN_STREET_DIR = '/content/urban_street_trunk'
URBAN_CONVERTED_DIR = '/content/urban_street_converted'
XIANG_DIR = '/content/xiang_validation'
XIANG_TRAIN = '/content/xiang_yolo_train'
XIANG_VAL = '/content/xiang_yolo_validation'

TFLITE_EXPORT_SIZE = 640

# ╔══════════════════════════════════════════════════════╗
# ║  Step 0：確認 GPU                                    ║
# ╚══════════════════════════════════════════════════════╝
print('\n' + '='*60)
print('Step 0：確認 GPU')
print('='*60)

os.system('nvidia-smi')

import torch
print(f'PyTorch: {torch.__version__}')
print(f'CUDA: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    gpu_name = torch.cuda.get_device_name(0)
    props = torch.cuda.get_device_properties(0)
    total = getattr(props, 'total_memory', None) or getattr(props, 'total_mem', None)
    gpu_mem_gb = total / 1024**3 if total else 0
    print(f'GPU: {gpu_name} ({gpu_mem_gb:.1f} GB)')
else:
    gpu_mem_gb = 0
    print('⚠️ 沒有偵測到 GPU！訓練會很慢')

# ╔══════════════════════════════════════════════════════╗
# ║  Step 1：安裝依賴                                     ║
# ╚══════════════════════════════════════════════════════╝
print('\n' + '='*60)
print('Step 1：安裝依賴')
print('='*60)

_need_install = False
try:
    import ultralytics, roboflow
    print('✓ 已安裝（跳過 pip install）')
except ImportError:
    _need_install = True

if _need_install:
    os.system('pip install ultralytics roboflow supervision zenodo_get kaggle -q')
    print('✓ 安裝完成')

# ╔══════════════════════════════════════════════════════╗
# ║  Step 2~3：資料準備（自動偵測，已有就跳過）             ║
# ╚══════════════════════════════════════════════════════╝
data_yaml_path = os.path.join(MERGED_DIR, 'data.yaml')
skip_data = False

if os.path.exists(data_yaml_path):
    _splits_ok = True
    for _s in ['train', 'valid', 'test']:
        _img_dir = os.path.join(MERGED_DIR, _s, 'images')
        if not os.path.exists(_img_dir) or len(os.listdir(_img_dir)) == 0:
            _splits_ok = False
            break
    skip_data = _splits_ok

if skip_data:
    print('\n' + '='*60)
    print('⏭️  資料集已存在，跳過 Step 2~3')
    print('='*60)
    for split in ['train', 'valid', 'test']:
        img_dir = os.path.join(MERGED_DIR, split, 'images')
        if os.path.exists(img_dir):
            count = len(os.listdir(img_dir))
            print(f'  {split}: {count} images ✓')
else:
    # ========== 完整資料準備流程 ==========
    # 直接跑 train_all_in_one.py 的資料準備部分
    print('\n' + '='*60)
    print('資料集不存在，執行完整資料準備...')
    print('提示：如果你已經用 train_all_in_one.py 準備過資料，')
    print('      可以先跑一次 train_all_in_one.py（它會自動快取資料）')
    print('='*60)

    # --- Step 2: Roboflow ---
    print('\n' + '='*60)
    print('Step 2：下載 Roboflow 資料集')
    print('='*60)

    from roboflow import Roboflow
    rf = Roboflow(api_key=ROBOFLOW_API_KEY)

    downloaded_datasets = []
    for i, (ws, proj, ver, desc) in enumerate(DATASETS, 1):
        print(f'\n[{i}/{len(DATASETS)}] 下載 {ws}/{proj} v{ver}...')
        try:
            project = rf.workspace(ws).project(proj)
            ds = project.version(ver).download(
                model_format='yolov8',
                location=f'/content/dataset_{i}',
                overwrite=False
            )
            downloaded_datasets.append(ds)
            print(f'  ✓ 完成')
        except Exception as e:
            print(f'  ✗ 下載失敗: {e}')
    print(f'\n✓ 成功下載 {len(downloaded_datasets)}/{len(DATASETS)} 個資料集')

    # --- Step 2.5: Urban Street (Kaggle) ---
    print('\n' + '='*60)
    print('Step 2.5：下載 Urban Street Trunk（Kaggle）')
    print('='*60)

    if KAGGLE_USERNAME and KAGGLE_KEY:
        os.environ['KAGGLE_USERNAME'] = KAGGLE_USERNAME
        os.environ['KAGGLE_KEY'] = KAGGLE_KEY
        DATASET_SLUG = 'erickendric/tree-dataset-of-urban-street-segmentation-trunk'
        print(f'\n📥 下載 {DATASET_SLUG}...')
        ret = os.system(f'kaggle datasets download -d {DATASET_SLUG} -p {URBAN_STREET_DIR} --unzip')
        if ret == 0:
            total_files = sum(len(fnames) for _, _, fnames in os.walk(URBAN_STREET_DIR))
            print(f'\n✓ 下載完成！共 {total_files} 個檔案')
        else:
            print('❌ 下載失敗')
    else:
        print('⚠️ 未設定 Kaggle 認證，跳過')

    # --- Step 2.5b: VOC → YOLO-seg 轉換 ---
    print('\n' + '='*60)
    print('Step 2.5b：VOC → YOLO-seg 轉換')
    print('='*60)

    import cv2

    if os.path.exists(URBAN_STREET_DIR):
        voc_root = None
        for root, dirs, files in os.walk(URBAN_STREET_DIR):
            if 'JPEGImages' in dirs and 'SegmentationClass' in dirs:
                voc_root = root
                break

        if voc_root:
            print(f'✓ VOC root: {voc_root}')
            JPEG_DIR = os.path.join(voc_root, 'JPEGImages')
            SEG_DIR = os.path.join(voc_root, 'SegmentationClass')

            if os.path.exists(URBAN_CONVERTED_DIR):
                shutil.rmtree(URBAN_CONVERTED_DIR)
            os.makedirs(os.path.join(URBAN_CONVERTED_DIR, 'images'), exist_ok=True)
            os.makedirs(os.path.join(URBAN_CONVERTED_DIR, 'labels'), exist_ok=True)

            def mask_to_yolo_polygons(mask_path, img_w, img_h, min_area=100):
                mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
                if mask is None:
                    mask_bgr = cv2.imread(mask_path, cv2.IMREAD_COLOR)
                    if mask_bgr is None: return []
                    mask = cv2.imread(mask_path, cv2.IMREAD_UNCHANGED)
                    if mask is None: return []
                    if len(mask.shape) == 3:
                        gray = cv2.cvtColor(mask_bgr, cv2.COLOR_BGR2GRAY)
                        mask = (gray > 0).astype(np.uint8) * 255
                if mask.max() <= 1:
                    binary = (mask > 0).astype(np.uint8) * 255
                else:
                    binary = np.zeros_like(mask)
                    binary[(mask > 0) & (mask < 255)] = 255
                contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_L1)
                yolo_lines = []
                for contour in contours:
                    if cv2.contourArea(contour) < min_area: continue
                    epsilon = 0.001 * cv2.arcLength(contour, True)
                    approx = cv2.approxPolyDP(contour, epsilon, True)
                    if len(approx) < 3: continue
                    points = []
                    for pt in approx:
                        nx = max(0.0, min(1.0, pt[0][0] / img_w))
                        ny = max(0.0, min(1.0, pt[0][1] / img_h))
                        points.extend([f'{nx:.6f}', f'{ny:.6f}'])
                    yolo_lines.append('0 ' + ' '.join(points))
                return yolo_lines

            from PIL import Image as _PILImage
            mask_files = sorted([f for f in os.listdir(SEG_DIR) if f.lower().endswith('.png')])
            converted_urban = 0
            for i, mask_fname in enumerate(mask_files):
                if (i + 1) % 1000 == 0: print(f'  進度: {i+1}/{len(mask_files)}')
                mask_path = os.path.join(SEG_DIR, mask_fname)
                stem = os.path.splitext(mask_fname)[0]
                img_path = None
                for ext in ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG']:
                    candidate = os.path.join(JPEG_DIR, stem + ext)
                    if os.path.exists(candidate):
                        img_path = candidate
                        break
                if not img_path: continue
                try:
                    with _PILImage.open(img_path) as _pil_img: img_w, img_h = _pil_img.size
                except: continue
                try:
                    yolo_lines = mask_to_yolo_polygons(mask_path, img_w, img_h)
                except: continue
                if not yolo_lines: continue
                img_ext = os.path.splitext(img_path)[1]
                out_name = f'urban_{converted_urban:05d}'
                try: os.link(img_path, os.path.join(URBAN_CONVERTED_DIR, 'images', out_name + img_ext))
                except: shutil.copy2(img_path, os.path.join(URBAN_CONVERTED_DIR, 'images', out_name + img_ext))
                with open(os.path.join(URBAN_CONVERTED_DIR, 'labels', out_name + '.txt'), 'w') as f:
                    f.write('\n'.join(yolo_lines) + '\n')
                converted_urban += 1
            print(f'✓ Urban Street 轉換: {converted_urban} 張')
        else:
            print('❌ 找不到 VOC 結構')
    else:
        print('⚠️ Urban Street 目錄不存在')

    # --- Step 2.7: Xiang et al. ---
    print('\n' + '='*60)
    print('Step 2.7：Xiang et al.（Zenodo）')
    print('='*60)

    os.makedirs(XIANG_DIR, exist_ok=True)
    ret = os.system(f'cd {XIANG_DIR} && zenodo_get 10.5281/zenodo.10650629')
    if ret != 0:
        ZIP_URL = 'https://zenodo.org/records/10650629/files/data%20and%20code.zip?download=1'
        os.system(f'wget -q --show-progress -O "{XIANG_DIR}/data_and_code.zip" "{ZIP_URL}"')
    for z in glob.glob(os.path.join(XIANG_DIR, '*.zip')):
        os.system(f'unzip -q -o "{z}" -d "{XIANG_DIR}"')

    import yaml

    for d in [XIANG_TRAIN, XIANG_VAL]:
        if os.path.exists(d): shutil.rmtree(d)
        os.makedirs(os.path.join(d, 'images'), exist_ok=True)
        os.makedirs(os.path.join(d, 'labels'), exist_ok=True)

    rgb_dirs = list(Path(XIANG_DIR).rglob('treeRGB'))
    seg_dirs = list(Path(XIANG_DIR).rglob('treeSeg'))

    if rgb_dirs and seg_dirs:
        rgb_dir, seg_dir = rgb_dirs[0], seg_dirs[0]
        rgb_files = sorted([f for f in rgb_dir.iterdir() if f.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp')])
        converted_pairs_xiang = []
        for rgb_path in rgb_files:
            stem = rgb_path.stem
            possible_masks = [seg_dir / f'{stem}-tm.jpg', seg_dir / f'{stem}-tm.png',
                              seg_dir / f'{stem}_mask.jpg', seg_dir / f'{stem}_mask.png',
                              seg_dir / f'{stem}.jpg', seg_dir / f'{stem}.png']
            mask_path = next((mp for mp in possible_masks if mp.exists()), None)
            if not mask_path: continue
            mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
            if mask is None: continue
            _, binary = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours: continue
            H, W = mask.shape[:2]
            yolo_lines = []
            for cnt in contours:
                if cv2.contourArea(cnt) < 500: continue
                epsilon = 0.005 * cv2.arcLength(cnt, True)
                approx = cv2.approxPolyDP(cnt, epsilon, True)
                if len(approx) < 3: continue
                points = []
                for pt in approx:
                    points.extend([f'{max(0.0, min(1.0, pt[0][0] / W)):.6f}',
                                   f'{max(0.0, min(1.0, pt[0][1] / H)):.6f}'])
                yolo_lines.append('0 ' + ' '.join(points))
            if yolo_lines:
                converted_pairs_xiang.append((rgb_path, yolo_lines))

        random.seed(42)
        indices = list(range(len(converted_pairs_xiang)))
        random.shuffle(indices)
        n_train_x = int(len(indices) * 0.8)
        train_c, val_c = 0, 0
        for rank, idx in enumerate(indices):
            rgb_p, yl = converted_pairs_xiang[idx]
            is_train = rank < n_train_x
            out_dir = XIANG_TRAIN if is_train else XIANG_VAL
            out_idx = train_c if is_train else val_c
            out_name = f'xiang_tree_{out_idx:04d}'
            shutil.copy2(str(rgb_p), os.path.join(out_dir, 'images', out_name + rgb_p.suffix))
            with open(os.path.join(out_dir, 'labels', out_name + '.txt'), 'w') as f:
                f.write('\n'.join(yl) + '\n')
            if is_train: train_c += 1
            else: val_c += 1
        for d, split_key in [(XIANG_VAL, 'val'), (XIANG_TRAIN, 'train')]:
            with open(os.path.join(d, 'data.yaml'), 'w') as f:
                yaml.dump({'path': d, split_key: 'images', 'nc': 1, 'names': ['tree_trunk']}, f)
        print(f'✓ Xiang: train={train_c}, val={val_c}')
    else:
        print('❌ 找不到 Xiang 資料')

    # --- Step 3: 合併 ---
    print('\n' + '='*60)
    print('Step 3：合併資料集')
    print('='*60)

    import yaml

    if os.path.exists(MERGED_DIR): shutil.rmtree(MERGED_DIR)
    for split in ['train', 'valid', 'test']:
        os.makedirs(os.path.join(MERGED_DIR, split, 'images'), exist_ok=True)
        os.makedirs(os.path.join(MERGED_DIR, split, 'labels'), exist_ok=True)

    all_pairs = []
    seen_hashes = set()
    stats = defaultdict(int)

    def fast_file_hash(filepath):
        st = os.stat(filepath)
        with open(filepath, 'rb') as f: head = f.read(2048)
        return hashlib.md5(f'{st.st_size}:{head}'.encode('latin-1')).hexdigest()

    EXTRA_TRUNK_OVERRIDES = {'tree_trunk-weppw': {'0', '2'}}

    for ds in downloaded_datasets:
        ds_dir = ds.location
        with open(os.path.join(ds_dir, 'data.yaml'), 'r') as f: cfg = yaml.safe_load(f)
        names = cfg.get('names', [])
        if isinstance(names, dict): names = [names[k] for k in sorted(names.keys())]
        ds_basename = os.path.basename(ds_dir)
        extra_trunk = set()
        for key, val in EXTRA_TRUNK_OVERRIDES.items():
            if key in ds_basename: extra_trunk = val; break
        trunk_ids = set()
        for idx, name in enumerate(names):
            n = str(name).lower().strip()
            if 'trunk' in n or n in extra_trunk: trunk_ids.add(idx)
        if not trunk_ids:
            if len(names) == 1: trunk_ids = {0}
            else: continue

        for split in ['train', 'valid', 'test']:
            img_dir = os.path.join(ds_dir, split, 'images')
            lbl_dir = os.path.join(ds_dir, split, 'labels')
            if not os.path.exists(img_dir): continue
            for img_file in os.listdir(img_dir):
                if not img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp')): continue
                img_path = os.path.join(img_dir, img_file)
                img_hash = fast_file_hash(img_path)
                if img_hash in seen_hashes: continue
                seen_hashes.add(img_hash)
                stem = os.path.splitext(img_file)[0]
                lbl_path = os.path.join(lbl_dir, stem + '.txt')
                trunk_lines = []
                if os.path.exists(lbl_path):
                    with open(lbl_path, 'r') as f:
                        for line in f:
                            parts = line.strip().split()
                            if len(parts) >= 5:
                                cls = int(parts[0])
                                if cls in trunk_ids:
                                    parts[0] = '0'
                                    trunk_lines.append(' '.join(parts))
                if trunk_lines:
                    all_pairs.append((img_path, trunk_lines))
                elif random.random() < 0.1:
                    all_pairs.append((img_path, []))

    roboflow_count = len(all_pairs)

    # Urban Street
    urban_img_dir = os.path.join(URBAN_CONVERTED_DIR, 'images')
    urban_lbl_dir = os.path.join(URBAN_CONVERTED_DIR, 'labels')
    if os.path.exists(urban_img_dir):
        for img_file in os.listdir(urban_img_dir):
            if not img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp')): continue
            img_path = os.path.join(urban_img_dir, img_file)
            img_hash = fast_file_hash(img_path)
            if img_hash in seen_hashes: continue
            seen_hashes.add(img_hash)
            lbl_path = os.path.join(urban_lbl_dir, os.path.splitext(img_file)[0] + '.txt')
            trunk_lines = []
            if os.path.exists(lbl_path):
                with open(lbl_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line and len(line.split()) >= 5: trunk_lines.append(line)
            if trunk_lines: all_pairs.append((img_path, trunk_lines))
            elif random.random() < 0.05: all_pairs.append((img_path, []))

    # Xiang Train
    xiang_img = os.path.join(XIANG_TRAIN, 'images')
    xiang_lbl = os.path.join(XIANG_TRAIN, 'labels')
    if os.path.exists(xiang_img):
        for img_file in os.listdir(xiang_img):
            if not img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp')): continue
            img_path = os.path.join(xiang_img, img_file)
            img_hash = fast_file_hash(img_path)
            if img_hash in seen_hashes: continue
            seen_hashes.add(img_hash)
            lbl_path = os.path.join(xiang_lbl, os.path.splitext(img_file)[0] + '.txt')
            trunk_lines = []
            if os.path.exists(lbl_path):
                with open(lbl_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line and len(line.split()) >= 5: trunk_lines.append(line)
            if trunk_lines: all_pairs.append((img_path, trunk_lines))

    # Oversampling
    xiang_pairs = [(p, l) for p, l in all_pairs if XIANG_TRAIN in p]
    for _ in range(XIANG_OVERSAMPLE):
        all_pairs.extend(xiang_pairs)

    print(f'  總影像: {len(all_pairs)} 張')

    # 分割 train/valid/test
    random.seed(42)
    random.shuffle(all_pairs)
    n = len(all_pairs)
    n_train = int(n * 0.80)
    n_valid = int(n * 0.15)

    for split_name, pairs in [('train', all_pairs[:n_train]),
                               ('valid', all_pairs[n_train:n_train+n_valid]),
                               ('test', all_pairs[n_train+n_valid:])]:
        for i, (img_path, label_lines) in enumerate(pairs):
            ext = os.path.splitext(img_path)[1]
            new_name = f'{split_name}_{i:05d}'
            dst_img = os.path.join(MERGED_DIR, split_name, 'images', new_name + ext)
            dst_lbl = os.path.join(MERGED_DIR, split_name, 'labels', new_name + '.txt')
            try: os.link(img_path, dst_img)
            except: shutil.copy2(img_path, dst_img)
            with open(dst_lbl, 'w') as f:
                f.write('\n'.join(label_lines) + '\n' if label_lines else '')

    data_yaml_path = os.path.join(MERGED_DIR, 'data.yaml')
    import yaml
    with open(data_yaml_path, 'w') as f:
        yaml.dump({'path': MERGED_DIR, 'train': 'train/images', 'val': 'valid/images',
                   'test': 'test/images', 'nc': 1, 'names': ['tree_trunk']}, f)
    print(f'✅ 資料準備完成！')

# ╔══════════════════════════════════════════════════════╗
# ║  訓練 n + s 模型                                      ║
# ╚══════════════════════════════════════════════════════╝

import torch
from ultralytics import YOLO

# 減少 CUDA 記憶體碎片（防止 validation 時 OOM）
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'

# GPU 最佳化
torch.backends.cudnn.benchmark = True
if hasattr(torch.backends, 'cuda'):
    torch.backends.cuda.matmul.allow_tf32 = True
if hasattr(torch.backends, 'cudnn'):
    torch.backends.cudnn.allow_tf32 = True

# Batch size 自動偵測
# ⚠️ seg 模型 validation 時 mask upsample 需要大量 GPU 記憶體
#    batch=128 在 95GB GPU 上 validation OOM (需要 ~90GB)
#    必須用較小的 batch，讓 validation 也能通過
if torch.cuda.is_available():
    gpu_name = torch.cuda.get_device_name(0)
    props = torch.cuda.get_device_properties(0)
    total = getattr(props, 'total_memory', None) or getattr(props, 'total_mem', None)
    gpu_mem_gb = total / 1024**3 if total else 0
    print(f'\n🖥️ GPU: {gpu_name} ({gpu_mem_gb:.1f} GB)')

    if BATCH_SIZE_OVERRIDE > 0:
        batch_size = BATCH_SIZE_OVERRIDE
    elif gpu_mem_gb >= 70:   # RTX PRO 6000 95GB
        batch_size = 64      # s: ~40GB training, validation batch//4=16 ~50GB, 安全
    elif gpu_mem_gb >= 35:   # A100 40GB / V100
        batch_size = 16
    elif gpu_mem_gb >= 20:   # L4 / T4
        batch_size = 16
    elif gpu_mem_gb >= 12:
        batch_size = 8
    else:
        batch_size = 4
else:
    batch_size = 8

export_dir = '/content/exported_models'
os.makedirs(export_dir, exist_ok=True)

total_start = time.time()

for model_pt, size_name, output_name in MODELS_TO_TRAIN:
    pt_dst = os.path.join(export_dir, f'{output_name}_best.pt')
    tflite_dst = os.path.join(export_dir, f'{output_name}.tflite')

    # ===== 跳過已完成的模型（恢復中斷時只做剩餘工作）=====
    if os.path.exists(pt_dst) and os.path.exists(tflite_dst):
        size_mb = os.path.getsize(tflite_dst) / 1024 / 1024
        print(f'\n⏭️  {size_name} 模型已完成（{size_mb:.1f}MB TFLite），跳過')
        continue

    # 如果有 best.pt 但沒有 TFLite → 只需要重新匯出（不用重訓）
    need_training = not os.path.exists(pt_dst)

    if need_training:
        print('\n' + '='*60)
        print(f'🚀 訓練 {size_name} 模型: {model_pt}')
        print(f'   Batch={batch_size}, ImgSz={IMAGE_SIZE}, Epochs={EPOCHS}')
        print('='*60)

        # 清理上次訓練殘留（避免 train/train2/train3 混亂）
        runs_dir = f'/content/runs/segment'
        if os.path.exists(runs_dir):
            shutil.rmtree(runs_dir)

        model = YOLO(model_pt)

        start_time = time.time()
        results = model.train(
            data=data_yaml_path,
            epochs=EPOCHS,
            batch=batch_size,
            imgsz=IMAGE_SIZE,
            device=0,
            workers=4,            # 平行資料載入
            cache=True,           # RAM 快取（~12GB，比 disk 快 10x）
            verbose=True,
            patience=10,          # 快速 early stop
            save=True,
            save_period=10,
            exist_ok=True,
            pretrained=True,
            optimizer='AdamW',
            lr0=0.001,
            lrf=0.01,
            warmup_epochs=5,
            cos_lr=True,
            # 資料增強
            hsv_h=0.02, hsv_s=0.6, hsv_v=0.4,
            degrees=15.0, translate=0.15, scale=0.5, shear=3.0,
            perspective=0.0005, flipud=0.0, fliplr=0.5,
            mosaic=0.9, mixup=0.15, copy_paste=0.15, erasing=0.15,
            # 分割
            overlap_mask=True, mask_ratio=1,
            amp=True, close_mosaic=15,
        )
        elapsed = time.time() - start_time
        print(f'\n✓ {size_name} 訓練完成！耗時 {elapsed/60:.1f} 分鐘')

        # --- 找到 best.pt ---
        best_pt = '/content/runs/segment/train/weights/best.pt'
        if not os.path.exists(best_pt):
            for p in ['/content/runs/segment/train2/weights/best.pt',
                      '/content/runs/segment/train3/weights/best.pt']:
                if os.path.exists(p):
                    best_pt = p
                    break

        if not os.path.exists(best_pt):
            print(f'❌ 找不到 {size_name} 的 best.pt，跳過匯出')
            continue

        # 立即保存 best.pt（防止後續清理 runs 時丟失）
        shutil.copy2(best_pt, pt_dst)
        print(f'  ✓ PyTorch: {os.path.getsize(pt_dst)/1024/1024:.1f} MB → {pt_dst}')

        # 釋放 GPU 記憶體
        del model
        gc.collect()
        torch.cuda.empty_cache()
    else:
        best_pt = pt_dst
        print(f'\n⏭️  {size_name} 已有 best.pt，跳過訓練，只做匯出')

    _free = (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()) / 1024**3
    print(f'  GPU 可用: {_free:.1f} GB')

    # --- 驗證 ---
    print(f'\n📊 驗證 {size_name} 模型品質...')
    val_model = YOLO(best_pt)
    val_batch = max(8, batch_size // 4)  # seg validation 用更小 batch 防 OOM
    metrics = val_model.val(data=data_yaml_path, batch=val_batch)
    box_map50 = float(getattr(metrics.box, 'map50', 0))
    seg_map50 = float(getattr(metrics.seg, 'map50', 0))
    print(f'  Detection mAP50: {box_map50:.3f}')
    print(f'  Segment   mAP50: {seg_map50:.3f}')

    if seg_map50 >= 0.85:
        print(f'  🏆 優秀')
    elif seg_map50 >= 0.70:
        print(f'  ✅ 良好')
    else:
        print(f'  ⚠️ 待加強（小模型精度略降是正常的）')

    # --- 匯出 TFLite ---
    # ⚠️ TFLite 匯出必須在獨立子程序中執行！
    #    PyTorch 和 TensorFlow 同時使用 CUDA 會衝突 (CUDA_ERROR_INVALID_HANDLE)
    #    解法：用 subprocess 跑 export_tflite.py，該腳本在 import 前就設 CUDA_VISIBLE_DEVICES=''
    print(f'\n📦 TFLite 匯出延後到訓練全部完成後，用獨立子程序執行')

    # --- 匯出 ONNX（在主程序中可以正常跑）---
    del val_model
    gc.collect()
    torch.cuda.empty_cache()

    onnx_dst = os.path.join(export_dir, f'{output_name}.onnx')
    if not os.path.exists(onnx_dst):
        export_model = YOLO(best_pt)
        try:
            onnx_path = export_model.export(format='onnx', imgsz=IMAGE_SIZE, simplify=True)
            if onnx_path:
                shutil.copy2(str(onnx_path), onnx_dst)
                print(f'  ✓ ONNX: {os.path.getsize(onnx_dst)/1024/1024:.1f} MB')
        except Exception as e:
            print(f'  ✗ ONNX: {e}')
        del export_model
    else:
        print(f'  ⏭️  ONNX 已存在: {os.path.getsize(onnx_dst)/1024/1024:.1f} MB')

    gc.collect()
    torch.cuda.empty_cache()

# ╔══════════════════════════════════════════════════════╗
# ║  TFLite 匯出（獨立子程序，避免 CUDA 衝突）              ║
# ╚══════════════════════════════════════════════════════╝
import subprocess

# 檢查是否有需要匯出的模型
tflite_needed = []
for model_pt, size_name, output_name in MODELS_TO_TRAIN:
    pt_dst = os.path.join(export_dir, f'{output_name}_best.pt')
    tflite_dst = os.path.join(export_dir, f'{output_name}.tflite')
    if os.path.exists(pt_dst) and not os.path.exists(tflite_dst):
        tflite_needed.append((size_name, output_name))

if tflite_needed:
    print('\n' + '='*60)
    print(f'📦 用子程序匯出 TFLite（{len(tflite_needed)} 個模型）')
    print('   子程序設定 CUDA_VISIBLE_DEVICES="" 避免 CUDA 衝突')
    print('='*60)

    # 找 export_tflite.py（和本腳本同目錄，或在 /content）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    export_script = os.path.join(script_dir, 'export_tflite.py')
    if not os.path.exists(export_script):
        export_script = '/content/export_tflite.py'

    if os.path.exists(export_script):
        # 釋放主程序 GPU 記憶體
        gc.collect()
        torch.cuda.empty_cache()

        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = '-1'
        result = subprocess.run(
            [sys.executable, export_script],
            env=env,
            capture_output=False,
            timeout=1800,  # 30 分鐘上限
        )
        if result.returncode == 0:
            print('✓ TFLite 匯出子程序完成')
        else:
            print(f'⚠️ TFLite 匯出子程序失敗 (returncode={result.returncode})')
    else:
        print(f'❌ 找不到 export_tflite.py！請上傳到 /content/ 或與本腳本同目錄')
        print(f'   搜尋路徑: {script_dir}/export_tflite.py, /content/export_tflite.py')
else:
    if all(os.path.exists(os.path.join(export_dir, f'{on}.tflite')) for _, _, on in MODELS_TO_TRAIN):
        print('\n✓ 所有 TFLite 已存在，跳過匯出')

# ╔══════════════════════════════════════════════════════╗
# ║  Labels + 打包下載                                    ║
# ╚══════════════════════════════════════════════════════╝
with open(os.path.join(export_dir, 'tree_trunk_labels.txt'), 'w') as f:
    f.write('tree_trunk\n')

total_elapsed = time.time() - total_start
print('\n' + '='*60)
print(f'🎉 全部完成！總耗時 {total_elapsed/60:.1f} 分鐘')
print('='*60)

print('\n📦 匯出的檔案:')
for f in sorted(os.listdir(export_dir)):
    fp = os.path.join(export_dir, f)
    size_mb = os.path.getsize(fp) / 1024 / 1024
    print(f'  {f}: {size_mb:.1f} MB')

# 打包
os.system('cd /content && zip -r exported_models.zip exported_models/')

try:
    from google.colab import files
    files.download('/content/exported_models.zip')
    print('\n✓ 下載開始！')
except:
    print('\n⚠️ 自動下載失敗，請手動下載: /content/exported_models.zip')

print('\n部署步驟：')
print('  1. tree_trunk_seg_n.tflite → frontend/assets/ml/tree_trunk_seg.tflite')
print('  2. 取代現有 m 模型（n 精度 mAP50=0.994，僅 6MB）')
