'use strict';

/**
 * 統一決定 pg Pool 的 ssl 設定。
 *
 * - 本機 / CI：設 `DB_SSL=false`（或 `PGSSLMODE=disable`）→ 不使用 SSL，
 *   讓測試可連到沒有 SSL 的本地 Postgres。
 * - 純 host/port（無 DATABASE_URL）：預設不加 SSL。
 * - 雲端託管 DB（有 DATABASE_URL）：預設啟用 SSL；要嚴格驗證憑證時
 *   設 `DB_SSL_REJECT_UNAUTHORIZED=true`。
 *
 * 不設任何環境變數時，行為與舊版（雲端 DATABASE_URL → SSL）一致，
 * 因此正式環境不受影響。
 */
function resolvePgSsl() {
  if (process.env.DB_SSL === 'false' || process.env.PGSSLMODE === 'disable') {
    return false;
  }
  if (!process.env.DATABASE_URL) {
    return false;
  }
  return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' };
}

module.exports = { resolvePgSsl };
