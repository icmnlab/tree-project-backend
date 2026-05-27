require('dotenv').config();
const db = require('../config/db');

(async () => {
  const col = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'pending_approval'
  `);
  console.log('pending_approval column:', col.rows.length > 0 ? 'yes' : 'NO');

  const users = await db.query(`
    SELECT user_id, username, is_active, pending_approval, created_at
    FROM users
    WHERE pending_approval = true OR is_active = false
    ORDER BY created_at DESC NULLS LAST
    LIMIT 15
  `);
  console.log('inactive/pending users:', JSON.stringify(users.rows, null, 2));

  const invites = await db.query(`
    SELECT invite_id, code, requires_approval, use_count, max_uses, is_active
    FROM registration_invites
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('recent invites:', JSON.stringify(invites.rows, null, 2));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
