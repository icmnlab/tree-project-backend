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
const { resolveAreaCity, normalizeCityCandidates, matchCity } = require('../utils/county');

// 縣市判斷一律使用 utils/county.js (內政部 1140318 官方界線 + turf point-in-polygon)
// 該 helper 會回傳官方 COUNTYNAME (含「市/縣」尾綴), 不需自行貌後綴

// 由座標推算 city；解析失敗回傳 fallbackCity (使用者手動指定的)。
// POST / PUT 共用，避免座標 → city 轉換邏輯重複。
function recomputeCityFromCoords({ xCoord, yCoord, fallbackCity }) {
    if (xCoord === undefined || xCoord === null || yCoord === undefined || yCoord === null) {
        return fallbackCity;
    }
    const lng = parseFloat(xCoord);
    const lat = parseFloat(yCoord);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return fallbackCity;
    const detected = resolveCountyByLngLat(lng, lat);
    return (detected && detected.name) ? detected.name : fallbackCity;
}


// 取得專案區位列表
// [Stage 1 commit 2] city 過濾改走 utils/county.resolveAreaCity：
//   1. 對每筆樹以座標 + project_location 一起送進 helper (座標優先，名稱為 fallback)
//   2. 聚合到 area → 該區位「真實樹木所在縣市」集合
//   3. 若 area 沒有任何樹 → fallback 到 project_areas.city 欄位 (denormalized cache)
//   4. 回傳所有「該縣市集合包含 city」或 fallback 命中的 area
router.get('/', async (req, res) => {
    const { city } = req.query;

    try {
        const { rows: areas } = await db.query('SELECT * FROM project_areas ORDER BY area_code ASC');

        if (!city) {
            return res.json({ success: true, data: areas });
        }

        // 將輸入 city 標準化為候選（'花蔣' → ['花蔣市','花蔣縣']）
        const cityCandidates = normalizeCityCandidates(city);

        // 從樹木表收集 area → resolved cities 對映
        const { rows: trees } = await db.query(`
            SELECT project_location, x_coord, y_coord
            FROM tree_survey
            WHERE project_location IS NOT NULL AND project_location != ''
              AND is_placeholder IS NOT TRUE
        `);

        const areaToCities = new Map(); // area_name → Set<countyName>
        for (const t of trees) {
            const detected = resolveAreaCity({
                lng: t.x_coord,
                lat: t.y_coord,
                areaName: t.project_location,
            });
            if (!detected) continue;
            if (!areaToCities.has(t.project_location)) {
                areaToCities.set(t.project_location, new Set());
            }
            areaToCities.get(t.project_location).add(detected);
        }

        const filtered = areas.filter(a => {
            const cities = areaToCities.get(a.area_name);
            if (cities && cities.size > 0) {
                // 有樹 → 必須樹的縣市命中
                return cityCandidates.some(c => cities.has(c));
            }
            // 無樹 → fallback 到 area.city 欄位
            return matchCity(a.city, city);
        });

        res.json({ success: true, data: filtered });
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
            finalCity = recomputeCityFromCoords({ xCoord, yCoord, fallbackCity: city });
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
// 支援 xCoord/yCoord：若有提供，重新計算 city (POST 邏輯一致)
// 若 caller 同時送 city，座標解析失敗時 fallback 用 caller 指定的 city
router.put('/:id', requireRole('專案管理員'), async (req, res) => {
    const { id } = req.params;
    const { area_name, area_code, description, xCoord, yCoord, city } = req.body;
    if (!area_name || !area_code) {
        return res.status(400).json({ success: false, message: '請提供區位名稱與代碼' });
    }
    try {
        // 讀現有 row 取得 fallback city (caller 沒送 city 時用 DB 原值)
        const { rows: existing } = await db.query('SELECT city FROM project_areas WHERE id = $1', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: '找不到要更新的區位' });
        }
        const fallbackCity = (city !== undefined && city !== null) ? city : existing[0].city;
        const finalCity = (xCoord !== undefined && yCoord !== undefined)
            ? recomputeCityFromCoords({ xCoord, yCoord, fallbackCity })
            : fallbackCity;

        const { rowCount } = await db.query(
            'UPDATE project_areas SET area_name = $1, area_code = $2, description = $3, city = $4 WHERE id = $5',
            [area_name, area_code, description || null, finalCity, id]
        );
        if (rowCount > 0) {
            res.status(200).json({ success: true, message: '區位更新成功', data: { id, area_name, area_code, description, city: finalCity } });
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
