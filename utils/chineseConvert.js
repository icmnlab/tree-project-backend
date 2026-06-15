/**
 * 中文簡體 → 繁體（台灣用語）轉換工具。
 *
 * Why: 第三方樹種辨識 API（Pl@ntNet）回傳的中文俗名多為簡體（如「银枫树」），
 * 直接入庫會造成繁簡混雜（「银枫树」vs「銀楓樹」），不符合本系統繁體中文的一致性要求，
 * 也會讓 tree_species 目錄與同義詞比對失準。此模組在「資料進入點」統一轉成台灣繁體。
 *
 * 採用 opencc-js 的 cn → tw（含台灣詞彙）轉換；對已是繁體的字串為無操作（idempotent）。
 * 任何轉換例外都會 fallback 回原字串，確保不會因轉換失敗而中斷主流程。
 */

let _converter = null;
let _initFailed = false;

function getConverter() {
    if (_converter || _initFailed) return _converter;
    try {
        const OpenCC = require('opencc-js');
        // from cn（簡體）→ to tw（台灣正體，含台灣慣用詞彙）
        _converter = OpenCC.Converter({ from: 'cn', to: 'tw' });
    } catch (err) {
        _initFailed = true;
        _converter = null;
        console.warn('[chineseConvert] opencc-js 載入失敗，將略過簡轉繁:', err.message);
    }
    return _converter;
}

/**
 * 將字串轉為台灣繁體。非字串、空字串或轉換失敗時回傳原值。
 * @param {*} value
 * @returns {*}
 */
function toTraditional(value) {
    if (typeof value !== 'string' || value.length === 0) return value;
    const convert = getConverter();
    if (!convert) return value;
    try {
        return convert(value);
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
