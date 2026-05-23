/**
 * invariants/boundarySuggest.test.js — 建議邊界 outlier 排除邏輯
 */
const assert = require('assert');
const path = require('path');
const {
    suggestBoundaryFromTrees,
    selectCoreCluster,
} = require(path.resolve(__dirname, '..', '..', 'utils', 'boundarySuggest.js'));

function runTests() {
    const tests = [
        {
            name: '主群集 + 一個遠距 outlier → 排除 outlier',
            fn: () => {
                const trees = [
                    { lng: 120.27, lat: 22.61, system_tree_id: 'A1' },
                    { lng: 120.271, lat: 22.611, system_tree_id: 'A2' },
                    { lng: 120.269, lat: 22.609, system_tree_id: 'A3' },
                    { lng: 121.5, lat: 23.5, system_tree_id: 'FAR' },
                ];
                const { core, excluded } = selectCoreCluster(trees);
                assert.strictEqual(core.length, 3);
                assert.strictEqual(excluded.length, 1);
                assert.strictEqual(excluded[0].system_tree_id, 'FAR');
            },
        },
        {
            name: 'suggestBoundaryFromTrees 成功產生 coordinates',
            fn: () => {
                const trees = [
                    { lng: 120.27, lat: 22.61, system_tree_id: 'B1' },
                    { lng: 120.272, lat: 22.612, system_tree_id: 'B2' },
                    { lng: 120.268, lat: 22.608, system_tree_id: 'B3' },
                    { lng: 120.271, lat: 22.609, system_tree_id: 'B4' },
                ];
                const result = suggestBoundaryFromTrees(trees);
                assert.strictEqual(result.ok, true);
                assert.ok(Array.isArray(result.coordinates));
                assert.ok(result.coordinates.length >= 3);
                assert.ok(result.stats.areaHa > 0);
            },
        },
        {
            name: '樹木不足 3 棵 → INSUFFICIENT_TREES',
            fn: () => {
                const result = suggestBoundaryFromTrees([
                    { lng: 120.27, lat: 22.61, system_tree_id: 'C1' },
                ]);
                assert.strictEqual(result.ok, false);
                assert.strictEqual(result.code, 'INSUFFICIENT_TREES');
            },
        },
    ];

    let passed = 0;
    for (const t of tests) {
        try {
            t.fn();
            console.log(`  ✓ ${t.name}`);
            passed++;
        } catch (e) {
            console.error(`  ✗ ${t.name}: ${e.message}`);
            process.exitCode = 1;
        }
    }
    console.log(`\nboundarySuggest: ${passed}/${tests.length} passed`);
}

runTests();
