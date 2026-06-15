/**
 * 中文簡體 → 繁體（台灣用語）轉換工具。
 *
 * Why: 第三方樹種辨識 API（Pl@ntNet）回傳的中文俗名多為簡體（如「银枫树」），
 * 直接入庫會造成繁簡混雜（「银枫树」vs「銀楓樹」），不符合本系統繁體中文的一致性要求，
 * 也會讓 tree_species 目錄與同義詞比對失準。此模組在「資料進入點」統一轉成台灣繁體。
 *
 * 採用 opencc-js 的 cn → tw（含台灣詞彙）轉換。
 * 任何轉換例外都會 fallback 回原字串，確保不會因轉換失敗而中斷主流程。
 *
 * 重要：cn → tw 轉換器假設輸入「全為簡體」。對「簡繁共用字」（如「朴」，
 * 簡體可對應繁體「樸」或「朴」）在已是繁體的字串中會誤轉（朴樹 → 樸樹）。
 * 因此本模組加上守門：若字串本身已含「繁體限定字」（以 tw → cn 偵測：
 * 繁轉簡會改變字串即代表含繁體字），即視為已是繁體，直接原樣回傳、不再轉換。
 * 此守門同時保證冪等（已轉成的「銀楓樹」不會被再次轉換），且不會破壞目錄中
 * 既有正確的繁體樹種名。完全簡體的輸入（如「朴树」）OpenCC 片語字典仍能
 * 正確處理（朴树 → 朴樹，保留「朴」）。
 */

let _toTrad = null;
let _toSimp = null;
let _initFailed = false;

function initConverters() {
    if (_initFailed) return;
    if (_toTrad && _toSimp) return;
    try {
        const OpenCC = require('opencc-js');
        // from cn（簡體）→ to tw（台灣正體，含台灣慣用詞彙）
        _toTrad = OpenCC.Converter({ from: 'cn', to: 'tw' });
        // 反向（繁 → 簡）僅用於偵測字串是否已含繁體限定字
        _toSimp = OpenCC.Converter({ from: 'tw', to: 'cn' });
    } catch (err) {
        _initFailed = true;
        _toTrad = null;
        _toSimp = null;
        console.warn('[chineseConvert] opencc-js 載入失敗，將略過簡轉繁:', err.message);
    }
}

/**
 * 將字串轉為台灣繁體。非字串、空字串或轉換失敗時回傳原值。
 * 若字串已含繁體限定字（已是繁體 / 混合繁簡）則原樣回傳，避免共用字誤轉。
 * @param {*} value
 * @returns {*}
 */
function toTraditional(value) {
    if (typeof value !== 'string' || value.length === 0) return value;
    initConverters();
    if (!_toTrad || !_toSimp) return value;
    try {
        // 繁轉簡會改變字串 → 原字串已含繁體限定字 → 視為已是繁體，不再轉換。
        if (_toSimp(value) !== value) return value;
        return _toTrad(value);
    } catch (_) {
        return value;
    }
}

/**
 * 對字串陣列逐項簡轉繁，並去除轉換後重複的項目（保留首次出現順序）。
 * @param {Array<*>} list
 * @returns {Array<*>}
 */
function toTraditionalList(list) {
    if (!Array.isArray(list)) return list;
    const seen = new Set();
    const out = [];
    for (const item of list) {
        const converted = toTraditional(item);
        const key = typeof converted === 'string' ? converted : JSON.stringify(converted);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(converted);
    }
    return out;
}

module.exports = {
    toTraditional,
    toTraditionalList,
};
