# Authors

**Last updated**: 2026-06-29

---

## Primary author

| Field | Value |
|-------|-------|
| Name / GitHub | **KyleliuNDHU** |
| Role | Original developer and primary maintainer through handover (2025–2026) |
| Copyright | Copyright (c) 2025 **KyleliuNDHU** — see [LICENSE](LICENSE) |

### Scope (this repository)

- Node.js / Express REST API, JWT auth, RBAC, project scoping
- PostgreSQL schema and migrations (`database/initial_data/`, migration 35+)
- Pending → transfer survey pipeline, carbon calculation, boundaries, AI routes
- Integration test framework (`tests/runner.js`) and CI
- Deployment scripts (`deploy.sh`, webhook, PM2)
- Optional `ml_service/` visual DBH pipeline (FastAPI)

Frontend counterpart: `tree-project-frontend` — see that repo's `AUTHORS.md`.

---

## GitHub contributor graph

On the recipient org (`icmnlab/tree-project-backend`), GitHub lists **one contributor** (`KyleliuNDHU`). That is expected: the handover repo uses a **fresh snapshot** history, not the full development log.

Authorship is established by **`LICENSE` + this file**, not by commit count on the recipient remote.

---

## Fresh-snapshot handover

When pushing to the recipient GitHub org, use a single snapshot commit (`git checkout --orphan`) so old commits (which may contain dev-only hostnames or secrets) are not transferred.

Procedure: frontend repo `docs/LAB_DEPLOYMENT_GUIDE.md` §0.1.

The deliverer keeps a **private archive** of the full development history as personal evidence. That archive is **not** pushed to the recipient.

---

## Recipient obligations (MIT License)

1. Retain the copyright notice in `LICENSE` on all copies and substantial portions.
2. Do not remove or falsify this attribution file.
3. You may modify the code freely; do not claim original authorship or delete copyright/attribution files.

---

## Related

- `CONTRIBUTION_RECORD.md` — legacy filename; points here
- Frontend `docs/HANDOFF.md` §0
