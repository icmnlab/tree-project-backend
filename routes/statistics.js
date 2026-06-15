const express = require('express');
const router = express.Router();
const db = require('../config/db');
const format = require('pg-format');
const { projectAuthFilter } = require('../middleware/projectAuth');

// 樹木資料統計分析 (依使用者權限過濾專案)
router.get('/', projectAuthFilter, async (req, res) => {
    // 建立基礎過濾條件
    const conditions = [];
    
    if (req.projectFilter) {
        if (req.projectFilter.length === 0) {
            return res.json({
                success: true,
                data: { species: [], projects: [], areas: [], sizes: null, carbon: null, retired: { total: 0, by_status: [] } }
            });
        }
        conditions.push(format('project_code IN (%L)', req.projectFilter));
    }

    if (req.query.areas) {
        const areasList = req.query.areas.split(',').map(area => area.trim()).filter(area => area);
        if (areasList.length > 0) {
            conditions.push(format('project_location IN (%L)', areasList));
        }
    }

    // [生命週期] 活立木生物量法：碳儲量與「在庫」統計僅計入存活樹（lifecycle_status='active'）；
    // 淘汰木（枯死/倒塌/移除）單獨統計，不併入活立木碳儲總計。
    const activeConditions = [...conditions, "(lifecycle_status = 'active')"];
    const retiredConditions = [...conditions, "(lifecycle_status <> 'active')"];

    const whereClause = 'WHERE ' + activeConditions.join(' AND ');
    const andClause = 'AND ' + activeConditions.join(' AND ');
    const whereRetired = 'WHERE ' + retiredConditions.join(' AND ');

    const client = await db.pool.connect();
    try {
        const speciesQuery = `
            SELECT species_name AS "樹種名稱", COUNT(*) as count 
            FROM tree_survey 
            ${whereClause}
            GROUP BY "樹種名稱" 
            ORDER BY count DESC
        `;

        const projectQuery = `
            SELECT project_name AS "專案名稱", COUNT(*) as count 
            FROM tree_survey 
            ${whereClause}
            GROUP BY "專案名稱" 
            ORDER BY count DESC
        `;

        const areaQuery = `
            SELECT project_location AS "專案區位", COUNT(*) as count 
            FROM tree_survey 
            ${whereClause}
            GROUP BY "專案區位" 
            ORDER BY count DESC
        `;

        const sizeQuery = `
            SELECT 
                AVG(tree_height_m) as avg_height,
                MAX(tree_height_m) as max_height,
                MIN(tree_height_m) as min_height,
                AVG(dbh_cm) as avg_dbh,
                MAX(dbh_cm) as max_dbh,
                MIN(dbh_cm) as min_dbh
            FROM tree_survey
            WHERE tree_height_m > 0 AND dbh_cm > 0 ${andClause}
        `;

        const carbonQuery = `
            SELECT 
                SUM(carbon_storage) as total_carbon,
                AVG(carbon_storage) as avg_carbon,
                SUM(carbon_sequestration_per_year) as total_annual_carbon,
                AVG(carbon_sequestration_per_year) as avg_annual_carbon
            FROM tree_survey
            ${whereClause}
        `;

        // 淘汰木統計：依生命週期狀態分組計數（供報表呈現「已淘汰」概況）
        const retiredQuery = `
            SELECT lifecycle_status, COUNT(*) as count,
                   SUM(carbon_storage) as last_carbon
            FROM tree_survey
            ${whereRetired}
            GROUP BY lifecycle_status
        `;

        const [speciesRes, projectRes, areaRes, sizeRes, carbonRes, retiredRes] = await Promise.all([
            client.query(speciesQuery),
            client.query(projectQuery),
            client.query(areaQuery),
            client.query(sizeQuery),
            client.query(carbonQuery),
            client.query(retiredQuery)
        ]);

        const retiredTotal = retiredRes.rows.reduce((sum, r) => sum + Number(r.count || 0), 0);

        res.json({
            success: true,
            data: {
                species: speciesRes.rows,
                projects: projectRes.rows,
                areas: areaRes.rows,
                sizes: sizeRes.rows[0],
                carbon: carbonRes.rows[0],
                retired: {
                    total: retiredTotal,
                    by_status: retiredRes.rows
                }
            }
        });

    } catch (err) {
        console.error('統計查詢錯誤:', err);
        res.status(500).json({ success: false, message: '取得統計資料時發生錯誤' });
    } finally {
        client.release();
    }
});

module.exports = router;
