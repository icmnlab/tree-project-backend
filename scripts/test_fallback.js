require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chatCompletions } = require('../services/llmProviderService');

chatCompletions({
  model: 'deepseek-ai/DeepSeek-V3',
  messages: [{ role: 'user', content: 'ping' }],
  max_tokens: 8,
})
  .then((r) => {
    console.log('OK provider=' + r.provider + ' text=' + r.result.choices[0].message.content);
    process.exit(0);
  })
  .catch((e) => {
    console.log('FAIL ' + e.message);
    process.exit(1);
  });
