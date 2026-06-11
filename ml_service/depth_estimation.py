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
    1. Requested DA3 OpenVINO device (ML_DA3_OV_DEVICE), when available
    2. OpenVINO + Intel GPU/NPU/CPU (if ML_USE_OPENVINO=true)
    3. CUDA GPU (if available)
    4. ONNX Runtime CPU (if ML_USE_ONNX=true and exported)
    5. PyTorch CPU (fallback)
"""

import os
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

# DA3 OpenVINO acceleration ---------------------------------------------------
# When `_da3_ov_compiled` is set, _infer_da3() will run depth on the iGPU via
# OpenVINO IR (FP16) instead of the much slower PyTorch CPU path.
# Validated at development time: < 1% per-pixel diff vs PT-FP32.
_da3_ov_compiled = None
_da3_ov_input_shape: tuple[int, int] | None = None  # (H, W) IR was exported at
_da3_ov_device = None  # "GPU" / "CPU" / "NPU"
_da3_input_processor = None  # DA3 InputProcessor instance


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
            requested_da3_device = os.environ.get("ML_DA3_OV_DEVICE", "").strip().upper()
            if requested_da3_device in devices:
                print(f"[Hardware] OpenVINO requested device {requested_da3_device} available: {devices}")
                return f"openvino_{requested_da3_device.lower()}"
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
    """Attempt to load Depth-Anything-3 via its native API.

    If a pre-exported OpenVINO IR exists at
    ``openvino_models/da3_metric_large/openvino_model.xml``, also compile it for
    iGPU acceleration; production inference will then route through OV (~5-6×
    faster on Intel Arc iGPU vs PT-CPU, with <1% numerical drift).
    """
    global _model, _processor, _device, _model_id, _backend_type
    global _da3_ov_compiled, _da3_ov_input_shape, _da3_ov_device, _da3_input_processor
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

        # ---- Optional: load DA3 OpenVINO IR for iGPU/NPU acceleration ----
        # Selection (override via env vars):
        #   ML_DA3_OV_DIR   absolute or relative path to the IR dir (defaults
        #                   to openvino_models/da3_metric_large)
        #   ML_DA3_OV_DEVICE  GPU | NPU | CPU | AUTO  (default: AUTO →
        #                   prefer GPU > NPU > CPU; benchmarks force a single
        #                   device by setting this explicitly)
        try:
            from pathlib import Path as _P
            ov_dir_env = os.environ.get("ML_DA3_OV_DIR", "").strip()
            if ov_dir_env:
                ov_dir = _P(ov_dir_env)
                if not ov_dir.is_absolute():
                    ov_dir = _P(__file__).parent / ov_dir
            else:
                ov_dir = _P(__file__).parent / "openvino_models" / "da3_metric_large"
            ov_xml = ov_dir / "openvino_model.xml"
            ov_cache_dir = _P(__file__).parent / "openvino_models" / "_ov_cache"
            ov_cache_dir.mkdir(parents=True, exist_ok=True)
            if ov_xml.exists():
                import openvino as ov
                core = ov.Core()
                devs = core.available_devices
                pref = os.environ.get("ML_DA3_OV_DEVICE", "AUTO").strip().upper()
                if pref in devs:
                    target = pref
                elif pref == "AUTO":
                    target = ("GPU" if "GPU" in devs
                              else "NPU" if "NPU" in devs
                              else "CPU")
                else:
                    print(f"[DepthEstimation] DA3 OV requested device '{pref}' "
                          f"not in {devs}; falling back to AUTO")
                    target = ("GPU" if "GPU" in devs
                              else "NPU" if "NPU" in devs
                              else "CPU")
                ov_model = core.read_model(str(ov_xml))
                # Read the static export shape from the IR (e.g. 504x378).
                # Even when traced with a fixed example_input, OV's PT
                # frontend sometimes leaves dimensions dynamic, so fall
                # through several strategies before giving up.
                in_shape = ov_model.inputs[0].get_partial_shape()
                H = W = None
                try:
                    if not in_shape[2].is_dynamic:
                        H = int(in_shape[2].get_length())
                    if not in_shape[3].is_dynamic:
                        W = int(in_shape[3].get_length())
                except Exception:
                    pass
                if H is None or W is None:
                    # Try the dir name (e.g. da3_metric_large_602x448)
                    for tok in ov_dir.name.split("_"):
                        if "x" in tok:
                            a, _, b = tok.partition("x")
                            if a.isdigit() and b.isdigit():
                                H, W = int(a), int(b)
                                break
                if H is None or W is None:
                    H, W = 504, 378  # final fallback (matches default IR)
                # NPU requires fully-static shapes; reshape is a no-op for
                # GPU/CPU when the IR is already static, so always do it.
                try:
                    ov_model.reshape({0: ov.PartialShape([1, 3, H, W])})
                except Exception as _re:
                    print(f"[DepthEstimation] DA3 OV reshape({H},{W}) warning: {_re}")
                _da3_ov_compiled = core.compile_model(
                    ov_model,
                    target,
                    {"CACHE_DIR": str(ov_cache_dir)},
                )
                _da3_ov_input_shape = (H, W)
                _da3_ov_device = target
                _da3_input_processor = _model.input_processor
                _backend_type = f"da3_openvino_{target.lower()}"
                print(f"[DepthEstimation] DA3 OpenVINO IR loaded → {target} "
                      f"(input {H}×{W}, FP16, ~5-6× faster than PT-CPU)")
            else:
                print(f"[DepthEstimation] DA3 OV IR not found at {ov_xml} — using PyTorch path")
        except Exception as ov_err:
            print(f"[DepthEstimation] DA3 OV load failed (will use PyTorch): {ov_err}")
            _da3_ov_compiled = None

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
    """Depth-Anything-3 native inference. Returns metric depth (resized to original).

    When a DA3 OpenVINO IR is loaded (`_da3_ov_compiled` is not None) and the
    image's preprocessed shape matches the IR's static input shape, the forward
    pass runs on the iGPU (FP16) instead of PyTorch CPU \u2014 ~5-6\u00d7 faster, with
    <1% per-pixel numerical drift (validated at development time).
    """
    target_h, target_w = image.height, image.width

    # ---- OpenVINO fast path ----
    if _da3_ov_compiled is not None and _da3_input_processor is not None:
        try:
            return _infer_da3_ov(image, model, config)
        except Exception as e:
            print(f"[DepthEstimation] DA3 OV path failed ({e}); falling back to PyTorch")

    # ---- PyTorch fallback path ----
    with torch.no_grad():
        pred = model.inference([image], export_dir=None)

    depth = pred.depth[0]  # (H_proc, W_proc) numpy
    if hasattr(depth, "detach"):
        depth = depth.detach().cpu().numpy()
    depth = np.asarray(depth, dtype=np.float32)

    # Resize to original image size (DA3 processes at ~504 long edge).
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
        # DA3 intrinsics are in processed-image space \u2192 rescale fx,fy by ratio.
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


def _infer_da3_ov(image: Image.Image, model, config) -> DepthResult:
    """DA3 OpenVINO IR forward (iGPU FP16). Image must preprocess to the IR's static shape."""
    assert _da3_ov_compiled is not None
    assert _da3_input_processor is not None
    assert _da3_ov_input_shape is not None

    target_h, target_w = image.height, image.width
    expect_h, expect_w = _da3_ov_input_shape

    # 1) Use DA3 InputProcessor for IDENTICAL preprocessing as PT path.
    proc, _, _ = _da3_input_processor(
        [image], None, None, max(expect_h, expect_w), "upper_bound_resize", num_workers=1
    )
    # proc shape is (1, N, 3, H, W); take first view.
    if proc.dim() == 5:
        x = proc[:, 0]  # (1, 3, H, W)
    else:
        x = proc

    H, W = int(x.shape[-2]), int(x.shape[-1])
    pad_top = pad_left = 0
    crop_h, crop_w = H, W
    if (H, W) != (expect_h, expect_w):
        # IR is static; letterbox-pad (replicate) to expected shape so OV path
        # still works for arbitrary aspect ratios (e.g. 9:16 phone photos).
        if H > expect_h or W > expect_w:
            raise RuntimeError(
                f"input shape {H}x{W} larger than IR static shape "
                f"{expect_h}x{expect_w} (preprocess sized incorrectly)"
            )
        pad_top = (expect_h - H) // 2
        pad_bottom = expect_h - H - pad_top
        pad_left = (expect_w - W) // 2
        pad_right = expect_w - W - pad_left
        x = torch.nn.functional.pad(
            x, (pad_left, pad_right, pad_top, pad_bottom), mode="replicate"
        )

    arr = x.numpy().astype(np.float32)
    out_node = _da3_ov_compiled.outputs[0]
    raw = _da3_ov_compiled([arr])[out_node]
    depth = np.asarray(raw, dtype=np.float32).squeeze()  # (expect_h, expect_w)

    # Crop out the padded border before resize.
    if (pad_top, pad_left) != (0, 0) or depth.shape != (crop_h, crop_w):
        depth = depth[pad_top:pad_top + crop_h, pad_left:pad_left + crop_w]

    # 2) Resize to original.
    if depth.shape != (target_h, target_w):
        d_t = torch.from_numpy(depth)[None, None]
        d_t = torch.nn.functional.interpolate(
            d_t, size=(target_h, target_w), mode="bilinear", align_corners=False,
        )
        depth = d_t.squeeze().numpy()

    # OV path does not return intrinsics (camera decoder was None for monocular metric DA3).
    return DepthResult(
        depth_map=depth,
        auto_focal_length_px=None,
        auto_fov_degrees=None,
        backend_used=_backend_type or f"da3_openvino_{(_da3_ov_device or '').lower()}",
        model_id=_model_id or config.model_id,
        notes=[f"DA3 OV {expect_h}x{expect_w} on {_da3_ov_device}"],
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
