/**
 * LLM provider with SiliconFlow → OpenAI fallback.
 * Fixes 403 when SiliconFlow keys expire or Gemini key is Android-restricted.
 */
const OpenAI = require('openai');

const OPENAI_FALLBACK_MODEL = process.env.LLM_OPENAI_FALLBACK_MODEL || 'gpt-5.4-mini';

let _openaiClient = null;

function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) return null;
    if (!_openaiClient) {
        _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openaiClient;
}

function getSiliconFlowKeyList() {
    return [
        process.env.SiliconFlow_API_KEY,
        process.env.Alt1_SiliconFlow_API_KEY,
        process.env.Alt2_SiliconFlow_API_KEY,
        process.env.Alt3_SiliconFlow_API_KEY,
    ].filter(Boolean);
}

function isSiliconFlowModel(model) {
    if (!model) return true;
    return model.startsWith('Qwen/') || model.startsWith('deepseek-ai/');
}

function mapToOpenAIModel(model) {
    if (!model) return OPENAI_FALLBACK_MODEL;
    if (model.startsWith('gpt-')) return model;
    if (model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) return model;
    return OPENAI_FALLBACK_MODEL;
}

function shouldFallbackToOpenAI(err) {
    const status = err?.status;
    return status === 403 || status === 401 || status === 429;
}

function isGeminiAndroidKeyBlocked(err) {
    const msg = String(err?.message || '');
    return msg.includes('API_KEY_ANDROID_APP_BLOCKED')
        || msg.includes('Android client application');
}

/**
 * Chat completion: try SiliconFlow keys first, then OpenAI.
 */
async function chatCompletions(options) {
    const {
        model,
        messages,
        tools,
        tool_choice,
        temperature,
        max_tokens,
        max_completion_tokens,
        preferSiliconFlow = true,
    } = options;

    const extra = {};
    if (max_completion_tokens != null) extra.max_completion_tokens = max_completion_tokens;
    else if (max_tokens != null) extra.max_tokens = max_tokens;

    const baseOpts = {
        messages,
        temperature,
        ...extra,
    };
    if (tools) {
        baseOpts.tools = tools;
        baseOpts.tool_choice = tool_choice ?? 'auto';
    }

    const sfKeys = getSiliconFlowKeyList();
    if (preferSiliconFlow && isSiliconFlowModel(model) && sfKeys.length > 0) {
        let lastErr;
        for (const key of sfKeys) {
            const client = new OpenAI({
                apiKey: key,
                baseURL: 'https://api.siliconflow.cn/v1',
            });
            try {
                const result = await client.chat.completions.create({
                    ...baseOpts,
                    model: model || 'deepseek-ai/DeepSeek-V3',
                });
                return { result, provider: 'siliconflow' };
            } catch (err) {
                lastErr = err;
                if (!shouldFallbackToOpenAI(err)) throw err;
                console.warn(`[LLM] SiliconFlow failed (${err.status}): ${err.message}`);
            }
        }
        if (!getOpenAIClient()) throw lastErr || new Error('SiliconFlow 不可用且未設定 OPENAI_API_KEY');
    }

    const openai = getOpenAIClient();
    if (!openai) {
        throw new Error('LLM 服務未配置：SiliconFlow 金鑰失效且 OPENAI_API_KEY 未設定');
    }

    const chain = [];
    const primary = mapToOpenAIModel(model);
    chain.push(primary);
    if (primary.startsWith('gpt-5')) chain.push('gpt-4o-mini');
    if (!chain.includes(OPENAI_FALLBACK_MODEL)) chain.push(OPENAI_FALLBACK_MODEL);
    const unique = [...new Set(chain)];

    let lastErr;
    for (const openaiModel of unique) {
        try {
            const result = await openai.chat.completions.create({
                ...baseOpts,
                model: openaiModel,
            });
            if (openaiModel !== primary) {
                console.warn(`[LLM] OpenAI 降級 ${primary} → ${openaiModel}`);
            }
            return { result, provider: 'openai', modelUsed: openaiModel };
        } catch (err) {
            lastErr = err;
            const retry = err.status === 404 || /model/i.test(String(err.message));
            if (!retry) throw err;
        }
    }
    throw lastErr || new Error('OpenAI 所有模型皆不可用');
}

/**
 * Simple text generation (for Gemini fallback path).
 */
async function generateText(prompt, systemInstruction, preferredModel) {
    const messages = [
        { role: 'system', content: systemInstruction || 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
    ];

    if (preferredModel && preferredModel.startsWith('gemini-')) {
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: preferredModel });
            const text = systemInstruction
                ? `${systemInstruction}\n\n---\n\n${prompt}`
                : prompt;
            const result = await model.generateContent(text);
            return result.response.text();
        } catch (err) {
            if (!isGeminiAndroidKeyBlocked(err) && !shouldFallbackToOpenAI(err)) throw err;
            console.warn('[LLM] Gemini blocked or failed, falling back to OpenAI:', err.message);
        }
    }

    const { result } = await chatCompletions({
        model: preferredModel,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
        preferSiliconFlow: !preferredModel?.startsWith('gemini-'),
    });
    return result.choices[0].message.content;
}

module.exports = {
    getOpenAIClient,
    getSiliconFlowKeyList,
    chatCompletions,
    generateText,
    mapToOpenAIModel,
    OPENAI_FALLBACK_MODEL,
    isGeminiAndroidKeyBlocked,
};
