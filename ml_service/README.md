# tree-ml-service

Python FastAPI service that turns a single RGB photo of a tree trunk into a
**DBH** (diameter at breast height, cm) estimate. Runs on a separate machine
from the Node backend; the Flutter app talks to it directly over HTTPS using
an API key handed out by the backend at login time.

```
Flutter app ──HTTPS + X-ML-API-Key──► uvicorn :8100 ──► Depth Pro + SAM 2.1 Tiny
```

This folder is part of the `tree-project-backend` repo but ships with its own
Python environment (`venv/`) and PowerShell launcher.

---

## Pipeline

1. **Depth estimation** — Apple's **Depth Pro** (350 M params, monocular, focal-length
   aware). Runs in PyTorch fp16 on CUDA / XPU, **or** as **OpenVINO INT8-W IR**
   on Intel Arc iGPU (the recommended preset on the lab Windows server, ≈3×
   faster than fp16 CPU and ≈2× faster than CUDA on the same hardware).
   See [`depth_estimation.py`](depth_estimation.py).
2. **Trunk segmentation** — **SAM 2.1 Tiny** (38.9 M params) auto-prompted at
   the image centre to extract a binary trunk mask.
   See [`tree_segmentation.py`](tree_segmentation.py).
3. **DBH calculation** — tangent-pair geometry on the mask, with trunk
   distance taken from the depth map at the mask centroid; corrects for
   focal length using the photo's EXIF when available.
   See [`dbh_calculator.py`](dbh_calculator.py).

End-to-end latency on the reference machine (Intel Core Ultra 7 + Arc iGPU,
INT8-W OpenVINO): **~1.3 s** per image.

---

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/health`, `/api/v1/health` | — | Liveness probe (no key) |
| GET  | `/api/v1/config` | — | Active model + backend info |
| POST | `/api/v1/estimate-depth` | `X-ML-API-Key` | Depth map only |
| POST | `/api/v1/measure-dbh` | `X-ML-API-Key` | DBH given an explicit bbox |
| POST | `/api/v1/auto-measure-dbh` | `X-ML-API-Key` | DBH with auto-segmentation |
| POST | `/api/v1/auto-measure-dbh-multi` | `X-ML-API-Key` | Multi-trunk variant |
| POST | `/api/v1/debug/depth-at-point` | `X-ML-API-Key` | Probe depth at one pixel |
| WS   | `/ws/scan` | API key in query string | ~5 fps live preview |

Authentication is a fixed-string compare (`hmac.compare_digest`) against
`ML_API_KEY`. Rate limit: **120 requests / hour / IP** (in-memory; reset on
restart). Health endpoints are exempt.

---

## Quick start (Windows — recommended)

```powershell
cd backend\ml_service
.\start.ps1                  # default: Depth Pro + OpenVINO INT8-W (pro_ov preset)
.\start.ps1 -Preset pro      # PyTorch Depth Pro (CUDA / XPU)
.\start.ps1 -Preset openvino # DA V2 Base + OpenVINO (lighter / faster)
.\start.ps1 -Preset default  # DA V2 Base, PyTorch
.\start.ps1 -Verify          # enable numpy verify (slower; for QA)
.\start.ps1 -Workers 2       # multi-worker uvicorn (≥ 12 GB RAM)
.\start.ps1 -Port 8200       # override port (default 8100)
.\start.ps1 -Debug            # enable Swagger /docs
```

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

| Key | Default | Notes |
|---|---|---|
| `ML_API_KEY` | — | **Required for production.** Empty = endpoints are open (dev only). |
| `PORT` | `8100` | uvicorn listen port |
| `ML_DEPTH_MODEL` | `da_v2_base` | `depth_pro` \| `da_v2_base` \| `da_v2_small` |
| `ML_USE_OPENVINO` | `false` | `true` to load the OpenVINO IR variant of the chosen depth model |
| `ML_ENABLE_SAM` | `true` | `false` skips SAM and requires an explicit bbox on every request |
| `ML_SEG_MODEL` | `sam2_tiny` | `sam2_tiny` \| `sam2_small` \| `sam2_base` |
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
├── depth_estimation.py        # Depth Pro / DA V2 loader + inference (PyTorch + OpenVINO)
├── tree_segmentation.py       # SAM 2.1 wrapper (auto + bbox prompts)
├── dbh_calculator.py          # tangent-pair geometry + EXIF focal-length handling
├── tree_trunk_detector.py     # legacy YOLO trunk detector (still used as a SAM hint)
├── visualization.py           # PNG overlays + colour-mapped depth visualisations
├── model_registry.py          # one-shot model loaders, cached behind asyncio.Lock
├── setup_models.py            # download Depth Pro + SAM weights
├── export_openvino_custom.py  # PyTorch → OpenVINO IR (INT8-W) export
├── run_export.ps1             # convenience wrapper for the above
├── start.ps1 / start.sh       # launchers (Windows / Linux)
├── requirements.txt           # runtime deps
├── requirements_sota.txt      # extra deps for OpenVINO + SAM 2.1 SOTA preset
├── self_host/                 # pm2 / systemd / nginx fragments
├── depth_pro_src/             # vendored Apple Depth Pro source (sub-README)
├── sam2_src/                  # vendored Meta SAM 2 source (sub-README)
├── trunk_detector_training/   # YOLO training scripts (sub-README)
└── tests/  ─  test_*.py        # smoke + benchmark scripts
```

`benchmark_*.csv`, `analyze_xiang.py`, etc. are research artifacts and are
gitignored.

---

## Testing

```powershell
.\venv\Scripts\python.exe -m pytest test_smoke.py     # smoke
.\venv\Scripts\python.exe test_dbh_full_pipeline.py    # full pipeline on a sample image
.\venv\Scripts\python.exe test_review.py               # numerical regression vs. saved baselines
```

Benchmark CSVs (committed for the paper, not for runtime) live next to the
scripts; reproduce with `benchmark_xiang.py`.

---

## Security notes

- API key check is **timing-safe** (`hmac.compare_digest`).
- The rate limiter is **in-memory** — a process restart resets counters. Put
  this service behind nginx + fail2ban (or Cloudflare) if it is exposed to
  the open internet.
- CORS defaults to localhost only; you must add production origins via
  `ML_CORS_ORIGINS` (comma-separated). Wildcard `*` is explicitly stripped.
- Image upload size is capped at **10 MB** by FastAPI's request size guard.
- WebSocket `/ws/scan` validates the API key on the very first frame; close
  the connection on mismatch.

---

## License

The vendored model code keeps its upstream licenses
(`depth_pro_src/LICENSE`, `sam2_src/LICENSE`). The rest of this folder is
MIT — same as the parent repo.
