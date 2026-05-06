/**
 * Research Dataset — 研究用 DBH 校準資料蒐集 API
 *
 * 用途：管理員以捲尺實測「樹幹周長」+「拍攝距離」並上傳 1~3 張手機照，
 *      作為 (1) 距離偏差線性校正 α,β 擬合；(2) leakage-free 評估集 的乾淨樣本。
 *
 * 權限：全部 endpoint 皆需「系統管理員」JWT。
 *
 * Photos 走 Cloudinary（與 tree_images 一致），不存本機。
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { requireRole } = require('../middleware/roleAuth');
const cloudinaryService = require('../config/cloudinary');

// 共用：將 base64 上傳 Cloudinary，回傳 URL
async function uploadOne(base64, treeId, suffix) {
    const matches = String(base64).match(/^data:([A-Za-z\-+\/]+);base64,(.+)$/);
    const buffer = matches
        ? Buffer.from(matches[2], 'base64')
        : Buffer.from(base64, 'base64');
    const result = await cloudinaryService.uploadWithThumbnail(buffer, {
        folder: `research_dataset/${treeId}`,
        publicId: `${suffix}_${uuidv4()}`,
    });
    return result.url;
}

/**
 * POST /api/research-dataset
 * Body: {
 *   tree_id, circumference_cm, capture_distance_m,
 *   species?, phone_model?, focal_length_px?,
 *   image_width_px?, image_height_px?,
 *   gps_lat?, gps_lng?, notes?,
 *   photos: [base64, ...]  // 1~3 張
 *   evidence_photo?: base64
 * }
 */
router.post('/', requireRole('系統管理員'), async (req, res) => {
    const {
        tree_id,
        circumference_cm,
        capture_distance_m,
        species,
        phone_model,
        focal_length_px,
        image_width_px,
        image_height_px,
        gps_lat,
        gps_lng,
        notes,
        photos,
        evidence_photo,
    } = req.body || {};

    // ---- 必填驗證 ----
    if (!tree_id || typeof tree_id !== 'string') {
        return res.status(400).json({ success: false, message: '缺少 tree_id' });
    }
    const circ = Number(circumference_cm);
    const dist = Number(capture_distance_m);
    if (!Number.isFinite(circ) || circ <= 0) {
        return res.status(400).json({ success: false, message: 'circumference_cm 必須 > 0' });
    }
    if (!Number.isFinite(dist) || dist <= 0) {
        return res.status(400).json({ success: false, message: 'capture_distance_m 必須 > 0' });
    }
    if (!Array.isArray(photos) || photos.length < 1 || photos.length > 3) {
        return res.status(400).json({ success: false, message: 'photos 需 1~3 張 base64' });
    }
    if (!cloudinaryService.isConfigured()) {
        return res.status(503).json({
            success: false,
            message: 'Cloudinary 未設定，無法儲存照片',
        });
    }

    try {
        // ---- 上傳照片 ----
        const photoUrls = [];
        for (let i = 0; i < photos.length; i++) {
            const url = await uploadOne(photos[i], tree_id, `main_${i + 1}`);
            photoUrls.push(url);
        }
        let evidenceUrl = null;
        if (evidence_photo) {
            evidenceUrl = await uploadOne(evidence_photo, tree_id, 'evidence');
        }

        // ---- 寫 DB ----
        const insertSql = `
            INSERT INTO research_dataset (
                tree_id, circumference_cm, capture_distance_m,
                species, phone_model, focal_length_px,
                image_width_px, image_height_px,
                gps_lat, gps_lng, notes,
                photo_urls, evidence_photo_url, created_by
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING id, true_dbh_cm, created_at
        `;
        const values = [
            tree_id,
            circ,
            dist,
            species || null,
            phone_model || null,
            Number.isFinite(Number(focal_length_px)) ? Number(focal_length_px) : null,
            Number.isFinite(Number(image_width_px)) ? Math.round(Number(image_width_px)) : null,
            Number.isFinite(Number(image_height_px)) ? Math.round(Number(image_height_px)) : null,
            Number.isFinite(Number(gps_lat)) ? Number(gps_lat) : null,
            Number.isFinite(Number(gps_lng)) ? Number(gps_lng) : null,
            notes || null,
            photoUrls,
            evidenceUrl,
            req.user && req.user.user_id ? req.user.user_id : null,
        ];
        const { rows } = await db.query(insertSql, values);
        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('[research_dataset] 建立失敗:', err);
        return res.status(500).json({ success: false, message: '建立失敗: ' + err.message });
    }
});

/**
 * GET /api/research-dataset
 * 列出全部，預設按 created_at DESC
 */
router.get('/', requireRole('系統管理員'), async (_req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT id, tree_id, circumference_cm, true_dbh_cm,
                   capture_distance_m, species, phone_model,
                   focal_length_px, image_width_px, image_height_px,
                   gps_lat, gps_lng, notes,
                   photo_urls, evidence_photo_url,
                   created_at, created_by
            FROM research_dataset
            ORDER BY created_at DESC
        `);
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('[research_dataset] 列表失敗:', err);
        return res.status(500).json({ success: false, message: '列表失敗' });
    }
});

/**
 * DELETE /api/research-dataset/:id
 * 注意：不會主動刪 Cloudinary 圖（保險起見保留 raw evidence；
 *       後續若需 GC 可再寫 batch script）。
 */
router.delete('/:id', requireRole('系統管理員'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ success: false, message: 'id 不合法' });
    }
    try {
        const { rowCount } = await db.query('DELETE FROM research_dataset WHERE id = $1', [id]);
        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: '找不到資料' });
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('[research_dataset] 刪除失敗:', err);
        return res.status(500).json({ success: false, message: '刪除失敗' });
    }
});

/**
 * GET /api/research-dataset/export.csv
 * 匯出全部紀錄為 UTF-8 BOM CSV（給 benchmark / 試算表）
 */
router.get('/export.csv', requireRole('系統管理員'), async (_req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT id, tree_id, circumference_cm, true_dbh_cm,
                   capture_distance_m, species, phone_model,
                   focal_length_px, image_width_px, image_height_px,
                   gps_lat, gps_lng, notes,
                   photo_urls, evidence_photo_url,
                   created_at, created_by
            FROM research_dataset
            ORDER BY created_at ASC
        `);

        const header = [
            'id', 'tree_id', 'circumference_cm', 'true_dbh_cm',
            'capture_distance_m', 'species', 'phone_model',
            'focal_length_px', 'image_width_px', 'image_height_px',
            'gps_lat', 'gps_lng', 'notes',
            'photo_url_1', 'photo_url_2', 'photo_url_3',
            'evidence_photo_url', 'created_at', 'created_by',
        ];

        const csvEscape = (v) => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
            return s;
        };

        const lines = [header.join(',')];
        for (const r of rows) {
            const photos = Array.isArray(r.photo_urls) ? r.photo_urls : [];
            lines.push([
                r.id, r.tree_id, r.circumference_cm, r.true_dbh_cm,
                r.capture_distance_m, r.species, r.phone_model,
                r.focal_length_px, r.image_width_px, r.image_height_px,
                r.gps_lat, r.gps_lng, r.notes,
                photos[0] || '', photos[1] || '', photos[2] || '',
                r.evidence_photo_url, r.created_at && r.created_at.toISOString
                    ? r.created_at.toISOString() : r.created_at,
                r.created_by,
            ].map(csvEscape).join(','));
        }

        const body = '\uFEFF' + lines.join('\n');
        const fname = `research_dataset_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        return res.send(body);
    } catch (err) {
        console.error('[research_dataset] 匯出失敗:', err);
        return res.status(500).json({ success: false, message: '匯出失敗' });
    }
});

module.exports = router;
