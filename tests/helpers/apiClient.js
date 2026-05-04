/**
 * helpers/apiClient.js — 統一 HTTP client
 *
 * - 自動處理 http/https
 * - token 注入
 * - JSON parse fallback（後端錯誤時可能回 plain text）
 * - timeout（預設 30s）
 * - VERBOSE 模式下印出 method/path/status
 *
 * 用法：
 *   const { Api } = require('./helpers/apiClient');
 *   const api = new Api();                   // 用 config.BASE_URL
 *   await api.login('admin');                // 自動填 token，回 { token, user }
 *   const r = await api.get('tree_survey');  // path 不要加前導 /
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { BASE_URL, USERS, flags } = require('../config');

class Api {
    constructor({ baseUrl = BASE_URL, timeout = 30000 } = {}) {
        this.baseUrl = baseUrl;
        this.timeout = timeout;
        this.token = null;
        this.user = null;
    }

    setToken(token) {
        this.token = token || null;
    }

    async login(roleKey) {
        const u = USERS[roleKey];
        if (!u) throw new Error(`unknown user role: ${roleKey}`);
        const r = await this.post('login', {
            account: u.username,
            password: u.password,
            loginType: u.loginType,
        });
        if (r.statusCode !== 200 || !r.body || r.body.success === false) {
            throw new Error(`login(${roleKey}) failed: HTTP ${r.statusCode} ${JSON.stringify(r.body).slice(0, 200)}`);
        }
        this.token = r.body.token || null;
        this.user = r.body.user || null;
        return r.body;
    }

    request(method, path, { body, token, headers = {}, query } = {}) {
        return new Promise((resolve, reject) => {
            const cleanPath = String(path || '').replace(/^\/+/, '');
            let url;
            try {
                url = new URL(`${this.baseUrl}/${cleanPath}`);
            } catch (e) {
                return reject(new Error(`bad URL: ${this.baseUrl}/${cleanPath}`));
            }
            if (query && typeof query === 'object') {
                for (const [k, v] of Object.entries(query)) {
                    if (v === undefined || v === null) continue;
                    url.searchParams.append(k, String(v));
                }
            }

            const useToken = token === undefined ? this.token : token;
            const finalHeaders = {
                'Accept': 'application/json',
                ...headers,
            };
            let payload = null;
            if (body !== undefined && body !== null) {
                payload = typeof body === 'string' ? body : JSON.stringify(body);
                finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
                finalHeaders['Content-Length'] = Buffer.byteLength(payload);
            }
            if (useToken) {
                finalHeaders['Authorization'] = `Bearer ${useToken}`;
            }

            const isHttps = url.protocol === 'https:';
            const lib = isHttps ? https : http;
            const opts = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: method.toUpperCase(),
                headers: finalHeaders,
            };
            // Tailscale 自簽憑證 / 開發環境需放行
            if (isHttps && process.env.TEST_TLS_INSECURE === 'true') {
                opts.rejectUnauthorized = false;
            }

            if (flags.VERBOSE) {
                console.log(`  → ${opts.method} ${url.pathname}${url.search}${payload ? ' body=' + payload.slice(0, 200) : ''}`);
            }

            const req = lib.request(opts, (res) => {
                let chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let parsed = raw;
                    const ct = res.headers['content-type'] || '';
                    if (ct.includes('json') || (raw.trim().startsWith('{') || raw.trim().startsWith('['))) {
                        try { parsed = JSON.parse(raw); } catch (_) { /* keep raw */ }
                    }
                    if (flags.VERBOSE) {
                        console.log(`  ← ${res.statusCode} ${typeof parsed === 'string' ? parsed.slice(0, 120) : JSON.stringify(parsed).slice(0, 200)}`);
                    }
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
                });
            });

            req.on('error', reject);
            req.setTimeout(this.timeout, () => {
                req.destroy();
                reject(new Error(`timeout ${this.timeout}ms: ${opts.method} ${opts.path}`));
            });

            if (payload) req.write(payload);
            req.end();
        });
    }

    get(path, opts) { return this.request('GET', path, opts); }
    post(path, body, opts = {}) { return this.request('POST', path, { ...opts, body }); }
    put(path, body, opts = {}) { return this.request('PUT', path, { ...opts, body }); }
    patch(path, body, opts = {}) { return this.request('PATCH', path, { ...opts, body }); }
    delete(path, opts) { return this.request('DELETE', path, opts); }
}

module.exports = { Api };
