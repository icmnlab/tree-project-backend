require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getLlmHealth } = require('../services/llmProviderHealth');

getLlmHealth(true)
    .then((h) => {
        console.log('defaultModel:', h.defaultModel);
        console.log('providers:', h.providers);
        console.log('categories:', h.categories.map((c) => c.category));
        process.exit(0);
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
