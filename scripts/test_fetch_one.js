require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { fetchAllowedUrl } = require('../services/agentExternalRetrievalService');
const url = process.argv[2] || 'https://www.moenv.gov.tw/';
fetchAllowedUrl(url).then((r) => {
  console.log(JSON.stringify(r, null, 2).slice(0, 1200));
  process.exit(r.error ? 1 : 0);
});
