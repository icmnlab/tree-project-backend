"""
Depth Estimation Service
========================
Uses configurable depth model for per-pixel metric depth estimation.

Supports multiple backends:
  - PyTorch (default): AutoModelForDepthEstimation (DA V2 family)
  - Depth Pro: DepthProForDepthEstimation (Apple, ICLR 2025 SOTA)
  - OpenVINO: Intel iGPU/NPU/CPU acceleration via optimum-intel
  - ONNX Runtime: CPU-optimized inference via optimum

Hardware auto-detection priority:
  1. OpenVINO + Intel iGPU (if ML_USE_OPENVINO=true and openvino installed)
  2. CUDA GPU (if available)
  3. ONNX Runtime CPU (if ML_USE_ONNX=true and exported)
  4. PyTorch CPU (fallback)
"""

import torch
import numpy as np
from PIL import Image
from typing import Optional
from dataclasses import dataclass, field

from model_registry import (
    get_depth_config, USE_ONNX_RUNTIME, ONNX_MODEL_DIR,
    CPU_THREADS, INPUT_SIZE_OVERRIDE, ENABLE_OPENVINO,
    DEPTH_MODELS,
)

# ============================================================
# Depth Result (carries auto-estimated focal/fov from Depth Pro)
# ============================================================

@dataclass
class DepthResult:
    """Enriched depth estimation result."""
    depth_map: np.ndarray                    # (H, W) in meters
    auto_focal_length_px: Optional[float] = None  # Depth Pro auto-estimated
    auto_fov_degrees: Optional[float] = None      # Depth Pro auto-estimated
    backend_used: str = "pytorch_cpu"
    model_id: str = ""
    notes: list = field(default_factory=list)


# ============================================================
# Singleton Model Holder
# ============================================================

_model = None
_processor = None
_device = None
_model_id = None
_backend_type = None  # "pytorch", "depth_pro", "openvino", "onnx"
_is_depth_pro = False  # True when active model is Apple DepthPro (any backend)
_detected_backend_cache = None


def detect_best_backend() -> str:
    """
    Auto-detect the best available inference backend (cached after first call).
    Returns: "openvino_gpu", "openvino_cpu", "cuda", "onnx", "cpu"
    """
    global _detected_backend_cache
    if _detected_backend_cache is not None:
        return _detected_backend_cache

    result = _probe_backend()
    _detected_backend_cache = result
    return result


def _probe_backend() -> str:
    """Actual hardware probing logic (called once)."""
    # 1. OpenVINO (Intel Arc iGPU / NPU)
    if ENABLE_OPENVINO:
        try:
            from openvino import Core
            core = Core()
            devices = core.available_devices
            if "GPU" in devices:
                print(f"[Hardware] OpenVINO GPU (Intel Arc iGPU) detected: {devices}")
                return "openvino_gpu"
            elif "NPU" in devices:
                print(f"[Hardware] OpenVINO NPU detected: {devices}")
                return "openvino_npu"
            else:
                print(f"[Hardware] OpenVINO CPU only: {devices}")
                return "openvino_cpu"
        except ImportError:
            print("[Hardware] OpenVINO not installed, skipping")
        except Exception as e:
            print(f"[Hardware] OpenVINO probe failed: {e}")

    # 2. CUDA GPU
    if torch.cuda.is_available():
        print(f"[Hardware] CUDA GPU detected: {torch.cuda.get_device_name(0)}")
        return "cuda"

    # 3. Intel XPU (Arc / integrated)
    if hasattr(torch, "xpu") and torch.xpu.is_available():
        name = torch.xpu.get_device_name(0)
        props = torch.xpu.get_device_properties(0)
        vram_gb = round(props.total_memory / 1024**3, 1)
        print(f"[Hardware] Intel XPU detected: {name} ({vram_gb} GB VRAM)")
        return "xpu"

    # 4. MPS (Apple Silicon)
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"

    # 5. ONNX Runtime
    if USE_ONNX_RUNTIME:
        try:
            import onnxruntime
            print(f"[Hardware] ONNX Runtime available (providers: {onnxruntime.get_available_providers()})")
            return "onnx"
        except ImportError:
            pass

    return "cpu"


def _get_torch_device(backend: str) -> str:
    """Map backend string to torch device string."""
    if backend == "cuda":
        return "cuda"
    if backend == "xpu":
        return "xpu"
    if backend == "mps":
        return "mps"
    return "cpu"


# ============================================================
# Model Loading
# ============================================================

def load_model(model_id_override: str = None):
    """
    Load depth model via ModelRegistry (Pinnacle Mode).
    """
    from model_registry import get_registry
    global _model, _processor, _device, _model_id, _backend_type
    
    registry = get_registry()
    
    config = get_depth_config()
    target_model_id = model_id_override or config.model_id
    
    # When override is provided, use config for that model
    if model_id_override:
        for cfg in DEPTH_MODELS.values():
            if cfg.model_id == target_model_id:
                config = cfg
                break
                
    if _model is not None and _model_id == target_model_id:
        return _model, _processor
        
    _model, _processor = registry.get_depth_model(force_openvino=ENABLE_OPENVINO)
    
    # PyTorch fallback if OpenVINO failed
    if _model is None:
        backend = detect_best_backend()
        _device = _get_torch_device(backend)
        if config.backend == "unidepth":
            _try_load_unidepth(target_model_id, config)
        elif config.backend == "da3_native":
            _try_load_da3(target_model_id, config)
        elif config.backend == "depth_pro" and ("DepthPro" in target_model_id or "depth_pro" in target_model_id):
            if not _try_load_depth_pro(target_model_id):
                print("[DepthEstimation] Depth Pro load failed, trying DA V2 Base fallback")
                target_model_id = "depth-anything/Depth-Anything-V2-Metric-Outdoor-Base-hf"
                config = DEPTH_MODELS.get("da_v2_base", config)
                _load_pytorch_standard(target_model_id, config)
        elif ENABLE_OPENVINO and config.backend == "transformers":
            # Registry handled OV export+load; if we got here it failed → PyTorch CPU.
            _load_pytorch_standard(target_model_id, config)
        else:
            _load_pytorch_standard(target_model_id, config)
            
        return _model, _processor

    _model_id = target_model_id
    _device = "cpu" if not ENABLE_OPENVINO else "openvino"
    
    # Check if it loaded OpenVINO
    global _is_depth_pro
    _is_depth_pro = bool(_model_id and ("DepthPro" in _model_id or "depth_pro" in _model_id))
    if hasattr(_model, "compile") or type(_model).__name__ == "_OVDepthModelWrapper":
        _backend_type = "openvino"
    elif _is_depth_pro:
        _backend_type = "depth_pro"
    else:
        _backend_type = "pytorch_cpu"
        
    return _model, _processor


def _try_load_openvino(model_id: str, config, backend: str) -> bool:
    """Attempt to load model via OpenVINO optimum-intel."""
    global _model, _processor, _model_id, _backend_type
    try:
        from optimum.intel import OVModelForDepthEstimation
        from transformers import AutoImageProcessor

        ov_device = "GPU" if "gpu" in backend else ("NPU" if "npu" in backend else "CPU")

        # Depth Pro uses its own processor class
        if config.backend == "depth_pro":
            from transformers import DepthProImageProcessorFast
            _processor = DepthProImageProcessorFast.from_pretrained(model_id)
        else:
            if INPUT_SIZE_OVERRIDE > 0:
                _processor = AutoImageProcessor.from_pretrained(
                    model_id,
                    size={"height": INPUT_SIZE_OVERRIDE, "width": INPUT_SIZE_OVERRIDE},
                )
            else:
                _processor = AutoImageProcessor.from_pretrained(model_id)

        print(f"[DepthEstimation] Exporting to OpenVINO (device={ov_device})...")
        _model = OVModelForDepthEstimation.from_pretrained(
            model_id, export=True, device=ov_device,
        )
        _model_id = model_id
        _backend_type = f"openvino_{ov_device.lower()}"
        print(f"[DepthEstimation] OpenVINO model ready on {ov_device}")
        return True

    except ImportError:
        print("[DepthEstimation] optimum-intel not installed: pip install optimum[openvino] openvino")
    except Exception as e:
        print(f"[DepthEstimation] OpenVINO load error: {e}")
        import traceback
        traceback.print_exc()
    return False


def _try_load_onnx(model_id: str) -> bool:
    """Attempt to load model via ONNX Runtime."""
    global _model, _processor, _model_id, _backend_type
    try:
        from optimum.onnxruntime import ORTModelForDepthEstimation
        from transformers import AutoImageProcessor
        import onnxruntime as ort

        onnx_path = f"{ONNX_MODEL_DIR}/depth"
        print(f"[DepthEstimation] Loading ONNX model from {onnx_path}...")

        sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = CPU_THREADS
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        _processor = AutoImageProcessor.from_pretrained(model_id)
        _model = ORTModelForDepthEstimation.from_pretrained(
            onnx_path, session_options=sess_options,
        )
        _model_id = model_id
        _backend_type = "onnx"
        print(f"[DepthEstimation] ONNX model loaded (threads={CPU_THREADS})")
        return True

    except ImportError:
        print("[DepthEstimation] optimum/onnxruntime not installed")
    except Exception as e:
        print(f"[DepthEstimation] ONNX load error: {e}")
    return False


def _try_load_unidepth(model_id: str, config) -> bool:
    """Attempt to load UniDepth V2 (auto-focal). Always uses CPU/PyTorch."""
    global _model, _processor, _device, _model_id, _backend_type
    try:
        from unidepth.models import UniDepthV2

        print(f"[DepthEstimation] Loading UniDepthV2 from {model_id}...")
        _processor = None  # UniDepth has no separate processor
        _model = UniDepthV2.from_pretrained(model_id)
        _model.eval()
        _model = _model.to(_device)
        if _device == "cpu":
            torch.set_num_threads(CPU_THREADS)
        _model_id = model_id
        _backend_type = f"unidepth_{_device}"
        print(f"[DepthEstimation] UniDepth V2 loaded ({config.params_m}M params) on {_device}")
        return True
    except Exception as e:
        print(f"[DepthEstimation] UniDepth load error: {e}")
        import traceback
        traceback.print_exc()
    return False


def _try_load_da3(model_id: str, config) -> bool:
    """Attempt to load Depth-Anything-3 via its native API."""
    global _model, _processor, _device, _model_id, _backend_type
    try:
        from depth_anything_3.api import DepthAnything3

        print(f"[DepthEstimation] Loading DepthAnything3 from {model_id}...")
        _processor = None
        _model = DepthAnything3.from_pretrained(model_id)
        _model.eval()
        # DA3 forward uses inference_mode internally; CPU only on Windows.
        if _device == "cpu":
            torch.set_num_threads(CPU_THREADS)
        _model_id = model_id
        _backend_type = f"da3_{_device}"
        print(f"[DepthEstimation] DA3 loaded ({config.params_m}M params) on {_device}")
        return True
    except Exception as e:
        print(f"[DepthEstimation] DA3 load error: {e}")
        import traceback
        traceback.print_exc()
    return False


def _try_load_depth_pro(model_id: str) -> bool:
    """Attempt to load Apple Depth Pro via transformers."""
    global _model, _processor, _device, _model_id, _backend_type
    try:
        from transformers import DepthProForDepthEstimation, DepthProImageProcessorFast

        print(f"[DepthEstimation] Loading Depth Pro from {model_id}...")
        _processor = DepthProImageProcessorFast.from_pretrained(model_id)
        _model = DepthProForDepthEstimation.from_pretrained(
            model_id, torch_dtype=torch.float32,
        )
        _model = _model.to(_device)
        _model.eval()

        if _device == "cpu":
            torch.set_num_threads(CPU_THREADS)
        elif _device == "xpu":
            # Intel Arc GPU: log VRAM usage
            props = torch.xpu.get_device_properties(0)
            vram_gb = round(props.total_memory / 1024**3, 1)
            print(f"[DepthEstimation] Intel Arc XPU: {torch.xpu.get_device_name(0)} ({vram_gb} GB)")

        _model_id = model_id
        _backend_type = "depth_pro"
        print(f"[DepthEstimation] Depth Pro loaded on {_device} (350M params)")

        # Warmup
        try:
            with torch.no_grad():
                dummy = torch.randn(1, 3, 384, 384).to(_device)
                _model(dummy)
            print("[DepthEstimation] Warmup complete")
        except Exception:
            print("[DepthEstimation] Warmup skipped (non-critical)")

        return True

    except ImportError as e:
        print(f"[DepthEstimation] Depth Pro not available in transformers: {e}")
        print("[DepthEstimation] Upgrade: pip install --upgrade transformers>=4.45.0")
    except Exception as e:
        print(f"[DepthEstimation] Depth Pro load error: {e}")
        import traceback
        traceback.print_exc()
    return False


def _load_pytorch_standard(model_id: str, config):
    """Standard PyTorch loading for DA V2 family."""
    global _model, _processor, _device, _model_id, _backend_type
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    if INPUT_SIZE_OVERRIDE > 0:
        _processor = AutoImageProcessor.from_pretrained(
            model_id,
            size={"height": INPUT_SIZE_OVERRIDE, "width": INPUT_SIZE_OVERRIDE},
        )
    else:
        _processor = AutoImageProcessor.from_pretrained(model_id)

    _model = AutoModelForDepthEstimation.from_pretrained(
        model_id, torch_dtype=torch.float32,
    )
    _model = _model.to(_device)
    _model.eval()

    if _device == "cpu":
        torch.set_num_threads(CPU_THREADS)
        print(f"[DepthEstimation] CPU threads set to {CPU_THREADS}")
    elif _device == "xpu":
        props = torch.xpu.get_device_properties(0)
        vram_gb = round(props.total_memory / 1024**3, 1)
        print(f"[DepthEstimation] Intel Arc XPU: {torch.xpu.get_device_name(0)} ({vram_gb} GB)")

    _model_id = model_id
    _backend_type = f"pytorch_{_device}"
    print(f"[DepthEstimation] PyTorch model loaded ({config.params_m}M params) on {_device}")

    try:
        with torch.no_grad():
            size = INPUT_SIZE_OVERRIDE if INPUT_SIZE_OVERRIDE > 0 else config.input_size
            dummy = torch.randn(1, 3, size, size).to(_device)
            _model(dummy)
        print("[DepthEstimation] Warmup complete")
    except Exception as e:
        print(f"[DepthEstimation] Warmup skipped: {e}")


# ============================================================
# Inference
# ============================================================

def estimate_depth(image: Image.Image) -> np.ndarray:
    """
    Estimate metric depth from a single RGB image.
    Returns np.ndarray of shape (H, W) with depth values in meters.

    For Depth Pro auto-focal/fov, use estimate_depth_rich() instead.
    """
    result = estimate_depth_rich(image)
    return result.depth_map


def estimate_depth_rich(image: Image.Image) -> DepthResult:
    """
    Estimate depth with rich metadata (focal length, FOV from Depth Pro).
    """
    model, processor = load_model()
    config = get_depth_config()

    # ── Custom backends ───────────────────────────────────────
    if config.backend == "unidepth":
        return _infer_unidepth(image, model, config)
    if config.backend == "da3_native":
        return _infer_da3(image, model, config)

    # ── Depth Pro path: uses post_process_depth_estimation ────
    # NOTE: route by _is_depth_pro (model identity) NOT _backend_type,
    # because Depth Pro running on OpenVINO still requires DepthPro post-processing
    # to convert raw outputs to metric depth + pixel focal length.
    if _is_depth_pro:
        return _infer_depth_pro(image, model, processor)

    # ── OpenVINO / ONNX / Standard PyTorch ────────────────────
    return _infer_standard(image, model, processor, config)


def _infer_depth_pro(
    image: Image.Image, model, processor
) -> DepthResult:
    """Depth Pro inference with auto focal length and FOV extraction."""
    inputs = processor(images=image, return_tensors="pt")
    
    is_ov_or_onnx = _backend_type and (
        _backend_type.startswith("openvino") or _backend_type == "onnx"
    )
    if not is_ov_or_onnx:
        inputs = {k: v.to(_device) if hasattr(v, 'to') else v for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)

    post = processor.post_process_depth_estimation(
        outputs, target_sizes=[(image.height, image.width)],
    )

    raw_depth = post[0]["predicted_depth"]
    if hasattr(raw_depth, 'cpu'):
        depth_map = raw_depth.cpu().numpy()
    elif hasattr(raw_depth, 'numpy'):
        depth_map = raw_depth.numpy()
    else:
        depth_map = np.array(raw_depth)

    auto_focal = None
    auto_fov = None
    notes = []

    def _to_float(val):
        if hasattr(val, 'cpu'):
            return float(val.cpu())
        return float(val)

    if "focal_length" in post[0]:
        auto_focal = _to_float(post[0]["focal_length"])
        notes.append(f"Depth Pro auto-focal: {auto_focal:.1f}px")
    if "field_of_view" in post[0]:
        auto_fov = _to_float(post[0]["field_of_view"])
        notes.append(f"Depth Pro auto-FOV: {auto_fov:.1f}deg")

    return DepthResult(
        depth_map=depth_map,
        auto_focal_length_px=auto_focal,
        auto_fov_degrees=auto_fov,
        backend_used=_backend_type or "depth_pro",
        model_id=_model_id or "",
        notes=notes,
    )


def _infer_standard(
    image: Image.Image, model, processor, config
) -> DepthResult:
    """Standard DA V2 / OpenVINO / ONNX inference."""
    inputs = processor(images=image, return_tensors="pt")

    is_ov_or_onnx = _backend_type and (
        _backend_type.startswith("openvino") or _backend_type == "onnx"
    )
    if not is_ov_or_onnx:
        inputs = {k: v.to(_device) if hasattr(v, 'to') else v for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)

    predicted_depth = outputs.predicted_depth

    # OpenVINO/ONNX may return numpy; convert to tensor for interpolation
    if not isinstance(predicted_depth, torch.Tensor):
        predicted_depth = torch.from_numpy(np.array(predicted_depth)).float()

    if predicted_depth.dim() == 2:
        predicted_depth = predicted_depth.unsqueeze(0)

    prediction = torch.nn.functional.interpolate(
        predicted_depth.unsqueeze(1),
        size=image.size[::-1],  # (H, W)
        mode="bicubic",
        align_corners=False,
    ).squeeze()

    depth_map = prediction.cpu().numpy()

    def _to_scalar(v):
        if v is None:
            return None
        try:
            if isinstance(v, torch.Tensor):
                v = v.detach().cpu().numpy()
            arr = np.asarray(v).squeeze()
            if arr.ndim == 0:
                return float(arr)
            return float(arr.reshape(-1)[0])
        except Exception:
            return None

    auto_focal = None
    auto_fov = None
    if hasattr(outputs, "focal_length"):
        auto_focal = _to_scalar(outputs.focal_length)
    if hasattr(outputs, "field_of_view"):
        auto_fov = _to_scalar(outputs.field_of_view)

    return DepthResult(
        depth_map=depth_map,
        auto_focal_length_px=auto_focal,
        auto_fov_degrees=auto_fov,
        backend_used=_backend_type or f"pytorch_{_device}",
        model_id=_model_id or config.model_id,
    )


def _infer_unidepth(image: Image.Image, model, config) -> DepthResult:
    """UniDepthV2 inference. Returns metric depth + auto-focal from estimated K."""
    arr = np.array(image)  # (H, W, 3) uint8
    rgb = torch.from_numpy(arr).permute(2, 0, 1)  # CHW uint8 / float

    with torch.no_grad():
        preds = model.infer(rgb)

    depth_t = preds["depth"].squeeze().detach().cpu().numpy()
    # UniDepth returns (H, W) at original image resolution
    if depth_t.ndim == 3 and depth_t.shape[0] == 1:
        depth_t = depth_t[0]
    depth_map = depth_t.astype(np.float32)

    auto_focal = None
    auto_fov = None
    notes = []
    if "intrinsics" in preds:
        K = preds["intrinsics"].squeeze().detach().cpu().numpy()
        if K.ndim == 3:
            K = K[0]
        fx = float(K[0, 0]); fy = float(K[1, 1])
        auto_focal = (fx + fy) / 2.0
        # FOV horizontal from fx and image width
        W = float(image.width)
        auto_fov = float(2.0 * np.degrees(np.arctan2(W, 2.0 * fx)))
        notes.append(f"UniDepth auto-fx={fx:.1f} fy={fy:.1f}")

    return DepthResult(
        depth_map=depth_map,
        auto_focal_length_px=auto_focal,
        auto_fov_degrees=auto_fov,
        backend_used=_backend_type or "unidepth",
        model_id=_model_id or config.model_id,
        notes=notes,
    )


def _infer_da3(image: Image.Image, model, config) -> DepthResult:
    """Depth-Anything-3 native inference. Returns metric depth (resized to original)."""
    with torch.no_grad():
        pred = model.inference([image], export_dir=None)

    depth = pred.depth[0]  # (H_proc, W_proc) numpy
    if hasattr(depth, "detach"):
        depth = depth.detach().cpu().numpy()
    depth = np.asarray(depth, dtype=np.float32)

    # Resize to original image size (DA3 processes at ~504 long edge).
    target_h, target_w = image.height, image.width
    if depth.shape != (target_h, target_w):
        d_t = torch.from_numpy(depth)[None, None]
        d_t = torch.nn.functional.interpolate(
            d_t, size=(target_h, target_w), mode="bilinear", align_corners=False,
        )
        depth = d_t.squeeze().numpy()

    auto_focal = None
    auto_fov = None
    notes = []
    if pred.intrinsics is not None:
        K = pred.intrinsics
        if K.ndim == 3:
            K = K[0]
        # DA3 intrinsics are in processed-image space → rescale fx,fy by ratio.
        proc_h, proc_w = pred.depth[0].shape[-2:]
        scale_x = target_w / float(proc_w)
        scale_y = target_h / float(proc_h)
        fx = float(K[0, 0]) * scale_x
        fy = float(K[1, 1]) * scale_y
        auto_focal = (fx + fy) / 2.0
        auto_fov = float(2.0 * np.degrees(np.arctan2(target_w, 2.0 * fx)))
        notes.append(f"DA3 auto-fx={fx:.1f} fy={fy:.1f}")

    return DepthResult(
        depth_map=depth,
        auto_focal_length_px=auto_focal,
        auto_fov_degrees=auto_fov,
        backend_used=_backend_type or "da3_native",
        model_id=_model_id or config.model_id,
        notes=notes,
    )


def estimate_depth_with_info(image: Image.Image) -> dict:
    """
    Estimate depth and return comprehensive info (backward compatible).
    """
    result = estimate_depth_rich(image)
    config = get_depth_config()

    info = {
        "depth_map": result.depth_map,
        "min_depth": float(np.min(result.depth_map)),
        "max_depth": float(np.max(result.depth_map)),
        "mean_depth": float(np.mean(result.depth_map)),
        "image_size": (result.depth_map.shape[1], result.depth_map.shape[0]),
        "model_id": result.model_id or config.model_id,
        "model_name": config.display_name,
        "backend": result.backend_used,
    }

    if result.auto_focal_length_px is not None:
        info["auto_focal_length_px"] = result.auto_focal_length_px
    if result.auto_fov_degrees is not None:
        info["auto_fov_degrees"] = result.auto_fov_degrees

    return info


def get_backend_info() -> dict:
    """Return info about detected backend for health check."""
    backend = detect_best_backend()
    return {
        "detected_backend": backend,
        "openvino_enabled": ENABLE_OPENVINO,
        "onnx_enabled": USE_ONNX_RUNTIME,
        "cuda_available": torch.cuda.is_available(),
        "xpu_available": hasattr(torch, "xpu") and torch.xpu.is_available(),
        "xpu_device": torch.xpu.get_device_name(0) if (hasattr(torch, "xpu") and torch.xpu.is_available()) else None,
        "active_backend": _backend_type,
        "active_model": _model_id,
    }
