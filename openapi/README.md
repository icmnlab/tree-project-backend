# OpenAPI Specification

Machine-readable API catalog for Postman, Swagger UI, and client codegen.

| Field | Value |
|-------|-------|
| **Spec file** | `openapi/openapi.yaml` (OpenAPI 3.0.3) |
| **Human catalog** | `tree-project-frontend/docs/API_REFERENCE.md` |
| **Regenerate** | `node scripts/generate_openapi.js` |

---

## Regenerate after route changes

```bash
cd tree-project-backend
node scripts/generate_openapi.js
git add openapi/openapi.yaml
```

The generator scans `routes/*.js` and mount prefixes from `app.js`. It does **not** infer request bodies or response schemas — add those manually over time or extend the script.

---

## Import into Postman

1. Postman → Import → File → select `openapi/openapi.yaml`
2. Set collection variable `host` to your server (no trailing slash)
3. Run **POST** `/api/login` with `{ "account": "...", "password": "..." }`
4. Set collection/auth Bearer token from response

---

## Swagger UI (local)

```bash
npx @redocly/cli preview-docs openapi/openapi.yaml
```

Or use any OpenAPI 3 viewer (Swagger Editor, Stoplight, etc.).

---

## Limitations

| Item | Detail |
|------|--------|
| Auth | Most `/api/*` paths marked `bearerAuth`; public paths: `/health`, webhooks |
| Schemas | Minimal — only `ErrorResponse` stub |
| SSE | `POST /api/chat` streaming not described in OpenAPI |
| Roles | RBAC (`requireRole`) not encoded — see `API_REFERENCE.md` |

---

## Related

- `frontend/docs/API_REFERENCE.md`
- `frontend/docs/ARCHITECTURE.md` §2 Request lifecycle
