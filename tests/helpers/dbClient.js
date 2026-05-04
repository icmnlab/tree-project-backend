/**
 * helpers/dbClient.js — 直連 PG 做 read-only 斷言（可選）
 *
 * 用於 invariants 測試直接驗 row 存在/欄位值，不依賴 API。
 * 沒設 TEST_DB_URL 時 isAvailable() 回 false，測試應 SKIP 而非 fail。
 */
'use strict';

const { DB_URL } = require('../config');

let pool = null;
let initTried = false;

function getPool() {
    if (initTried) return pool;
    initTried = true;
    if (!DB_URL) return null;
    try {
        const { Pool } = require('pg');
        pool = new Pool({
            connectionString: DB_URL,
            max: 3,
            idleTimeoutMillis: 5000,
            connectionTimeoutMillis: 5000,
            ssl: process.env.TEST_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        });
        return pool;
    } catch (e) {
        console.warn('[dbClient] pg module not loaded:', e.message);
        return null;
    }
}

async function query(text, params = []) {
    const p = getPool();
    if (!p) throw new Error('dbClient not available (TEST_DB_URL not set)');
    return p.query(text, params);
}

function isAvailable() {
    return getPool() !== null;
}

async function close() {
    if (pool) {
        await pool.end().catch(() => {});
        pool = null;
    }
}

module.exports = { query, isAvailable, close };
