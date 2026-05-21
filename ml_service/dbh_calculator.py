"""
DBH Calculator
==============
Computes Diameter at Breast Height from a depth map and trunk region.

Core formulas from:
  - Holcomb et al. (2023): Basic pixel-to-metric conversion
  - Xiang et al. (2025): Cylindrical geometry correction

Pipeline:
  1. Extract trunk region depth from depth map using bounding box
  2. Calculate pixel width of trunk at breast height row
  3. Convert pixel width to metric width using depth + focal length
  4. Apply cylindrical geometry correction (chord → diameter)
  5. Return DBH in centimeters with confidence score
"""

import os
import math
import numpy as np
from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass
class BoundingBox:
    """Bounding box in pixel coordinates (x1, y1, x2, y2)."""
    x1: int
    y1: int
    x2: int
    y2: int

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1

    @property
    def center_x(self) -> int:
        return (self.x1 + self.x2) // 2

    @property
    def center_y(self) -> int:
        return (self.y1 + self.y2) // 2


@dataclass
class DBHResult:
    """Result of DBH measurement."""
    dbh_cm: float                    # Diameter at breast height (cm)
    confidence: float                # Confidence score 0-1
    trunk_depth_m: float             # Estimated depth to trunk (m)
    trunk_pixel_width: float         # Trunk width in pixels
    chord_length_m: float            # Chord length before correction (m)
    focal_length_px: float           # Focal length used (px)
    measurement_row: int             # Image row where measurement was taken
    method: str                      # "simplified" or "cylindrical_corrected"
    notes: list                      # Any warnings or notes


# ============================================================
# Focal Length Utilities
# ============================================================

def estimate_focal_length_from_fov(image_width_px: int,
                                    fov_degrees: float = 70.0) -> float:
    """
    Estimate focal length in pixels from field of view.

    Formula: f_px = W_px / (2 * tan(θ/2))

    Most smartphone main cameras have FOV ≈ 65-80 degrees.
    Default 70° is a reasonable fallback.
    """
    fov_degrees = max(10.0, min(170.0, fov_degrees))
    fov_rad = math.radians(fov_degrees)
    f_px = image_width_px / (2.0 * math.tan(fov_rad / 2.0))
    return f_px


def focal_length_from_exif(focal_length_mm: float,
                            sensor_width_mm: float,
                            image_width_px: int) -> float:
    """
    Calculate focal length in pixels from EXIF metadata.

    Formula: f_px = f_mm * W_px / W_sensor

    IMPORTANT: ``image_width_px`` and ``sensor_width_mm`` MUST refer to the
    same physical axis. PHONE_SENSORS stores sensor **long axis** (landscape
    width), so callers must pass the image's long-dimension pixel count.
    For phone photos rotated to portrait by ``ImageOps.exif_transpose``, this
    means ``max(image.size)``, NOT ``image.size[0]``.
    """
    return focal_length_mm * image_width_px / sensor_width_mm


# Common phone sensor data (sensor_width_mm)
# Key: lowercase normalized model name fragment
PHONE_SENSORS = {
    # Apple iPhone
    "iphone 16 pro max": 9.8,
    "iphone 16 pro": 9.8,
    "iphone 16": 7.6,
    "iphone 15 pro max": 9.8,    # 1/1.28"
    "iphone 15 pro": 9.8,
    "iphone 15": 7.6,
    "iphone 14 pro max": 9.8,
    "iphone 14 pro": 9.8,
    "iphone 14": 7.6,
    "iphone 13 pro max": 7.6,    # 1/1.65"
    "iphone 13 pro": 7.6,
    "iphone 13 mini": 7.0,
    "iphone 13": 7.0,            # 1/1.7"
    "iphone 12 pro max": 7.0,
    "iphone 12 pro": 7.0,
    "iphone 12": 7.0,
    "iphone 11 pro": 7.0,
    "iphone 11": 6.17,
    "iphone se": 4.89,
    # Samsung Galaxy S
    "sm-s928": 9.8,  # S24 Ultra
    "sm-s926": 7.6,  # S24+
    "sm-s921": 7.6,  # S24
    "sm-s918": 9.8,  # S23 Ultra
    "sm-s916": 7.6,  # S23+
    "sm-s911": 7.0,  # S23
    "sm-s908": 9.0,  # S22 Ultra
    "sm-s906": 7.0,  # S22+
    "sm-s901": 7.0,  # S22
    "galaxy s24": 9.8,
    "galaxy s23": 9.0,
    "galaxy s22": 7.0,
    "galaxy s21": 6.4,
    # Samsung Galaxy A
    "sm-a556": 6.4,  # A55
    "sm-a546": 6.4,  # A54
    "sm-a536": 6.4,  # A53
    "galaxy a55": 6.4,
    "galaxy a54": 6.4,
    "galaxy a53": 6.4,
    # Google Pixel
    "pixel 9 pro": 9.0,
    "pixel 9": 7.6,
    "pixel 8 pro": 9.0,
    "pixel 8a": 6.4,
    "pixel 8": 6.4,
    "pixel 7 pro": 9.0,
    "pixel 7a": 6.4,
    "pixel 7": 6.4,
    "pixel 6 pro": 9.0,
    "pixel 6a": 6.4,
    "pixel 6": 6.4,
    # Xiaomi
    "mi a1": 5.64,             # 1/2.9"  ← user's test device
    "mi 5x": 5.64,             # same as Mi A1
    "mi a2": 5.64,
    "14 ultra": 9.8,
    "14 pro": 9.0,
    "13 ultra": 9.8,
    "13 pro": 9.0,
    "redmi note 13": 6.4,
    "redmi note 12": 6.4,
    "poco f5": 6.4,
    "poco x5": 6.4,
    # OnePlus
    "oneplus 12": 9.0,
    "oneplus 11": 9.0,
    "oneplus 10 pro": 9.0,
    "oneplus nord": 6.4,
    # Sony
    "xperia 1": 9.0,
    "xperia 5": 6.4,
    # ASUS
    "zenfone 10": 9.0,
    "zenfone 9": 9.0,
    "rog phone": 9.0,
    # Huawei
    "p60 pro": 9.0,
    "mate 60": 9.0,
    "p50 pro": 9.0,
    # OPPO
    "find x7": 9.0,
    "find x6": 9.0,
    "reno 11": 6.4,
    # Vivo
    "x100": 9.0,
    "x90": 9.0,
    # Fallback
    "default": 7.0,            # ~1/1.7" typical mid-range
}


def match_phone_sensor(make: str = "", model: str = "") -> tuple:
    """
    Match EXIF Make/Model to sensor width.

    Returns:
        (sensor_width_mm, matched_key)
    """
    if not make and not model:
        return PHONE_SENSORS["default"], "default"

    # Normalize: lowercase, strip whitespace
    query = f"{make} {model}".lower().strip()

    # Try exact prefix match first (longest match wins)
    best_key = None
    best_len = 0
    for key in PHONE_SENSORS:
        if key == "default":
            continue
        if key in query and len(key) > best_len:
            best_key = key
            best_len = len(key)

    if best_key:
        return PHONE_SENSORS[best_key], best_key

    # Brand-level fallback
    brand_defaults = {
        "apple": 7.0,     # Older iPhones
        "samsung": 6.4,   # Mid-range Samsung
        "google": 6.4,    # Pixel
        "xiaomi": 5.64,   # Xiaomi mid-range
        "oneplus": 6.4,
        "huawei": 7.0,
        "oppo": 6.4,
        "vivo": 6.4,
        "sony": 6.4,
        "asus": 6.4,
        "realme": 6.4,
        "motorola": 5.64,
        "nokia": 5.64,
    }
    query_lower = query.lower()
    for brand, sw in brand_defaults.items():
        if brand in query_lower:
            return sw, f"brand:{brand}"

    return PHONE_SENSORS["default"], "default"


# ============================================================
# Core DBH Calculation
# ============================================================

def calculate_trunk_width_pixels(depth_map: np.ndarray,
                                  bbox: BoundingBox,
                                  measurement_row: Optional[int] = None,
                                  depth_threshold_ratio: float = 0.3
                                  ) -> Tuple[float, int, float]:
    """
    Calculate the pixel width of the trunk at the measurement row.

    Uses a multi-strategy approach for robustness:
    1. Depth gradient (Sobel) — detects edges where depth changes sharply
    2. Depth threshold — clusters trunk vs background by absolute depth
    3. Combined — intersects both methods for best result
    Falls back to simpler methods if the primary strategy fails.

    Args:
        depth_map: (H, W) depth array in meters
        bbox: Bounding box around the trunk
        measurement_row: Specific row to measure (None = center of bbox)
        depth_threshold_ratio: Ratio of depth range to use as threshold

    Returns:
        (pixel_width, measurement_row, median_trunk_depth)
    """
    if measurement_row is None:
        measurement_row = bbox.center_y

    # Clamp measurement row to bbox
    measurement_row = max(bbox.y1, min(bbox.y2 - 1, measurement_row))

    # Extract depth values along the measurement row within bbox
    row_depths = depth_map[measurement_row, bbox.x1:bbox.x2]

    if len(row_depths) == 0:
        return 0.0, measurement_row, 0.0

    bbox_width = len(row_depths)

    # --- Strategy 1: Depth gradient edge detection ---
    gradient_width = _gradient_edge_detection(row_depths, bbox_width)

    # --- Strategy 2: Depth threshold clustering ---
    threshold_width, threshold_mask = _threshold_clustering(
        row_depths, depth_threshold_ratio
    )

    # --- Strategy 3: Vertical consistency check ---
    # Check a few rows above/below to validate the width
    vertical_widths = []
    for dr in [-3, -1, 0, 1, 3]:
        r = measurement_row + dr
        if bbox.y1 <= r < bbox.y2:
            rd = depth_map[r, bbox.x1:bbox.x2]
            w, _ = _threshold_clustering(rd, depth_threshold_ratio)
            if w > 0:
                vertical_widths.append(w)

    # --- Select best width ---
    candidates = []
    if gradient_width > 5:
        candidates.append(gradient_width)
    if threshold_width > 5:
        candidates.append(threshold_width)
    if vertical_widths:
        candidates.append(float(np.median(vertical_widths)))

    if not candidates:
        # No reliable edges detected. Return 0 so caller can mark measurement
        # as failed instead of falling back to bbox width * 0.7 (which would
        # effectively be measuring the rectangle, not the trunk).
        trunk_width = 0.0
    elif len(candidates) == 1:
        trunk_width = candidates[0]
    else:
        # Use median of all candidates for robustness
        trunk_width = float(np.median(candidates))

    # Sanity check: trunk can't be wider than bbox
    trunk_width = min(trunk_width, float(bbox_width))

    # Compute trunk depth from center pixels
    center = bbox_width // 2
    half_w = max(int(trunk_width / 2), 1)
    trunk_slice = row_depths[max(0, center - half_w):min(bbox_width, center + half_w)]
    trunk_depth = float(np.median(trunk_slice)) if len(trunk_slice) > 0 else float(np.median(row_depths))

    return float(trunk_width), measurement_row, trunk_depth


def _gradient_edge_detection(row_depths: np.ndarray, bbox_width: int) -> float:
    """
    Detect trunk edges using depth gradient (Sobel-like).
    Trunk edges appear as sharp depth increases (foreground → background).
    """
    if bbox_width < 10:
        return 0.0

    # Smooth the depth profile to reduce noise
    from scipy.ndimage import uniform_filter1d
    smoothed = uniform_filter1d(row_depths.astype(float), size=max(3, bbox_width // 20))

    # Compute gradient (depth change per pixel)
    gradient = np.gradient(smoothed)
    abs_gradient = np.abs(gradient)

    # Find significant edges (gradient > adaptive threshold)
    grad_threshold = max(np.percentile(abs_gradient, 75), 0.01)

    # Find the leftmost and rightmost strong edges
    edge_positions = np.where(abs_gradient > grad_threshold)[0]
    if len(edge_positions) < 2:
        return 0.0

    # The trunk is between the first strong "far→near" edge and
    # the last strong "near→far" edge
    # Look for sign changes: negative gradient = getting closer (left edge)
    #                        positive gradient = getting farther (right edge)
    center = bbox_width // 2

    # Find left edge: rightmost negative gradient edge left of center
    left_edges = edge_positions[(edge_positions < center) & (gradient[edge_positions] < 0)]
    left_edge = left_edges[-1] if len(left_edges) > 0 else edge_positions[0]

    # Find right edge: leftmost positive gradient edge right of center
    right_edges = edge_positions[(edge_positions > center) & (gradient[edge_positions] > 0)]
    right_edge = right_edges[0] if len(right_edges) > 0 else edge_positions[-1]

    width = float(right_edge - left_edge)
    return max(width, 0.0)


def _threshold_clustering(row_depths: np.ndarray,
                           depth_threshold_ratio: float
                           ) -> Tuple[float, np.ndarray]:
    """
    Cluster trunk pixels by depth threshold.
    Returns (width, mask).
    """
    if len(row_depths) == 0:
        return 0.0, np.array([], dtype=bool)

    # Use percentile-based approach instead of pure min/median
    # This is more robust to outlier pixels
    p10 = float(np.percentile(row_depths, 10))  # near-trunk depth
    p90 = float(np.percentile(row_depths, 90))  # likely background
    depth_range = p90 - p10

    if depth_range < 0.05:
        # Very uniform depth → entire bbox width is the trunk
        mask = np.ones(len(row_depths), dtype=bool)
    else:
        # Adaptive threshold: trunk depth + fraction of range
        threshold = p10 + depth_range * (0.3 + depth_threshold_ratio)
        mask = row_depths <= threshold

    if not np.any(mask):
        return 0.0, mask

    # Find the widest contiguous segment
    width, _ = _longest_contiguous_true(mask)
    return float(width), mask


def _longest_contiguous_true_original(mask: np.ndarray) -> Tuple[int, int]:
    """Original loop-based implementation kept for verification."""
    max_len = 0
    max_start = 0
    current_len = 0
    current_start = 0

    for i, val in enumerate(mask):
        if val:
            if current_len == 0:
                current_start = i
            current_len += 1
            if current_len > max_len:
                max_len = current_len
                max_start = current_start
        else:
            current_len = 0

    return max_len, max_start


def _longest_contiguous_true(mask: np.ndarray) -> Tuple[int, int]:
    """Find the longest contiguous run of True values (numpy vectorized)."""
    if mask.size == 0 or not np.any(mask):
        return 0, 0
    padded = np.concatenate(([False], mask, [False]))
    diffs = np.diff(padded.astype(int))
    starts = np.where(diffs == 1)[0]
    ends = np.where(diffs == -1)[0]
    if len(starts) == 0:
        return 0, 0
    lengths = ends - starts
    best = np.argmax(lengths)
    result = (int(lengths[best]), int(starts[best]))

    if os.environ.get('ML_VERIFY_NUMPY', 'false').lower() == 'true':
        result_original = _longest_contiguous_true_original(mask)
        if result != result_original:
            print(f"[VERIFY] _longest_contiguous_true mismatch: numpy={result} vs original={result_original}")
        else:
            print("[VERIFY] _longest_contiguous_true matches original perfectly")

    return result


def pixel_width_to_metric(pixel_width: float,
                           depth_m: float,
                           focal_length_px: float) -> float:
    """
    Convert pixel width to metric width.

    Formula: w_m = w_px * Z / f_x

    Args:
        pixel_width: Width in pixels
        depth_m: Depth in meters
        focal_length_px: Focal length in pixels

    Returns:
        Width in meters
    """
    if focal_length_px <= 0:
        raise ValueError("Focal length must be positive")
    return pixel_width * depth_m / focal_length_px


def cylindrical_correction(chord_length_m: float,
                            camera_distance_m: float) -> float:
    """
    Convert observed visual chord to true cylinder diameter (pure vision).

    Closed-form tangent-to-cylinder solution:
        d = z * u * (u + sqrt(u² + 4)) / 2,   where u = chord / z

    Default behaviour (since 2026-05-14): naive pinhole d = chord (no
    cylinder correction). The closed-form correction was found to
    over-correct on monocular depth (Depth Anything v3) because the depth
    is sampled from the mask centre and corresponds to chord depth rather
    than front-surface depth — applying the closed-form again amplifies
    mask wpx bias (NDHU MAE 5.51 cm naive vs 12.62 cm closed-form).

    Environment switches:
        ML_USE_CLOSEDFORM=1 (or ML_DBH_FORMULA=closed-form):
            Apply legacy tangent closed-form d = z·u·(u+sqrt(u²+4))/2.
            Kept for ablation / comparison studies.

    Empirical validation (NDHU N=82, Xiang N=294, both with naive):
      NDHU all (Mi A1 + DA3):      MAE 5.51 cm  bias +3.76 cm
      NDHU UI-guided (>=1m):       MAE 3.88 cm  bias +2.03 cm
      NDHU sweet spot (1.3-1.7m):  MAE 3.32 cm  bias -0.33 cm
      Xiang all (iPhone 13 + DA3): MAE 14.89 cm bias -11.97 cm
      Xiang within NDHU range (DBH<=50): MAE 8.02 cm bias -7.51 cm
      (Xiang remainder bias attributed to DA3 z systematic underestimation
       at >1m capture distance; Xiang dataset includes 32% large-trunk
       (DBH>50) near-field samples outside NDHU deployment range.)
    """
    l = chord_length_m
    z = camera_distance_m
    if l <= 0 or z <= 0:
        return max(0.0, chord_length_m)
    # Environment-controlled formula switch (default: naive)
    formula = os.environ.get("ML_DBH_FORMULA", "").strip().lower()
    use_cf_env = os.environ.get("ML_USE_CLOSEDFORM", "0").strip()
    if formula == "closed-form" or formula == "closedform" or use_cf_env == "1":
        # Legacy closed-form (assumes z = front-surface depth)
        u = l / z
        if u > 4.0:
            print(f"[cylindrical_correction] WARNING: u={u:.2f} (chord {l:.3f}m, "
                  f"z_front {z:.3f}m) — out of plausible regime, returning chord.")
            return chord_length_m
        return z * u * (u + math.sqrt(u * u + 4.0)) / 2.0
    # Default: naive pinhole d = chord (assumes z = chord depth from mask centre)
    return l


def compute_confidence(trunk_depth_m: float,
                       trunk_pixel_width: float,
                       dbh_cm: float,
                       bbox: BoundingBox,
                       depth_map: np.ndarray) -> float:
    """
    Compute a confidence score for the DBH measurement.

    Factors:
    - Distance: 1-4m is ideal, further reduces confidence
    - Trunk pixel width: more pixels = more precision
    - DBH reasonableness: 5-150cm is expected
    - Depth consistency: low variance in trunk region = better
    """
    scores = []
    notes = []

    # Distance score (ideal: 1-3m)
    if 1.0 <= trunk_depth_m <= 3.0:
        dist_score = 1.0
    elif 0.5 <= trunk_depth_m < 1.0 or 3.0 < trunk_depth_m <= 5.0:
        dist_score = 0.7
    elif 5.0 < trunk_depth_m <= 8.0:
        dist_score = 0.4
    else:
        dist_score = 0.2
    scores.append(dist_score * 0.25)

    # Pixel width score (more = better, minimum ~20px for reliability)
    if trunk_pixel_width >= 100:
        px_score = 1.0
    elif trunk_pixel_width >= 50:
        px_score = 0.8
    elif trunk_pixel_width >= 20:
        px_score = 0.5
    else:
        px_score = 0.2
    scores.append(px_score * 0.25)

    # DBH reasonableness (5-150cm is normal range)
    if 5.0 <= dbh_cm <= 150.0:
        dbh_score = 1.0
    elif 3.0 <= dbh_cm < 5.0 or 150.0 < dbh_cm <= 200.0:
        dbh_score = 0.6
    else:
        dbh_score = 0.2
    scores.append(dbh_score * 0.25)

    # Depth consistency in trunk region
    trunk_region = depth_map[bbox.y1:bbox.y2, bbox.x1:bbox.x2]
    if trunk_region.size > 0:
        depth_std = np.std(trunk_region)
        depth_mean = np.mean(trunk_region)
        cv = depth_std / max(depth_mean, 0.01)  # coefficient of variation
        if cv < 0.05:
            consistency_score = 1.0
        elif cv < 0.1:
            consistency_score = 0.8
        elif cv < 0.2:
            consistency_score = 0.6
        else:
            consistency_score = 0.3
    else:
        consistency_score = 0.3
    scores.append(consistency_score * 0.25)

    return min(1.0, sum(scores))


# ============================================================
# Main DBH Measurement Function
# ============================================================

def measure_dbh(depth_map: np.ndarray,
                bbox: BoundingBox,
                focal_length_px: Optional[float] = None,
                image_width_px: Optional[int] = None,
                fov_degrees: float = 70.0,
                apply_cylindrical_correction: bool = True,
                breast_height_ratio: Optional[float] = None,
                trunk_mask: Optional[np.ndarray] = None,
                ) -> DBHResult:
    """
    Measure DBH from a depth map and trunk bounding box.

    If ``trunk_mask`` is provided, the pixel width is measured FROM THE MASK
    (rows restricted to where mask == True). This is the correct behaviour
    when an upstream segmentation (YOLO-seg on device, or SAM on server)
    gave us a precise trunk silhouette. Without a mask we fall back to
    depth-gradient edge detection inside the bbox.

    Args:
        depth_map: (H, W) numpy array with metric depth in meters
        bbox: Bounding box around the trunk (x1, y1, x2, y2)
        focal_length_px: Focal length in pixels. If None, estimated from FOV.
        image_width_px: Image width (needed if focal_length_px is None)
        fov_degrees: Horizontal FOV for focal length estimation
        apply_cylindrical_correction: Whether to apply chord->diameter correction
        breast_height_ratio: Where to measure within bbox (0=top, 1=bottom).
                            None = center (0.5).
        trunk_mask: Optional (H, W) binary trunk segmentation mask.

    Returns:
        DBHResult with all measurement details
    """
    notes = []

    # Determine focal length
    if focal_length_px is None:
        if image_width_px is None:
            image_width_px = depth_map.shape[1]
        focal_length_px = estimate_focal_length_from_fov(image_width_px, fov_degrees)
        notes.append(f"Focal length estimated from FOV ({fov_degrees}°): {focal_length_px:.1f}px")

    # Determine measurement row
    if breast_height_ratio is not None:
        measurement_row = int(bbox.y1 + breast_height_ratio * bbox.height)
    else:
        measurement_row = bbox.center_y
        notes.append("Measuring at bbox center (no ground plane fitting)")

    # Calculate trunk pixel width and depth
    if trunk_mask is not None and trunk_mask.any():
        # Prefer measurement from segmentation mask (YOLO-seg / SAM).
        # Width = rightmost - leftmost mask pixel at measurement_row.
        # Clamp the measurement_row to rows that actually intersect the mask.
        H, W_map = depth_map.shape
        row = max(0, min(H - 1, measurement_row))
        # Do NOT clamp the row slice to bbox.x1:bbox.x2 — YOLO bboxes often
        # crop tightly on one side of a wide trunk, which would truncate the
        # mask width. Instead, take the connected mask component that
        # intersects the bbox center column at ``row``.
        row_mask_full = trunk_mask[row]
        bbox_cx = (bbox.x1 + bbox.x2) // 2
        if bbox_cx < W_map and row_mask_full[bbox_cx] > 0:
            # Extend left/right from bbox center until mask ends.
            left = bbox_cx
            while left > 0 and row_mask_full[left - 1] > 0:
                left -= 1
            right = bbox_cx
            while right < W_map - 1 and row_mask_full[right + 1] > 0:
                right += 1
            idx = np.arange(left, right + 1)
        else:
            # Fallback: use all mask pixels on this row, but only within an
            # expanded bbox (2x width centered on bbox center) to avoid
            # grabbing a different trunk.
            bbox_w = bbox.x2 - bbox.x1
            x_lo = max(0, bbox_cx - bbox_w)
            x_hi = min(W_map, bbox_cx + bbox_w)
            row_slice = row_mask_full[x_lo:x_hi]
            hits = np.where(row_slice > 0)[0]
            idx = hits + x_lo if len(hits) else np.array([], dtype=int)
        if len(idx) >= 2:
            trunk_pixel_width = float(idx[-1] - idx[0] + 1)
            row_depths = depth_map[row]
            # Take depth from the central 1/3 of the mask cross-section to avoid
            # anti-aliasing artefacts at the mask boundary which can distort the
            # depth estimate. For very narrow masks (< 9 px) fall back to full
            # cross-section.
            full_lo, full_hi = int(idx[0]), int(idx[-1])
            mask_w = full_hi - full_lo + 1
            if mask_w >= 9:
                third = mask_w // 3
                core_lo = full_lo + third
                core_hi = full_hi - third
                trunk_slice = row_depths[core_lo:core_hi + 1]
                depth_window = f"central 1/3 (x={core_lo}..{core_hi})"
            else:
                trunk_slice = row_depths[full_lo:full_hi + 1]
                depth_window = f"full mask (x={full_lo}..{full_hi})"
            trunk_depth_m = float(np.median(trunk_slice)) if len(trunk_slice) else 0.0
            notes.append(f"Width from mask at row {row}: {trunk_pixel_width:.1f}px "
                         f"(x={full_lo}..{full_hi}); depth from {depth_window}")
        else:
            trunk_pixel_width, measurement_row, trunk_depth_m = \
                calculate_trunk_width_pixels(depth_map, bbox, measurement_row)
            notes.append("Mask did not intersect measurement row; fell back to depth edges")
    else:
        trunk_pixel_width, measurement_row, trunk_depth_m = \
            calculate_trunk_width_pixels(depth_map, bbox, measurement_row)

    if trunk_pixel_width < 1.0 or trunk_depth_m <= 0:
        return DBHResult(
            dbh_cm=0.0,
            confidence=0.0,
            trunk_depth_m=trunk_depth_m,
            trunk_pixel_width=trunk_pixel_width,
            chord_length_m=0.0,
            focal_length_px=focal_length_px,
            measurement_row=measurement_row,
            method="failed",
            notes=["Could not detect trunk at measurement row"]
        )

    # Convert pixel width to metric chord length
    chord_length_m = pixel_width_to_metric(
        trunk_pixel_width, trunk_depth_m, focal_length_px
    )

    # Apply cylindrical correction
    if apply_cylindrical_correction and chord_length_m > 0:
        dbh_m = cylindrical_correction(chord_length_m, trunk_depth_m)
        method = "cylindrical_corrected"
        correction_pct = ((dbh_m - chord_length_m) / chord_length_m) * 100
        notes.append(f"Cylindrical correction: +{correction_pct:.1f}%")
    else:
        dbh_m = chord_length_m
        method = "simplified"

    dbh_cm = dbh_m * 100.0

    # Compute confidence
    confidence = compute_confidence(
        trunk_depth_m, trunk_pixel_width, dbh_cm, bbox, depth_map
    )

    return DBHResult(
        dbh_cm=round(dbh_cm, 2),
        confidence=round(confidence, 3),
        trunk_depth_m=round(trunk_depth_m, 3),
        trunk_pixel_width=round(trunk_pixel_width, 1),
        chord_length_m=round(chord_length_m, 4),
        focal_length_px=round(focal_length_px, 1),
        measurement_row=measurement_row,
        method=method,
        notes=notes,
    )


def measure_dbh_multi_row(depth_map: np.ndarray,
                           bbox: BoundingBox,
                           focal_length_px: Optional[float] = None,
                           image_width_px: Optional[int] = None,
                           fov_degrees: float = 70.0,
                           num_rows: int = 5,
                           trunk_mask: Optional[np.ndarray] = None,
                           ) -> DBHResult:
    """
    Measure DBH using multiple rows and take the median.
    More robust than single-row measurement.

    Samples num_rows evenly spaced rows within the middle 60% of the bbox.
    If ``trunk_mask`` is provided, every row is measured from the mask so
    we never silently fall back to bbox-rectangle width.
    """
    if focal_length_px is None:
        if image_width_px is None:
            image_width_px = depth_map.shape[1]
        focal_length_px = estimate_focal_length_from_fov(image_width_px, fov_degrees)

    # Sample rows in the middle 60% of the bbox
    margin = 0.2
    ratios = np.linspace(margin, 1.0 - margin, num_rows)

    results = []
    for ratio in ratios:
        result = measure_dbh(
            depth_map, bbox,
            focal_length_px=focal_length_px,
            apply_cylindrical_correction=True,
            breast_height_ratio=ratio,
            trunk_mask=trunk_mask,
        )
        if result.dbh_cm > 0:
            results.append(result)

    if not results:
        return DBHResult(
            dbh_cm=0.0, confidence=0.0, trunk_depth_m=0.0,
            trunk_pixel_width=0.0, chord_length_m=0.0,
            focal_length_px=focal_length_px, measurement_row=bbox.center_y,
            method="multi_row_failed", notes=["No valid measurements from any row"]
        )

    # Take median DBH
    dbh_values = [r.dbh_cm for r in results]
    median_dbh = float(np.median(dbh_values))
    std_dbh = float(np.std(dbh_values))

    # Use the result closest to the median
    best_result = min(results, key=lambda r: abs(r.dbh_cm - median_dbh))

    notes = best_result.notes.copy()
    notes.append(f"Multi-row median from {len(results)}/{num_rows} valid rows")
    notes.append(f"DBH range: {min(dbh_values):.1f} - {max(dbh_values):.1f} cm (std: {std_dbh:.1f})")

    # Adjust confidence based on consistency
    consistency_bonus = max(0, 0.1 - std_dbh / median_dbh * 0.5) if median_dbh > 0 else 0
    adjusted_confidence = min(1.0, best_result.confidence + consistency_bonus)

    return DBHResult(
        dbh_cm=round(median_dbh, 2),
        confidence=round(adjusted_confidence, 3),
        trunk_depth_m=best_result.trunk_depth_m,
        trunk_pixel_width=best_result.trunk_pixel_width,
        chord_length_m=best_result.chord_length_m,
        focal_length_px=focal_length_px,
        measurement_row=best_result.measurement_row,
        method="multi_row_median",
        notes=notes,
    )
