"""
DBH Pure Vision ML Service
===========================
FastAPI server providing DBH measurement from a single RGB image.

Endpoints:
  POST     /api/v1/measure-dbh       - Full DBH measurement pipeline
  POST     /api/v1/estimate-depth    - Depth estimation only
  GET      /api/v1/health            - Health check
  WebSocket /ws/scan                 - Real-time live scan (frames → DBH + mask)

Usage:
  uvicorn app:app --host 0.0.0.0 --port 8100 --reload
"""

import io
import os
import math
import json
import time
import hmac
import base64
import hashlib
import asyncio
import traceback
from typing import Optional, List
from collections import defaultdict

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from PIL import Image, ImageOps
import numpy as np

# ============================================================
# Security: API Key Authentication
# ============================================================

ML_API_KEY = os.environ.get("ML_API_KEY", "").strip()
if not ML_API_KEY:
    print("[WARNING] ML_API_KEY is not set. All endpoints are open without authentication.")
    print("[WARNING] Set ML_API_KEY environment variable for production use.")

ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "ML_CORS_ORIGINS",
        # Default to localhost only; production hosts must be supplied via env.
        "http://localhost:3000,http://localhost:8080"
    ).split(",") if o.strip() and o.strip() != "*"
]


def verify_api_key(request: Request):
    """Dependency that verifies the ML API key on protected endpoints."""
    if not ML_API_KEY:
        # If no API key is configured, skip auth (dev mode)
        return
    
    # Check X-ML-API-Key header
    provided_key = request.headers.get("X-ML-API-Key", "").strip()
    if not provided_key:
        # Also check Authorization: Bearer <key>
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            provided_key = auth_header[7:].strip()
    
    if not provided_key or not hmac.compare_digest(provided_key, ML_API_KEY):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: Invalid or missing ML API key"
        )


# ============================================================
# Security: Simple In-Memory Rate Limiter
# ============================================================

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple IP-based rate limiter for ML endpoints."""
    
    def __init__(self, app, max_requests: int = 120, window_seconds: int = 3600):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)
    
    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for health check
        if request.url.path.endswith("/health"):
            return await call_next(request)
        
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        
        # Clean old entries
        self.requests[client_ip] = [
            t for t in self.requests[client_ip]
            if now - t < self.window_seconds
        ]
        
        if len(self.requests[client_ip]) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Try again later."}
            )
        
        self.requests[client_ip].append(now)
        response = await call_next(request)
        return response

_model_load_lock = asyncio.Lock()

from depth_estimation import (
    estimate_depth, estimate_depth_rich, estimate_depth_with_info,
    load_model, get_backend_info, DepthResult,
)
from dbh_calculator import (
    BoundingBox, DBHResult, measure_dbh, measure_dbh_multi_row,
    estimate_focal_length_from_fov, focal_length_from_exif,
    pixel_width_to_metric, cylindrical_correction,
    PHONE_SENSORS, match_phone_sensor,
)
from visualization import create_result_image, depth_to_colormap, image_to_bytes
from tree_trunk_detector import detect_trunks, create_detection_visualization
from tree_segmentation import (
    segment_trunk_auto,
    segment_trunk_with_bbox,
    segment_trunk_with_yolo_guidance,
    subpixel_trunk_width,
    ellipse_corrected_width,
    compute_trunk_width_from_mask,
)
from model_registry import (
    get_depth_config, get_seg_config, get_preset,
    print_config_summary, ACCURACY_PRESETS, DEPTH_MODELS,
    USE_ONNX_RUNTIME, ENABLE_SAM_SEGMENTATION, ENABLE_OPENVINO,
    get_registry,
)

# Max processing dimension — larger images are resized to save memory & time.
# DA V2 internally resizes to ~518px; Depth Pro uses 1536px.
# Depth Pro benefits from higher input resolution, so we raise the limit when it's active.
_depth_cfg = get_depth_config()
MAX_PROCESSING_DIM = 1536 if _depth_cfg.backend == "depth_pro" else 800


# ============================================================
# WebSocket: Motion check & mask visualization
# ============================================================

def _motion_check(current: np.ndarray, last: Optional[np.ndarray], 
                   downscale: int = 8, threshold: float = 0.02) -> bool:
    """
    Return True if frame has significant motion (should process).
    Return False if frame is similar to last (skip).
    """
    if last is None:
        return True
    if current.shape != last.shape:
        return True
    ds = downscale
    c_small = current[::ds, ::ds]
    l_small = last[::ds, ::ds]
    if c_small.ndim == 3:
        c_small = c_small.astype(np.float32).mean(axis=2)
        l_small = l_small.astype(np.float32).mean(axis=2)
    diff = np.abs(c_small.astype(np.float32) - l_small.astype(np.float32))
    change_ratio = float(np.mean(diff)) / 255.0 if np.max(c_small) > 0 else 0
    return change_ratio >= threshold


def _mask_to_overlay_base64(image: Image.Image, mask: np.ndarray) -> str:
    """Create green overlay on trunk mask, return base64 PNG."""
    overlay = np.array(image.convert("RGB"))
    green = np.array([0, 255, 0], dtype=np.uint8)
    mask_bool = (mask > 0).astype(np.uint8)
    for c in range(3):
        overlay[:, :, c] = np.where(
            mask_bool,
            (overlay[:, :, c].astype(np.uint32) * 0.4 + green[c] * 0.6).astype(np.uint8),
            overlay[:, :, c],
        )
    out = Image.fromarray(overlay)
    return base64.b64encode(image_to_bytes(out, "PNG")).decode()


def _resize_for_processing(image: Image.Image) -> tuple:
    """Resize image if it exceeds MAX_PROCESSING_DIM on its longest side.

    Returns:
        (resized_image, scale_factor)  where scale_factor = new_size / old_size.
        If no resize needed, scale_factor = 1.0.
    """
    W, H = image.size
    longest = max(W, H)
    if longest <= MAX_PROCESSING_DIM:
        return image, 1.0

    scale = MAX_PROCESSING_DIM / longest
    new_w = int(W * scale)
    new_h = int(H * scale)
    resized = image.resize((new_w, new_h), Image.LANCZOS)
    print(f"[Resize] {W}x{H} → {new_w}x{new_h} (scale={scale:.3f})")
    return resized, scale


app = FastAPI(
    title="TreeAI DBH Measurement Service",
    description="Pure vision DBH measurement using Depth Anything V2",
    version="0.2.0",
    docs_url="/docs" if os.environ.get("ML_DEBUG", "").lower() == "true" else None,
    redoc_url=None,
)

# Rate limiting middleware (30 requests per hour per IP)
app.add_middleware(
    RateLimitMiddleware,
    max_requests=int(os.environ.get("ML_RATE_LIMIT", "30")),
    window_seconds=3600,
)

# CORS — restricted to known origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-ML-API-Key", "Authorization"],
)


# ============================================================
# Startup
# ============================================================

@app.on_event("startup")
async def startup_event():
    """Pre-load models on startup (using model_registry)."""
    print_config_summary()
    registry = get_registry()
    print("[Startup] Pre-loading depth model via model_registry...")
    try:
        async with _model_load_lock:
            registry.get_depth_model()
        print("[Startup] Depth model ready!")
    except Exception as e:
        print(f"[Startup] Warning: Could not pre-load depth model: {e}")
        print("[Startup] Depth model will be loaded on first request.")
    if ENABLE_SAM_SEGMENTATION:
        print("[Startup] Pre-loading SAM model...")
        try:
            sam_model, _ = registry.get_sam_model()
            if sam_model is not None:
                print("[Startup] SAM model ready!")
            else:
                print("[Startup] SAM model not available (using heuristic fallback).")
        except Exception as e:
            print(f"[Startup] Warning: Could not pre-load SAM: {e}")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"OMFG Validation Error: {exc.errors()}")
    print(f"Body: {exc.body}")
    return JSONResponse(
        status_code=400,
        content={"detail": exc.errors(), "body": exc.body},
    )


# ============================================================
# Health Check
# ============================================================

@app.get("/health")
@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint (no auth required)."""
    depth_config = get_depth_config()
    seg_config = get_seg_config()
    backend_info = get_backend_info()
    return {
        "status": "ok",
        "service": "dbh-measurement",
        "model": depth_config.display_name,
        "model_params_m": depth_config.params_m,
        "segmentation": seg_config.display_name,
        "onnx_enabled": USE_ONNX_RUNTIME,
        "openvino_enabled": ENABLE_OPENVINO,
        "sam_enabled": ENABLE_SAM_SEGMENTATION,
        "auth_required": bool(ML_API_KEY),
        "available_modes": list(ACCURACY_PRESETS.keys()),
        "backend": backend_info,
    }


# ============================================================
# WebSocket Live Scan — Decoupled Viewfinder and Capture Pipeline
# ============================================================
#
# DECOUPLED PIPELINE DESIGN:
# --------------------------
# The live scan separates two stages to balance responsiveness and accuracy:
#
#   1. VIEWFINDER (preview): Fast, responsive feedback while user aims the camera.
#      - Uses da_v2_small (~1.5s) when depth_pro would be too slow (>2s on frame 1).
#      - User sees real-time DBH preview and mask overlay without long waits.
#
#   2. CAPTURE (final): High-accuracy measurement when user confirms.
#      - On "lock", we switch back to depth_pro for the final frame.
#      - Client sends "lock" then the next frame; that frame uses depth_pro for SOTA accuracy.
#
# This avoids blocking the viewfinder with 5–25s Depth Pro inference while guaranteeing
# the locked measurement uses the best model available.
# ============================================================

DEPTH_PRO_SLOW_THRESHOLD_S = 2.0  # If frame 1 depth exceeds this, use da_v2_small for preview
DA_V2_SMALL_ID = "depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf"


@app.websocket("/ws/scan")
async def ws_scan(websocket: WebSocket):
    """
    WebSocket endpoint for real-time DBH scanning.

    Protocol:
    - Client sends: raw frame bytes (JPEG/PNG image) or JSON {"action": "lock"}
    - Server sends: JSON { mask, dbh, confidence, status, ... }

    Status: "scanning" | "locked" | "no_trunk" | "skipped" (motion check)

    Decoupled fallback: If frame 1 depth takes > 2s, switch to da_v2_small for preview;
    on "lock", switch back to depth_pro for the final capture frame.
    """
    if ML_API_KEY:
        provided_key = websocket.query_params.get("api_key") or websocket.headers.get("x-ml-api-key")
        if not provided_key or not hmac.compare_digest(provided_key.strip(), ML_API_KEY.strip()):
            print("[WS Auth Failed] Invalid or missing API key")
            await websocket.close(code=1008)
            return

    await websocket.accept()
    last_frame: Optional[np.ndarray] = None
    last_result: Optional[dict] = None
    # Decoupled pipeline: use_fast_depth=True → da_v2_small for responsive preview
    use_fast_depth = False
    first_frame_done = False

    try:
        while True:
            # Receive frame bytes (binary) or control message (text)
            try:
                data = await websocket.receive()
            except WebSocketDisconnect:
                break
            except RuntimeError as e:
                if "Cannot call \"receive\" once a disconnect message has been received" in str(e):
                    break
                raise

            # Handle "lock" command: switch back to depth_pro for final capture
            if "text" in data:
                try:
                    msg = json.loads(data["text"])
                    if msg.get("action") == "lock":
                        use_fast_depth = False
                        load_model(None)  # Reset to DEFAULT_DEPTH_MODEL (depth_pro)
                        continue
                    b64 = msg.get("frame") or msg.get("image")
                    if b64:
                        frame_bytes = base64.b64decode(b64)
                    else:
                        continue
                except (json.JSONDecodeError, TypeError):
                    continue
            elif "bytes" in data:
                frame_bytes = data["bytes"]
            else:
                continue

            if len(frame_bytes) < 100:
                continue

            try:
                pil_image = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
            except Exception:
                continue

            img_np = np.array(pil_image)
            pil_image, scale = _resize_for_processing(pil_image)
            W, H = pil_image.size

            # Motion check: skip if similar to last frame
            if not _motion_check(img_np, last_frame):
                if last_result:
                    last_result["status"] = "skipped"
                    await websocket.send_text(json.dumps(last_result))
                last_frame = img_np
                continue

            last_frame = img_np

            # Run depth estimation with decoupled fallback
            # Preview path: if frame 1 took >2s, use da_v2_small for responsive viewfinder
            # Capture path: after "lock", use depth_pro for final SOTA accuracy
            t0 = time.time()
            if use_fast_depth:
                load_model(DA_V2_SMALL_ID)  # da_v2_small for preview (~1.5s)
            depth_result = estimate_depth_rich(pil_image)
            depth_time = time.time() - t0

            # After frame 1: if depth_pro exceeded threshold, switch to da_v2 for preview
            if not first_frame_done:
                first_frame_done = True
                if depth_time > DEPTH_PRO_SLOW_THRESHOLD_S:
                    use_fast_depth = True
                    load_model(DA_V2_SMALL_ID)  # Next frames use fast model

            depth_map = depth_result.depth_map
            effective_focal_px = depth_result.auto_focal_length_px
            effective_fov = depth_result.auto_fov_degrees or 70.0
            if effective_focal_px is None:
                effective_focal_px = estimate_focal_length_from_fov(W, effective_fov)

            # Detect trunk
            detection = detect_trunks(depth_map)
            if not detection.trunks or detection.best_trunk_index < 0:
                await websocket.send_text(json.dumps({
                    "mask": "",
                    "dbh": 0.0,
                    "confidence": 0.0,
                    "status": "no_trunk",
                    "message": "未偵測到樹幹",
                }))
                continue

            best_trunk = detection.trunks[detection.best_trunk_index]
            bbox = BoundingBox(
                x1=best_trunk.bbox_x1,
                y1=best_trunk.bbox_y1,
                x2=best_trunk.bbox_x2,
                y2=best_trunk.bbox_y2,
            )

            # SAM segmentation: prefer YOLO bbox guidance, fallback to auto-prompt
            img_np = np.array(pil_image)
            if ENABLE_SAM_SEGMENTATION:
                seg_result = segment_trunk_with_yolo_guidance(
                    img_np, depth_map,
                    bbox=(bbox.x1, bbox.y1, bbox.x2, bbox.y2),
                )
            else:
                seg_result = segment_trunk_auto(
                    img_np, depth_map,
                    existing_mask=best_trunk.mask.astype(np.uint8) if best_trunk.mask is not None else None,
                )

            # DBH calculation
            result = measure_dbh_multi_row(
                depth_map, bbox,
                focal_length_px=effective_focal_px,
                image_width_px=W,
                fov_degrees=effective_fov,
            )

            # Override with SAM mask width if available (方案A+C)
            if seg_result.confidence > 0.3 and seg_result.method.startswith("sam2"):
                _sam_w, _ = compute_trunk_width_from_mask(
                    seg_result.mask, (bbox.x1, bbox.y1, bbox.x2, bbox.y2)
                )
                if _sam_w > 10.0:
                    _chord = pixel_width_to_metric(_sam_w, result.trunk_depth_m, result.focal_length_px)
                    _dbh_m = cylindrical_correction(_chord, result.trunk_depth_m)
                    result = DBHResult(
                        dbh_cm=round(_dbh_m * 100.0, 2),
                        confidence=min(1.0, round(result.confidence + 0.10, 3)),
                        trunk_depth_m=result.trunk_depth_m,
                        trunk_pixel_width=round(_sam_w, 2),
                        chord_length_m=round(_chord, 4),
                        focal_length_px=result.focal_length_px,
                        measurement_row=result.measurement_row,
                        method=f"{result.method}+sam_mask",
                        notes=result.notes + [f"SAM mask width: {_sam_w:.1f}px"],
                    )

            mask_b64 = _mask_to_overlay_base64(pil_image, seg_result.mask)

            # Quality gates: flag poor measurements
            is_poor_quality = (
                result.confidence < 0.45
                or result.dbh_cm > 200
                or result.dbh_cm < 2
            )

            payload = {
                "mask": mask_b64,
                "dbh": round(result.dbh_cm, 1),
                "confidence": round(result.confidence, 2),
                "status": "poor_quality" if is_poor_quality else "locked",
                "trunk_depth_m": round(result.trunk_depth_m, 2),
                "bbox": {"x1": bbox.x1, "y1": bbox.y1, "x2": bbox.x2, "y2": bbox.y2},
            }
            if is_poor_quality:
                payload["message"] = "請靠近或在白天測量"

            last_result = payload
            await websocket.send_text(json.dumps(payload))

    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected properly.")
        pass
    except RuntimeError as e:
        if "Cannot call \"receive\" once a disconnect message has been received" in str(e):
            print("[WebSocket] Client already disconnected.")
        else:
            traceback.print_exc()
    except Exception as e:
        traceback.print_exc()
        try:
            await websocket.send_text(json.dumps({
                "mask": "",
                "dbh": 0.0,
                "confidence": 0.0,
                "status": "error",
                "message": str(e),
            }))
        except Exception:
            pass


# ============================================================
# Depth Estimation
# ============================================================

@app.post("/api/v1/estimate-depth", dependencies=[Depends(verify_api_key)])
async def estimate_depth_endpoint(
    image: UploadFile = File(...),
    return_visualization: bool = Form(default=True),
):
    """
    Estimate depth from a single RGB image.

    Returns depth statistics and optionally a colorized depth map.
    """
    try:
        # Read image and resize for performance
        img_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        pil_image = ImageOps.exif_transpose(pil_image) or pil_image
        pil_image, _ = _resize_for_processing(pil_image)

        # Run depth estimation
        t0 = time.time()
        result = estimate_depth_with_info(pil_image)
        inference_time = time.time() - t0

        response = {
            "success": True,
            "inference_time_ms": round(inference_time * 1000, 1),
            "image_size": {"width": result["image_size"][0],
                          "height": result["image_size"][1]},
            "depth_stats": {
                "min_m": round(result["min_depth"], 3),
                "max_m": round(result["max_depth"], 3),
                "mean_m": round(result["mean_depth"], 3),
            },
        }

        if return_visualization:
            # Create colorized depth map
            depth_rgb = depth_to_colormap(result["depth_map"])
            depth_img = Image.fromarray(depth_rgb)
            depth_bytes = image_to_bytes(depth_img, "PNG")
            response["depth_map_base64"] = base64.b64encode(depth_bytes).decode()

        return JSONResponse(content=response)

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal error during depth estimation: {type(e).__name__}")


# ============================================================
# DBH Measurement
# ============================================================

@app.post("/api/v1/measure-dbh", dependencies=[Depends(verify_api_key)])
async def measure_dbh_endpoint(
    image: UploadFile = File(...),
    bbox_x1: int = Form(..., description="Bounding box left x"),
    bbox_y1: int = Form(..., description="Bounding box top y"),
    bbox_x2: int = Form(..., description="Bounding box right x"),
    bbox_y2: int = Form(..., description="Bounding box bottom y"),
    focal_length_px: Optional[float] = Form(default=None,
        description="Focal length in pixels. Auto-estimated if not provided."),
    focal_length_mm: Optional[float] = Form(default=None,
        description="EXIF focal length in mm (from phone camera)"),
    focal_length_35mm: Optional[float] = Form(default=None,
        description="35mm equivalent focal length (from EXIF)"),
    fov_degrees: float = Form(default=70.0,
        description="Horizontal FOV in degrees (used if focal_length not provided)"),
    phone_make: Optional[str] = Form(default=None,
        description="EXIF Make (e.g. 'Apple', 'samsung', 'Xiaomi')"),
    phone_model: Optional[str] = Form(default=None,
        description="EXIF Model (e.g. 'iPhone 15 Pro', 'SM-S928B', 'Mi A1')"),
    use_multi_row: bool = Form(default=True,
        description="Use multi-row median measurement for robustness"),
    return_visualization: bool = Form(default=True,
        description="Return annotated result image"),
):
    """
    Measure tree DBH from a single RGB image.

    Workflow:
    1. Upload image + trunk bounding box coordinates
    2. Server runs Depth Anything V2 for metric depth estimation
    3. Calculates DBH using depth + focal length + cylindrical correction
    4. Returns DBH in cm with confidence score

    The bounding box should tightly surround the tree trunk.
    """
    try:
        # Input validation
        if image.content_type and not image.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="上傳的檔案不是圖片格式")

        img_bytes = await image.read()
        if len(img_bytes) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="圖片大小超過 20MB 限制")
        try:
            pil_image_orig = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        except Exception:
            raise HTTPException(status_code=400, detail="無法解析圖片，請確認檔案格式正確")
        pil_image_orig = ImageOps.exif_transpose(pil_image_orig) or pil_image_orig
        W_orig, H_orig = pil_image_orig.size
        pil_image, scale = _resize_for_processing(pil_image_orig)
        W, H = pil_image.size

        # Normalize bbox (auto-swap if drawn right-to-left or bottom-to-top)
        nx1, nx2 = sorted([bbox_x1, bbox_x2])
        ny1, ny2 = sorted([bbox_y1, bbox_y2])

        # Scale bbox to resized coordinates and clamp to image bounds
        sx1 = max(0, int(nx1 * scale))
        sy1 = max(0, int(ny1 * scale))
        sx2 = min(W, int(nx2 * scale))
        sy2 = min(H, int(ny2 * scale))

        # Ensure minimum bbox size (at least 5px after scaling)
        if sx2 - sx1 < 5 or sy2 - sy1 < 5:
            raise HTTPException(
                status_code=400,
                detail="框選範圍太小，請框選更大的樹幹區域"
            )

        bbox = BoundingBox(x1=sx1, y1=sy1, x2=sx2, y2=sy2)

        # Compute focal length from EXIF if available.
        # NOTE: form field `focal_length_px` is given in ORIGINAL image pixels
        # (e.g. Xiang 1428 px for a 1440-wide image). Since bbox/depth/mask
        # are all measured in resized pixels, focal must be scaled too or we
        # systematically under-estimate DBH by (1/scale) ≈ 25 %.
        if focal_length_px is not None and scale != 1.0:
            effective_focal_px = focal_length_px * scale
            focal_source_extra = f" (scaled ×{scale:.3f})"
        else:
            effective_focal_px = focal_length_px
            focal_source_extra = ""
        effective_fov = fov_degrees
        focal_source = "default"

        # 注意：PHONE_SENSORS 中的 sensor_width_mm 是感測器「長軸」(landscape 寬)。
        # 但 exif_transpose 將直拍照片旋轉為 portrait 後，W 變成短軸。
        # 必須用 max(W, H)（長軸像素數）對齊 sensor_width_mm，否則 f_px 會偏小
        # 約 25% (4:3 感測器)，導致 DBH 被系統性高估。
        long_dim_px = max(W, H)

        if effective_focal_px is None and focal_length_mm is not None:
            # Use EXIF focal length + sensor width to compute focal_length_px
            # f_px = f_mm * long_dim_px / sensor_width_mm
            sensor_w, sensor_match = match_phone_sensor(
                phone_make or "", phone_model or ""
            )
            effective_focal_px = focal_length_from_exif(
                focal_length_mm, sensor_w, long_dim_px
            )
            focal_source = f"exif_mm ({focal_length_mm}mm, sensor={sensor_w}mm [{sensor_match}])"

        if effective_focal_px is None and focal_length_35mm is not None:
            # Compute FOV from 35mm equivalent focal length
            # FOV = 2 * atan(36 / (2 * f_35)) in degrees
            effective_fov = 2 * math.atan(36.0 / (2 * focal_length_35mm)) * 180.0 / math.pi
            focal_source = f"35mm_equiv ({focal_length_35mm}mm → FOV={effective_fov:.1f}°)"

        # Run depth estimation
        t0 = time.time()
        depth_map = estimate_depth(pil_image)
        depth_time = time.time() - t0

        # Measure DBH
        t1 = time.time()
        if use_multi_row:
            result = measure_dbh_multi_row(
                depth_map, bbox,
                focal_length_px=effective_focal_px,
                image_width_px=W,
                fov_degrees=effective_fov,
            )
        else:
            result = measure_dbh(
                depth_map, bbox,
                focal_length_px=effective_focal_px,
                image_width_px=W,
                fov_degrees=effective_fov,
            )
        calc_time = time.time() - t1

        # Add focal source to notes
        if focal_source != "default":
            result.notes.append(f"Focal source: {focal_source}")

        response = {
            "success": True,
            "dbh_cm": result.dbh_cm,
            "confidence": result.confidence,
            "trunk_depth_m": result.trunk_depth_m,
            "trunk_pixel_width": result.trunk_pixel_width,
            "chord_length_m": result.chord_length_m,
            "focal_length_px": result.focal_length_px,
            "measurement_row": result.measurement_row,
            "method": result.method,
            "notes": result.notes,
            "timing": {
                "depth_estimation_ms": round(depth_time * 1000, 1),
                "dbh_calculation_ms": round(calc_time * 1000, 1),
                "total_ms": round((depth_time + calc_time) * 1000, 1),
            },
            "image_size": {"width": W_orig, "height": H_orig},
            "processing_size": {"width": W, "height": H},
            "bbox": {"x1": bbox.x1, "y1": bbox.y1,
                     "x2": bbox.x2, "y2": bbox.y2},
        }

        if return_visualization:
            viz = create_result_image(
                pil_image, depth_map,
                (bbox.x1, bbox.y1, bbox.x2, bbox.y2),
                result.dbh_cm, result.trunk_depth_m,
                result.confidence, result.measurement_row,
            )
            viz_bytes = image_to_bytes(viz, "JPEG")
            response["visualization_base64"] = base64.b64encode(viz_bytes).decode()

        return JSONResponse(content=response)

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal error during DBH measurement: {type(e).__name__}")


# ============================================================
# Auto DBH Measurement (No Manual Bbox)
# ============================================================

@app.post("/api/v1/auto-measure-dbh", dependencies=[Depends(verify_api_key)])
async def auto_measure_dbh_endpoint(
    image: UploadFile = File(...),
    focal_length_px: Optional[float] = Form(default=None,
        description="Focal length in pixels. Auto-estimated if not provided."),
    focal_length_mm: Optional[float] = Form(default=None,
        description="EXIF focal length in mm"),
    focal_length_35mm: Optional[float] = Form(default=None,
        description="35mm equivalent focal length"),
    fov_degrees: float = Form(default=70.0,
        description="Horizontal FOV in degrees"),
    phone_make: Optional[str] = Form(default=None,
        description="EXIF Make (e.g. 'Apple', 'samsung', 'Xiaomi')"),
    phone_model: Optional[str] = Form(default=None,
        description="EXIF Model (e.g. 'iPhone 15 Pro', 'SM-S928B', 'Mi A1')"),
    # ── 新增: 精度模式選擇 (Phase 1+) ────────────────────────
    # mode=fast    → ~1.5s, 快速篩選
    # mode=balanced → ~3-6s, 日常使用 (預設)
    # mode=accurate → ~5-10s, 研究級精密量測
    mode: Optional[str] = Form(default=None,
        description="Accuracy mode: 'fast', 'balanced', or 'accurate'. "
                    "Controls model selection & processing detail."),
    # ── 參考距離：GPS + 儀器 HD 雙源校正 ────────────────────────
    reference_distance: Optional[float] = Form(default=None,
        description="Known distance from phone to tree (meters), from GPS or instrument. "
                    "Overrides monocular depth estimation for higher accuracy."),
    instrument_distance: Optional[float] = Form(default=None,
        description="Instrument horizontal distance HD (meters). "
                    "Used as fallback when GPS is unavailable or inaccurate, "
                    "and for cross-validation with GPS distance."),
    distance_source: Optional[str] = Form(default=None,
        description="Which distance source the frontend chose: "
                    "'gps' (phone GPS), 'instrument' (VLGEO2 HD), or 'none'."),
    # ── 新增: 使用者觸碰點 (Phase 2: SAM prompt) ──────────────
    # 使用者在手機上點擊目標樹幹 → 送出座標作為 SAM 分割的 prompt
    tap_x: Optional[int] = Form(default=None,
        description="User tap X coordinate on the tree trunk (for SAM segmentation)"),
    tap_y: Optional[int] = Form(default=None,
        description="User tap Y coordinate on the tree trunk (for SAM segmentation)"),
    # ── [Edge AI] Local bounding box from ML Kit ──────────────
    bbox_x1: Optional[float] = Form(default=None),
    bbox_y1: Optional[float] = Form(default=None),
    bbox_x2: Optional[float] = Form(default=None),
    bbox_y2: Optional[float] = Form(default=None),
    # ── [方案A] YOLOv8-seg mask pixel width ───────────────────
    mask_pixel_width: Optional[float] = Form(default=None,
        description="Trunk pixel width computed on-device from YOLOv8-seg mask. "
                    "Overrides depth-edge detection when provided."),
    trunk_mask_base64: Optional[str] = Form(default=None,
        description="Base64-encoded PNG of the on-device YOLO-seg trunk mask "
                    "(grayscale, same width as JPEG). When provided the server "
                    "measures DBH on every multi-row sample directly from this "
                    "mask instead of the depth-edge fallback. This is the "
                    "recommended way: SAM on server is no longer needed."),
    preview_width_px: Optional[float] = Form(default=None,
        description="Preview frame portrait width (short-side px) on which the "
                    "on-device YOLO mask was computed. Required for correct "
                    "scaling when preview and JPEG resolutions differ (iOS, "
                    "low-end Android). If omitted, assume preview == JPEG."),
    return_visualization: bool = Form(default=True,
        description="Return annotated visualization image"),
    return_detection_visualization: bool = Form(default=True,
        description="Return Tesla-style detection overlay"),
):
    """
    Fully automatic DBH measurement — no manual bounding box needed.

    Workflow:
    1. Upload image (just take a photo of the tree)
    2. Server runs depth estimation + automatic trunk detection
    3. Auto-generates bounding box around detected trunk
    4. Measures DBH automatically
    5. Returns result with distance validation feedback

    Like Tesla's vision system: point the camera, AI does everything.
    """
    try:
        # Input validation
        if image.content_type and not image.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="上傳的檔案不是圖片格式")
        
        if mode is not None and mode not in ('fast', 'balanced', 'accurate'):
            raise HTTPException(status_code=400, detail=f"無效的精度模式: {mode}，請使用 fast/balanced/accurate")

        img_bytes = await image.read()
        if len(img_bytes) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="圖片大小超過 20MB 限制")
        try:
            pil_image_orig = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        except Exception:
            raise HTTPException(status_code=400, detail="無法解析圖片，請確認檔案格式正確")
        # 關鍵：套用 EXIF 方向旋轉，使影像座標與前端一致
        # 手機拍直向照片時 JPEG 原始資料是橫向 1280x720，
        # 前端的 bbox 座標是基於旋轉後的直向 720x1280 空間
        pil_image_orig = ImageOps.exif_transpose(pil_image_orig) or pil_image_orig
        W_orig, H_orig = pil_image_orig.size
        pil_image, scale = _resize_for_processing(pil_image_orig)
        W, H = pil_image.size

        # Compute focal length. See /measure-dbh: rescale provided focal_length_px
        # to match the resized image space (mask/depth/bbox are all in resized px).
        if focal_length_px is not None and scale != 1.0:
            effective_focal_px = focal_length_px * scale
            focal_source_extra = f" (scaled ×{scale:.3f})"
        else:
            effective_focal_px = focal_length_px
            focal_source_extra = ""
        effective_fov = fov_degrees
        focal_source = "default"

        # See note in /measure-dbh endpoint: must use long-axis pixel count
        # to match sensor_width_mm which is the sensor's long axis.
        long_dim_px = max(W, H)

        if effective_focal_px is None and focal_length_mm is not None:
            sensor_w, sensor_match = match_phone_sensor(
                phone_make or "", phone_model or ""
            )
            effective_focal_px = focal_length_from_exif(
                focal_length_mm, sensor_w, long_dim_px
            )
            focal_source = f"exif_mm ({focal_length_mm}mm, sensor={sensor_w}mm [{sensor_match}])"

        if effective_focal_px is None and focal_length_35mm is not None:
            effective_fov = 2 * math.atan(36.0 / (2 * focal_length_35mm)) * 180.0 / math.pi
            focal_source = f"35mm_equiv ({focal_length_35mm}mm → FOV={effective_fov:.1f}°)"

        # Step 1: Depth estimation (rich — includes Depth Pro auto-focal/fov)
        t0 = time.time()
        depth_result = estimate_depth_rich(pil_image)
        depth_map = depth_result.depth_map
        depth_time = time.time() - t0

        # Depth Pro auto-focal: override if no EXIF provided
        if depth_result.auto_focal_length_px is not None:
            if effective_focal_px is None:
                effective_focal_px = depth_result.auto_focal_length_px
                if focal_source == "default":
                    focal_source = f"depth_pro_auto ({depth_result.auto_focal_length_px:.1f}px)"
        if depth_result.auto_fov_degrees is not None and focal_source == "default":
            effective_fov = depth_result.auto_fov_degrees
            focal_source = f"depth_pro_fov ({depth_result.auto_fov_degrees:.1f}°)"

        # Step 2: Auto trunk detection
        t1 = time.time()
        detection = detect_trunks(depth_map)
        detect_time = time.time() - t1

        # Step 3: Use the best detected trunk for DBH measurement
        # If Edge AI local_bbox is provided, we use that instead of server auto-detection
        if bbox_x1 is not None and bbox_y1 is not None and bbox_x2 is not None and bbox_y2 is not None:
            bbox = BoundingBox(
                x1=max(0, min(W - 1, int(bbox_x1 * scale))),
                y1=max(0, min(H - 1, int(bbox_y1 * scale))),
                x2=max(0, min(W, int(bbox_x2 * scale))),
                y2=max(0, min(H, int(bbox_y2 * scale))),
            )
            print(f"[AutoMeasure] Using Edge AI local bbox: {bbox}  (image={W}x{H}, scale={scale:.3f})")
            # Compute depth at bbox center for MockTrunk
            _cy = (bbox.y1 + bbox.y2) // 2
            _cx = (bbox.x1 + bbox.x2) // 2
            _cy = max(0, min(depth_map.shape[0] - 1, _cy))
            _cx = max(0, min(depth_map.shape[1] - 1, _cx))
            # Use median depth in bbox region for robustness
            _roi = depth_map[bbox.y1:bbox.y2, bbox.x1:bbox.x2]
            _mock_depth = float(np.median(_roi)) if _roi.size > 0 else float(depth_map[_cy, _cx])
            # Mock best_trunk for response compatibility (must match DetectedTrunk attrs)
            class MockTrunk:
                def __init__(self, b, depth_val):
                    self.bbox_x1 = b.x1
                    self.bbox_y1 = b.y1
                    self.bbox_x2 = b.x2
                    self.bbox_y2 = b.y2
                    self.confidence = 1.0
                    self.depth_m = depth_val
                    self.pixel_width = float(b.x2 - b.x1)
                    self.pixel_height = float(b.y2 - b.y1)
                    self.center_x = (b.x1 + b.x2) // 2
                    self.center_y = (b.y1 + b.y2) // 2
                    self.distance_status = "ok"
                    self.distance_message = "Edge AI local tracking"
                    self.mask = None
            best_trunk = MockTrunk(bbox, _mock_depth)
            detection.trunks = [best_trunk]
            detection.best_trunk_index = 0
            # Also reset error if local bbox provided
            if "response" in locals() and "error" in response:
                del response
        else:
            # Check if any trunk was found by server auto-detection
            if not detection.trunks or detection.best_trunk_index < 0:
                response = {
                    "success": False,
                    "error": "no_trunk_detected",
                    "message": "未偵測到樹幹 — 請對準樹幹拍攝，保持 1-3 公尺距離",
                    "detection_notes": detection.notes,
                    "depth_stats": detection.depth_stats,
                    "timing": {
                        "depth_estimation_ms": round(depth_time * 1000, 1),
                        "detection_ms": round(detect_time * 1000, 1),
                        "total_ms": round((depth_time + detect_time) * 1000, 1),
                    },
                }

                if return_detection_visualization:
                    det_viz = create_detection_visualization(
                        pil_image, depth_map, detection
                    )
                    det_viz_bytes = image_to_bytes(det_viz, "JPEG")
                    response["detection_visualization_base64"] = base64.b64encode(det_viz_bytes).decode()

                return JSONResponse(content=response)
                
            best_trunk = detection.trunks[detection.best_trunk_index]
            bbox = BoundingBox(
                x1=best_trunk.bbox_x1,
                y1=best_trunk.bbox_y1,
                x2=best_trunk.bbox_x2,
                y2=best_trunk.bbox_y2,
            )

        # Step 3.5: SAM segmentation with YOLO bbox guidance (方案A+C)
        # When Edge AI provides bbox, use it as SAM prompt for precise trunk mask
        t_seg = time.time()
        sam_seg_result = None
        sam_trunk_width = None
        seg_mask_applied = False
        has_yolo_bbox = (bbox_x1 is not None and bbox_y1 is not None
                         and bbox_x2 is not None and bbox_y2 is not None)

        if ENABLE_SAM_SEGMENTATION and has_yolo_bbox:
            try:
                img_np = np.array(pil_image)
                _tap = (tap_x, tap_y) if (tap_x is not None and tap_y is not None) else None
                sam_seg_result = segment_trunk_with_yolo_guidance(
                    img_np, depth_map,
                    bbox=(bbox.x1, bbox.y1, bbox.x2, bbox.y2),
                    tap_point=_tap,
                )
                if sam_seg_result.confidence > 0.3:
                    # Compute trunk width from SAM mask (more precise than depth edges)
                    sam_trunk_width, _ = compute_trunk_width_from_mask(
                        sam_seg_result.mask,
                        (bbox.x1, bbox.y1, bbox.x2, bbox.y2),
                    )
                    print(f"[AutoMeasure] SAM mask trunk width: {sam_trunk_width:.1f}px "
                          f"(method={sam_seg_result.method}, conf={sam_seg_result.confidence:.2f})")
            except Exception as e:
                print(f"[AutoMeasure] SAM segmentation failed: {e}")
                traceback.print_exc()
        elif ENABLE_SAM_SEGMENTATION:
            # No YOLO bbox — use depth-based auto-prompt
            try:
                img_np = np.array(pil_image)
                _tap = (tap_x, tap_y) if (tap_x is not None and tap_y is not None) else None
                if _tap:
                    from tree_segmentation import segment_trunk_with_tap
                    sam_seg_result = segment_trunk_with_tap(img_np, depth_map, _tap[0], _tap[1])
                else:
                    sam_seg_result = segment_trunk_auto(img_np, depth_map)
                if sam_seg_result.confidence > 0.3:
                    sam_trunk_width, _ = compute_trunk_width_from_mask(
                        sam_seg_result.mask,
                        (bbox.x1, bbox.y1, bbox.x2, bbox.y2),
                    )
            except Exception as e:
                print(f"[AutoMeasure] SAM auto-prompt failed: {e}")
        seg_time = time.time() - t_seg

        # ── Decode on-device YOLO-seg mask PNG if provided ──
        # This is the recommended path (replaces server-side SAM). When the
        # phone sends us a precise trunk mask we feed it into measure_dbh so
        # every sampled row is measured FROM THE MASK (not depth edges).
        on_device_mask_np = None
        if trunk_mask_base64:
            try:
                import base64
                raw = base64.b64decode(trunk_mask_base64)
                m_img = Image.open(io.BytesIO(raw)).convert("L")
                # IMPORTANT: the mask must live in the SAME coordinate space
                # as ``depth_map`` and ``bbox`` (processed / resized space),
                # because dbh_calculator indexes it as
                # ``trunk_mask[row, bbox.x1:bbox.x2]``. ``pil_image`` is the
                # ORIGINAL upload; depth/bbox are in processed space.
                target_wh = (depth_map.shape[1], depth_map.shape[0])  # (W, H)
                if m_img.size != target_wh:
                    m_img = m_img.resize(target_wh, Image.NEAREST)
                on_device_mask_np = (np.array(m_img) > 127).astype(np.uint8)
                print(f"[AutoMeasure] Decoded on-device mask: shape={on_device_mask_np.shape} "
                      f"positive_px={int(on_device_mask_np.sum())} "
                      f"(resized to depth_map space {target_wh})")
            except Exception as e:
                print(f"[AutoMeasure] Failed to decode on-device mask: {e}")
                on_device_mask_np = None

        # Prefer on-device mask > SAM mask (if SAM ran) for measurement
        effective_mask_np = on_device_mask_np
        if effective_mask_np is None and sam_seg_result is not None \
                and sam_seg_result.confidence > 0.3:
            effective_mask_np = (sam_seg_result.mask > 0).astype(np.uint8)

        # Step 4: Measure DBH using auto-detected bbox
        t2 = time.time()
        result = measure_dbh_multi_row(
            depth_map, bbox,
            focal_length_px=effective_focal_px,
            image_width_px=W,
            fov_degrees=effective_fov,
            trunk_mask=effective_mask_np,
        )
        calc_time = time.time() - t2

        # ── [方案A+C] Override with SAM mask width (highest priority) ──
        # SAM mask width > on-device mask_pixel_width > depth-edge detection
        if sam_trunk_width is not None and sam_trunk_width > 10.0:
            try:
                sam_chord_m = pixel_width_to_metric(
                    sam_trunk_width, result.trunk_depth_m, result.focal_length_px
                )
                sam_dbh_m = cylindrical_correction(sam_chord_m, result.trunk_depth_m)
                old_px = result.trunk_pixel_width
                result = DBHResult(
                    dbh_cm=round(sam_dbh_m * 100.0, 2),
                    confidence=min(1.0, round(result.confidence + 0.10, 3)),
                    trunk_depth_m=result.trunk_depth_m,
                    trunk_pixel_width=round(sam_trunk_width, 2),
                    chord_length_m=round(sam_chord_m, 4),
                    focal_length_px=result.focal_length_px,
                    measurement_row=result.measurement_row,
                    method=f"{result.method}+sam_mask",
                    notes=result.notes + [
                        f"方案A+C: SAM mask width {sam_trunk_width:.1f}px "
                        f"(depth-edge was {old_px:.1f}px, "
                        f"SAM method={sam_seg_result.method}, "
                        f"SAM conf={sam_seg_result.confidence:.2f})"
                    ],
                )
                seg_mask_applied = True
            except Exception as e:
                result.notes.append(f"SAM mask override failed: {e}")

        # ── [方案A fallback] On-device mask_pixel_width (only if SAM didn't apply) ──
        # When SAM mask is available, it's more precise than on-device YOLO mask width.
        # Only use on-device mask_pixel_width as fallback when SAM was not applied.
        if not seg_mask_applied and mask_pixel_width is not None and mask_pixel_width > 10.0:
            try:
                # 座標空間校正：mask_pixel_width 是在前端 camera preview 幀上計算的，
                # preview 解析度未必等於上傳的 JPEG 解析度（iOS / 低階 Android 會分離）。
                # 正確做法：若前端有送 preview_width_px，則以比例重新對應到 processed 空間。
                # 若沒有送，則回退為舊行為 (假設 preview 幀尺寸 == JPEG 尺寸)。
                if preview_width_px is not None and preview_width_px > 0:
                    # preview -> processed 比例 = W_processed / preview_width_px
                    mask_pixel_width_proc = mask_pixel_width * (float(W) / float(preview_width_px))
                    mask_scale_note = (
                        f"preview {mask_pixel_width:.1f}px (@{preview_width_px:.0f}) "
                        f"→ processed {mask_pixel_width_proc:.1f}px (@{W})"
                    )
                else:
                    mask_pixel_width_proc = mask_pixel_width * scale
                    mask_scale_note = (
                        f"photo {mask_pixel_width:.1f}px → processed "
                        f"{mask_pixel_width_proc:.1f}px (scale={scale:.3f}); "
                        f"assumed preview==JPEG"
                    )
                mask_chord_m = pixel_width_to_metric(
                    mask_pixel_width_proc, result.trunk_depth_m, result.focal_length_px
                )
                mask_dbh_m = cylindrical_correction(mask_chord_m, result.trunk_depth_m)
                old_depth_edge_px = result.trunk_pixel_width
                result = DBHResult(
                    dbh_cm=round(mask_dbh_m * 100.0, 2),
                    confidence=min(1.0, round(result.confidence + 0.05, 3)),
                    trunk_depth_m=result.trunk_depth_m,
                    trunk_pixel_width=round(mask_pixel_width_proc, 2),
                    chord_length_m=round(mask_chord_m, 4),
                    focal_length_px=result.focal_length_px,
                    measurement_row=result.measurement_row,
                    method=f"{result.method}+seg_mask",
                    notes=result.notes + [
                        f"方案A: {mask_scale_note}; depth-edge was {old_depth_edge_px:.1f}px"
                    ],
                )
                seg_mask_applied = True
            except Exception as e:
                result.notes.append(f"方案A mask override skipped: {e}")

        # ── Quality guard: warn when we have NO segmentation at all ──
        # Without a trunk mask or on-device mask_pixel_width, measurement
        # relied purely on depth-gradient inside the bbox. After removing the
        # bbox*0.7 rectangular fallback, such measurements will return dbh=0
        # when the three depth strategies all fail. We annotate it so the
        # response is transparent (caller can display a "please re-aim" hint).
        no_mask_available = (
            on_device_mask_np is None
            and not seg_mask_applied
            and (mask_pixel_width is None or mask_pixel_width <= 10.0)
        )
        if no_mask_available:
            result.notes.append(
                "WARNING: no segmentation mask available — measurement is based "
                "on depth edges only; accuracy may be degraded."
            )

        # Step 4.5: Subpixel + Ellipse refinement (mode-dependent)
        # Skip when ANY seg mask was applied (SAM override OR on-device
        # YOLOv8-seg mask fed into measure_dbh). The mask width is more
        # accurate than depth-gradient refinement, and running subpixel
        # would silently overwrite the mask width with a noisier estimate.
        active_preset = get_preset(mode) if mode else get_preset("balanced")
        subpixel_width = None
        ellipse_width = None
        refinement_skip_due_to_mask = (
            seg_mask_applied or on_device_mask_np is not None
        )

        if (not refinement_skip_due_to_mask
                and active_preset.use_subpixel
                and result.measurement_row is not None):
            try:
                gray = np.array(pil_image.convert("L")).astype(np.float64)
                fg_mask = (depth_map < np.percentile(depth_map, 40)).astype(np.uint8)
                sub_w = subpixel_trunk_width(
                    gray, fg_mask, result.measurement_row,
                    initial_width_px=result.trunk_pixel_width,
                )
                if sub_w is not None and sub_w > 3:
                    subpixel_width = sub_w
                    old_px = result.trunk_pixel_width
                    depth_at_row = result.trunk_depth_m
                    new_chord = pixel_width_to_metric(sub_w, depth_at_row, result.focal_length_px)
                    new_dbh_m = cylindrical_correction(new_chord, depth_at_row)
                    result = DBHResult(
                        dbh_cm=round(new_dbh_m * 100.0, 2),
                        confidence=min(1.0, round(result.confidence + 0.05, 3)),
                        trunk_depth_m=result.trunk_depth_m,
                        trunk_pixel_width=round(sub_w, 2),
                        chord_length_m=round(new_chord, 4),
                        focal_length_px=result.focal_length_px,
                        measurement_row=result.measurement_row,
                        method=f"{result.method}+subpixel",
                        notes=result.notes + [
                            f"Subpixel refinement: {old_px:.1f}px → {sub_w:.2f}px"
                        ],
                    )
            except Exception as e:
                result.notes.append(f"Subpixel refinement skipped: {e}")

        if not refinement_skip_due_to_mask and active_preset.use_ellipse_fit and result.measurement_row is not None:
            try:
                fg_mask = (depth_map < np.percentile(depth_map, 40)).astype(np.uint8)
                ell_w = ellipse_corrected_width(fg_mask, result.measurement_row)
                if ell_w is not None and ell_w > 3:
                    ellipse_width = ell_w
                    depth_at_row = result.trunk_depth_m
                    new_chord = pixel_width_to_metric(ell_w, depth_at_row, result.focal_length_px)
                    new_dbh_m = cylindrical_correction(new_chord, depth_at_row)
                    result = DBHResult(
                        dbh_cm=round(new_dbh_m * 100.0, 2),
                        confidence=min(1.0, round(result.confidence + 0.05, 3)),
                        trunk_depth_m=result.trunk_depth_m,
                        trunk_pixel_width=round(ell_w, 2),
                        chord_length_m=round(new_chord, 4),
                        focal_length_px=result.focal_length_px,
                        measurement_row=result.measurement_row,
                        method=f"{result.method}+ellipse",
                        notes=result.notes + [
                            f"Ellipse fitting: equivalent diameter {ell_w:.2f}px"
                        ],
                    )
            except Exception as e:
                result.notes.append(f"Ellipse fitting skipped: {e}")

        # ── Smart distance selection & depth correction ───────────────
        # Priority: GPS (if accurate) > Instrument HD > Monocular depth
        # Cross-validate GPS vs Instrument when both available
        depth_source = "monocular"
        chosen_distance = None
        correction_notes = []
        
        _ref = reference_distance if (reference_distance is not None and reference_distance > 0) else None
        _inst = instrument_distance if (instrument_distance is not None and instrument_distance > 0) else None
        _src = distance_source or "none"
        
        if _ref is not None and _inst is not None:
            deviation = abs(_ref - _inst) / _inst if _inst > 0 else float('inf')
            # Tighter tolerance: GPS 水平精度通常 ±5-10m，但拍樹距離多在 1-5m。
            # 15% 偏差 (例如 3m vs 3.45m) 已是顯著落差，此時信任儀器 HD。
            # 原本 50% 太寬鬆 → 50cm 樹被錯放成 75cm 的風險。
            if deviation < 0.15:
                # GPS 與儀器吻合 → 用 GPS (實際位置誤差較小時)
                chosen_distance = _ref
                depth_source = "gps_validated"
                correction_notes.append(
                    f"GPS ({_ref:.2f}m) validated by instrument HD ({_inst:.2f}m), deviation {deviation:.0%}"
                )
            else:
                # 分歧大 → 信任儀器 HD (校正過的光學測距)
                chosen_distance = _inst
                depth_source = "instrument_preferred"
                correction_notes.append(
                    f"GPS ({_ref:.2f}m) disagrees with instrument HD ({_inst:.2f}m) by {deviation:.0%}, using instrument"
                )
        elif _ref is not None:
            chosen_distance = _ref
            depth_source = f"gps_{_src}" if _src == "gps" else "reference"
            correction_notes.append(f"Reference distance: {_ref:.2f}m (source: {_src})")
        elif _inst is not None:
            chosen_distance = _inst
            depth_source = "instrument"
            correction_notes.append(f"Instrument HD: {_inst:.2f}m")
        
        if chosen_distance is not None:
            original_depth = result.trunk_depth_m
            if original_depth > 0:
                scale_factor = chosen_distance / original_depth
                corrected_chord = result.chord_length_m * scale_factor
                corrected_dbh_m = cylindrical_correction(corrected_chord, chosen_distance)
                corrected_dbh_cm = corrected_dbh_m * 100.0
                
                confidence_boost = 0.15 if depth_source == "gps_validated" else 0.1
                
                result = DBHResult(
                    dbh_cm=round(corrected_dbh_cm, 2),
                    confidence=min(1.0, round(result.confidence + confidence_boost, 3)),
                    trunk_depth_m=round(chosen_distance, 3),
                    trunk_pixel_width=result.trunk_pixel_width,
                    chord_length_m=round(corrected_chord, 4),
                    focal_length_px=result.focal_length_px,
                    measurement_row=result.measurement_row,
                    method=f"{result.method}+{depth_source}",
                    notes=result.notes + correction_notes + [
                        f"Monocular depth was: {original_depth:.2f}m (scale: {scale_factor:.2f}x)",
                    ],
                )
            else:
                chord_m = pixel_width_to_metric(
                    result.trunk_pixel_width, chosen_distance, result.focal_length_px
                )
                dbh_m = cylindrical_correction(chord_m, chosen_distance)
                result = DBHResult(
                    dbh_cm=round(dbh_m * 100.0, 2),
                    confidence=round(0.6, 3),
                    trunk_depth_m=round(chosen_distance, 3),
                    trunk_pixel_width=result.trunk_pixel_width,
                    chord_length_m=round(chord_m, 4),
                    focal_length_px=result.focal_length_px,
                    measurement_row=result.measurement_row,
                    method=f"{depth_source}_fallback",
                    notes=correction_notes + [
                        "Monocular depth failed, using external distance directly",
                    ],
                )
                depth_source = f"{depth_source}_fallback"

        if focal_source != "default":
            result.notes.append(f"Focal source: {focal_source}")
        result.notes.append(f"Auto-detected trunk (confidence: {best_trunk.confidence:.0%})")

        # Quality gate: add warning for low-confidence or unrealistic DBH
        is_poor_quality = (
            result.confidence < 0.45
            or result.dbh_cm > 200
            or result.dbh_cm < 2
        )
        if is_poor_quality:
            result.notes.append("⚠️ 測量品質偏低，建議靠近樹幹或在白天測量")

        # Build response
        response = {
            "success": True,
            "auto_detected": True,
            "quality_warning": is_poor_quality,
            "quality_message": "請靠近或在白天測量" if is_poor_quality else None,
            "dbh_cm": result.dbh_cm,
            "confidence": result.confidence,
            "trunk_depth_m": result.trunk_depth_m,
            "trunk_pixel_width": result.trunk_pixel_width,
            "chord_length_m": result.chord_length_m,
            "focal_length_px": result.focal_length_px,
            "measurement_row": result.measurement_row,
            "method": result.method,
            "notes": result.notes,
            # Distance validation
            "distance_status": best_trunk.distance_status,
            "distance_message": best_trunk.distance_message,
            # Auto-detected bbox
            "detected_bbox": {
                "x1": best_trunk.bbox_x1,
                "y1": best_trunk.bbox_y1,
                "x2": best_trunk.bbox_x2,
                "y2": best_trunk.bbox_y2,
            },
            "detection_confidence": best_trunk.confidence,
            # All detected trunks info
            "all_trunks": [
                {
                    "bbox": {"x1": t.bbox_x1, "y1": t.bbox_y1,
                             "x2": t.bbox_x2, "y2": t.bbox_y2},
                    "confidence": t.confidence,
                    "depth_m": t.depth_m,
                    "distance_status": t.distance_status,
                    "distance_message": t.distance_message,
                }
                for t in detection.trunks
            ],
            "depth_source": depth_source,
            "reference_distance_m": reference_distance,
            "instrument_distance_m": instrument_distance,
            "sam_segmentation": {
                "applied": seg_mask_applied,
                "method": sam_seg_result.method if sam_seg_result else None,
                "confidence": round(sam_seg_result.confidence, 3) if sam_seg_result else None,
                "sam_trunk_width_px": round(sam_trunk_width, 1) if sam_trunk_width else None,
            } if sam_seg_result else None,
            "timing": {
                "depth_estimation_ms": round(depth_time * 1000, 1),
                "detection_ms": round(detect_time * 1000, 1),
                "sam_segmentation_ms": round(seg_time * 1000, 1),
                "dbh_calculation_ms": round(calc_time * 1000, 1),
                "total_ms": round((depth_time + detect_time + seg_time + calc_time) * 1000, 1),
            },
            "image_size": {"width": W_orig, "height": H_orig},
            "processing_size": {"width": W, "height": H},
            "backend_used": depth_result.backend_used,
        }

        # SAM mask overlay (green highlight on trunk)
        if sam_seg_result is not None and sam_seg_result.confidence > 0.3:
            mask_b64 = _mask_to_overlay_base64(pil_image, sam_seg_result.mask)
            response["sam_mask_overlay_base64"] = mask_b64

        if return_visualization:
            viz = create_result_image(
                pil_image, depth_map,
                (bbox.x1, bbox.y1, bbox.x2, bbox.y2),
                result.dbh_cm, result.trunk_depth_m,
                result.confidence, result.measurement_row,
            )
            viz_bytes = image_to_bytes(viz, "JPEG")
            response["visualization_base64"] = base64.b64encode(viz_bytes).decode()

        if return_detection_visualization:
            det_viz = create_detection_visualization(
                pil_image, depth_map, detection
            )
            det_viz_bytes = image_to_bytes(det_viz, "JPEG")
            response["detection_visualization_base64"] = base64.b64encode(det_viz_bytes).decode()

        return JSONResponse(content=response)

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal error during processing: {type(e).__name__}")


# ============================================================
# ML Service Configuration Endpoint
# ============================================================

@app.get("/api/v1/config")
async def get_ml_config():
    """
    Return current ML service configuration and available options.
    
    Frontend can use this to:
    - Show available accuracy modes in the UI
    - Display which model is active
    - Show estimated processing times
    """
    depth_config = get_depth_config()
    seg_config = get_seg_config()
    
    modes_info = {}
    for name, preset in ACCURACY_PRESETS.items():
        depth_m = DEPTH_MODELS.get(preset.depth_model)
        modes_info[name] = {
            "description": preset.description,
            "depth_model": preset.depth_model,
            "segmentation": preset.seg_model,
            "estimated_time_s": depth_m.expected_cpu_time_s if depth_m else 0,
            "features": {
                "multi_row": preset.use_multi_row,
                "subpixel": preset.use_subpixel,
                "ellipse_fit": preset.use_ellipse_fit,
            },
        }
    
    return {
        "active_depth_model": {
            "key": os.environ.get("ML_DEPTH_MODEL", "depth_pro"),
            "name": depth_config.display_name,
            "params_m": depth_config.params_m,
            "license": depth_config.license,
        },
        "active_segmentation": {
            "key": os.environ.get("ML_SEG_MODEL", "depth_heuristic"),
            "name": seg_config.display_name,
        },
        "onnx_enabled": USE_ONNX_RUNTIME,
        "openvino_enabled": ENABLE_OPENVINO,
        "sam_enabled": ENABLE_SAM_SEGMENTATION,
        "available_modes": modes_info,
    }


# ============================================================
# Batch / Debug Endpoints
# ============================================================

@app.post("/api/v1/debug/depth-at-point", dependencies=[Depends(verify_api_key)])
async def depth_at_point(
    image: UploadFile = File(...),
    x: int = Form(...),
    y: int = Form(...),
):
    """Get depth value at a specific pixel coordinate. Useful for debugging."""
    try:
        img_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(img_bytes)).convert("RGB")

        depth_map = estimate_depth(pil_image)
        H, W = depth_map.shape

        if not (0 <= x < W and 0 <= y < H):
            raise HTTPException(status_code=400, detail=f"Point ({x},{y}) outside image ({W}x{H})")

        depth_value = float(depth_map[y, x])

        # Also get average in a small neighborhood
        r = 5
        x1, y1 = max(0, x-r), max(0, y-r)
        x2, y2 = min(W, x+r+1), min(H, y+r+1)
        neighborhood = depth_map[y1:y2, x1:x2]

        return {
            "depth_m": round(depth_value, 4),
            "neighborhood_mean_m": round(float(np.mean(neighborhood)), 4),
            "neighborhood_std_m": round(float(np.std(neighborhood)), 4),
            "point": {"x": x, "y": y},
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal error during debug endpoint: {type(e).__name__}")


# ============================================================
# Multi-Photo Fusion Endpoint
# ============================================================

@app.post("/api/v1/auto-measure-dbh-multi", dependencies=[Depends(verify_api_key)])
async def auto_measure_dbh_multi_endpoint(
    images: List[UploadFile] = File(..., description="2-3 photos of the same tree"),
    focal_length_mm: Optional[float] = Form(default=None),
    focal_length_35mm: Optional[float] = Form(default=None),
    fov_degrees: float = Form(default=70.0),
    phone_make: Optional[str] = Form(default=None),
    phone_model: Optional[str] = Form(default=None),
    reference_distance: Optional[float] = Form(default=None),
    instrument_distance: Optional[float] = Form(default=None),
    mode: Optional[str] = Form(default=None),
):
    """
    Multi-photo DBH measurement for higher accuracy.

    Takes 2-3 photos of the same tree and fuses depth maps
    by taking the median, reducing single-inference noise.
    Confidence is boosted based on inter-photo consistency.
    """
    if len(images) < 2:
        raise HTTPException(status_code=400, detail="At least 2 images required")
    if len(images) > 3:
        raise HTTPException(status_code=400, detail="Maximum 3 images supported for multi-shot")

    try:
        dbh_results = []
        total_time = 0

        for i, img_upload in enumerate(images):
            img_bytes = await img_upload.read()
            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            pil_img = ImageOps.exif_transpose(pil_img) or pil_img
            pil_img, scale = _resize_for_processing(pil_img)
            W, H = pil_img.size

            # Compute focal
            eff_focal = None
            eff_fov = fov_degrees
            if focal_length_mm is not None:
                sensor_w, _ = match_phone_sensor(phone_make or "", phone_model or "")
                eff_focal = focal_length_from_exif(focal_length_mm, sensor_w, W)
            elif focal_length_35mm is not None:
                eff_fov = 2 * math.atan(36.0 / (2 * focal_length_35mm)) * 180.0 / math.pi

            t0 = time.time()
            depth_result = estimate_depth_rich(pil_img)
            depth_map = depth_result.depth_map

            if eff_focal is None and depth_result.auto_focal_length_px is not None:
                eff_focal = depth_result.auto_focal_length_px
            if depth_result.auto_fov_degrees is not None and eff_focal is None:
                eff_fov = depth_result.auto_fov_degrees

            detection = detect_trunks(depth_map)
            if not detection.trunks or detection.best_trunk_index < 0:
                continue

            best = detection.trunks[detection.best_trunk_index]
            bbox = BoundingBox(x1=best.bbox_x1, y1=best.bbox_y1, x2=best.bbox_x2, y2=best.bbox_y2)
            result = measure_dbh_multi_row(
                depth_map, bbox,
                focal_length_px=eff_focal, image_width_px=W, fov_degrees=eff_fov,
            )
            elapsed = time.time() - t0
            total_time += elapsed
            dbh_results.append(result)

        if not dbh_results:
            return JSONResponse(content={
                "success": False,
                "error": "no_trunk_in_any_image",
                "message": "所有照片都未偵測到樹幹",
            })

        dbh_values = [r.dbh_cm for r in dbh_results]
        median_dbh = float(np.median(dbh_values))
        std_dbh = float(np.std(dbh_values)) if len(dbh_values) > 1 else 0
        cv = std_dbh / median_dbh if median_dbh > 0 else 1.0

        # Consistency-based confidence: low CV = high confidence
        base_confidence = np.mean([r.confidence for r in dbh_results])
        multi_boost = 0.1 if cv < 0.15 else 0.05 if cv < 0.3 else 0
        final_confidence = min(1.0, float(base_confidence + multi_boost))

        # Apply distance correction to median
        _ref = reference_distance if (reference_distance and reference_distance > 0) else None
        _inst = instrument_distance if (instrument_distance and instrument_distance > 0) else None
        chosen_dist = _ref or _inst
        depth_source = "monocular_multi"

        if chosen_dist:
            median_result = dbh_results[len(dbh_results) // 2]
            if median_result.trunk_depth_m > 0:
                sf = chosen_dist / median_result.trunk_depth_m
                corr_chord = median_result.chord_length_m * sf
                corr_dbh = cylindrical_correction(corr_chord, chosen_dist) * 100.0
                median_dbh = round(corr_dbh, 2)
                depth_source = "multi_corrected"
                final_confidence = min(1.0, final_confidence + 0.1)

        return JSONResponse(content={
            "success": True,
            "multi_shot": True,
            "num_images": len(images),
            "num_valid": len(dbh_results),
            "dbh_cm": round(median_dbh, 2),
            "confidence": round(final_confidence, 3),
            "dbh_std_cm": round(std_dbh, 2),
            "dbh_cv": round(cv, 3),
            "individual_dbh_cm": [round(d, 2) for d in dbh_values],
            "method": f"multi_median_{len(dbh_results)}shot+{depth_source}",
            "depth_source": depth_source,
            "notes": [
                f"Multi-shot fusion: {len(dbh_results)}/{len(images)} images valid",
                f"DBH range: {min(dbh_values):.1f} - {max(dbh_values):.1f} cm (CV={cv:.1%})",
            ],
            "timing": {
                "total_ms": round(total_time * 1000, 1),
                "per_image_ms": round(total_time / len(dbh_results) * 1000, 1) if dbh_results else 0,
            },
        })

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal error during multi-photo measurement: {type(e).__name__}")


# ============================================================
# Static Files (scanner.html for mobile testing)
# ============================================================

_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8100))
    uvicorn.run(app, host="0.0.0.0", port=port)
