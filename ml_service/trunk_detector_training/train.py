#!/usr/bin/env python3
"""
YOLOv8n-seg 樹幹偵測模型訓練腳本
===================================

用 COCO 預訓練的 YOLOv8n-seg 進行遷移學習 (transfer learning)，
只訓練辨識一個類別：tree_trunk（樹幹）。

不是從零訓練！利用 COCO 學過的特徵（邊緣、紋理、形狀），
只需 500-1000 張標註圖片即可達到 mAP50 > 0.85。

Usage:
    python train.py                          # 預設參數
    python train.py --epochs 200 --batch 8   # 自訂參數
    python train.py --resume                 # 續訓
"""

import argparse
import os
import sys
from pathlib import Path


def check_dataset(data_yaml: str) -> bool:
    """驗證資料集是否存在且格式正確。"""
    import yaml

    if not os.path.exists(data_yaml):
        print(f"[ERROR] Dataset config not found: {data_yaml}")
        print("        Run `python prepare_dataset.py` first to prepare the dataset.")
        return False

    with open(data_yaml, 'r') as f:
        config = yaml.safe_load(f)

    base_dir = Path(data_yaml).parent / config.get('path', '.')
    train_dir = base_dir / config.get('train', 'images/train')
    val_dir = base_dir / config.get('val', 'images/val')

    if not train_dir.exists():
        print(f"[ERROR] Training images directory not found: {train_dir}")
        print("        Run `python prepare_dataset.py` first.")
        return False

    train_images = list(train_dir.glob('*.jpg')) + list(train_dir.glob('*.png'))
    val_images = list(val_dir.glob('*.jpg')) + list(val_dir.glob('*.png'))

    print(f"[Dataset] Training images: {len(train_images)}")
    print(f"[Dataset] Validation images: {len(val_images)}")

    if len(train_images) < 10:
        print("[WARN] Very few training images. Recommend at least 300 for decent results.")
    if len(val_images) < 5:
        print("[WARN] Very few validation images. Recommend at least 50.")

    return True


def train(args):
    """執行 YOLOv8n-seg 訓練。"""
    from ultralytics import YOLO

    data_yaml = os.path.join(os.path.dirname(__file__), 'dataset.yaml')
    if not args.resume and not check_dataset(data_yaml):
        sys.exit(1)

    print("=" * 60)
    print("  YOLOv8n-seg 樹幹偵測模型訓練")
    print("=" * 60)
    print(f"  Base model:  yolov8n-seg.pt (COCO pretrained)")
    print(f"  Classes:     1 (tree_trunk)")
    print(f"  Epochs:      {args.epochs}")
    print(f"  Batch size:  {args.batch}")
    print(f"  Image size:  {args.imgsz}")
    print(f"  Device:      {args.device}")
    print(f"  Workers:     {args.workers}")
    print("=" * 60)

    if args.resume:
        # 從上次中斷處續訓
        last_pt = Path('runs/segment/train/weights/last.pt')
        if not last_pt.exists():
            print("[ERROR] No checkpoint found to resume from.")
            sys.exit(1)
        model = YOLO(str(last_pt))
        print(f"[Resume] Continuing from {last_pt}")
    else:
        # 從 COCO 預訓練權重開始遷移學習
        model = YOLO('yolov8n-seg.pt')
        print("[Transfer Learning] Starting from COCO pretrained weights")

    # ── 訓練配置 ──────────────────────────────────────────────
    results = model.train(
        data=data_yaml,
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        device=args.device,
        workers=args.workers,
        patience=args.patience,     # Early stopping
        save=True,                  # Save checkpoints
        save_period=10,             # Save every 10 epochs
        exist_ok=True,              # Overwrite previous run
        pretrained=True,
        optimizer='AdamW',
        lr0=0.001,                  # Initial learning rate
        lrf=0.01,                   # Final LR = lr0 * lrf
        warmup_epochs=3,
        cos_lr=True,                # Cosine LR schedule

        # ── 資料增強（針對戶外樹木場景優化）──────────────
        hsv_h=0.015,                # 色調 ±1.5%（不同光照）
        hsv_s=0.5,                  # 飽和度 ±50%（不同天氣）
        hsv_v=0.4,                  # 亮度 ±40%（逆光/陰影）
        degrees=5.0,                # 旋轉 ±5°（手機沒拿正）
        translate=0.1,              # 平移 ±10%
        scale=0.3,                  # 縮放 ±30%（不同拍攝距離）
        shear=2.0,                  # 剪切 ±2°
        flipud=0.0,                 # 不上下翻轉（樹幹有方向性）
        fliplr=0.5,                 # 左右翻轉 50%
        mosaic=0.8,                 # Mosaic 增強 80%
        mixup=0.1,                  # MixUp 10%
        erasing=0.1,                # Random erasing 10%（模擬遮擋）

        # ── 分割特定設定 ──────────────────────────────────
        overlap_mask=True,          # 允許重疊 mask
        mask_ratio=4,               # Mask 下採樣比例

        # ── 效能 ──────────────────────────────────────────
        amp=True,                   # Mixed precision
        cache=args.cache,           # 快取圖片到 RAM
        close_mosaic=10,            # 最後 10 epochs 關閉 mosaic
    )

    print("\n" + "=" * 60)
    print("  Training Complete!")
    print("=" * 60)

    # 顯示最終結果
    best_pt = Path('runs/segment/train/weights/best.pt')
    if best_pt.exists():
        print(f"\n  Best model: {best_pt}")
        print(f"  File size:  {best_pt.stat().st_size / 1024 / 1024:.1f} MB")

        # 自動驗證
        model_best = YOLO(str(best_pt))
        metrics = model_best.val(data=data_yaml)

        box_map50 = getattr(metrics.box, 'map50', None)
        seg_map50 = getattr(metrics.seg, 'map50', None)

        print(f"\n  [Detection]    mAP50: {box_map50:.3f}" if box_map50 else "")
        print(f"  [Segmentation] mAP50: {seg_map50:.3f}" if seg_map50 else "")

        if seg_map50 and seg_map50 > 0.85:
            print("\n  ✓ 模型品質良好，可以匯出！")
            print("    運行: python export_model.py")
        elif seg_map50 and seg_map50 > 0.70:
            print("\n  △ 模型品質可接受，建議增加訓練資料或 epochs")
        else:
            print("\n  ✗ 模型品質不足，需要更多訓練資料")
            print("    建議：至少 500 張多樣化標註圖片")

    return results


def main():
    parser = argparse.ArgumentParser(description='Train YOLOv8n-seg tree trunk detector')
    parser.add_argument('--epochs', type=int, default=150, help='Training epochs (default: 150)')
    parser.add_argument('--batch', type=int, default=8,
                        help='Batch size (default: 8 for CPU. Use 16 on Colab T4 GPU)')
    parser.add_argument('--imgsz', type=int, default=640, help='Image size (default: 640)')
    parser.add_argument('--device', type=str, default='cpu',
                        help='Device: "cpu", "0" (NVIDIA GPU), "mps" (Apple M1/M2). '
                             'Default: cpu. Use a GPU environment (e.g. Colab) for faster training.')
    parser.add_argument('--workers', type=int, default=4, help='DataLoader workers (default: 4)')
    parser.add_argument('--patience', type=int, default=30, help='Early stopping patience (default: 30)')
    parser.add_argument('--resume', action='store_true', help='Resume from last checkpoint')
    parser.add_argument('--cache', type=str, default='', help='Cache images: "", "ram", "disk" (default: "")')
    args = parser.parse_args()

    train(args)


if __name__ == '__main__':
    main()
