const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { requireRole } = require('../middleware/roleAuth');
const { hasProjectPermission } = require('../middleware/projectAuth');
const cloudinaryService = require('../config/cloudinary');

async function assertOwnerProjectAccess(req, ownerType, ownerId) {
    if (!req.user?.user_id) {
        return { ok: false, status: 401, message: '未授權：請先登入' };
    }
    if (req.user.role === '系統管理員' || req.user.role === '業務管理員') {
        return { ok: true };
    }

    const table = ownerType === 'survey' ? 'tree_survey' : 'pending_tree_measurements';
    const ownerColumns = ownerType === 'pending'
        ? 'project_code, created_by_user_id'
        : 'project_code';
    const { rows } = await db.query(
        `SELECT ${ownerColumns} FROM ${table} WHERE id = $1`,
        [ownerId]
    );
    // [稽核#14] 找不到 owner 列 → 404（原本放行，任何人都可掛圖到不存在的 id）
    if (rows.length === 0) {
        return { ok: false, status: 404, message: '找不到對應的樹木/待測記錄' };
    }
    const projectCode = rows[0].project_code;
    if (!projectCode) {
        // [稽核#14] pending 無 project_code 時改驗建立者（legacy NULL 建立者沿用舊行為放行）
        if (ownerType === 'pending') {
            const creator = rows[0].created_by_user_id;
            if (creator != null && creator !== req.user.user_id) {
                return { ok: false, status: 403, message: '權限不足：僅建立者可操作此記錄的影像' };
            }
        }
        return { ok: true };
    }

    const allowed = await hasProjectPermission(req.user.user_id, projectCode, req.user.role);
    if (!allowed) {
        return { ok: false, status: 403, message: '權限不足：您沒有此專案的存取權限' };
    }
    return { ok: true };
}

async function resolveOwner(treeId, source, metadata, client) {
    const requestedSource = source === 'pending' || source === 'survey' ? source : null;
    let ownerType = requestedSource || 'pending';
    let ownerId = parseInt(treeId, 10) || 0;

    if (source === 'pending' && !isNaN(parseInt(treeId, 10))) {
        const pendingCheck = await client.query('SELECT id FROM pending_tree_measurements WHERE id = $1', [treeId]);
        if (pendingCheck.rows.length > 0) {
            ownerType = 'pending';
            ownerId = parseInt(treeId, 10);
        }
    } else if (source === 'survey' && !isNaN(parseInt(treeId, 10))) {
        const surveyCheck = await client.query('SELECT id FROM tree_survey WHERE id = $1', [treeId]);
        if (surveyCheck.rows.length > 0) {
            ownerType = 'survey';
            ownerId = parseInt(treeId, 10);
        }
    } else if (!isNaN(parseInt(treeId, 10))) {
        const pendingCheck = await client.query('SELECT id FROM pending_tree_measurements WHERE id = $1', [treeId]);
        if (pendingCheck.rows.length > 0) {
            ownerType = 'pending';
            ownerId = parseInt(treeId, 10);
        } else {
            const surveyCheck = await client.query('SELECT id FROM tree_survey WHERE id = $1', [treeId]);
            if (surveyCheck.rows.length > 0) {
                ownerType = 'survey';
                ownerId = parseInt(treeId, 10);
            }
        }
    }

    if (ownerId === 0 && metadata && metadata.task_id) {
        const pendingCheck = await client.query('SELECT id FROM pending_tree_measurements WHERE id = $1', [metadata.task_id]);
        if (pendingCheck.rows.length > 0) {
            ownerType = 'pending';
            ownerId = metadata.task_id;
        }
    }

    return { ownerType, ownerId };
}

/**
 * 上傳樹木影像 — Cloudinary 雲端儲存 + 2NF schema
 * POST /api/tree-images/upload
 */
router.post('/upload', async (req, res) => {
    const { tree_id, image_id, type, captured_at, metadata, image_data, source } = req.body;

    if (!tree_id || !image_data || !type) {
        return res.status(400).json({ success: false, message: '缺少必要參數 (tree_id, image_data, type)' });
    }

    // 檢查 Cloudinary 設定
    if (!cloudinaryService.isConfigured()) {
        return res.status(503).json({
            success: false,
            message: 'Cloudinary 未設定，請在環境變數中配置 CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET',
        });
    }

    const client = await db.pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. 解析 Base64
        const matches = image_data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let buffer;
        if (matches && matches.length === 3) {
            buffer = Buffer.from(matches[2], 'base64');
        } else {
            buffer = Buffer.from(image_data, 'base64');
        }

        const { ownerType, ownerId } = await resolveOwner(tree_id, source, metadata, client);
        const auth = await assertOwnerProjectAccess(req, ownerType, ownerId);
        if (!auth.ok) {
            await client.query('ROLLBACK');
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        // 2. 上傳到 Cloudinary（含縮圖 URL 生成）
        const finalImageId = image_id || uuidv4();
        const cloudResult = await cloudinaryService.uploadWithThumbnail(buffer, {
            folder: `tree_images/${tree_id}`,
            publicId: finalImageId,
        });

        // 3. 插入資料（2NF schema）
        const insertQuery = `
            INSERT INTO tree_images 
            (owner_type, owner_id, image_type, cloud_url, cloud_public_id, thumbnail_url, storage_type, captured_at, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, cloud_url
        `;
        
        const insertValues = [
            ownerType,
            ownerId,
            type,
            cloudResult.url,
            cloudResult.publicId,
            cloudResult.thumbnailUrl,
            'cloudinary',
            captured_at || new Date(),
            metadata || {},
        ];

        const { rows } = await client.query(insertQuery, insertValues);
        const dbId = rows[0].id;

        await client.query('COMMIT');

        res.json({
            success: true,
            message: '影像上傳成功（Cloudinary）',
            id: dbId,
            remote_path: cloudResult.url,        // 前端更新用（完整 Cloudinary URL）
            thumbnail_url: cloudResult.thumbnailUrl,
            cloud_public_id: cloudResult.publicId,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[tree_images] 上傳失敗:', err);
        res.status(500).json({ success: false, message: '影像上傳失敗: ' + err.message });
    } finally {
        client.release();
    }
});

/**
 * 取得影像 URL（重導向到 Cloudinary）
 * GET /api/tree-images/:id
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const query = 'SELECT cloud_url, image_type, storage_type, owner_type, owner_id FROM tree_images WHERE id = $1';
        const { rows } = await db.query(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '找不到影像' });
        }

        const imageRecord = rows[0];
        const auth = await assertOwnerProjectAccess(req, imageRecord.owner_type, imageRecord.owner_id);
        if (!auth.ok) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        // Cloudinary 直接重導向到 CDN URL
        if (imageRecord.cloud_url && imageRecord.cloud_url.startsWith('http')) {
            return res.redirect(imageRecord.cloud_url);
        }

        // Legacy fallback: 本地檔案（舊資料遷移期間）
        const path = require('path');
        const fs = require('fs');
        const uploadsDir = path.resolve(__dirname, '..', 'uploads');
        const absolutePath = path.resolve(__dirname, '..', imageRecord.cloud_url);
        // 防止目錄遍歷攻擊：確保路徑在 uploads 目錄內
        if (!absolutePath.startsWith(uploadsDir)) {
            return res.status(403).json({ success: false, message: '無效的檔案路徑' });
        }
        if (fs.existsSync(absolutePath)) {
            return res.sendFile(absolutePath);
        }

        return res.status(404).json({ success: false, message: '影像檔案遺失' });

    } catch (err) {
        console.error('[tree_images] 讀取失敗:', err);
        res.status(500).json({ success: false, message: '讀取影像失敗' });
    }
});

/**
 * 取得特定樹木的所有影像列表（2NF: owner_type + owner_id）
 * GET /api/tree-images/tree/:treeId?source=pending|survey
 */
router.get('/tree/:treeId', async (req, res) => {
    const { treeId } = req.params;
    const { source } = req.query;

    try {
        if (source === 'pending' || source === 'survey') {
            const auth = await assertOwnerProjectAccess(req, source, parseInt(treeId, 10));
            if (!auth.ok) {
                return res.status(auth.status).json({ success: false, message: auth.message });
            }
        }

        let query;
        let params;

        if (source) {
            // 明確指定 owner_type
            query = `
                SELECT id, image_type, cloud_url, thumbnail_url, captured_at, metadata, created_at 
                FROM tree_images 
                WHERE owner_type = $1 AND owner_id = $2
                ORDER BY captured_at DESC
            `;
            params = [source, treeId];
        } else {
            // 相容模式：查詢所有 owner_type
            query = `
                SELECT id, owner_type, image_type, cloud_url, thumbnail_url, captured_at, metadata, created_at 
                FROM tree_images 
                WHERE owner_id = $1
                ORDER BY captured_at DESC
            `;
            params = [treeId];
        }

        const { rows } = await db.query(query, params);

        const images = rows.map(row => ({
            ...row,
            url: row.cloud_url || `/api/tree-images/${row.id}`,
        }));

        res.json({ success: true, data: images });

    } catch (err) {
        console.error('[tree_images] 列表讀取失敗:', err);
        res.status(500).json({ success: false, message: '讀取列表失敗' });
    }
});

/**
 * 刪除影像 — 需要管理員權限
 * DELETE /api/tree-images/:id
 * 同時從 Cloudinary 和 DB 刪除
 */
router.delete('/:id', requireRole('專案管理員'), async (req, res) => {
    const { id } = req.params;
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // 1. 查詢 cloud_public_id
        const query = 'SELECT cloud_public_id, cloud_url, owner_type, owner_id FROM tree_images WHERE id = $1';
        const { rows } = await client.query(query, [id]);

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: '找不到影像' });
        }

        const auth = await assertOwnerProjectAccess(req, rows[0].owner_type, rows[0].owner_id);
        if (!auth.ok) {
            await client.query('ROLLBACK');
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const { cloud_public_id } = rows[0];

        // 2. 刪除 DB 記錄
        await client.query('DELETE FROM tree_images WHERE id = $1', [id]);

        // 3. 從 Cloudinary 刪除（如果有 public_id）
        if (cloud_public_id && cloudinaryService.isConfigured()) {
            try {
                await cloudinaryService.deleteImage(cloud_public_id);
            } catch (cloudErr) {
                console.warn('[tree_images] Cloudinary 刪除失敗（DB 記錄已刪）:', cloudErr.message);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: '影像已刪除' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[tree_images] 刪除失敗:', err);
        res.status(500).json({ success: false, message: '刪除失敗' });
    } finally {
        client.release();
    }
});

module.exports = router;
