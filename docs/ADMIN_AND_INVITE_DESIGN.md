# 管理後台與邀請碼 — 已定案規格（2026-05）

## 邀請碼（已實作）

| 項目 | 規格 |
|------|------|
| 產生者 | **業務管理員**以上（`POST/GET /api/users/invites`） |
| 內建角色 | 建立時指定 `role`（不可高於建立者） |
| 專案／區位 | `project_codes[]` 註冊後寫入 `user_projects`；`project_locations[]` 存於邀請列供紀錄 |
| 一次性 | 預設 `max_uses=1` |
| 過期 | `expires_in_days`（1–90 天） |
| 審核啟用 | `requires_approval=true` → 新帳號 `is_active=false`，管理員於使用者列表啟用 |

App：**管理後台 → 使用者管理 → 邀請碼管理**。

公開註冊：`POST /api/register` + `RegisterPage`。

---

## 樹木歷史 vs 現場場次 vs 多人

| 概念 | 說明 |
|------|------|
| **樹木歷史** | `tree_measurement_raw`、多次調查時間序列；見 `SURVEY_HISTORY.md` |
| **現場場次** | `FieldSessionSetup`、`session_id`、BLE `_liveSessionId` — 單次外業工作脈絡，**非**歷史頁 |
| **多人** | 各調查員各自登入／各自 session；後端 `X-Request-Id` 去重、`pg_advisory_xact_lock` 配號、`expected_updated_at` 樂觀鎖 |

---

## 管理後台待辦

- 稽核 log 檢視、專案區位與邀請 `project_locations` 首次登入引導（選填）
