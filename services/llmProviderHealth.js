/**
 * 偵測各 LLM 供應商是否可用（結果快取，避免每次開 App 都打 API）
 */
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const CACHE_MS = parseInt(process.env.LLM_HEALTH_CACHE_MS || '300000', 10); // 5 分鐘
let _cache = null;

const OPENAI_PROBE_CANDIDATES = ['gpt-5.4-mini', 'gpt-5-mini', 'gpt-4o-mini'];

async function probeOpenAI() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { available: false, reason: 'OPENAI_API_KEY 未設定' };
    const client = new OpenAI({ apiKey: key });
    let lastErr = null;
    for (const model of OPENAI_PROBE_CANDIDATES) {
        try {
            await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
            });
            return { available: true, probeModel: model, supportsGpt5: model.startsWith('gpt-5') };
        } catch (e) {
            lastErr = e;
            const missing = e.status === 404 || /model/i.test(String(e.message));
            if (missing) continue;
            return { available: false, reason: e.message };
        }
    }
    return { available: false, reason: lastErr?.message || 'OpenAI 連線失敗' };
}

async function probeSiliconFlow() {
    const keys = [
        process.env.SiliconFlow_API_KEY,
        process.env.Alt1_SiliconFlow_API_KEY,
    ].filter(Boolean);
    if (!keys.length) return { available: false, reason: 'SiliconFlow 金鑰未設定' };
    try {
        const client = new OpenAI({
            apiKey: keys[0],
            baseURL: 'https://api.siliconflow.cn/v1',
        });
        await client.chat.completions.create({
            model: 'deepseek-ai/DeepSeek-V3',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
        });
        return { available: true };
    } catch (e) {
        return { available: false, reason: e.message?.includes('403') ? '需身份驗證或金鑰失效' : e.message };
    }
}

async function probeGemini() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { available: false, reason: 'GEMINI_API_KEY 未設定' };
    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        await model.generateContent('ping');
        return { available: true };
    } catch (e) {
        const msg = e.message || '';
        if (msg.includes('ANDROID') || msg.includes('Android')) {
            return { available: false, reason: '金鑰限制為 Android，需 Server API Key' };
        }
        return { available: false, reason: msg };
    }
}

/** 前端可選模型目錄（依供應商可用性過濾） */
function buildModelCatalog(health) {
    const categories = [];

    if (health.openai.available) {
        const gpt5 =
            health.openai.supportsGpt5
            || (process.env.OPENAI_CATALOG_GPT5 !== '0' && process.env.OPENAI_CATALOG_GPT5 !== 'false');
        const models = gpt5
            ? [
                { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini · 預設（Agent / Demo）', default: true },
                { id: 'gpt-5-mini', label: 'GPT-5 mini（$0.25/$2 per 1M）', default: false },
                { id: 'gpt-5.4', label: 'GPT-5.4（$2.5/$15）', default: false },
                { id: 'gpt-5.5', label: 'GPT-5.5（$5/$30）', default: false },
            ]
            : [
                { id: 'gpt-4o-mini', label: 'GPT-4o mini · 推薦', default: true },
                { id: 'gpt-4o', label: 'GPT-4o · 較強', default: false },
            ];
        categories.push({
            category: gpt5 ? 'OpenAI GPT-5（1M token 額度適用）' : 'OpenAI（目前可用）',
            provider: 'openai',
            models,
        });
    }

    if (health.siliconflow.available) {
        categories.push({
            category: 'SiliconFlow 免費額度',
            provider: 'siliconflow',
            models: [
                { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3', default: !health.openai.available },
                { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5 72B', default: false },
            ],
        });
    }

    if (health.gemini.available) {
        categories.push({
            category: 'Google Gemini',
            provider: 'gemini',
            models: [
                { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', default: false },
            ],
        });
    }

    let defaultModel = 'gpt-5.4-mini';
    for (const cat of categories) {
        const d = cat.models.find((m) => m.default);
        if (d) {
            defaultModel = d.id;
            break;
        }
    }
    if (!categories.length) {
        defaultModel = null;
    } else if (!categories.some((c) => c.models.some((m) => m.id === defaultModel))) {
        defaultModel = categories[0].models[0].id;
    }

    return { categories, defaultModel };
}

async function getLlmHealth(force = false) {
    if (!force && _cache && Date.now() - _cache.at < CACHE_MS) {
        return _cache.data;
    }

    const [openai, siliconflow, gemini] = await Promise.all([
        probeOpenAI(),
        probeSiliconFlow(),
        probeGemini(),
    ]);

    const providers = { openai, siliconflow, gemini };
    const catalog = buildModelCatalog(providers);

    const data = {
        providers,
        ...catalog,
        agentMode: {
            /** Agent 固定走 chatCompletions 備援時用此模型 */
            defaultModel: catalog.defaultModel || 'gpt-5.4-mini',
            showModelPicker:
                catalog.categories.length > 1
                || (catalog.categories[0]?.models?.length || 0) > 1,
        },
        checkedAt: new Date().toISOString(),
    };

    _cache = { at: Date.now(), data };
    return data;
}

module.exports = { getLlmHealth, buildModelCatalog };
