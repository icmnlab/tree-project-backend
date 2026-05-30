require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../config/db');
db.query('SELECT username, role FROM users WHERE is_active = true ORDER BY username')
  .then((r) => { console.log(r.rows); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
