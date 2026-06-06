/**
 * 手冊合規：正式 DBH（measured_dbh_cm / dbh_cm）不可來自儀器或視覺，
 * 除非明確標記 research_mode（研究模式，管理員場景）。
 *
 * 預設啟用；設 HANDBOOK_ENFORCE_DBH=false 可關閉（僅 dev）。
 */
function isHandbookEnforced() {
    return process.env.HANDBOOK_ENFORCE_DBH !== 'false';
}

const NON_MANUAL_SOURCES = new Set(['remote_diameter', 'vision', 'autopilot_vision']);

/**
 * @param {object} opts
 * @param {string|null|undefined} opts.dbhSource
 * @param {boolean|undefined} opts.researchMode
 * @param {number|null|undefined} opts.measuredDbhCm - 若 undefined 表示未嘗試寫入
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function assertHandbookDbhWrite({ dbhSource, researchMode, measuredDbhCm }) {
    if (!isHandbookEnforced()) return { ok: true };
    if (researchMode === true) return { ok: true };
    if (measuredDbhCm === undefined) return { ok: true };

    const source = (dbhSource || 'manual').toLowerCase();
    if (NON_MANUAL_SOURCES.has(source)) {
        return {
            ok: false,
            message: '手冊合規模式：正式胸徑須人工量測（dbh_source 不可為儀器或視覺）',
        };
    }
    return { ok: true };
}

module.exports = { isHandbookEnforced, assertHandbookDbhWrite, NON_MANUAL_SOURCES };
