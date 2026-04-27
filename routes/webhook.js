/**
 * GitHub Webhook — 自動部署路由
 * 
 * 當 GitHub 收到 push 事件時，觸發自動部署腳本。
 * 此路由不經過 JWT 驗證，改用 HMAC-SHA256 簽名驗證。
 * 
 * 設定方式:
 *   1. GitHub repo → Settings → Webhooks → Add webhook
 *   2. Payload URL: https://<your-public-host>/webhook/deploy
 *      (例如 Tailscale Funnel / Cloudflare Tunnel / 公網 IP 經 nginx)
 *   3. Content type: application/json
 *   4. Secret: (同 .env 中的 DEPLOY_WEBHOOK_SECRET)
 *   5. Events: Just the push event
 */

const express = require('express');
const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');
const router = express.Router();

const DEPLOY_SCRIPT = path.resolve(__dirname, '../scripts/deploy.sh');

/**
 * 驗證 GitHub webhook 簽名 (HMAC-SHA256)
 * 使用 rawBody (由 express.json verify 回調儲存) 避免重新序列化差異
 */
function verifySignature(req) {
    const secret = process.env.DEPLOY_WEBHOOK_SECRET;
    if (!secret) return false;

    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return false;

    // 優先使用原始 body bytes，避免 JSON 序列化差異
    const body = req.rawBody || JSON.stringify(req.body);
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

/**
 * POST /webhook/deploy — GitHub push event handler
 */
router.post('/deploy', (req, res) => {
    // 1. 驗證簽名
    if (!verifySignature(req)) {
        console.warn('[Webhook] Invalid signature from', req.ip);
        return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. 只處理 push 事件
    const event = req.headers['x-github-event'];
    if (event !== 'push') {
        return res.status(200).json({ message: `Ignored event: ${event}` });
    }

    // 3. 只處理 main branch
    const ref = req.body.ref;
    if (ref !== 'refs/heads/main') {
        return res.status(200).json({ message: `Ignored branch: ${ref}` });
    }

    const pusher = req.body.pusher?.name || 'unknown';
    const commitMsg = req.body.head_commit?.message || '';
    console.log(`[Webhook] Deploy triggered by ${pusher}: ${commitMsg}`);

    // 4. 非同步執行部署腳本
    res.status(202).json({ message: 'Deploy started', pusher, commit: commitMsg });

    execFile('bash', [DEPLOY_SCRIPT], { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
            console.error('[Webhook] Deploy failed:', error.message);
            console.error('[Webhook] stderr:', stderr);
        } else {
            console.log('[Webhook] Deploy output:', stdout);
        }
    });
});

/**
 * GET /webhook/status — 部署狀態 (需 admin token)
 */
router.get('/status', (req, res) => {
    const adminToken = req.headers['x-admin-token'];
    if (adminToken !== process.env.ADMIN_API_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const fs = require('fs');
    const logsPath = '/opt/tree-app/logs/deploy.log';
    
    try {
        const content = fs.readFileSync(logsPath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const recent = lines.slice(-30);
        res.json({ recentLogs: recent });
    } catch {
        res.json({ recentLogs: ['No deploy logs found'] });
    }
});

module.exports = router;
