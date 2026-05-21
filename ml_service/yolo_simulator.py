"""
yolo_simulator.py
==================
On-PC simulator of the on-device YOLOv8n-seg used by the Flutter app
(`tflite_tracking_service.dart`). Runs the same .tflite via ai-edge-litert
so we can include `yolomask` cases in the offline benchmark.

Difference vs production:
  - We feed the EXIF-rotated portrait JPEG directly. The phone's NV21
    camera path adds rotation + minor color noise that we do not replicate.
  - Letterbox + NMS + proto×coeffs mask reconstruction logic mirrors the
    Dart implementation so output bbox / mask is the same shape.

Output:
  YoloDetection(bbox_x1, ..., confidence, mask_pixel_width, mask_full)
  where mask_full is a uint8 (H, W) ndarray (0/255) at the ORIGINAL input
  image size, suitable for direct PNG encode → trunk_mask_base64 form field.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

try:
    from ai_edge_litert.interpreter import Interpreter as _Interpreter  # type: ignore
    _BACKEND = "ai-edge-litert"
except ImportError:
    try:
        from tflite_runtime.interpreter import Interpreter as _Interpreter  # type: ignore
        _BACKEND = "tflite_runtime"
    except ImportError:
        from tensorflow.lite.python.interpreter import Interpreter as _Interpreter  # type: ignore
        _BACKEND = "tensorflow"


@dataclass
class YoloDetection:
    bbox_x1: float
    bbox_y1: float
    bbox_x2: float
    bbox_y2: float
    confidence: float
    mask_pixel_width: Optional[float] = None  # max contiguous mask width in any row
    mask_full: Optional[np.ndarray] = None    # uint8 (H, W), 0/255, original image size


class YoloSimulator:
    """Run YOLOv8n-seg .tflite locally to mimic on-device detection."""

    def __init__(self, model_path: Path | str):
        self.itp = _Interpreter(model_path=str(model_path))
        self.itp.allocate_tensors()
        self.in_d = self.itp.get_input_details()
        self.out_d = self.itp.get_output_details()
        self.input_size = int(self.in_d[0]['shape'][1])  # 640
        self.input_dtype = self.in_d[0]['dtype']

    # ---- letterbox ----
    def _letterbox(self, img: Image.Image):
        w, h = img.size
        s = min(self.input_size / w, self.input_size / h)
        new_w, new_h = int(round(w * s)), int(round(h * s))
        resized = img.resize((new_w, new_h), Image.BILINEAR)
        canvas = Image.new('RGB', (self.input_size, self.input_size), (114, 114, 114))
        pad_x = (self.input_size - new_w) // 2
        pad_y = (self.input_size - new_h) // 2
        canvas.paste(resized, (pad_x, pad_y))
        return np.asarray(canvas), s, pad_x, pad_y

    def detect(self, img: Image.Image, conf_thresh: float = 0.15,
               iou_thresh: float = 0.45, mask_thresh: float = 0.0,
               want_full_mask: bool = True) -> Optional[YoloDetection]:
        arr, s, pad_x, pad_y = self._letterbox(img)
        if self.input_dtype == np.float32:
            inp = (arr.astype(np.float32) / 255.0)[None, ...]
        else:
            inp = arr[None, ...]
        self.itp.set_tensor(self.in_d[0]['index'], inp)
        self.itp.invoke()

        det_out = self.itp.get_tensor(self.out_d[0]['index'])
        proto_out = self.itp.get_tensor(self.out_d[1]['index']) if len(self.out_d) > 1 else None

        det = det_out[0]
        if det.shape[0] < det.shape[1]:
            det = det.T  # [N, 37]
        boxes_xywh = det[:, :4]
        cls_scores = det[:, 4]
        coeffs = det[:, 5:]

        keep = cls_scores >= conf_thresh
        if not np.any(keep):
            return None
        boxes_xywh = boxes_xywh[keep]
        cls_scores = cls_scores[keep]
        coeffs = coeffs[keep]

        if boxes_xywh[:, 0].max() <= 1.5:
            boxes_xywh = boxes_xywh * self.input_size
        cx, cy, bw, bh = boxes_xywh.T
        x1 = cx - bw / 2; y1 = cy - bh / 2
        x2 = cx + bw / 2; y2 = cy + bh / 2

        # NMS
        order = np.argsort(-cls_scores)
        kept = []
        for i in order:
            ok = True
            for j in kept:
                ix1 = max(x1[i], x1[j]); iy1 = max(y1[i], y1[j])
                ix2 = min(x2[i], x2[j]); iy2 = min(y2[i], y2[j])
                iw = max(0.0, ix2 - ix1); ih = max(0.0, iy2 - iy1)
                inter = iw * ih
                a_i = (x2[i] - x1[i]) * (y2[i] - y1[i])
                a_j = (x2[j] - x1[j]) * (y2[j] - y1[j])
                if inter / (a_i + a_j - inter + 1e-6) > iou_thresh:
                    ok = False
                    break
            if ok:
                kept.append(int(i))
            if len(kept) >= 5:
                break
        if not kept:
            return None
        best = kept[0]

        # Undo letterbox → original portrait coords
        W_orig, H_orig = img.size
        def _un(x, y):
            return ((x - pad_x) / s, (y - pad_y) / s)
        ux1, uy1 = _un(float(x1[best]), float(y1[best]))
        ux2, uy2 = _un(float(x2[best]), float(y2[best]))

        mask_pixel_width = None
        mask_full = None

        if proto_out is not None:
            proto = proto_out[0]  # [Hp, Wp, 32]
            Hp, Wp, _ = proto.shape

            # 1. Logit map at proto resolution: [Hp, Wp]
            logits = proto @ coeffs[best]  # (Hp, Wp)

            # 2. Restrict to bbox (in proto coords) to suppress background blobs
            bx1 = int(np.clip(np.floor((x1[best] / self.input_size) * Wp), 0, Wp - 1))
            by1 = int(np.clip(np.floor((y1[best] / self.input_size) * Hp), 0, Hp - 1))
            bx2 = int(np.clip(np.ceil((x2[best] / self.input_size) * Wp), 0, Wp - 1))
            by2 = int(np.clip(np.ceil((y2[best] / self.input_size) * Hp), 0, Hp - 1))

            mask_proto = np.zeros((Hp, Wp), dtype=np.bool_)
            mask_proto[by1:by2 + 1, bx1:bx2 + 1] = (
                logits[by1:by2 + 1, bx1:bx2 + 1] > mask_thresh
            )

            # mask_pixel_width: max horizontal contiguous run anywhere in box, scaled
            #   to original-image px (proto → model space → portrait via /s)
            if mask_proto.any():
                rows_any = mask_proto[by1:by2 + 1, bx1:bx2 + 1]
                # Longest contiguous True run per row:
                max_run_proto = 0
                for r in rows_any:
                    cur = 0; mx = 0
                    for v in r:
                        if v:
                            cur += 1
                            if cur > mx:
                                mx = cur
                        else:
                            cur = 0
                    if mx > max_run_proto:
                        max_run_proto = mx
                if max_run_proto > 0:
                    lb_w = max_run_proto * (self.input_size / Wp)
                    mask_pixel_width = lb_w / s

            # 3. Full-resolution mask (optional)
            if want_full_mask and mask_proto.any():
                # Upsample proto mask to letterbox model space (input_size×input_size)
                mask_lb_pil = Image.fromarray(
                    (mask_proto.astype(np.uint8) * 255), mode='L'
                ).resize((self.input_size, self.input_size), Image.NEAREST)
                # Crop letterbox padding back to scaled image, then resize to original
                lb_arr = np.asarray(mask_lb_pil)
                # New_w/h after letterbox resize:
                new_w = int(round(W_orig * s))
                new_h = int(round(H_orig * s))
                cropped = lb_arr[pad_y:pad_y + new_h, pad_x:pad_x + new_w]
                if cropped.shape[0] > 0 and cropped.shape[1] > 0:
                    mask_full_pil = Image.fromarray(cropped, mode='L').resize(
                        (W_orig, H_orig), Image.NEAREST
                    )
                    mask_full = (np.asarray(mask_full_pil) > 127).astype(np.uint8) * 255

        return YoloDetection(
            bbox_x1=max(0.0, ux1),
            bbox_y1=max(0.0, uy1),
            bbox_x2=ux2,
            bbox_y2=uy2,
            confidence=float(cls_scores[best]),
            mask_pixel_width=mask_pixel_width,
            mask_full=mask_full,
        )


def get_default_model_path() -> Path:
    """Path to the production tree_trunk_seg.tflite shipped in the Flutter app."""
    return (
        Path(__file__).resolve().parent.parent.parent
        / "frontend" / "assets" / "ml" / "tree_trunk_seg.tflite"
    )


# ============================================================
# YOLOv8m-seg server-grade variant
# ============================================================
# Uses ultralytics directly (no manual letterbox / NMS / proto math).
# Different "flow" from YoloSimulator above:
#   - Loads .pt via ultralytics → built-in preprocess + postprocess
#   - Mask is delivered in letterbox model space, we resize to original
# Use this as an upper-bound mask-quality reference vs the deployed n model.

class YoloV8mSimulator:
    """Run YOLOv8m-seg .pt via ultralytics (server-grade, ~27M params)."""

    def __init__(self, model_path: Path | str, imgsz: int = 832,
                 device: Optional[str] = None):
        from ultralytics import YOLO  # local import → optional dep
        self.model = YOLO(str(model_path), task="segment")
        self.imgsz = imgsz
        self.device = device

    def detect(self, img: Image.Image, conf_thresh: float = 0.15,
               want_full_mask: bool = True,
               bbox_hint: Optional[tuple[float, float, float, float]] = None
               ) -> Optional[YoloDetection]:
        W, H = img.size
        res = self.model(
            img, conf=conf_thresh, imgsz=self.imgsz,
            verbose=False, device=self.device,
        )[0]
        if res.boxes is None or len(res.boxes) == 0:
            return None
        conf = res.boxes.conf.cpu().numpy()
        boxes_xyxy = res.boxes.xyxy.cpu().numpy()
        best = int(conf.argmax())
        if bbox_hint is not None:
            hx1, hy1, hx2, hy2 = bbox_hint
            ix1 = np.maximum(boxes_xyxy[:, 0], hx1)
            iy1 = np.maximum(boxes_xyxy[:, 1], hy1)
            ix2 = np.minimum(boxes_xyxy[:, 2], hx2)
            iy2 = np.minimum(boxes_xyxy[:, 3], hy2)
            inter = np.maximum(0.0, ix2 - ix1) * np.maximum(0.0, iy2 - iy1)
            area_a = np.maximum(0.0, boxes_xyxy[:, 2] - boxes_xyxy[:, 0]) * np.maximum(0.0, boxes_xyxy[:, 3] - boxes_xyxy[:, 1])
            area_b = max(0.0, hx2 - hx1) * max(0.0, hy2 - hy1)
            iou = inter / np.maximum(area_a + area_b - inter, 1e-6)
            if float(iou.max()) > 0.0:
                best = int(np.argmax(iou + 0.01 * conf))
        x1, y1, x2, y2 = boxes_xyxy[best].tolist()

        mask_pixel_width = None
        mask_full = None
        if res.masks is not None and want_full_mask:
            # res.masks.data may still be in the square letterbox canvas used
            # by YOLO preprocessing. Crop the unpadded content before resizing
            # back to the original image, or portrait photos get compressed
            # horizontally by about 0.75 (480px content inside 640px canvas).
            m = res.masks.data[best].cpu().numpy()  # float 0/1
            mask_lr = (m > 0.5).astype(np.uint8) * 255
            mask_h, mask_w = mask_lr.shape
            content_scale = min(mask_w / max(W, 1), mask_h / max(H, 1))
            content_w = max(1, min(mask_w, int(round(W * content_scale))))
            content_h = max(1, min(mask_h, int(round(H * content_scale))))
            pad_x = max(0, (mask_w - content_w) // 2)
            pad_y = max(0, (mask_h - content_h) // 2)
            mask_content = mask_lr[pad_y:pad_y + content_h, pad_x:pad_x + content_w]
            if mask_content.size == 0:
                mask_content = mask_lr
            mask_full = np.array(
                Image.fromarray(mask_content, mode='L').resize((W, H), Image.NEAREST)
            )
            # mask_pixel_width = max horizontal contiguous run inside bbox
            xi1, yi1 = max(0, int(x1)), max(0, int(y1))
            xi2, yi2 = min(W, int(x2) + 1), min(H, int(y2) + 1)
            if xi2 > xi1 and yi2 > yi1:
                sub = mask_full[yi1:yi2, xi1:xi2] > 127
                if sub.any():
                    max_run = 0
                    for r in sub:
                        cur = 0; mx = 0
                        for v in r:
                            if v:
                                cur += 1
                                if cur > mx:
                                    mx = cur
                            else:
                                cur = 0
                        if mx > max_run:
                            max_run = mx
                    mask_pixel_width = float(max_run)

        return YoloDetection(
            bbox_x1=float(x1), bbox_y1=float(y1),
            bbox_x2=float(x2), bbox_y2=float(y2),
            confidence=float(conf[best]),
            mask_pixel_width=mask_pixel_width,
            mask_full=mask_full,
        )


def get_default_v8m_path() -> Path:
    """Path to YOLOv8m-seg trained on the same Roboflow datasets (server-grade)."""
    return (
        Path(__file__).resolve().parent
        / "trunk_detector_training" / "tree_trunk_seg_best.pt"
    )


def get_default_v8m_openvino_path() -> Path:
    """Path to the OpenVINO export of the server-grade YOLOv8m-seg model."""
    return (
        Path(__file__).resolve().parent
        / "trunk_detector_training" / "tree_trunk_seg_best_openvino_model"
    )
