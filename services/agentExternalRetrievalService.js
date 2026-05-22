/**
 * Agent 受控外部檢索：網域白名單、單頁抓取、可選 site 限定搜尋、快取與引用欄位。
 */
const axios = require('axios');
const { URL } = require('url');

const FETCH_TIMEOUT_MS = parseInt(process.env.AGENT_FETCH_TIMEOUT_MS || '15000', 10);
const MAX_BODY_BYTES = parseInt(process.env.AGENT_FETCH_MAX_BYTES || '500000', 10);
const CACHE_TTL_MS = parseInt(process.env.AGENT_FETCH_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10);

/** 允許的網域後綴（小寫比對）— 涵蓋 .gov.tw 下各機關子網域 */
const ALLOWED_HOST_SUFFIXES = [
    '.gov.tw',
    '.edu.tw',
    'moenv.gov.tw',
    'forestry.gov.tw',
    'nfa.gov.tw',
    'coa.gov.tw',
    'ndc.gov.tw',
    'ipcc.ch',
    'unfccc.int',
    'fao.org',
    'iges.or.jp',
    'worldbank.org',
    'europa.eu',
];

/** 允許的完整 host（非 .gov.tw 之國際組織等） */
const ALLOWED_EXACT_HOSTS = new Set([
    'www.ipcc.ch',
    'www.moenv.gov.tw',
    'www.forestry.gov.tw',
    'www.sfaa.gov.tw',
    'www.coa.gov.tw',
    'www.ndc.gov.tw',
    'www.iges.or.jp',
    'www.ipcc-nggip.iges.or.jp',
    'unfccc.int',
    'www.unfccc.int',
    'www.fao.org',
    'www.worldbank.org',
]);

const DEFAULT_SEARCH_SITES = [
    'site:moenv.gov.tw',
    'site:forestry.gov.tw',
    'site:coa.gov.tw',
    'site:gov.tw',
    'site:ipcc.ch',
    'site:unfccc.int',
];

/** 分類政策／方法學入口（Agent 可 list / 批次 fetch） */
const POLICY_SOURCE_CATALOG = [
    {
        category: '環境與氣候',
        sources: [
            { title: '環境部全球資訊網', url: 'https://www.moenv.gov.tw/', keywords: ['碳匯', '氣候', '溫室氣體'] },
            { title: '環境部碳足跡平台', url: 'https://cfp-calculate.moenv.gov.tw/', keywords: ['碳足跡', '盤查'] },
            { title: '國家溫室氣體減量及管理法', url: 'https://law.moenv.gov.tw/', keywords: ['法規', '減量'] },
        ],
    },
    {
        category: '森林與國土',
        sources: [
            { title: '林業署全球資訊網', url: 'https://www.forestry.gov.tw/', keywords: ['森林', '碳匯', '經營'] },
            { title: '林業署森林經營及保育處', url: 'https://www.sfaa.gov.tw/', keywords: ['保育', '調查'] },
            { title: '農業部（林業相關政策）', url: 'https://www.coa.gov.tw/', keywords: ['農業', '國土'] },
        ],
    },
    {
        category: '能源與產業政策',
        sources: [
            { title: '國家發展委員會', url: 'https://www.ndc.gov.tw/', keywords: ['淨零', '政策'] },
            { title: '經濟部能源署', url: 'https://www.moeaboe.gov.tw/', keywords: ['能源', '效率'] },
        ],
    },
    {
        category: '國際方法學',
        sources: [
            { title: 'IPCC', url: 'https://www.ipcc.ch/', keywords: ['AR6', 'inventory', '方法學'] },
            { title: 'UNFCCC', url: 'https://unfccc.int/', keywords: ['Paris', 'NDC'] },
            { title: 'IPCC NGGIP (IGES)', url: 'https://www.ipcc-nggip.iges.or.jp/', keywords: ['GHG', 'guideline'] },
            { title: 'FAO 林業與氣候', url: 'https://www.fao.org/forestry/', keywords: ['forest', 'climate'] },
        ],
    },
];

const _cache = new Map();

function isHostAllowed(hostname) {
    const host = (hostname || '').toLowerCase().replace(/\.$/, '');
    if (!host) return false;
    if (ALLOWED_EXACT_HOSTS.has(host)) return true;
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

function validateUrl(urlString) {
    let parsed;
    try {
        parsed = new URL(urlString);
    } catch {
        return { ok: false, error: '無效的 URL' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, error: '僅允許 http/https' };
    }
    if (!isHostAllowed(parsed.hostname)) {
        return { ok: false, error: `網域未在白名單內：${parsed.hostname}` };
    }
    return { ok: true, parsed };
}

function htmlToText(html) {
    if (!html || typeof html !== 'string') return '';
    let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, 12000);
}

function extractTitle(html) {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim().slice(0, 200) : '';
}

function splitParagraphs(text, maxParagraphs = 8) {
    const parts = text.split(/(?<=[。！？.!?])\s+/).filter((p) => p.length > 40);
    return parts.slice(0, maxParagraphs).map((p, i) => ({
        section: `段落 ${i + 1}`,
        excerpt: p.slice(0, 600),
    }));
}

function cacheGet(url) {
    const entry = _cache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        _cache.delete(url);
        return null;
    }
    return entry;
}

function cacheSet(url, payload) {
    _cache.set(url, { ...payload, cachedAt: Date.now() });
}

function buildCitation(payload) {
    const date = payload.fetchedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    return `依據：${payload.title || payload.url}（擷取日期 ${date}，來源 ${payload.url}）`;
}

/**
 * 抓取單一允許網址
 */
async function fetchAllowedUrl(url) {
    const check = validateUrl(url);
    if (!check.ok) return { error: check.error };

    const normalized = check.parsed.href;
    const cached = cacheGet(normalized);
    if (cached) {
        return {
            ...cached,
            fromCache: true,
            citation: buildCitation(cached),
        };
    }

    try {
        const res = await axios.get(normalized, {
            timeout: FETCH_TIMEOUT_MS,
            maxContentLength: MAX_BODY_BYTES,
            maxBodyLength: MAX_BODY_BYTES,
            headers: {
                'User-Agent': 'TreeCarbonAgent/1.0 (research; allowlist-only)',
                Accept: 'text/html,application/xhtml+xml,text/plain',
            },
            responseType: 'text',
            validateStatus: (s) => s >= 200 && s < 400,
        });

        const contentType = String(res.headers['content-type'] || '');
        if (contentType.includes('pdf')) {
            const payload = {
                url: normalized,
                title: 'PDF 文件',
                contentType: 'application/pdf',
                message: '此為 PDF，系統僅提供連結與擷取日期，未解析全文。請由使用者於官方網站開啟。',
                fetchedAt: new Date().toISOString(),
                paragraphs: [],
            };
            payload.citation = buildCitation(payload);
            cacheSet(normalized, payload);
            return payload;
        }

        const html = res.data || '';
        const title = extractTitle(html) || normalized;
        const text = htmlToText(html);
        const paragraphs = splitParagraphs(text);

        const payload = {
            url: normalized,
            title,
            fetchedAt: new Date().toISOString(),
            paragraphs,
            excerpt: text.slice(0, 1500),
            citation: '',
        };
        payload.citation = buildCitation(payload);
        cacheSet(normalized, payload);
        return payload;
    } catch (err) {
        return { error: `抓取失敗：${err.message}` };
    }
}

/**
 * Google Custom Search（site 限定），需 GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX
 */
async function searchPublicDocuments({ query, max_results = 5 }) {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!apiKey || !cx) {
        return {
            error: '搜尋 API 未設定（需 GOOGLE_CSE_API_KEY 與 GOOGLE_CSE_CX）',
            hint: '可改用 fetch_allowed_url 直接貼上政府網站連結',
        };
    }

    const siteClause = DEFAULT_SEARCH_SITES.join(' OR ');
    const fullQuery = `${query} (${siteClause})`;

    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: apiKey,
                cx,
                q: fullQuery,
                num: Math.min(Math.max(max_results, 1), 8),
                lr: 'lang_zh-TW',
            },
            timeout: FETCH_TIMEOUT_MS,
        });

        const raw = (res.data.items || []).map((item) => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet,
        }));

        const items = raw
            .filter((item) => item.url && validateUrl(item.url).ok)
            .map((item, idx) => ({
                rank: idx + 1,
                title: item.title,
                url: item.url,
                snippet: item.snippet,
            }));

        return {
            query: fullQuery,
            resultCount: items.length,
            results: items,
            searchedAt: new Date().toISOString(),
            note: '僅搜尋白名單政府／IPCC 相關網域；後續請用 fetch_allowed_url 取得段落內容',
        };
    } catch (err) {
        return { error: `搜尋失敗：${err.response?.data?.error?.message || err.message}` };
    }
}

function flattenPolicySources() {
    return POLICY_SOURCE_CATALOG.flatMap((g) =>
        g.sources.map((s) => ({ ...s, category: g.category }))
    );
}

/** 研討會 demo 入口（扁平列表，相容舊工具） */
const DEMO_POLICY_URLS = flattenPolicySources().map(({ title, url }) => ({ title, url }));

async function listDemoPolicyUrls() {
    return {
        note: '內建碳盤查／森林／淨零相關入口（白名單）。可用 fetch_allowed_url 讀單頁，或 fetch_allowed_urls 一次讀 2～3 頁比較。',
        urlCount: DEMO_POLICY_URLS.length,
        urls: DEMO_POLICY_URLS,
    };
}

async function listPolicySources({ category } = {}) {
    const groups = category
        ? POLICY_SOURCE_CATALOG.filter((g) => g.category.includes(category))
        : POLICY_SOURCE_CATALOG;
    return {
        note: '所有網址均在白名單內；亦可請使用者提供 https://*.gov.tw 連結由 fetch_allowed_url 讀取',
        allowedSuffixes: ALLOWED_HOST_SUFFIXES,
        catalog: groups,
        totalSources: groups.reduce((n, g) => n + g.sources.length, 0),
    };
}

async function listAllowedDomains() {
    return {
        allowedHostSuffixes: ALLOWED_HOST_SUFFIXES,
        allowedExactHosts: [...ALLOWED_EXACT_HOSTS],
        rules: [
            '僅 http/https',
            '台灣政府 .gov.tw、學術 .edu.tw、IPCC／UNFCCC／FAO 等國際公開站',
            '單次 fetch 上限約 500KB；內容快取 24 小時',
        ],
        howToAdd: '請在伺服器設定 AGENT_EXTRA_HOST_SUFFIXES（逗號分隔，如 .nat.gov.tw）後 reload',
    };
}

/** 一次抓取 2～3 個白名單網址（比較政策用） */
async function fetchAllowedUrls(urls = []) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean).slice(0, 3);
    if (!list.length) return { error: '請提供至少一個 url' };

    const results = [];
    for (const url of list) {
        const r = await fetchAllowedUrl(url);
        results.push({
            url,
            ok: !r.error,
            title: r.title,
            error: r.error,
            citation: r.citation,
            excerpt: r.excerpt?.slice(0, 800) || r.message,
            paragraphCount: r.paragraphs?.length || 0,
        });
    }
    return {
        fetched: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
    };
}

function applyExtraHostSuffixes() {
    const extra = process.env.AGENT_EXTRA_HOST_SUFFIXES;
    if (!extra) return;
    extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((suffix) => {
        if (!ALLOWED_HOST_SUFFIXES.includes(suffix)) {
            ALLOWED_HOST_SUFFIXES.push(suffix.startsWith('.') ? suffix : `.${suffix}`);
        }
    });
}
applyExtraHostSuffixes();

module.exports = {
    fetchAllowedUrl,
    fetchAllowedUrls,
    searchPublicDocuments,
    listDemoPolicyUrls,
    listPolicySources,
    listAllowedDomains,
    isHostAllowed,
    buildCitation,
    POLICY_SOURCE_CATALOG,
};
