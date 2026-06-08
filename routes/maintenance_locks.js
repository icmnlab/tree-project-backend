/**
 * 維護量測樹木互斥鎖（Phase A）
 *
 * GET    /api/maintenance-locks?project_code=
 * POST   /api/maintenance-locks/:treeId  { session_hint? }
 * DELETE /api/maintenance-locks/:treeId
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { projectAuthFilter } = require('../middleware/projectAuth');

const LOCK_TTL_MINUTES = 45;

async function purgeExpired(client) {
  await client.query(
    'DELETE FROM maintenance_tree_locks WHERE expires_at <= now()'
  );
}

async function getTreeProjectCode(client, treeId) {
  const res = await client.query(
    'SELECT id, project_code FROM tree_survey WHERE id = $1',
    [treeId]
  );
  return res.rows[0] || null;
}

function lockBlockedResponse(existing, selfUserId) {
  if (existing.user_id === selfUserId) {
    return null;
  }
  return {
    success: false,
    code: 'LOCKED',
    message: `${existing.display_name || '其他使用者'} 正在重測此樹`,
    lock: {
      tree_id: existing.tree_id,
      user_id: existing.user_id,
      display_name: existing.display_name,
      locked_at: existing.locked_at,
      expires_at: existing.expires_at,
      session_hint: existing.session_hint,
    },
  };
}

/** GET — 專案／區內有效鎖定清單 */
router.get('/', projectAuthFilter, async (req, res) => {
  const projectCode = (req.query.project_code || '').toString().trim();
  if (!projectCode) {
    return res.status(400).json({ success: false, message: '請提供 project_code' });
  }
  if (req.projectFilter != null && !req.projectFilter.includes(projectCode)) {
    return res.status(403).json({ success: false, message: '無此專案權限' });
  }
  try {
    await purgeExpired(db);
    const { rows } = await db.query(
      `SELECT tree_id, user_id, display_name, project_code, session_hint,
              locked_at, expires_at
       FROM maintenance_tree_locks
       WHERE project_code = $1 AND expires_at > now()
       ORDER BY locked_at DESC`,
      [projectCode]
    );
    res.json({ success: true, locks: rows });
  } catch (err) {
    console.error('[maintenance-locks] list failed:', err);
    res.status(500).json({ success: false, message: '查詢鎖定失敗' });
  }
});

/** POST — 取得或延長鎖（同 user 可重入） */
router.post('/:treeId', projectAuthFilter, async (req, res) => {
  const treeId = parseInt(req.params.treeId, 10);
  if (!Number.isFinite(treeId)) {
    return res.status(400).json({ success: false, message: '無效的 tree_id' });
  }
  const userId = req.user?.user_id;
  if (!userId) {
    return res.status(401).json({ success: false, message: '未登入' });
  }
  const sessionHint = (req.body?.session_hint || '').toString().slice(0, 200) || null;
  const displayName =
    req.user.display_name || req.user.username || `user-${userId}`;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await purgeExpired(client);

    const tree = await getTreeProjectCode(client, treeId);
    if (!tree) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: '找不到樹木' });
    }
    if (req.projectFilter != null && !req.projectFilter.includes(tree.project_code)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: '無此樹木專案權限' });
    }

    const existingRes = await client.query(
      'SELECT * FROM maintenance_tree_locks WHERE tree_id = $1 FOR UPDATE',
      [treeId]
    );
    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      if (existing.expires_at <= new Date()) {
        await client.query('DELETE FROM maintenance_tree_locks WHERE tree_id = $1', [
          treeId,
        ]);
      } else {
        const blocked = lockBlockedResponse(existing, userId);
        if (blocked) {
          await client.query('ROLLBACK');
          return res.status(409).json(blocked);
        }
        const upd = await client.query(
          `UPDATE maintenance_tree_locks
           SET expires_at = now() + ($2 || ' minutes')::interval,
               session_hint = COALESCE($3, session_hint),
               display_name = $4
           WHERE tree_id = $1
           RETURNING *`,
          [treeId, LOCK_TTL_MINUTES, sessionHint, displayName]
        );
        await client.query('COMMIT');
        return res.json({ success: true, lock: upd.rows[0], renewed: true });
      }
    }

    const ins = await client.query(
      `INSERT INTO maintenance_tree_locks
         (tree_id, user_id, display_name, project_code, session_hint, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)
       RETURNING *`,
      [treeId, userId, displayName, tree.project_code, sessionHint, LOCK_TTL_MINUTES]
    );
    await client.query('COMMIT');
    res.json({ success: true, lock: ins.rows[0], renewed: false });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[maintenance-locks] acquire failed:', err);
    res.status(500).json({ success: false, message: '取得鎖定失敗' });
  } finally {
    client.release();
  }
});

/** DELETE — 釋放鎖（僅持有者或管理員） */
router.delete('/:treeId', projectAuthFilter, async (req, res) => {
  const treeId = parseInt(req.params.treeId, 10);
  if (!Number.isFinite(treeId)) {
    return res.status(400).json({ success: false, message: '無效的 tree_id' });
  }
  const userId = req.user?.user_id;
  const role = req.user?.role;
  const isAdmin = role === '系統管理員' || role === '業務管理員';

  try {
    await purgeExpired(db);
    const { rows } = await db.query(
      'SELECT * FROM maintenance_tree_locks WHERE tree_id = $1',
      [treeId]
    );
    if (rows.length === 0) {
      return res.json({ success: true, message: '無鎖定或已過期' });
    }
    const lock = rows[0];
    if (!isAdmin && lock.user_id !== userId) {
      return res.status(403).json({ success: false, message: '無法釋放他人鎖定' });
    }
    await db.query('DELETE FROM maintenance_tree_locks WHERE tree_id = $1', [treeId]);
    res.json({ success: true, message: '已釋放鎖定' });
  } catch (err) {
    console.error('[maintenance-locks] release failed:', err);
    res.status(500).json({ success: false, message: '釋放鎖定失敗' });
  }
});

module.exports = router;
