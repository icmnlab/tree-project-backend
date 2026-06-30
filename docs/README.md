# Backend documentation index

Handover and module guides live in the **frontend repo `docs/`** (single canonical copy). This file is a pointer from the backend repo.

**Start here** → **[frontend documentation hub](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/README.md)** → Step 1: **[ONBOARDING_READING_PATH.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/ONBOARDING_READING_PATH.md)**

> **Only cloned backend?** You still need the [frontend repo](https://github.com/icmnlab/tree-project-frontend) for almost all handover docs. Clone both repos side by side (e.g. `D:\treeproject\tree-project-backend` + `tree-project-frontend`). **Develop**: fork both repos on GitHub → clone your fork → PR to `icmnlab/main` ([workflow](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/DEVELOPMENT_WORKFLOW.md#fork-and-remotes-required-setup)).

**Last updated**: 2026-07-01

**Deploy markers**: `2026-06-30` — webhook smoke-test PR; `2026-07-01` — SSH + webhook + Funnel verified on lab VM (see public [LAB_DEPLOYMENT_GUIDE.md §Phase 4](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/LAB_DEPLOYMENT_GUIDE.md)).

---

## Start here (links → frontend repo on GitHub)

| Topic | Document |
|-------|----------|
| **Documentation hub** | [docs/README.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/README.md) |
| Onboarding, reading order | [ONBOARDING_READING_PATH.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/ONBOARDING_READING_PATH.md) |
| Run locally, tests | [HANDOFF.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/HANDOFF.md) |
| **Development workflow & CI** | [DEVELOPMENT_WORKFLOW.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/DEVELOPMENT_WORKFLOW.md) |
| Architecture (full stack) | [ARCHITECTURE.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/ARCHITECTURE.md) |
| API catalog | [API_REFERENCE.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/API_REFERENCE.md) |
| File/feature inventory | [CODEBASE_INVENTORY.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/CODEBASE_INVENTORY.md) |
| Deploy / VM ops | [LAB_DEPLOYMENT_GUIDE.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/LAB_DEPLOYMENT_GUIDE.md) |
| Optional: ST-1 bug runbook | [DEVELOPMENT_WORKFLOW.md § Guided exercise](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/DEVELOPMENT_WORKFLOW.md#guided-exercise--fix-st-1-species_id-shows無-optional-reference) |

---

## Backend-specific in **this** repo (clickable)

| Topic | Document |
|-------|----------|
| **Source layout (controllers, services, …)** | [SOURCE_LAYOUT.md](./SOURCE_LAYOUT.md) |
| Routes, tables, feature flows | [../README.md](../README.md) |
| Integration tests | [../tests/FRAMEWORK.md](../tests/FRAMEWORK.md) |
| Optional ML service | [../ml_service/README.md](../ml_service/README.md) |
| OpenAPI spec | [../openapi/openapi.yaml](../openapi/openapi.yaml), [../openapi/README.md](../openapi/README.md) |
| Boundary import samples | [boundary_samples/README.md](./boundary_samples/README.md) |

---

## Module guides (frontend `docs/` — full list in [hub](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/README.md))

| Module | Document |
|--------|----------|
| Auth & invites | [ADMIN_AND_INVITE_DESIGN.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/ADMIN_AND_INVITE_DESIGN.md) |
| Database schema | [DATABASE_SCHEMA.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/DATABASE_SCHEMA.md) |
| Pending → transfer | [SURVEY_HISTORY.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/SURVEY_HISTORY.md) |
| Boundaries | [BOUNDARY_SYSTEM_DESIGN.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/BOUNDARY_SYSTEM_DESIGN.md) |
| BLE / VLGEO2 | [VLGEO2_STD_APPLICATION_GUIDE.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/VLGEO2_STD_APPLICATION_GUIDE.md) |
| Species & PlantNet | [SPECIES_AND_PLANTNET.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/SPECIES_AND_PLANTNET.md) |
| Carbon | [CARBON_CALCULATION.md](https://github.com/icmnlab/tree-project-frontend/blob/main/docs/CARBON_CALCULATION.md) |
