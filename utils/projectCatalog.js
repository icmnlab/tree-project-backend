const db = require('../config/db');

/** [P1-2] 合併 projects 與僅存在於 project_boundaries 的專案（以 code 優先、name 次之去重） */
function mergeProjectLists(primaryRows, boundaryRows) {
    const byCode = new Map();
    const byName = new Map();
    const merged = [];

    for (const row of primaryRows) {
        const name = (row.name || '').trim();
        const code = (row.code || '').trim();
        if (!name) continue;
        merged.push({ name, code: code || null, area: row.area || '' });
        if (code) byCode.set(code, name);
        byName.set(name, code || null);
    }

    for (const row of boundaryRows) {
        const name = (row.name || '').trim();
        const code = (row.code || '').trim();
        if (!name) continue;
        if (code && byCode.has(code)) continue;
        if (byName.has(name)) continue;
        merged.push({ name, code: code || null, area: row.area || '' });
        if (code) byCode.set(code, name);
        byName.set(name, code || null);
    }

    merged.sort((a, b) => {
        const ac = a.code || '';
        const bc = b.code || '';
        if (ac && bc) {
            const an = Number(ac);
            const bn = Number(bc);
            if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
            return ac.localeCompare(bc, undefined, { numeric: true });
        }
        return a.name.localeCompare(b.name, 'zh-Hant');
    });

    return merged;
}

function applyProjectFilter(rows, projectFilter) {
    if (!Array.isArray(projectFilter)) return rows;
    return rows.filter((r) => r.code && projectFilter.includes(r.code));
}

async function fetchActiveProjects(projectFilter) {
    let query = `
        SELECT p.name, p.project_code AS code, COALESCE(pa.area_name, '') AS area
        FROM projects p
        LEFT JOIN project_areas pa ON pa.id = p.area_id
        WHERE p.is_active = true
    `;
    const params = [];
    if (projectFilter) {
        query += ` AND p.project_code = ANY($1::text[])`;
        params.push(projectFilter);
    }
    query += ` ORDER BY p.project_code`;
    const result = await db.query(query, params);
    return result.rows;
}

async function fetchBoundaryOnlyProjects({ area } = {}) {
    let query = `
        SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(project_code), ''), project_name))
            project_name AS name,
            NULLIF(TRIM(project_code), '') AS code,
            COALESCE(NULLIF(TRIM(project_area), ''), '') AS area
        FROM project_boundaries
        WHERE project_name IS NOT NULL AND TRIM(project_name) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM projects p
            WHERE p.is_active IS NOT DISTINCT FROM TRUE
              AND TRIM(p.name) = TRIM(project_boundaries.project_name)
          )
    `;
    const params = [];
    if (area) {
        query += ` AND TRIM(project_area) = $1`;
        params.push(area);
    }
    query += `
        ORDER BY COALESCE(NULLIF(TRIM(project_code), ''), project_name), project_name
    `;
    const result = await db.query(query, params);
    return result.rows;
}

async function fetchMergedProjects(projectFilter, { area } = {}) {
    const activeRows = await fetchActiveProjects(projectFilter);
    const boundaryRows = await fetchBoundaryOnlyProjects(area ? { area } : {});
    let rows = mergeProjectLists(activeRows, boundaryRows);
    rows = applyProjectFilter(rows, projectFilter);
    return rows;
}

module.exports = {
    mergeProjectLists,
    applyProjectFilter,
    fetchActiveProjects,
    fetchBoundaryOnlyProjects,
    fetchMergedProjects,
};
