# tree-ml-service

Python FastAPI service that turns a single RGB photo of a tree trunk into a
**DBH** (diameter at breast height, cm) estimate. Runs on a separate machine
from the Node backend; the Flutter app talks to it directly over HTTPS using
an API key handed out by the backend at login time.

```
Flutter app ──HTTPS + X-ML-API-Key──► uvicorn :8100 ──► DA3 depth (OpenVINO) + server YOLOv8-seg mask
```

> Current production preset (`start.ps1`, default `-Preset da3`):
> **Depth-Anything-3 Metric Large** (OpenVINO, Intel NPU) for depth +
> **server-side YOLOv8-seg** (OpenVINO) for the trunk mask
> (`ML_ENABLE_SAM=false`, `ML_FORCE_SERVER_YOLO=true`).
> Depth Pro + SAM 2.1 remain available as alternative presets.

This folder is part of the `tree-project-backend` repo but ships with its own
Python environment (`venv/`) and PowerShell launcher.

---

## Pipeline

1. **Depth estimation** — default: **Depth-Anything-3 Metric Large** as
   OpenVINO IR on Intel NPU (`ML_DA3_OV_*`). Alternatives: Apple **Depth Pro**
   (PyTorch fp16 or OpenVINO INT8-W) and **DA V2** presets.
   See [`depth_estimation.py`](depth_estimation.py).
2. **Trunk mask** — default: **server-side YOLOv8-seg** (OpenVINO, see
   [`yolo_simulator.py`](yolo_simulator.py), enabled by
   `ML_FORCE_SERVER_YOLO=true`). Optional: **SAM 2.1** auto-prompt
   (`ML_ENABLE_SAM=true`, see [`tree_segmentation.py`](tree_segmentation.py) —
   its sub-pixel/ellipse refinement helpers are used on every path).
   When neither is available, [`tree_trunk_detector.py`](tree_trunk_detector.py)
   provides a depth-gradient fallback detector.
3. **DBH calculation** — tangent-pair geometry on the mask, with trunk
   distance taken from the depth map at the mask centroid; corrects for
   focal length using the photo's EXIF when available.
   See [`dbh_calculator.py`](dbh_calculator.py).

---

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/health`, `/api/v1/health` | — | Liveness probe (no key) |
| GET  | `/api/v1/config` | — | Active model + backend info |
| POST | `/api/v1/estimate-depth` | `X-ML-API-Key` | Depth map only |
| POST | `/api/v1/measure-dbh` | `X-ML-API-Key` | DBH given an explicit bbox |
| POST | `/api/v1/auto-measure-dbh` | `X-ML-API-Key` | DBH with auto-segmentation |
| POST | `/api/v1/auto-measure-dbh-multi` | `X-ML-API-Key` | Multi-photo fusion (2–3 photos of the same tree) |
| POST | `/api/v1/debug/depth-at-point` | `X-ML-API-Key` | Probe depth at one pixel |
| WS   | `/ws/scan` | API key in query string | ~5 fps live preview (browser test page: `/static/scanner.html`) |

Authentication is a fixed-string compare (`hmac.compare_digest`) against
`ML_API_KEY`. Rate limit: **`ML_RATE_LIMIT` requests / hour / IP, default 30**
(in-memory; reset on restart). Health endpoints are exempt.

---

## Quick start (Windows — recommended)

```powershell
cd backend\ml_service
.\start.ps1                  # default: DA3 Metric Large + OpenVINO NPU + server YOLO (da3 preset)
.\start.ps1 -Preset pro_ov   # Depth Pro + OpenVINO INT8-W
.\start.ps1 -Preset pro      # PyTorch Depth Pro (CUDA / XPU)
.\start.ps1 -Preset openvino # DA V2 Base + OpenVINO (lighter / faster)
.\start.ps1 -Preset default  # DA V2 Base, PyTorch
.\start.ps1 -Verify          # enable numpy verify (slower; for QA)
.\start.ps1 -Workers 2       # multi-worker uvicorn (≥ 12 GB RAM)
.\start.ps1 -Port 8200       # override port (default 8100)
.\start.ps1 -Debug            # enable Swagger /docs
```

> The `da3` preset requires the DA3 OpenVINO IR under `openvino_models\`
> (one-off export: `python da3_to_openvino.py`) and the YOLOv8-seg OpenVINO
> model (see `trunk_detector_training/export_model.py`).

The launcher:

- loads `.env` from this folder (gitignored),
- picks the venv at `ml_service\venv\` if present,
- detects CUDA / Intel XPU / CPU and prints it,
- kills any ghost `ngrok.exe` left over from previous sessions,
- frees the port if another `python.exe` is bound to it,
- starts `uvicorn app:app --host 0.0.0.0 --port $env:PORT` with the chosen worker count.

## Quick start (Linux / production)

```bash
cd backend/ml_service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# (one-off) export OpenVINO IR if using a *_ov preset:
./run_export.ps1                          # works under pwsh on Linux too
# OR:
python export_openvino_custom.py --weights models/depth_pro.pt --int8w

ML_API_KEY=…  ML_DEPTH_MODEL=depth_pro  ML_USE_OPENVINO=true \
  uvicorn app:app --host 0.0.0.0 --port 8100 --workers 2
```

A pm2 / systemd unit lives in [`self_host/`](self_host/).

---

## Environment variables

Most production values are injected by `start.ps1 -Preset da3`; set them
manually only when running uvicorn directly. Full template: `.env.example`.

| Key | Default | Notes |
|---|---|---|
| `ML_API_KEY` | — | **Required for production.** Empty = endpoints are open (dev only). |
| `PORT` | `8100` | uvicorn listen port |
| `ML_DEPTH_MODEL` | `da_v2_base` | `da3_metric_large` \| `depth_pro` \| `da_v2_base` \| `da_v2_small` |
| `ML_USE_OPENVINO` | `true` | load the OpenVINO IR variant of the chosen depth model |
| `ML_DA3_OV_DIR` / `ML_DA3_OV_DEVICE` | `openvino_models\da3_metric_large` / `NPU` | DA3 IR location + OpenVINO device |
| `ML_FORCE_SERVER_YOLO` | `false` (`true` via `start.ps1`) | use server-side YOLOv8-seg mask on `/auto-measure-dbh` |
| `ML_SERVER_YOLO_DEVICE` / `ML_SERVER_YOLO_IMGSZ` | `intel:gpu` / `832` | YOLO OpenVINO device + inference size |
| `ML_ENABLE_SAM` | `true` (`false` via `start.ps1`) | SAM auto-segmentation path |
| `ML_SEG_MODEL` | `sam2_tiny` | `sam2_tiny` \| `sam2_small` \| `sam2_base` |
| `ML_RATE_LIMIT` | `30` | requests / hour / IP |
| `ML_VERIFY_NUMPY` | `false` | Run a parallel numpy reference and assert ≤ 1 e-3 max-abs delta (QA only) |
| `ML_CORS_ORIGINS` | localhost:3000, localhost:8080 | Comma-separated CORS allow-list. Add your backend / web hosts here in production. |
| `ML_DEBUG` | `false` | `true` enables Swagger at `/docs` and verbose pipeline logs |

Models are not committed (`models/`, `openvino_models/` are gitignored). Run
`setup_models.py` once to download Depth Pro + SAM 2.1 Tiny, then
`run_export.ps1` if you want the OpenVINO IR.

Third-party sources are **not** committed either (gitignored, no submodules).
If you need them, clone into the listed folders:

```bash
git clone https://github.com/apple/ml-depth-pro depth_pro_src
git clone https://github.com/facebookresearch/sam2 sam2_src
# optional research baselines:
git clone https://github.com/lpiccinelli-eth/UniDepth third_party/UniDepth
git clone https://github.com/ByteDance-Seed/depth-anything-3 third_party/depth-anything-3
```

---

## Repository layout

```
ml_service/
├── app.py                     # FastAPI entrypoint (auth, rate limit, endpoints, WS)
├── depth_estimation.py        # DA3 / Depth Pro / DA V2 loader + inference (PyTorch + OpenVINO)
├── yolo_simulator.py          # server-side YOLOv8-seg mask (production) + phone TFLite simulator
├── tree_segmentation.py       # SAM 2.1 wrapper + sub-pixel/ellipse refinement helpers
├── dbh_calculator.py          # tangent-pair geometry + EXIF focal-length handling
├── tree_trunk_detector.py     # depth-gradient fallback trunk detector
├── visualization.py           # PNG overlays + colour-mapped depth visualisations
├── model_registry.py          # one-shot model loaders, cached behind asyncio.Lock
├── setup_models.py            # download Depth Pro + SAM weights
├── da3_to_openvino.py         # DA3 → OpenVINO IR export (needed for the da3 preset)
├── export_openvino_custom.py  # Depth Pro / SAM → OpenVINO IR (INT8-W) export
├── export_onnx.py             # ONNX export (optional backend)
├── compress_depth_pro.py      # Depth Pro INT8 weight compression (optional)
├── run_export.ps1             # convenience wrapper for OpenVINO export
├── check_env.py               # Python / OpenVINO / CUDA environment check
├── start.ps1 / start.sh       # launchers (Windows / Linux)
├── requirements.txt           # runtime deps (install this one)
├── requirements_sota.txt      # historical minimal pin list (kept for reference)
├── static/scanner.html        # browser live-scan test page (served at /static)
├── test_*.py                  # smoke / API / stability tests (repo root, not tests/)
└── trunk_detector_training/   # YOLO training pipeline (sub-README)
```

Not committed (gitignored, set up locally): `models/`, `openvino_models/`,
`venv/`, `self_host/`, `depth_pro_src/`, `sam2_src/`, `third_party/`,
benchmark outputs.

---

## Testing

```powershell
.\venv\Scripts\python.exe test_smoke.py        # depth pipeline smoke (synthetic image)
.\venv\Scripts\python.exe test_review.py       # module import + numerical sanity check
.\venv\Scripts\python.exe test_api.py          # /measure-dbh HTTP endpoint (server must be running)
.\venv\Scripts\python.exe test_depth_pro.py    # Depth Pro memory/OOM stability (optional)
```

Research benchmark scripts and their outputs were moved out of this repo at
handover (2026-06); they live in the original author's local archive.

---

## Security notes

- API key check is **timing-safe** (`hmac.compare_digest`).
- The rate limiter is **in-memory** — a process restart resets counters. Put
  this service behind nginx + fail2ban (or Cloudflare) if it is exposed to
  the open internet.
- CORS defaults to localhost only; you must add production origins via
  `ML_CORS_ORIGINS` (comma-separated). Wildcard `*` is explicitly stripped.
- Image upload size is capped at **20 MB** per image (checked in `app.py`).
- WebSocket `/ws/scan` validates the API key on the very first frame; close
  the connection on mismatch.

---

## License

The vendored model code keeps its upstream licenses
(`depth_pro_src/LICENSE`, `sam2_src/LICENSE`). The rest of this folder is
MIT — same as the parent repo.
