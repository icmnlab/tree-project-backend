const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { generateText, isGeminiAndroidKeyBlocked } = require('./llmProviderService');

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 更快速、更經濟高效: gemini-2.5-flash
// 更強大的性能和理解能力，價格相對較高 gemini-2.5-pro
const DEFAULT_MODEL_NAME = 'gemini-2.5-flash'; 

/**
 * 使用 Gemini API 生成聊天回應。
 * @param {string} userMessage 使用者的訊息。
 * @param {string} systemInstruction 系統指示 (類似 OpenAI system role)。
 * @param {Array<object>} history 對話歷史 (可選，格式為 [{role: 'user'/'model', parts: [{text: ''}]}])。
 * @param {string} modelName 要使用的 Gemini 模型名稱 (可選)。
 * @returns {Promise<string|null>} AI 的回應文本，或在出錯時返回 null。
 */
async function generateGeminiChatResponse(userMessage, systemInstruction, history = [], modelName = DEFAULT_MODEL_NAME) {
    if (!API_KEY) {
        console.error('GEMINI_API_KEY 未設定。請在 .env 檔案中設定。');
        return '錯誤：Gemini API 金鑰未設定。';
    }

    try {
        const model = genAI.getGenerativeModel({ model: modelName });

        const chatHistory = [];

        // Gemini API 的 history 格式與 OpenAI 不同，需要轉換
        // 系統指示通常放在初始的對話歷史中，或者作為 prompt 的一部分
        if (systemInstruction) {
            // Gemini 沒有明確的 system role，但可以將系統指示作為初始的 'user' 訊息，然後 AI 的回應作為 'model' parts
            // 或者，更常見的做法是將系統指示融入到第一個 user message 的上下文中。
            // 這裡我們先嘗試將其作為對話開頭的一部分。
            // 但請注意，對於 Gemini 的 chat session，更標準的做法是將系統指令放在 `startChat` 的 `systemInstruction` 參數中 (如果SDK版本支援)
            // 或直接構造包含系統指示的 prompt。
            // 為了簡化，這裡我們將系統指示加到使用者訊息前。
             // userMessage = systemInstruction + '\n\n---\n\n使用者問題：\n' + userMessage;
        }
        
        // 構建發送給 Gemini 的內容
        const parts = [{ text: systemInstruction + '\n\n---\n\n使用者問題：\n' + userMessage }];

        // Gemini 的 `generateContentStream` 或 `generateContent` 直接接收 prompt
        // 如果要使用聊天模式 (with history)，則使用 `startChat`
        
        const generationConfig = {
            temperature: 0.7,
            topK: 1,
            topP: 1,
            maxOutputTokens: 8192, // Gemini Pro 最大輸出 8192 tokens, Gemini 1.5 Pro 更大
        };

        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ];
        
        console.log(`[Gemini Service] 正在使用模型: ${modelName}`);
        console.log(`[Gemini Service] 發送給 Gemini 的內容 (部分): ${parts[0].text.substring(0, 200)}...`);


        const result = await model.generateContent({
            contents: [{ role: "user", parts }], // 歷史記錄可以加在這裡 [{role: "user", parts}, {role: "model", parts}, ...]
            generationConfig,
            safetySettings,
        });

        if (result && result.response) {
            const responseText = result.response.text();
            console.log('[Gemini Service] Gemini 回應成功。');
            return responseText;
        } else if (result && result.response && result.response.promptFeedback && result.response.promptFeedback.blockReason) {
            console.error('[Gemini Service] Gemini 回應因為安全原因被阻擋:', result.response.promptFeedback.blockReason);
            return `抱歉，您的請求因為安全原因被阻擋：${result.response.promptFeedback.blockReason}。請嘗試修改您的問題。`;
        } 
        else {
            console.error('[Gemini Service] Gemini 回應無效或為空。', result);
            return '抱歉，Gemini 模型沒有返回有效的回應。';
        }

    } catch (error) {
        console.error('[Gemini Service] 調用 Gemini API 時發生錯誤:', error);
        if (isGeminiAndroidKeyBlocked(error) || error.status === 403) {
            try {
                const fallback = await generateText(userMessage, systemInstruction, 'deepseek-ai/DeepSeek-V3');
                console.log('[Gemini Service] 已改用 OpenAI/SiliconFlow 備援。');
                return fallback;
            } catch (fallbackErr) {
                console.error('[Gemini Service] 備援 LLM 也失敗:', fallbackErr.message);
            }
        }
        let errorMessage = '處理 AI 回應時發生內部錯誤 (Gemini)。';
        if (error.message) {
            errorMessage += ` 詳情: ${error.message}`;
        }
        if (error.status) {
             errorMessage += ` (狀態碼: ${error.status})`;
        }
        return errorMessage;
    }
}

module.exports = { generateGeminiChatResponse, DEFAULT_MODEL_NAME }; 