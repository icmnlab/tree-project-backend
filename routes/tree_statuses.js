/**
 * routes/tree_statuses.js — 樹況選單目錄（內建 + 使用者自訂可共享）
 *
 * GET  /tree-statuses        列出可用樹況（供新增／維護量測表單下拉）
 * POST /tree-statuses        新增自訂樹況（調查管理員以上）；多人同時新增同名以 UNIQUE + ON CONFLICT 收斂
 *
 * 是否存活（活立木）依 lifecycle 判定，預設由狀況文字推導（見 utils/treeLifecycle.js）。
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireRole } = require('../middleware/roleAuth');
const AuditLogService = require('../services/auditLogService');
const { lifecycleFromStatus, RETIRED_STATES } = require('../utils/treeLifecycle');

const VALID_LIFECYCLES = new Set(['active', 'dead', 'fallen', 'removed']);

// 列出啟用中的樹況（任何已登入使用者皆可讀，供表單下拉）
router.get('/', async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, name, lifecycle, is_builtin, sort_order
               FROM tree_status_options
              WHERE is_active = TRUE
              ORDER BY sort_order ASC, name ASC`
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('讀取樹況選單錯誤:', err);
        res.status(500).json({ success: false, message: '讀取樹況選單時發生錯誤' });
    }
});

// 新增自訂樹況（調查管理員以上）。lifecycle 未提供時由狀況文字推導；可由前端傳入覆寫。
router.post('/', requireRole('調查管理員'), async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
        return res.status(400).json({ success: false, message: '狀況名稱不能為空' });
    }
    if (name.length > 50) {
        return res.status(400).json({ success: false, message: '狀況名稱請勿超過 50 字' });
    }
    let lifecycle = String(req.body?.lifecycle || '').trim();
    if (lifecycle && !VALID_LIFECYCLES.has(lifecycle)) {
        return res.status(400).json({ success: false, message: 'lifecycle 必須為 active/dead/fallen/removed' });
    }
    if (!lifecycle) {
        lifecycle = lifecycleFromStatus(name) || 'active';
    }
    try {
        // 多人同時新增同名：UNIQUE(name) + ON CONFLICT 收斂；一律回傳目前資料庫中的那一筆
        const { rows } = await db.query(
            `INSERT INTO tree_status_options (name, lifecycle, is_builtin, created_by)
             VALUES ($1, $2, FALSE, $3)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id, name, lifecycle, is_builtin, sort_order,
                       (xmax = 0) AS inserted`,
            [name, lifecycle, req.user?.user_id || null]
        );
        const row = rows[0];
        const created = row.inserted === true;
        delete row.inserted;
        if (created) {
            await AuditLogService.log({
                userId: req.user?.user_id,
                username: req.user?.username,
                action: 'CREATE_TREE_STATUS',
                resourceType: 'tree_status_options',
                resourceId: row.id,
                details: { name: row.name, lifecycle: row.lifecycle },
                req,
            });
        }
        res.status(created ? 201 : 200).json({ success: true, data: row, created });
    } catch (err) {
        console.error('新增樹況錯誤:', err);
        res.status(500).json({ success: false, message: '新增樹況時發生錯誤' });
    }
});

module.exports = router;
