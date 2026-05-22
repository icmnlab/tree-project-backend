/**
 * Agent 匯出工具：寫入 exports/ 並回傳下載連結（不修改資料庫）
 */
const fs = require('fs');
const path = require('path');
const format = require('pg-format');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../config/db');
const { getUserProjects } = require('../middleware/projectAuth');
const aiReportController = require('../controllers/aiReportController');

const EXPORT_DIR = path.join(__dirname, '..', 'exports');
const EXPORT_URL_PREFIX = '/api/download/';

if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function getBaseUrl() {
    if (process.env.BASE_URL) {
        return process.env.BASE_URL.replace(/\/$/, '');
    }
    const test = process.env.TEST_BASE_URL || '';
    if (test) {
        return test.replace(/\/api\/?$/, '').replace(/\/$/, '');
    }
    return `http://localhost:${process.env.PORT || 3000}`;
}

/** 回傳相對路徑，由 App 依 ApiService.baseUrl 組完整 URL（避免外部瀏覽器開 .ts.net 失敗） */
function getDownloadUrl(fileName) {
    return `${EXPORT_URL_PREFIX}${encodeURIComponent(fileName)}`;
}

/** 僅供日誌或後台除錯用的絕對 URL */
function getAbsoluteDownloadUrl(fileName) {
    return `${getBaseUrl()}${getDownloadUrl(fileName)}`;
}

async function resolveProjectCodes(userId, userRole, { project_codes, project_area }) {
    if (userRole === '系統管理員' || userRole === '業務管理員') {
        if (project_codes) {
            return project_codes.split(',').map((c) => c.trim()).filter(Boolean);
        }
        if (project_area) {
            const { rows } = await db.query(
                `SELECT DISTINCT project_code FROM tree_survey WHERE project_location ILIKE $1 AND project_code IS NOT NULL`,
                [`%${project_area}%`]
            );
            return rows.map((r) => r.project_code).filter(Boolean);
        }
        return null;
    }

    const allowed = await getUserProjects(userId);
    if (project_codes) {
        const requested = project_codes.split(',').map((c) => c.trim()).filter(Boolean);
        const filtered = requested.filter((c) => allowed.includes(c));
        return filtered.length ? filtered : [];
    }
    if (project_area) {
        const { rows } = await db.query(
            `SELECT DISTINCT project_code FROM tree_survey 
             WHERE project_location ILIKE $1 AND project_code = ANY($2::text[])`,
            [`%${project_area}%`, allowed]
        );
        return rows.map((r) => r.project_code).filter(Boolean);
    }
    return allowed.length ? allowed : [];
}

function buildWhereClause(projectCodes) {
    if (projectCodes === null) return { sql: '', params: [] };
    if (!projectCodes.length) return { sql: ' WHERE 1=0', params: [] };
    return { sql: format(' WHERE project_code IN (%L)', projectCodes), params: [] };
}

async function querySurveyRows(projectCodes) {
    const { sql: where, params } = buildWhereClause(projectCodes);
    const { rows } = await db.query(`SELECT * FROM tree_survey${where}`, params);
    return rows;
}

async function toolExportExcel({ userId, userRole, project_codes, project_area }) {
    try {
        const codes = await resolveProjectCodes(userId, userRole, { project_codes, project_area });
        const rows = await querySurveyRows(codes);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('樹木調查資料');
        worksheet.columns = [
            { header: '專案區位', key: 'project_location' },
            { header: '專案代碼', key: 'project_code' },
            { header: '樹種名稱', key: 'species_name' },
            { header: '胸徑（公分）', key: 'dbh_cm' },
            { header: '樹高（公尺）', key: 'tree_height_m' },
            { header: '碳儲存量', key: 'carbon_storage' },
            { header: '年碳吸存量', key: 'carbon_sequestration_per_year' },
        ];
        worksheet.addRows(rows);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `agent_tree_export_${timestamp}.xlsx`;
        const filePath = path.join(EXPORT_DIR, fileName);
        await workbook.xlsx.writeFile(filePath);

        return {
            success: true,
            rowCount: rows.length,
            fileName,
            downloadUrl: getDownloadUrl(fileName),
            message: `已產生 Excel（${rows.length} 筆）。請在 App 內點擊下載連結。`,
        };
    } catch (err) {
        return { error: err.message };
    }
}

async function toolExportPdf({ userId, userRole, project_codes, project_area }) {
    try {
        const codes = await resolveProjectCodes(userId, userRole, { project_codes, project_area });
        const rows = await querySurveyRows(codes);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `agent_tree_export_${timestamp}.pdf`;
        const filePath = path.join(EXPORT_DIR, fileName);

        await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);
            doc.fontSize(18).text('樹木調查資料匯出', { align: 'center' });
            doc.moveDown();
            doc.fontSize(10).text(`筆數：${rows.length}　產生時間：${new Date().toLocaleString('zh-TW')}`);
            doc.moveDown();
            rows.slice(0, 80).forEach((tree, index) => {
                doc.fontSize(11).text(`${index + 1}. ${tree.project_location || ''} / ${tree.species_name || ''}`);
                doc.fontSize(9).text(
                    `   DBH ${tree.dbh_cm || '-'} cm · 碳儲存 ${tree.carbon_storage || '-'} kg CO₂e`
                );
            });
            if (rows.length > 80) {
                doc.moveDown().fontSize(9).text(`（僅列出前 80 筆，完整資料請用 Excel 匯出）`);
            }
            doc.end();
            stream.on('finish', resolve);
            stream.on('error', reject);
        });

        return {
            success: true,
            rowCount: rows.length,
            fileName,
            downloadUrl: getDownloadUrl(fileName),
            message: `已產生 PDF 摘要（共 ${rows.length} 筆）。`,
        };
    } catch (err) {
        return { error: err.message };
    }
}

async function toolExportAiReport({ userId, userRole, project_areas, min_dbh, max_dbh }) {
    try {
        const query = {};
        if (project_areas) query.projectAreas = project_areas;
        if (min_dbh != null) query.minDbh = String(min_dbh);
        if (max_dbh != null) query.maxDbh = String(max_dbh);

        const mockReq = { query, user: { user_id: userId, role: userRole } };
        let reportPayload = null;

        const mockRes = {
            json(data) {
                reportPayload = data;
            },
            status() {
                return mockRes;
            },
        };

        await aiReportController.generateAIReport(mockReq, mockRes);

        if (!reportPayload?.success || !reportPayload.data) {
            return { error: '無法產生 AI 永續報告' };
        }

        const pdfBuffer = await aiReportController.generateAIReportPDF(reportPayload.data);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `agent_ai_sustainability_${timestamp}.pdf`;
        const filePath = path.join(EXPORT_DIR, fileName);
        fs.writeFileSync(filePath, pdfBuffer);

        const preview = (reportPayload.data.aiAnalysis || '').slice(0, 400);

        return {
            success: true,
            fileName,
            downloadUrl: getDownloadUrl(fileName),
            preview,
            message: '已產生 AI 永續報告 PDF，請點擊下載連結。',
        };
    } catch (err) {
        return { error: err.message };
    }
}

module.exports = {
    toolExportExcel,
    toolExportPdf,
    toolExportAiReport,
    getDownloadUrl,
};
