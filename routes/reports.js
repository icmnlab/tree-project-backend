const express = require('express');
const router = express.Router();
const db = require('../config/db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const format = require('pg-format');
const reportController = require('../controllers/reportController');
const { projectAuthFilter } = require('../middleware/projectAuth');
const { requireRole } = require('../middleware/roleAuth');

// 匯出 Excel (依使用者權限過濾專案)
router.get('/export/excel', requireRole('調查管理員'), projectAuthFilter, async (req, res) => {
    const { project_codes } = req.query;
    let sql = 'SELECT * FROM tree_survey';
    const params = [];
    const conditions = [];

    // 依使用者權限過濾
    if (req.projectFilter) {
        if (req.projectFilter.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }
        // 如果使用者指定了 project_codes，取交集
        if (project_codes) {
            const requestedCodes = project_codes.split(',').map(code => code.trim()).filter(code => code);
            const allowedCodes = requestedCodes.filter(code => req.projectFilter.includes(code));
            if (allowedCodes.length === 0) {
                return res.status(200).json({ success: true, data: [] });
            }
            conditions.push(format('project_code IN (%L)', allowedCodes));
        } else {
            conditions.push(format('project_code IN (%L)', req.projectFilter));
        }
    } else if (project_codes) {
        const codesArray = project_codes.split(',').map(code => code.trim()).filter(code => code);
        if (codesArray.length > 0) {
            conditions.push(format('project_code IN (%L)', codesArray));
        }
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }

    try {
        const { rows } = await db.query(sql, params);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('樹木調查資料');

        worksheet.columns = [
            { header: '專案區位', key: 'project_location' },
            { header: '專案代碼', key: 'project_code' },
            { header: '專案名稱', key: 'project_name' },
            { header: '系統樹木', key: 'system_tree_id' },
            { header: '專案樹木', key: 'project_tree_id' },
            { header: '樹種編號', key: 'species_id' },
            { header: '樹種名稱', key: 'species_name' },
            { header: 'X坐標', key: 'x_coord' },
            { header: 'Y坐標', key: 'y_coord' },
            { header: '狀況', key: 'status' },
            { header: '註記', key: 'notes' },
            { header: '樹木備註', key: 'tree_notes' },
            { header: '樹高（公尺）', key: 'tree_height_m' },
            { header: '胸徑（公分）', key: 'dbh_cm' },
            { header: '調查備註', key: 'survey_notes' },
            { header: '調查時間', key: 'survey_time' },
            { header: '碳儲存量', key: 'carbon_storage' },
            { header: '推估年碳吸存量', key: 'carbon_sequestration_per_year' }
        ];

        worksheet.addRows(rows);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `tree_survey_export_${timestamp}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('匯出 Excel 錯誤:', err);
        res.status(500).json({ success: false, message: '匯出 Excel 時發生錯誤' });
    }
});

// 匯出 PDF (依使用者權限過濾專案)
router.get('/export/pdf', requireRole('調查管理員'), projectAuthFilter, async (req, res) => {
    const { project_codes } = req.query;
    let sql = 'SELECT * FROM tree_survey';
    const conditions = [];

    // 依使用者權限過濾
    if (req.projectFilter) {
        if (req.projectFilter.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }
        if (project_codes) {
            const requestedCodes = project_codes.split(',').map(code => code.trim()).filter(code => code);
            const allowedCodes = requestedCodes.filter(code => req.projectFilter.includes(code));
            if (allowedCodes.length === 0) {
                return res.status(200).json({ success: true, data: [] });
            }
            conditions.push(format('project_code IN (%L)', allowedCodes));
        } else {
            conditions.push(format('project_code IN (%L)', req.projectFilter));
        }
    } else if (project_codes) {
        const codesArray = project_codes.split(',').map(code => code.trim()).filter(code => code);
        if (codesArray.length > 0) {
            conditions.push(format('project_code IN (%L)', codesArray));
        }
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }

    try {
        const { rows } = await db.query(sql);
        const doc = new PDFDocument({ margin: 30, size: 'A4' });

        const fontPath = path.join(__dirname, '../Noto_Sans_TC/static/NotoSansTC-Regular.ttf');
        if (fs.existsSync(fontPath)) {
            doc.font(fontPath);
        } else {
            console.error('中文字型檔案未找到:', fontPath);
            // Fallback to standard font if custom font fails (Chinese will still be garbled but at least it runs)
            console.warn('使用系統預設字型 (中文將無法顯示)');
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `tree_survey_export_${timestamp}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        doc.pipe(res);

        doc.fontSize(20).text('樹木調查資料', { align: 'center' });
        doc.moveDown();

        rows.forEach((tree, index) => {
            doc.fontSize(12).text(`資料 ${index + 1}:`, { underline: true });
            const treeDetails = [
                `專案區位: ${tree.project_location || 'N/A'}`,
                `專案代碼: ${tree.project_code || 'N/A'}`,
                `專案名稱: ${tree.project_name || 'N/A'}`,
                `樹種名稱: ${tree.species_name || 'N/A'}`,
                `樹高: ${tree.tree_height_m || 0} 公尺`,
                `胸徑: ${tree.dbh_cm || 0} 公分`,
                `狀況: ${tree.status || 'N/A'}`
            ];
            doc.fontSize(10).list(treeDetails, { bulletRadius: 2 });
            doc.moveDown();
        });

        doc.end();
    } catch (err) {
        console.error('匯出 PDF 錯誤:', err);
        res.status(500).json({ success: false, message: '匯出 PDF 時發生錯誤' });
    }
});

// 簡易永續報告 (調查管理員以上)
router.get('/sustainability_report', requireRole('調查管理員'), projectAuthFilter, reportController.generateSustainabilityReport);


// ... (AI 報告路由將在 ai.js 中處理) ...


module.exports = router;
