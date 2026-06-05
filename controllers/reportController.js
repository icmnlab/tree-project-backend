const db = require('../config/db');

const EMPTY_REPORT = {
    basicStats: {
        total_trees: 0,
        species_count: 0,
        avg_height: null,
        avg_dbh: null,
        total_carbon_storage: null,
        total_annual_carbon_sequestration: null,
    },
    speciesDiversity: [],
    healthStatus: [],
    dbhDistribution: [],
    projectAnalysis: [],
};

function buildScopedSource(req) {
    if (req.projectFilter != null && req.projectFilter.length === 0) {
        return { empty: true };
    }
    if (req.projectFilter != null) {
        return {
            cte: 'WITH ts AS (SELECT * FROM tree_survey WHERE project_code = ANY($1::text[]))',
            params: [req.projectFilter],
            empty: false,
        };
    }
    return {
        cte: 'WITH ts AS (SELECT * FROM tree_survey)',
        params: [],
        empty: false,
    };
}

// 生成永續報告
exports.generateSustainabilityReport = async (req, res) => {
    try {
        const scope = buildScopedSource(req);
        if (scope.empty) {
            return res.json({
                success: true,
                data: {
                    ...EMPTY_REPORT,
                    generatedAt: new Date().toISOString(),
                },
            });
        }

        const { cte, params } = scope;

        const { rows: basicStatsRows } = await db.query(`
            ${cte}
            SELECT 
                COUNT(*) as total_trees,
                COUNT(DISTINCT species_name) as species_count,
                AVG(tree_height_m) as avg_height,
                AVG(dbh_cm) as avg_dbh,
                SUM(carbon_storage) as total_carbon_storage,
                SUM(carbon_sequestration_per_year) as total_annual_carbon_sequestration
            FROM ts
        `, params);
        const basicStats = basicStatsRows[0];

        const { rows: speciesDiversity } = await db.query(`
            ${cte}
            SELECT 
                species_name,
                COUNT(*) as count,
                (COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM ts), 0)) as percentage
            FROM ts
            WHERE species_name IS NOT NULL AND species_name != ''
            GROUP BY species_name
            ORDER BY count DESC
        `, params);

        const { rows: healthStatus } = await db.query(`
            ${cte}
            SELECT 
                status,
                COUNT(*) as count,
                (COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM ts), 0)) as percentage
            FROM ts
            WHERE status IS NOT NULL AND status != ''
            GROUP BY status
        `, params);

        const { rows: dbhDistribution } = await db.query(`
            ${cte}
            SELECT 
                CASE 
                    WHEN dbh_cm < 10 THEN '小於10公分'
                    WHEN dbh_cm BETWEEN 10 AND 20 THEN '10-20公分'
                    WHEN dbh_cm BETWEEN 20 AND 30 THEN '20-30公分'
                    WHEN dbh_cm BETWEEN 30 AND 40 THEN '30-40公分'
                    ELSE '大於40公分'
                END as dbh_range,
                COUNT(*) as count,
                (COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM ts), 0)) as percentage
            FROM ts
            GROUP BY dbh_range
            ORDER BY MIN(dbh_cm)
        `, params);

        const { rows: projectAnalysis } = await db.query(`
            ${cte}
            SELECT 
                project_location,
                COUNT(*) as tree_count,
                SUM(carbon_storage) as total_carbon,
                SUM(carbon_sequestration_per_year) as annual_carbon
            FROM ts
            WHERE project_location IS NOT NULL AND project_location != ''
            GROUP BY project_location
        `, params);

        res.json({
            success: true,
            data: {
                basicStats,
                speciesDiversity,
                healthStatus,
                dbhDistribution,
                projectAnalysis,
                generatedAt: new Date().toISOString(),
            },
        });

    } catch (error) {
        console.error('Error generating sustainability report:', error);
        res.status(500).json({
            success: false,
            error: '生成永續報告時發生錯誤'
        });
    }
};
