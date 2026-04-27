const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { 
    cleanupUnusedProjectAreas, 
    cleanupUnusedSpecies, 
    cleanupOrphanedPlaceholders,
    cleanupOldChatLogs // 引入新的清理函式
} = require('../utils/cleanup');
const { requireRole } = require('../middleware/roleAuth');
const { resolveCountyByLngLat } = require('../utils/geo');

// 縣市判斷一律使用 utils/geo.js (內政部 1140318 官方界線 + turf point-in-polygon)
// 該 helper 會回傳官方 COUNTYNAME (含「市/縣」尾綴), 不需自行貼後綴


// 取得專案區位列表
router.get('/', async (req, res) => {
    const { city } = req.query;
    let query = 'SELECT * FROM project_areas';
    const params = [];

    if (city) {
        if (city.endsWith('市') || city.endsWith('縣')) {
            query += ' WHERE city = $1';
            params.push(city);
        } else {
            query += ' WHERE city = $1 OR city = $2';
            params.push(city + '市', city + '縣');
        }
    }
    query += ' ORDER BY area_code ASC';

    try {
        const { rows } = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('查詢區位時發生錯誤:', err);
        res.status(500).json({ success: false, message: '查詢區位時發生錯誤' });
    }
});

// 新增專案區位 (專案管理員以上)
router.post('/', requireRole('專案管理員'), async (req, res) => {
    const { area_name, description, city, xCoord, yCoord, isSubmit } = req.body;
    if (!area_name) {
        return res.status(400).json({ success: false, message: '區位名稱不能為空' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: existingAreas } = await client.query('SELECT area_code, city FROM project_areas WHERE area_name = $1', [area_name]);
        if (existingAreas.length > 0) {
            // 區位已存在，直接返回資訊
            await client.query('ROLLBACK');
            return res.status(200).json({ 
                success: true, 
                message: "區位已存在",
                data: { area_name, area_code: existingAreas[0].area_code, description, city: existingAreas[0].city }
            });
        }

        // 使用 Advisory Lock (Key 3) 確保區位代碼生成的原子性
        await client.query('SELECT pg_advisory_xact_lock(3)');

        const { rows: allAreas } = await client.query('SELECT area_code FROM project_areas');
        const usedNumbers = new Set(allAreas.map(row => {
            const match = row.area_code && row.area_code.match(/^AREA-(\d{3})$/);
            return match ? parseInt(match[1], 10) : null;
        }).filter(n => n !== null));
        
        let nextNum = 1;
        while (usedNumbers.has(nextNum)) {
            nextNum++;
        }
        const nextCode = `AREA-${String(nextNum).padStart(3, '0')}`;

        let finalCity = city;
        if (isSubmit && yCoord && xCoord) {
            const lng = parseFloat(xCoord);
            const lat = parseFloat(yCoord);
            const detected = resolveCountyByLngLat(lng, lat);
            if (detected && detected.name) {
                // 官方 COUNTYNAME 已含「市/縣」, 直接使用 (例: 嘉義縣 / 台南市)
                finalCity = detected.name;
            }
        }

        const { rows: insertResult } = await client.query(
            'INSERT INTO project_areas (area_name, area_code, description, city) VALUES ($1, $2, $3, $4) RETURNING id',
            [area_name, nextCode, description, finalCity]
        );

        await client.query('COMMIT');
        res.status(201).json({ success: true, data: { id: insertResult[0].id, area_name, area_code: nextCode, description, city: finalCity } });

    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ success: false, message: '區位名稱或代碼已存在' });
        }
        console.error('新增區位時發生錯誤:', err);
        res.status(500).json({ success: false, message: '新增區位時發生錯誤' });
    } finally {
        client.release();
    }
});

// 修改專案區位 (專案管理員以上)
router.put('/:id', requireRole('專案管理員'), async (req, res) => {
    const { id } = req.params;
    const { area_name, area_code, description } = req.body;
    if (!area_name || !area_code) {
        return res.status(400).json({ success: false, message: '請提供區位名稱與代碼' });
    }
    try {
        const { rowCount } = await db.query('UPDATE project_areas SET area_name = $1, area_code = $2, description = $3 WHERE id = $4', [area_name, area_code, description || null, id]);
        if (rowCount > 0) {
            res.status(200).json({ success: true, message: '區位更新成功' });
        } else {
            res.status(404).json({ success: false, message: '找不到要更新的區位' });
        }
    } catch (err) {
        console.error('更新區位錯誤:', err);
        res.status(500).json({ success: false, message: '更新區位失敗' });
    }
});

// 刪除專案區位 — 專案管理員以上
router.delete('/:id', requireRole('專案管理員'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rowCount } = await db.query('DELETE FROM project_areas WHERE id = $1', [id]);
        if (rowCount > 0) {
            res.status(200).json({ success: true, message: '區位刪除成功' });
        } else {
            res.status(404).json({ success: false, message: '找不到要刪除的區位' });
        }
    } catch (err) {
        console.error('刪除區位錯誤:', err);
        res.status(500).json({ success: false, message: '刪除區位失敗' });
    }
});

// 依座標查縣市 — 任何登入使用者都可呼叫
// GET /api/project_areas/county_by_coords?lng=120.1666&lat=23.3778
router.get('/county_by_coords', (req, res) => {
    const lng = parseFloat(req.query.lng);
    const lat = parseFloat(req.query.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return res.status(400).json({ success: false, message: 'lng/lat 必填且須為數字' });
    }
    const r = resolveCountyByLngLat(lng, lat);
    if (!r) {
        return res.status(200).json({ success: true, data: null, message: '座標不在台灣縣市範圍內' });
    }
    res.json({ success: true, data: r });
});


// 手動觸發清理 — 系統管理員專用
router.post('/cleanup', requireRole('系統管理員'), async (req, res) => {
    try {
        console.log('[API] Manual cleanup process triggered.');
        // 呼叫所有清理函式
        await cleanupOrphanedPlaceholders();
        await cleanupUnusedSpecies();
        await cleanupUnusedProjectAreas();
        await cleanupOldChatLogs(); // 執行聊天記錄清理
        
        console.log('[API] Manual cleanup process finished successfully.');
        res.json({
            success: true,
            message: '手動清理完成',
        });
    } catch (err) {
        console.error('手動觸發清理失敗:', err);
        res.status(500).json({ success: false, message: '清理失敗' });
    }
});


module.exports = router;
