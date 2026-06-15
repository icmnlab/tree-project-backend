/**
 * invariants/treeLifecycle.test.js — 樹況→生命週期推導（純邏輯，免 DB）
 */
'use strict';

const assert = require('assert');
const path = require('path');
const {
    lifecycleFromStatus,
    isRetiredLifecycle,
} = require(path.resolve(__dirname, '..', '..', 'utils', 'treeLifecycle.js'));

module.exports = {
    section: 'invariants',
    cases: [
        {
            name: 'lifecycle: 正常/良好/空備註 → active',
            run: async () => {
                assert.strictEqual(lifecycleFromStatus('正常'), 'active');
                assert.strictEqual(lifecycleFromStatus('良好'), 'active');
                assert.strictEqual(lifecycleFromStatus('病蟲害'), 'active');
                assert.strictEqual(lifecycleFromStatus(''), null);
                assert.strictEqual(lifecycleFromStatus(null), null);
            },
        },
        {
            name: 'lifecycle: 枯死/死亡/枯立木 → dead',
            run: async () => {
                assert.strictEqual(lifecycleFromStatus('枯死'), 'dead');
                assert.strictEqual(lifecycleFromStatus('樹木死亡'), 'dead');
                // 枯立木（立枯死木 / snag）為非活立木 → dead（修正 migration 31 漏網）
                assert.strictEqual(lifecycleFromStatus('枯立木'), 'dead');
                assert.strictEqual(lifecycleFromStatus('枯立'), 'dead');
            },
        },
        {
            name: 'lifecycle: 枯萎 → active（可回復逆境，仍屬活立木，非 dead）',
            run: async () => {
                assert.strictEqual(lifecycleFromStatus('枯萎'), 'active');
                // 傾斜為結構性，仍為活立木
                assert.strictEqual(lifecycleFromStatus('傾斜'), 'active');
            },
        },
        {
            name: 'lifecycle: 倒塌/倒伏 → fallen',
            run: async () => {
                assert.strictEqual(lifecycleFromStatus('倒塌'), 'fallen');
                assert.strictEqual(lifecycleFromStatus('倒伏'), 'fallen');
            },
        },
        {
            name: 'lifecycle: 移除/已移除/砍除/砍伐 → removed',
            run: async () => {
                assert.strictEqual(lifecycleFromStatus('已移除'), 'removed');
                assert.strictEqual(lifecycleFromStatus('移除'), 'removed');
                assert.strictEqual(lifecycleFromStatus('砍除'), 'removed');
                assert.strictEqual(lifecycleFromStatus('砍伐'), 'removed');
            },
        },
        {
            name: 'lifecycle: 移除優先於死亡（同時出現時）',
            run: async () => {
                // 「砍除枯死木」應判定為 removed（移除動作優先）
                assert.strictEqual(lifecycleFromStatus('砍除枯死木'), 'removed');
            },
        },
        {
            name: 'isRetiredLifecycle: dead/fallen/removed 為淘汰；active 否',
            run: async () => {
                assert.strictEqual(isRetiredLifecycle('dead'), true);
                assert.strictEqual(isRetiredLifecycle('fallen'), true);
                assert.strictEqual(isRetiredLifecycle('removed'), true);
                assert.strictEqual(isRetiredLifecycle('active'), false);
                assert.strictEqual(isRetiredLifecycle(''), false);
                assert.strictEqual(isRetiredLifecycle(null), false);
            },
        },
    ],
};
