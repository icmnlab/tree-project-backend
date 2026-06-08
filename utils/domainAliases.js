/**
 * 對外 API 語意別名（DB 表／欄位名不變）。
 *
 * 團隊 UI 語意（2026-05 定案）：
 * | UI 詞 | 別名欄 | DB 欄 |
 * |-------|--------|-------|
 * | **專案** | program_name | project_location, project_areas.area_name |
 * | **區** | block_name | project_name, projects.name |
 * | 代碼 | project_code | projects.project_code |
 *
 * 注意：`project_boundaries.project_area` 常與「專案」同值，但 ≠ UI「區」→ legacy_boundary_area
 */

function attachDomainAliases(row) {
  if (!row || typeof row !== 'object') return row;

  const programName =
    row.program_name ??
    row.project_location ??
    row.area ??
    row.area_name ??
    row['專案區位'] ??
    null;

  const blockName =
    row.block_name ??
    row.project_name ??
    row.name ??
    row['專案名稱'] ??
    null;

  const projectCode = row.project_code ?? row.code ?? row['專案代碼'] ?? null;

  const legacyBoundaryArea =
    row.legacy_boundary_area ??
    row.project_area ??
    null;

  return {
    ...row,
    program_name: programName,
    block_name: blockName,
    project_code: projectCode ?? row.project_code,
    legacy_boundary_area: legacyBoundaryArea,
    domain: {
      program: programName,
      block: blockName,
      project_code: projectCode,
      legacy_boundary_area: legacyBoundaryArea,
    },
    /** 中文 UI 別名（方便前端直接顯示，不改 DB） */
    專案: programName,
    區: blockName,
  };
}

function attachDomainAliasesList(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(attachDomainAliases);
}

module.exports = {
  attachDomainAliases,
  attachDomainAliasesList,
};
