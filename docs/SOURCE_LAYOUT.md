# Backend Source Layout

Catalog of backend application layers: routes delegate to controllers and services; this document maps **every production `.js` file** in `controllers/`, `services/`, `middleware/`, and `utils/`.

**Repo**: `tree-project-backend`  
**Last reviewed**: 2026-06-29  
**Related**: `../routes/` (HTTP wiring) · `openapi/openapi.yaml` · frontend `docs/API_REFERENCE.md` · frontend `docs/ARCHITECTURE.md` §4

---

## Layering convention

```
HTTP request
  → middleware/     (auth, rate limit, project scope)
  → routes/*.js     (parse params, call controller or inline handler)
  → controllers/*.js (optional — multi-step HTTP orchestration)
  → services/*.js   (business logic, external APIs)
  → utils/*.js      (pure helpers, geo, lifecycle)
  → PostgreSQL (config/db.js pool)
```

**Rule**: keep routes thin; prefer `services/` for reusable logic. Controllers exist where create/update/report flows are large (`treeSurvey*`, CSV import, AI reports).

---

## Controllers (`controllers/`)

| File | Used by | Responsibility |
|------|---------|----------------|
| `treeSurveyCreateController.js` | `routes/treeSurvey.js` | `POST create_v2` — transaction: tree row, images, measurements, carbon calc |
| `treeSurveyUpdateController.js` | `routes/treeSurvey.js` | `PUT update_v2/:id` — optimistic lock, snapshot update |
| `treeSurveyBatchController.js` | `routes/treeSurvey.js` | Batch import / bulk operations |
| `csvImportController.js` | `routes/csvImport.js` | Admin CSV preview + execute |
| `reportController.js` | `routes/reports.js` | Excel/PDF export assembly |
| `aiReportController.js` | `routes/ai.js`, `routes/admin.js` | AI sustainability report generation |
| `aiController.js` | `routes/ai.js` | Chat session handlers (legacy split) |
| `treeManagementController.js` | `routes/management.js` | Tree management action CRUD |

---

## Services (`services/`)

| File | Domain | Responsibility |
|------|--------|----------------|
| `carbonCalculationService.js` | Carbon | Handbook Ch.6 stepwise carbon storage from DBH/height/species |
| `handbookCarbonService.js` | Carbon | COA volume equation helpers (shared with frontend asset) |
| `coaVolumeEquations.js` | Carbon | Volume table loader |
| `speciesIdentificationService.js` | Species | PlantNet API, GBIF/iNat enrichment, catalog merge |
| `speciesSynonymService.js` | Species | Synonym maintenance cron, merge reports |
| `auditLogService.js` | Admin | Structured audit log writes |
| `ipBlacklistService.js` | Security | IP block list persistence |
| `sqlQueryService.js` | AI Agent | Text-to-SQL guardrails for agent tools |
| `agentService.js` | AI Agent | ReAct loop, tool dispatch |
| `agentDataTools.js` | AI Agent | `query_tree_data`, `calculate_carbon`, etc. |
| `agentExportService.js` | AI Agent | Export temp files for agent downloads |
| `agentExternalRetrievalService.js` | AI Agent | Google CSE / external search |
| `llmProviderService.js` | AI | Model routing, fallbacks |
| `llmProviderHealth.js` | AI | Provider availability checks |
| `openaiService.js` | AI | OpenAI client wrapper |
| `geminiService.js` | AI | Gemini client wrapper |

Routes without dedicated services often inline SQL or use `utils/` (e.g. `project_boundaries.js` → `utils/boundaryImport.js`).

---

## Middleware (`middleware/`)

Applied in `app.js` order for `/api/*`:

| File | Export | Purpose |
|------|--------|---------|
| `ipBlacklistGuard.js` | guard | Block listed IPs before handlers |
| `rateLimiter.js` | `burstLimiter`, `apiLimiter`, `loginLimiter`, `aiLimiter` | Rate limits (`DISABLE_RATE_LIMIT` in CI) |
| `jwtAuth.js` | `jwtAuth` | Bearer JWT validation → `req.user` |
| `roleAuth.js` | `requireRole(...)` | RBAC level check |
| `projectAuth.js` | `projectAuthFilter` | Restrict queries to `user_projects` |
| `loginAttemptMonitor.js` | used in `users.js` | Lockout after failed logins |
| `requestIdDedup.js` | optional | Idempotent pending batch (`X-Request-Id`) |

Also: `middleware/upload.js` (Multer) mounted per-route for images.

---

## Utils (`utils/`)

| File | Used for |
|------|----------|
| `treeLifecycle.js` | Map tree status text → `lifecycle_status`; retire/restore rules |
| `boundaryImport.js` | KML/GeoJSON/txt import, validation |
| `boundarySuggest.js` | Convex hull / suggest boundary from tree GPS |
| `geo.js` | Point-in-polygon, county lookup (`data/tw_county.geojson`) |
| `county.js` | County name helpers |
| `projectCatalog.js` | Project code / name resolution |
| `domainAliases.js` | Legacy name alias normalization |
| `handbookDbhGuard.js` | Instrument DBH vs manual DBH handbook rules |
| `textValidation.js` | Reject U+FFFD in string fields |
| `chineseConvert.js` | 臺→台 normalization |
| `cleanup.js` | Scheduled orphan cleanup (cron in `app.js`) |

---

## Routes (`routes/`)

24 route modules — **145 HTTP operations**. Full path list:

- Human-readable: frontend repo `docs/API_REFERENCE.md`
- Machine-readable: `openapi/openapi.yaml` (regenerate via `scripts/generate_openapi.js`)

| File | Mount prefix (under `/api`) |
|------|----------------------------|
| `users.js` | `/` (login, users, invites) |
| `projects.js` | `/projects` |
| `project_areas.js` | `/project_areas` |
| `treeSurvey.js` | `/tree_survey` |
| `treeSpecies.js` | `/tree_species` |
| `tree_statuses.js` | `/tree-statuses` |
| `reports.js` | `/` (export paths) |
| `statistics.js` | `/tree_statistics` |
| `ai.js` | `/` (chat, reports) |
| `admin.js` | `/admin` |
| `location.js` | `/location` |
| `management.js` | `/tree-management` |
| `speciesIdentification.js` | `/species` |
| `pending_measurements.js` | `/pending-measurements` |
| `maintenance_locks.js` | `/maintenance-locks` |
| `project_boundaries.js` | `/project-boundaries` |
| `ml_training_data.js` | `/ml-training` |
| `tree_images.js` | `/tree-images` |
| `ml_service.js` | `/ml-service` |
| `csvImport.js` | `/admin/import-csv` |
| `ipBlacklist.js` | `/admin/ip-blacklist` |
| `research_dataset.js` | `/admin/research-dataset` |
| `agent.js` | `/agent` |
| `webhook.js` | `/webhook` (no `/api` prefix) |

---

## Config & entry

| Path | Role |
|------|------|
| `app.js` | Express app, middleware chain, route mounts, startup migrations |
| `config/db.js` | PostgreSQL pool |
| `ecosystem.config.js` | PM2 cluster config |
| `.env.example` | Environment template |

---

## Scripts (operations, not runtime)

| Script | Purpose |
|--------|---------|
| `scripts/migrate.js` | Full DB bootstrap (dev + first prod) |
| `scripts/run_pending_migrations.js` | Production incremental migrations |
| `scripts/create_lab_admin.js` | Create admin user (production) |
| `scripts/deploy.sh` | Webhook deploy pipeline |
| `scripts/generate_openapi.js` | Regenerate OpenAPI spec |
| `scripts/backup_db.sh` | Cron DB backup |

See frontend `docs/LAB_DEPLOYMENT_GUIDE.md` for when to run each.

---

## Tests

| Path | Role |
|------|------|
| `tests/runner.js` | Integration test entry (89 cases) |
| `tests/invariants/` | Domain invariants |
| `tests/contracts/` | API contract tests |
| `tests/journeys/` | End-to-end flows |

See `tests/FRAMEWORK.md`.

---

## Related

- `ml_service/` — optional Python FastAPI service (`ml_service/README.md`)
- `database/initial_data/` — schema SQL (see frontend `docs/DATABASE_SCHEMA.md`)
- `dev-fixtures/` — **not production** seed data
