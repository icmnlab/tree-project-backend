# Backend documentation index

Handover and module guides live in the **frontend repo `docs/`** (single canonical copy). This file is a pointer from the backend repo.

**Last updated**: 2026-06-29

---

## Start here

| Topic | Document (frontend repo) |
|-------|--------------------------|
| Onboarding, local run, tests | `tree-project-frontend/docs/ONBOARDING_READING_PATH.md` → `HANDOFF.md` |
| Architecture (full stack) | `tree-project-frontend/docs/ARCHITECTURE.md` |
| API catalog | `tree-project-frontend/docs/API_REFERENCE.md` |
| File/feature inventory | `tree-project-frontend/docs/CODEBASE_INVENTORY.md` |

---

## Backend-specific in this repo

| Topic | Document |
|-------|----------|
| **Source layout (controllers, services, …)** | **`SOURCE_LAYOUT.md`** (this folder) |
| Routes, tables, feature flows | `../README.md` (this repo root) |
| Integration tests | `../tests/FRAMEWORK.md` |
| Optional ML service | `../ml_service/README.md` |
| OpenAPI spec | `../openapi/openapi.yaml`, `../openapi/README.md` |
| Boundary import samples | `boundary_samples/README.md` |

---

## Module guides (frontend `docs/`)

| Module | Document |
|--------|----------|
| Auth & invites | `ADMIN_AND_INVITE_DESIGN.md` |
| Database schema | `DATABASE_SCHEMA.md` |
| Pending → transfer | `SURVEY_HISTORY.md` |
| Boundaries | `BOUNDARY_SYSTEM_DESIGN.md` |
| BLE / VLGEO2 | `VLGEO2_STD_APPLICATION_GUIDE.md` |
| Species & PlantNet | `SPECIES_AND_PLANTNET.md` |
| Carbon | `CARBON_CALCULATION.md` |
| Experimental features | `EXPERIMENTAL_FEATURES.md` |
| Visual measurement | `VISUAL_MEASUREMENT.md` |
| ML correction upload | `ML_CORRECTION_UPLOAD.md` |

Deployment runbook from live VM ops: pending until school-side SSH/webhook steps are verified (`LAB_DEPLOYMENT_GUIDE.md` placeholder until then).
