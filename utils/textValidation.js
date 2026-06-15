/**
 * Text encoding validation & safe decoding for upload pipelines.
 *
 * Why: Node's Buffer.toString('utf-8') silently replaces invalid bytes with
 * U+FFFD (REPLACEMENT CHARACTER) and writes garbage like "台中港植栽第??區"
 * straight into the database. We treat any byte sequence that fails strict
 * UTF-8 decoding as a client error and detect+convert when possible.
 *
 * Pipeline (rejection layer / L1):
 *   1. Try strict UTF-8 (TextDecoder with fatal=true). If clean, done.
 *   2. Detect charset via `chardet`. If it's another encoding we trust
 *      (BIG5/GBK/Shift_JIS/etc.), decode via iconv-lite, then re-validate.
 *   3. Anything still containing U+FFFD or that we can't decode → throw
 *      EncodingError that the route turns into a 400 response.
 *
 * 另提供輕量同步 helper（hasReplacementChar / findReplacementCharField），供
 * 已是字串的 JSON 請求（如 create_v2 / batch_import）在入庫前掃描欄位，
 * 與 DB CHECK 約束（migration 34）構成兩道防線。
 */

const chardet = require('chardet');
const iconv = require('iconv-lite');

const REPLACEMENT_CHAR = '\uFFFD';

class EncodingError extends Error {
    constructor(message, { detected, sample } = {}) {
        super(message);
        this.name = 'EncodingError';
        this.statusCode = 400;
        this.detected = detected || null;
        this.sample = sample || null;
    }
}

/**
 * Strict UTF-8 decode. Throws on any invalid byte sequence.
 * @param {Buffer} buf
 * @returns {string}
 */
function strictDecodeUtf8(buf) {
    // TextDecoder('utf-8', { fatal: true }) throws TypeError on invalid bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
}

/**
 * Assert the string contains no U+FFFD replacement characters.
 * Used as a final guard even after successful decoding.
 * @param {string} s
 * @param {string} contextLabel
 */
function assertCleanUtf8(s, contextLabel = 'text') {
    if (typeof s !== 'string') {
        throw new EncodingError(`${contextLabel} 不是字串`);
    }
    const idx = s.indexOf(REPLACEMENT_CHAR);
    if (idx >= 0) {
        const start = Math.max(0, idx - 20);
        const end = Math.min(s.length, idx + 21);
        throw new EncodingError(
            `${contextLabel} 含有無效字元 (U+FFFD)，原始檔案編碼錯誤或被前一階段污染`,
            { sample: s.slice(start, end) }
        );
    }
}

/**
 * Auto-detect encoding and decode safely.
 *
 * @param {Buffer} buf - raw bytes (e.g., req.file.buffer from multer).
 * @param {object} [opts]
 * @param {string} [opts.contextLabel='上傳檔案']
 * @param {string[]} [opts.acceptableEncodings] - whitelist of encodings to try
 *        when chardet's first guess doesn't decode cleanly.
 * @returns {{ text: string, encoding: string }}
 * @throws {EncodingError}
 */
function decodeBufferAuto(buf, opts = {}) {
    if (!Buffer.isBuffer(buf)) {
        throw new EncodingError('decodeBufferAuto 需要 Buffer');
    }

    const contextLabel = opts.contextLabel || '上傳檔案';
    const acceptable = opts.acceptableEncodings || [
        'UTF-8', 'BIG5', 'GBK', 'GB18030', 'Shift_JIS', 'EUC-KR', 'windows-1252', 'ISO-8859-1'
    ];

    // 1. Strict UTF-8 first (most common, no detection cost)
    try {
        const text = strictDecodeUtf8(buf).replace(/^\uFEFF/, ''); // strip BOM
        assertCleanUtf8(text, contextLabel);
        return { text, encoding: 'UTF-8' };
    } catch (_) {
        // Fall through to detection.
    }

    // 2. Detect via chardet
    const detected = chardet.detect(buf);
    const candidates = [];
    if (detected && acceptable.includes(detected)) candidates.push(detected);
    for (const enc of acceptable) {
        if (enc !== 'UTF-8' && !candidates.includes(enc)) candidates.push(enc);
    }

    for (const enc of candidates) {
        if (!iconv.encodingExists(enc)) continue;
        try {
            const text = iconv.decode(buf, enc).replace(/^\uFEFF/, '');
            // Only accept if no replacement characters appeared.
            if (!text.includes(REPLACEMENT_CHAR)) {
                return { text, encoding: enc };
            }
        } catch (_) {
            // Try next candidate.
        }
    }

    // 3. Give up — caller turns this into 400.
    throw new EncodingError(
        `${contextLabel} 編碼無法辨識；請另存為 UTF-8 後重試 (chardet 偵測: ${detected || 'unknown'})`,
        { detected }
    );
}

/**
 * 輕量檢查：字串是否含 U+FFFD（亂碼徵兆）。非字串一律視為通過。
 * @param {*} value
 * @returns {boolean}
 */
function hasReplacementChar(value) {
    return typeof value === 'string' && value.includes(REPLACEMENT_CHAR);
}

/**
 * 掃描物件的字串欄位，回傳第一個含 U+FFFD 的欄位名；無則回 null。
 * 供 JSON 請求（值已是字串）在入庫前做欄位級亂碼防護。
 * @param {object} obj      待檢查物件
 * @param {string[]} [fields] 限定檢查的欄位；省略則檢查所有自有字串欄位
 * @returns {string|null}
 */
function findReplacementCharField(obj, fields) {
    if (!obj || typeof obj !== 'object') return null;
    const keys = Array.isArray(fields) ? fields : Object.keys(obj);
    for (const key of keys) {
        if (hasReplacementChar(obj[key])) return key;
    }
    return null;
}

module.exports = {
    EncodingError,
    REPLACEMENT_CHAR,
    strictDecodeUtf8,
    assertCleanUtf8,
    decodeBufferAuto,
    hasReplacementChar,
    findReplacementCharField,
};
