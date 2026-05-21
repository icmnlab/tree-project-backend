"""
Model Registry & Configuration
================================
Central configuration for all ML models used in the DBH measurement pipeline.

This file serves as a single source of truth for model selection and upgrade.
When upgrading models, update MODEL_CONFIGS and DEFAULT_DEPTH_MODEL / DEFAULT_SEG_MODEL.

Architecture:
  depth_estimation.py  ← reads from here to pick the depth model
  tree_segmentation.py ← reads from here to pick the segmentation model
  app.py               ← reads from here for health/status info

CURRENT ARCHITECTURE: DA3 + server YOLOv8-seg
---------------------------------------------
Production DBH uses DA3 Metric Large for metric depth and YOLOv8-seg for trunk
masks. The phone may provide a local trunk bbox; the backend then generates a
server-side mask and measures DBH from DA3 depth plus the mask geometry.

FP16 MEMORY OPTIMIZATION (OpenVINO):
------------------------------------
We set INFERENCE_PRECISION_HINT="f16" in OpenVINO config to halve memory footprint
vs FP32 without meaningful accuracy loss for depth estimation. This is essential
for running DA3 Metric Large on constrained Intel GPU/NPU devices. Trunk masks
come from the server YOLOv8-seg path, so the active production startup path does
not require the retired interactive segmentation stack.

UPGRADE GUIDE:
    Phase 1: Change DEFAULT_DEPTH_MODEL to "da_v2_base"
    Phase 2: Use server YOLOv8-seg masks for trunk boundaries
    Phase 3: Change DEFAULT_DEPTH_MODEL to "da3_metric_large"
    Phase 4: Export OpenVINO IR for the selected depth model/device
"""

import os
from dataclasses import dataclass, field
from typing import Optional, Dict, Any

# ============================================================
# Model Definitions
# ============================================================

@dataclass
class DepthModelConfig:
    """Configuration for a depth estimation model."""
    model_id: str                    # HuggingFace model ID or local path
    display_name: str                # Human-readable name
    params_m: float                  # Parameter count in millions
    license: str                     # License type
    expected_cpu_time_s: float       # Estimated CPU inference time (seconds)
    input_size: int                  # Default input resolution (px)
    output_type: str                 # "metric" or "relative"
    backend: str                     # "transformers", "da3_native", "onnx"
    requires_cuda: bool = False      # Whether CUDA is required
    notes: str = ""                  # Additional notes


# All available depth models — add new models here when upgrading
DEPTH_MODELS: Dict[str, DepthModelConfig] = {
    
    # ── Current (Phase 0) ──────────────────────────────────────
    "da_v2_small": DepthModelConfig(
        model_id="depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf",
        display_name="DA V2 Metric Outdoor Small",
        params_m=24.8,
        license="Apache-2.0",
        expected_cpu_time_s=1.5,
        input_size=518,
        output_type="metric",
        backend="transformers",
        notes="Current production model. Smallest, fastest.",
    ),
    
    # ── Phase 1: Upgrade ───────────────────────────────────────
    "da_v2_base": DepthModelConfig(
        model_id="depth-anything/Depth-Anything-V2-Metric-Outdoor-Base-hf",
        display_name="DA V2 Metric Outdoor Base",
        params_m=97.5,
        license="CC-BY-NC-4.0",
        expected_cpu_time_s=5.0,
        input_size=518,
        output_type="metric",
        backend="transformers",
        notes="Phase 1 upgrade. ~15% better depth accuracy. CC-BY-NC (學術OK).",
    ),
    
    # ── Phase 2: Further Upgrade ───────────────────────────────
    "da_v2_large": DepthModelConfig(
        model_id="depth-anything/Depth-Anything-V2-Metric-Outdoor-Large-hf",
        display_name="DA V2 Metric Outdoor Large",
        params_m=335.3,
        license="CC-BY-NC-4.0",
        expected_cpu_time_s=15.0,
        input_size=518,
        output_type="metric",
        backend="transformers",
        notes="Largest DA V2. Very slow on CPU. Only use with ONNX optimization.",
    ),
    
    # ── Apple Depth Pro (SOTA) ────────────────────────────────
    "depth_pro": DepthModelConfig(
        model_id="apple/DepthPro-hf",
        display_name="Apple Depth Pro",
        params_m=350.0,
        license="Apple Sample Code License",
        expected_cpu_time_s=25.0,
        input_size=1536,
        output_type="metric",
        backend="depth_pro",
        notes=(
            "ICLR 2025 SOTA. Sharp boundaries (+40% vs DA V2). "
            "Auto focal length + FOV estimation. "
            "0.3s on GPU, ~5-8s on Intel Arc iGPU via OpenVINO, ~25s on CPU. "
            "Uses DepthProForDepthEstimation + DepthProImageProcessorFast."
        ),
    ),
    
    # ── Phase 3: UniDepth V2 (auto-focal, ICCV 2024) ─────────
    "unidepth_v2_l": DepthModelConfig(
        model_id="lpiccinelli/unidepth-v2-vitl14",
        display_name="UniDepth V2 ViT-L",
        params_m=350.0,
        license="CC-BY-NC-4.0",
        expected_cpu_time_s=12.5,
        input_size=518,
        output_type="metric",
        backend="unidepth",
        notes=(
            "ICCV 2024. Auto camera intrinsics (fx, fy, cx, cy). "
            "CPU ~12.6s/img on i5. xformers/triton optional (Windows OK without)."
        ),
    ),

    # ── Phase 3: DA3METRIC-LARGE (ICLR 2026 Oral) ────────────
    "da3_metric_large": DepthModelConfig(
        model_id="depth-anything/DA3METRIC-LARGE",
        display_name="DA3 Metric Large",
        params_m=400.0,
        license="CC-BY-NC-4.0",
        expected_cpu_time_s=15.0,
        input_size=504,
        output_type="metric",
        backend="da3_native",
        notes=(
            "ICLR 2026 Oral. Uses DA3 native api (depth_anything_3.api). "
            "Returns depth in processed-size (504x378), no auto-intrinsics in monocular mode. "
            "Loaded via DepthAnything3.from_pretrained()."
        ),
    ),
    
    # ── Metric3D v2 (REMOVED 2026-04-28) ───────────────────────
    # Was registered with backend="metric3d" but had no loader in
    # depth_estimation.py — selecting it would crash. Repo also gated
    # on Hugging Face. Use unidepth_v2 / da3_metric_large instead.

    # ── Phase 4: Latest SOTA ───────────────────────────────────
    # TODO: Uncomment when MetricAnything is mature enough
    # "metric_anything": DepthModelConfig(
    #     model_id="yjh001/metricanything_student_pointmap",
    #     display_name="MetricAnything Student-PointMap",
    #     params_m=300,                   # Approximate, ViT-L based
    #     license="Apache-2.0",
    #     expected_cpu_time_s=20.0,       # WARNING: Untested
    #     input_size=518,
    #     output_type="metric",
    #     backend="metric_anything",
    #     notes=(
    #         "Phase 4. 直接輸出 3D 點雲 (XYZ). 不需要額外焦距估計. "
    #         "SOTA on 7 tasks. 但 2026-01 才發佈，生態尚未成熟. "
    #         "需要大幅修改 DBH 計算流程 (點雲 → DBH 而非 深度圖 → DBH)."
    #     ),
    # ),
}


@dataclass
class SegmentationModelConfig:
    """Configuration for a segmentation model."""
    model_id: str
    display_name: str
    params_m: float
    license: str
    expected_cpu_time_s: float
    backend: str                     # "heuristic", "sam2", "grounded_sam"
    needs_prompt: bool = False       # Whether user tap point is needed
    notes: str = ""


# All available segmentation approaches
SEGMENTATION_MODELS: Dict[str, SegmentationModelConfig] = {

    "server_yolo_v8_seg": SegmentationModelConfig(
        model_id="models/yolov8m-tree-trunk-seg-openvino",
        display_name="Server YOLOv8-seg trunk mask",
        params_m=25.9,
        license="dataset/model dependent",
        expected_cpu_time_s=0.1,
        backend="server_yolo",
        needs_prompt=False,
        notes=(
            "Current production mask path. Uses phone bbox when available and "
            "generates the trunk mask on the backend."
        ),
    ),
    
    # ── Current: No ML model, depth-based only ─────────────────
    "depth_heuristic": SegmentationModelConfig(
        model_id="none",
        display_name="Depth-based Heuristic",
        params_m=0,
        license="N/A",
        expected_cpu_time_s=0.3,
        backend="heuristic",
        notes="Current method. Fast but inaccurate boundaries. No ML model needed.",
    ),
    
    # ── Phase 2: SAM 2.1 ──────────────────────────────────────
    "sam2_tiny": SegmentationModelConfig(
        model_id="facebook/sam2.1-hiera-tiny",
        display_name="SAM 2.1 Hiera Tiny",
        params_m=38.9,
        license="Apache-2.0",
        expected_cpu_time_s=3.0,
        backend="sam2",
        needs_prompt=False,       # Can use auto-prompt from depth center
        notes=(
            "Phase 2 upgrade. Pixel-perfect segmentation. "
            "Uses depth map to auto-generate point prompt. "
            "pip install sam2  # Requires Python>=3.10, PyTorch>=2.5.1"
        ),
    ),
    
    "sam2_small": SegmentationModelConfig(
        model_id="facebook/sam2.1-hiera-small",
        display_name="SAM 2.1 Hiera Small",
        params_m=46.0,
        license="Apache-2.0",
        expected_cpu_time_s=4.5,
        backend="sam2",
        needs_prompt=False,
        notes="Slightly better than tiny. Use if tiny isn't accurate enough.",
    ),
    
    # ── HQ-SAM: High Quality SAM ─────────────────────────────
    "hq_sam_tiny": SegmentationModelConfig(
        model_id="lkeab/hq-sam",
        display_name="HQ-SAM (High Quality)",
        params_m=100.0,
        license="Apache-2.0",
        expected_cpu_time_s=5.0,
        backend="hq_sam",
        needs_prompt=False,
        notes=(
            "NeurIPS 2023. Specialized high-quality token for sharper boundaries. "
            "Better edge quality than SAM2 for thin structures like tree trunks. "
            "pip install segment-anything-hq"
        ),
    ),

    # ── EfficientViT-SAM: Lightweight ─────────────────────────
    "efficientvit_sam": SegmentationModelConfig(
        model_id="mit-han-lab/efficientvit-sam",
        display_name="EfficientViT-SAM (Lightweight)",
        params_m=25.0,
        license="MIT",
        expected_cpu_time_s=1.5,
        backend="efficientvit_sam",
        needs_prompt=False,
        notes=(
            "ICCV 2023. 48x faster than SAM with comparable accuracy. "
            "Ideal for MX130/low-end GPU. Only 25M params. "
            "pip install efficientvit"
        ),
    ),

    # ── Phase 3: Grounded SAM ──────────────────────────────────
    # TODO: Uncomment when ready to test
    # "grounded_sam": SegmentationModelConfig(
    #     model_id="IDEA-Research/grounding-dino-tiny",
    #     display_name="Grounded SAM (DINO + SAM 2.1)",
    #     params_m=85.0,        # DINO tiny + SAM tiny combined
    #     license="Apache-2.0",
    #     expected_cpu_time_s=8.0,
    #     backend="grounded_sam",
    #     needs_prompt=False,
    #     notes=(
    #         "Phase 3. Zero-shot: auto-finds 'tree trunk' via text. "
    #         "No training data needed. But slower (2 models)."
    #     ),
    # ),
}


# ============================================================
# Active Configuration — CHANGE THESE TO UPGRADE
# ============================================================

# 👇 Configurable via ML_DEPTH_MODEL env var. Default: depth_pro (ICLR 2025 SOTA).
# 👇 Phase 1: Set "da_v2_base" for faster inference (~5s). Phase 3: "da3_metric_large".
DEFAULT_DEPTH_MODEL = os.environ.get("ML_DEPTH_MODEL", "depth_pro")

# Current production mask path: server YOLOv8-seg. Older .env files may still
# contain retired segmentation model names; start.ps1 overrides them.
DEFAULT_SEG_MODEL = os.environ.get("ML_SEG_MODEL", "server_yolo_v8_seg")

# 👇 Phase 1+: Set to True after converting models to ONNX
#    ONNX Runtime gives 1.5-2.5x speedup on Intel CPU, zero accuracy loss.
#    Steps: pip install optimum onnxruntime
#           python -c "from optimum.onnxruntime import ORTModelForDepthEstimation; \
#               m = ORTModelForDepthEstimation.from_pretrained('MODEL_ID', export=True); \
#               m.save_pretrained('./onnx_models/depth')"
USE_ONNX_RUNTIME = os.environ.get("ML_USE_ONNX", "false").lower() == "true"

# 👇 ONNX 模型路徑 (export 後存放的目錄)
ONNX_MODEL_DIR = os.environ.get("ML_ONNX_DIR", "./onnx_models")

# 👇 OpenVINO IR 模型路徑 (Pinnacle Mode: export 後存放的目錄)
OPENVINO_MODEL_DIR = os.environ.get("ML_OPENVINO_DIR", os.path.join(os.path.dirname(__file__), "openvino_models"))

# 👇 CPU Thread count — set to physical core count for best throughput
#    Core Ultra 5 125H has 14 cores (6P+8E). Use P-cores for inference.
#    i3-8130U has 2 cores. Set via env var for each machine.
CPU_THREADS = int(os.environ.get("ML_CPU_THREADS", "6"))

# 👇 OpenVINO device priority — auto-detect Intel Arc iGPU, NPU, or fallback CPU
#    Core Ultra 5 125H: has Arc iGPU (XMX) + NPU — prefer GPU for best throughput
#    i3-8130U + MX130: UHD 620 (no XMX) — NVIDIA MX130 not supported by OpenVINO, use CPU
#    Set ML_OV_DEVICE to override: "GPU", "NPU", "CPU", "GPU.0", "GPU.1"
OPENVINO_DEVICE = os.environ.get("ML_OV_DEVICE", "AUTO")

# 👇 Input resolution override — lower = faster, slightly less accurate
#    518 = DA V2 default. 384 = ~45% less computation for ~2% accuracy loss.
#    Set via env var for quick testing: ML_INPUT_SIZE=384
INPUT_SIZE_OVERRIDE = int(os.environ.get("ML_INPUT_SIZE", "0"))  # 0 = use model default

# Legacy segmentation switch. Production keeps this disabled.
ENABLE_SAM_SEGMENTATION = os.environ.get("ML_ENABLE_SAM", "false").lower() == "true"

# 👇 OpenVINO acceleration for Intel Arc iGPU / NPU / CPU (default: enabled)
#    Gives 2-3x speedup on Intel hardware. Auto-detects best device.
#    Uses FP16 hint for memory optimization (see INFERENCE_PRECISION_HINT in _load_depth_openvino).
#    Set ML_USE_OPENVINO=false to disable (e.g. for PyTorch-only memory tests).
ENABLE_OPENVINO = os.environ.get("ML_USE_OPENVINO", "true").lower() != "false"


# ============================================================
# Accuracy Mode Presets
# ============================================================

@dataclass
class AccuracyPreset:
    """Predefined accuracy/speed tradeoff."""
    depth_model: str
    seg_model: str
    input_size: int          # 0 = model default
    use_multi_row: bool
    use_subpixel: bool       # TODO Phase 3: 亞像素邊緣偵測
    use_ellipse_fit: bool    # TODO Phase 3: 橢圓擬合修正
    description: str


# 使用者可透過 API 參數 mode=fast/balanced/accurate 選擇
ACCURACY_PRESETS: Dict[str, AccuracyPreset] = {
    "fast": AccuracyPreset(
        depth_model="da_v2_small",
        seg_model="depth_heuristic",
        input_size=384,       # Reduced resolution for speed
        use_multi_row=False,
        use_subpixel=False,
        use_ellipse_fit=False,
        description="快速模式 (~1.5s): 野外大量調查快速篩檢",
    ),
    "balanced": AccuracyPreset(
        depth_model="depth_pro",
        seg_model="server_yolo_v8_seg",
        input_size=0,
        use_multi_row=True,
        use_subpixel=True,
        use_ellipse_fit=False,
        description="平衡模式: 深度模型 + server YOLOv8-seg + 亞像素邊緣",
    ),
    "accurate": AccuracyPreset(
        depth_model="depth_pro",
        seg_model="server_yolo_v8_seg",
        input_size=0,
        use_multi_row=True,
        use_subpixel=True,
        use_ellipse_fit=True,
        description="精確模式: 深度模型 + server YOLOv8-seg + 亞像素 + 橢圓擬合",
    ),
}


# ============================================================
# Helper Functions
# ============================================================

def get_depth_config() -> DepthModelConfig:
    """Get the currently active depth model configuration."""
    model_key = DEFAULT_DEPTH_MODEL
    if model_key not in DEPTH_MODELS:
        print(f"[ModelRegistry] WARNING: Unknown depth model '{model_key}', falling back to da_v2_small")
        model_key = "da_v2_small"
    return DEPTH_MODELS[model_key]


def get_seg_config() -> SegmentationModelConfig:
    """Get the currently active segmentation model configuration."""
    model_key = DEFAULT_SEG_MODEL
    if model_key not in SEGMENTATION_MODELS:
        print(f"[ModelRegistry] WARNING: Unknown seg model '{model_key}', falling back to depth_heuristic")
        model_key = "depth_heuristic"
    return SEGMENTATION_MODELS[model_key]


def get_preset(mode: str) -> AccuracyPreset:
    """Get accuracy preset by mode name."""
    if mode not in ACCURACY_PRESETS:
        print(f"[ModelRegistry] WARNING: Unknown mode '{mode}', using 'balanced'")
        mode = "balanced"
    return ACCURACY_PRESETS[mode]


def print_config_summary():
    """Print current configuration to console on startup."""
    depth = get_depth_config()
    seg = get_seg_config()
    
    print("=" * 60)
    print("  ML Service Configuration Summary")
    print("=" * 60)
    print(f"  Depth Model:  {depth.display_name} ({depth.params_m}M params)")
    print(f"  Model ID:     {depth.model_id}")
    print(f"  License:      {depth.license}")
    print(f"  Est. Time:    ~{depth.expected_cpu_time_s}s on CPU")
    print(f"  Trunk Mask:   {seg.display_name}")
    print(f"  Mask Device:  {os.environ.get('ML_SERVER_YOLO_DEVICE', 'intel:gpu')}")
    print(f"  Mask imgsz:   {os.environ.get('ML_SERVER_YOLO_IMGSZ', '832')}")
    print(f"  ONNX Runtime: {'Enabled' if USE_ONNX_RUNTIME else 'Disabled'}")
    print(f"  OpenVINO:     {'Enabled' if ENABLE_OPENVINO else 'Disabled'}")
    if os.environ.get("ML_DA3_OV_DEVICE"):
        print(f"  DA3 Device:   {os.environ.get('ML_DA3_OV_DEVICE')}")
    if os.environ.get("ML_DA3_OV_DIR"):
        print(f"  DA3 IR:       {os.environ.get('ML_DA3_OV_DIR')}")
    print(f"  CPU Threads:  {CPU_THREADS}")
    print(f"  Input Size:   {INPUT_SIZE_OVERRIDE if INPUT_SIZE_OVERRIDE else 'model default'}")
    print("=" * 60)


# ============================================================
# SAM 2 Hybrid Predictor (OpenVINO encoder + PyTorch decoder)
# ============================================================


class _HybridSAM2Predictor:
    """
    Wrapper that uses OpenVINO for the image encoder (heavy) and PyTorch
    for the mask decoder (lightweight). Compatible with SAM2ImagePredictor API.
    """

    def __init__(self, ov_encoder, pytorch_predictor):
        self._ov_encoder = ov_encoder
        self._predictor = pytorch_predictor
        self._transforms = pytorch_predictor._transforms
        self._bb_feat_sizes = pytorch_predictor._bb_feat_sizes
        self.mask_threshold = pytorch_predictor.mask_threshold

    def set_image(self, image):
        """Compute image embeddings via OpenVINO encoder."""
        import numpy as np
        import torch
        self._predictor.reset_predictor()
        if isinstance(image, np.ndarray):
            self._predictor._orig_hw = [image.shape[:2]]
        else:
            from PIL.Image import Image
            w, h = image.size
            self._predictor._orig_hw = [(h, w)]
        input_image = self._transforms(image)
        input_image = input_image[None, ...]  # 1,3,H,W
        inp_np = input_image.numpy() if hasattr(input_image, "numpy") else input_image.cpu().numpy()
        inp_np = inp_np.astype(np.float32)
        # Run OpenVINO inference: compiled_model([data]) or compiled_model({name: data})
        try:
            res = self._ov_encoder([inp_np])
        except (TypeError, KeyError):
            inp = self._ov_encoder.inputs[0]
            iname = inp.get_any_name() if hasattr(inp, "get_any_name") else inp.get_names()[0]
            res = self._ov_encoder({iname: inp_np})
            
        outs = list(res.values()) if isinstance(res, dict) else (list(res) if isinstance(res, (list, tuple)) else [res])
        # OpenVINO sometimes returns scalar/0D arrays or object arrays depending on bindings
        # We ensure it's a standard numeric numpy array before passing to torch
        feats = []
        for o in outs:
            arr = np.asarray(o)
            if str(arr.dtype) == 'object' or 'openvino' in str(type(o)):
                # Handle OpenVINO ConstOutput or generic object arrays
                try:
                    arr = np.array(o.data)
                except AttributeError:
                    arr = np.array(list(o))
            if arr.dtype == np.object_:
                arr = arr.astype(np.float32)
            feats.append(torch.from_numpy(arr).float())
            
        if len(feats) >= 3:
            self._predictor._features = {
                "image_embed": feats[0],
                "high_res_feats": [feats[1], feats[2]],
            }
        else:
            self._predictor._features = {"image_embed": feats[0], "high_res_feats": feats[1:]}
        self._predictor._is_image_set = True

    def predict(self, point_coords=None, point_labels=None, box=None, mask_input=None,
                multimask_output=True, return_logits=False, normalize_coords=True):
        """Delegate to PyTorch predictor (uses precomputed _features from set_image)."""
        return self._predictor.predict(
            point_coords=point_coords, point_labels=point_labels, box=box, mask_input=mask_input,
            multimask_output=multimask_output, return_logits=return_logits,
            normalize_coords=normalize_coords,
        )

    @property
    def device(self):
        return self._predictor.device


# ============================================================
# Model Registry Singleton — Pinnacle Mode
# ============================================================
# Manages lazy loading of heavy models (Depth Pro, SAM 2.1) with
# OpenVINO IR support. Use get_registry() for the single instance.
# ============================================================


class _OVDepthModelWrapper:
    """Wrapper for raw OpenVINO depth model to mimic PyTorch model outputs.

    Maps outputs by tensor NAME (not positional index) so it works whether
    the exported IR has 1/2/3 heads (e.g. DA V2 has only predicted_depth,
    DepthPro-INT8W has [predicted_depth, field_of_view], full DepthPro has
    all three). HF post_process_depth_estimation computes focal_length
    internally from field_of_view if the focal head is absent.
    """
    def __init__(self, compiled_model):
        self.compiled_model = compiled_model

    def __call__(self, **kwargs):
        import numpy as np
        import torch
        inputs = {k: v.numpy() if hasattr(v, 'numpy') else v for k, v in kwargs.items()}
        res = self.compiled_model(inputs)

        class DummyOutput:
            pass
        out = DummyOutput()

        # Build name->value map (convert numpy -> torch tensor so HF post_process works)
        def _to_torch(v):
            if isinstance(v, np.ndarray):
                return torch.from_numpy(v)
            return v

        named: dict = {}
        for k, v in res.items():
            key = k.any_name if hasattr(k, "any_name") else str(k)
            named[key] = _to_torch(v)

        depth_keys = [n for n in named if "depth" in n.lower()]
        focal_keys = [n for n in named if "focal" in n.lower()]
        fov_keys = [n for n in named if "field_of_view" in n.lower() or n.lower() == "fov"]

        if depth_keys:
            out.predicted_depth = named[depth_keys[0]]
        else:
            out.predicted_depth = list(named.values())[0]

        if focal_keys:
            out.focal_length = named[focal_keys[0]]
        if fov_keys:
            out.field_of_view = named[fov_keys[0]]

        return out

def _export_hf_to_openvino_ir(config, output_dir: str) -> bool:
    """One-time export of a HuggingFace transformers depth model to OpenVINO IR (FP16).

    Used to avoid collisions across DA V2 sizes (small/base/large all share the same
    HF architecture but different weights). Saves to per-model directory so multiple
    DA V2 variants can coexist on disk.

    Returns True if IR was successfully created at output_dir/openvino_model.xml.
    """
    try:
        import torch
        import openvino as ov
        from transformers import AutoModelForDepthEstimation
        os.makedirs(output_dir, exist_ok=True)
        xml_path = os.path.join(output_dir, "openvino_model.xml")
        if os.path.exists(xml_path):
            return True
        size = config.input_size if config.input_size else 518
        print(
            f"[ModelRegistry] Exporting {config.model_id} → OpenVINO IR "
            f"(size={size}, dir={output_dir})... this is a one-time op"
        )
        pt_model = AutoModelForDepthEstimation.from_pretrained(config.model_id)
        pt_model.eval()
        example = torch.randn(1, 3, size, size)
        with torch.no_grad():
            ov_model = ov.convert_model(pt_model, example_input=example)
        ov.save_model(ov_model, xml_path, compress_to_fp16=True)
        print(f"[ModelRegistry] OpenVINO IR saved: {xml_path}")
        # Free PT memory before downstream OV load
        del pt_model, ov_model
        return True
    except Exception as e:
        print(f"[ModelRegistry] HF→OV export failed for {config.model_id}: {e}")
        import traceback
        traceback.print_exc()
        return False


class _ModelRegistry:
    """
    Singleton registry for heavy ML models.
    Lazy-loads depth and segmentation models, preferring OpenVINO IR when available.
    """

    _instance: Optional["_ModelRegistry"] = None
    _depth_model = None
    _depth_processor = None
    _sam_model = None
    _sam_processor = None
    _ov_depth_model = None
    _ov_sam_encoder = None
    _ov_sam_predictor = None

    def __new__(cls) -> "_ModelRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def get_depth_model(self, force_openvino: bool = False):
        """
        Get depth model + processor (lazy load).
        Uses OpenVINO IR from OPENVINO_MODEL_DIR when ENABLE_OPENVINO and available.
        Prefers INT8-W compressed model (depth_pro_int8w/) over FP16 for ~15% faster
        inference and ~50% smaller file size with negligible accuracy loss.
        """
        config = get_depth_config()

        # Custom backends (unidepth, da3_native) are loaded by depth_estimation.py
        # directly — bypass OpenVINO/HF transformers path.
        if config.backend in ("unidepth", "da3_native"):
            return None, None

        is_depth_pro = "depthpro" in config.model_id.lower() or "depth_pro" in config.model_id.lower()
        base_name = "depth_pro" if is_depth_pro else "depth"

        # Prefer INT8-W compressed model when available (smaller + faster)
        int8w_path = os.path.join(OPENVINO_MODEL_DIR, f"{base_name}_int8w")
        fp16_path = os.path.join(OPENVINO_MODEL_DIR, base_name)

        # Per-model FP16 cache (avoids collision between da_v2_small/base/large
        # which all map to base_name="depth"). Format: openvino_models/<sanitized_id>/
        per_model_dir = os.path.join(
            OPENVINO_MODEL_DIR,
            config.model_id.replace("/", "_").replace("-", "_").lower(),
        )

        if ENABLE_OPENVINO:
            if os.path.exists(os.path.join(int8w_path, "openvino_model.xml")):
                print(f"[ModelRegistry] Using INT8-W compressed model: {int8w_path}")
                return self._load_depth_openvino(int8w_path, config)
            if os.path.exists(os.path.join(per_model_dir, "openvino_model.xml")):
                print(f"[ModelRegistry] Using per-model OV cache: {per_model_dir}")
                return self._load_depth_openvino(per_model_dir, config)
            if os.path.exists(os.path.join(fp16_path, "openvino_model.xml")) and is_depth_pro:
                # Legacy shared depth_pro IR (only for depth_pro to avoid DA V2 collisions)
                return self._load_depth_openvino(fp16_path, config)
            # Auto-export PyTorch HF model → OpenVINO IR (one-time per model)
            if config.backend == "transformers":
                ok = _export_hf_to_openvino_ir(config, per_model_dir)
                if ok:
                    return self._load_depth_openvino(per_model_dir, config)
            if force_openvino:
                return self._load_depth_openvino(fp16_path, config)
        return self._load_depth_pytorch(config)

    def _load_depth_openvino(self, ov_path: str, config) -> tuple:
        """
        Load depth model from OpenVINO IR.

        FP16 precision hint halves memory vs FP32, enabling Depth Pro on Intel Arc iGPU
        without OOM. See module docstring for architectural rationale.
        """
        if self._ov_depth_model is not None:
            return self._ov_depth_model, self._depth_processor
        try:
            from transformers import DepthProImageProcessorFast, AutoImageProcessor
            from openvino import Core
            core = Core()
            # Device selection: use env var override, else auto-detect
            # Core Ultra 5 125H → Intel Arc iGPU (best), i3-8130U → CPU only
            avail = core.available_devices
            if OPENVINO_DEVICE != "AUTO":
                device = OPENVINO_DEVICE
            else:
                device = "GPU" if "GPU" in avail else "CPU"
            print(f"[ModelRegistry] OpenVINO devices: {avail}, selected: {device}")
            
            if config.backend == "depth_pro":
                self._depth_processor = DepthProImageProcessorFast.from_pretrained(config.model_id)
            else:
                # Force square resize to match static IR shape [1,3,518,518] (or 384/...).
                # Without this, DPTImageProcessor preserves aspect → 686×518 etc., which
                # breaks GPU/NPU static-shape inference.
                size_hw = config.input_size or 518
                self._depth_processor = AutoImageProcessor.from_pretrained(
                    config.model_id,
                    size={"height": size_hw, "width": size_hw},
                    do_resize=True,
                    keep_aspect_ratio=False,
                )
                
            # FP16 inference: ~50% less VRAM, minimal accuracy impact for depth estimation
            ov_config = {"INFERENCE_PRECISION_HINT": "f16"}
            
            xml_path = os.path.join(ov_path, "openvino_model.xml")
            if not os.path.exists(xml_path):
                print(f"[ModelRegistry] OpenVINO model not found at {xml_path}")
                return self._load_depth_pytorch(config)
                
            ov_model = core.read_model(xml_path)
            
            # Force static shapes to prevent NPU/GPU compiler crashes (vpux-compiler error)
            input_name = ov_model.inputs[0].any_name
            if config.backend == "depth_pro":
                ov_model.reshape({input_name: [1, 3, 1536, 1536]})
            else:
                ov_model.reshape({input_name: [1, 3, 518, 518]})
                
            compiled_model = core.compile_model(ov_model, device, config=ov_config)
            self._ov_depth_model = _OVDepthModelWrapper(compiled_model)
            
            return self._ov_depth_model, self._depth_processor
        except Exception as e:
            print(f"[ModelRegistry] OpenVINO depth load failed: {e}")
        return self._load_depth_pytorch(config)

    def _load_depth_pytorch(self, config) -> tuple:
        """Return None to let depth_estimation.py handle the PyTorch fallback."""
        return None, None

    def get_sam_model(self, force_openvino: bool = False):
        """
        Get SAM 2.1 model (lazy load).
        Uses OpenVINO IR when ENABLE_OPENVINO and ov_image_encoder exists.
        Supports Hybrid Mode: OpenVINO encoder + PyTorch decoder when only
        ov_image_encoder.xml is exported (mask decoder kept in PyTorch).
        """
        config = get_seg_config()
        ov_dir = os.path.join(OPENVINO_MODEL_DIR, "sam2_tiny")
        enc_path = os.path.join(ov_dir, "ov_image_encoder.xml")
        if ENABLE_OPENVINO and (force_openvino or os.path.exists(enc_path)):
            return self._load_sam_openvino(ov_dir, config)
        return self._load_sam_pytorch(config)

    def _load_sam_openvino(self, ov_dir: str, config) -> tuple:
        """
        Load SAM from OpenVINO IR.
        - Full mode: encoder + mask predictor (both .xml)
        - Hybrid mode: encoder only → OpenVINO encoder + PyTorch decoder
        """
        if self._ov_sam_encoder is not None and self._ov_sam_predictor is not None:
            return self._ov_sam_encoder, self._ov_sam_predictor
        try:
            from openvino import Core
            core = Core()
            avail = core.available_devices
            if OPENVINO_DEVICE != "AUTO":
                device = OPENVINO_DEVICE
            else:
                device = "GPU" if "GPU" in avail else "CPU"
            enc_path = os.path.join(ov_dir, "ov_image_encoder.xml")
            pred_path = os.path.join(ov_dir, "ov_mask_predictor.xml")
            if not os.path.exists(enc_path):
                return self._load_sam_pytorch(config)
            # Load OpenVINO encoder
            self._ov_sam_encoder = core.compile_model(core.read_model(enc_path), device)
            # Full OpenVINO: encoder + mask predictor
            if os.path.exists(pred_path):
                self._ov_sam_predictor = core.compile_model(core.read_model(pred_path), device)
                return self._ov_sam_encoder, self._ov_sam_predictor
            # Hybrid mode: OpenVINO encoder + PyTorch decoder
            hybrid = self._load_sam_hybrid(config, self._ov_sam_encoder)
            if hybrid is not None:
                self._ov_sam_predictor = hybrid
                print("[ModelRegistry] SAM 2 Hybrid: OpenVINO encoder + PyTorch decoder")
                return self._ov_sam_encoder, hybrid
        except Exception as e:
            print(f"[ModelRegistry] OpenVINO SAM load failed: {e}")
        return self._load_sam_pytorch(config)

    def _load_sam_hybrid(self, config, ov_encoder):
        """Create Hybrid SAM predictor: OpenVINO image encoder + PyTorch mask decoder."""
        try:
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            predictor = SAM2ImagePredictor.from_pretrained(config.model_id, device="cpu")
            return _HybridSAM2Predictor(
                ov_encoder=ov_encoder,
                pytorch_predictor=predictor,
            )
        except ImportError as e:
            print(f"[ModelRegistry] Hybrid SAM requires sam2: {e}")
        except Exception as e:
            print(f"[ModelRegistry] Hybrid SAM load failed: {e}")
        return None

    def _load_sam_pytorch(self, config) -> tuple:
        """Defer to tree_segmentation SAM loading or use transformers."""
        if not ENABLE_SAM_SEGMENTATION:
            return None, None
        try:
            from transformers import Sam2Model, Sam2Processor
            if self._sam_model is None:
                self._sam_model = Sam2Model.from_pretrained(config.model_id)
                self._sam_processor = Sam2Processor.from_pretrained(config.model_id)
                self._sam_model.eval()
            return self._sam_model, self._sam_processor
        except Exception as e:
            print(f"[ModelRegistry] SAM PyTorch load failed: {e}")
        return None, None

    def unload_all(self):
        """Release all loaded models to free memory."""
        self._depth_model = None
        self._depth_processor = None
        self._sam_model = None
        self._sam_processor = None
        self._ov_depth_model = None
        self._ov_sam_encoder = None
        self._ov_sam_predictor = None


def _is_sam2_predictor_style(obj) -> bool:
    """True if obj has set_image + predict (SAM2ImagePredictor / Hybrid)."""
    return obj is not None and hasattr(obj, "set_image") and hasattr(obj, "predict")


def get_registry() -> _ModelRegistry:
    """Return the singleton ModelRegistry instance."""
    return _ModelRegistry()
