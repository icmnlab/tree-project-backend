#!/usr/bin/env node
/**
 * tests/runner.js — 測試 runner
 *
 * 用法：
 *   node tests/runner.js                       # 跑全部
 *   node tests/runner.js --section=invariants  # 只跑 invariants/
 *   node tests/runner.js --filter=county       # 名稱含 county 的 case
 *   node tests/runner.js --bail                # 首個 fail 就停
 *   node tests/runner.js --verbose             # 印 request/response
 *   node tests/runner.js --list                # 只列出 case
 *   node tests/runner.js --local               # base_url 走 localhost:3001
 *
 * 寫測試：
 *   tests/{invariants,journeys,contracts}/{name}.test.js
 *   module.exports = {
 *     section: 'invariants',                   // 自動依資料夾推斷，可省略
 *     cases: [
 *       { name: 'short description', skip?: bool|reason, run: async (ctx) => { ... } },
 *       ...
 *     ],
 *   };
 *
 * ctx 內容：{ api, db, cleanup, assert, factories, config }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Api } = require('./helpers/apiClient');
const dbClient = require('./helpers/dbClient');
const { TestContext } = require('./helpers/cleanup');
const asserts = require('./helpers/asserts');
const factories = require('./helpers/factories');

const ROOT = path.join(__dirname);
const SECTION_DIRS = ['invariants', 'journeys', 'contracts'];

function discoverFiles() {
    const files = [];
    for (const sec of SECTION_DIRS) {
        const dir = path.join(ROOT, sec);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.test.js')) continue;
            files.push({ section: sec, file: path.join(dir, f), name: f.replace(/\.test\.js$/, '') });
        }
    }
    return files;
}

function loadCases() {
    const files = discoverFiles();
    const all = [];
    for (const f of files) {
        let mod;
        try {
            mod = require(f.file);
        } catch (e) {
            console.error(`[load] ${f.file} threw: ${e.stack || e}`);
            continue;
        }
        const cases = mod.cases || [];
        const section = mod.section || f.section;
        for (const c of cases) {
            all.push({
                section,
                file: f.name,
                name: c.name,
                fullName: `${section}/${f.name} :: ${c.name}`,
                skip: c.skip,
                run: c.run,
            });
        }
    }
    return all;
}

function color(code, s) {
    if (process.env.NO_COLOR) return s;
    return `\x1b[${code}m${s}\x1b[0m`;
}
const green = s => color('32', s);
const red = s => color('31', s);
const yellow = s => color('33', s);
const dim = s => color('90', s);
const bold = s => color('1', s);

async function main() {
    const all = loadCases();

    let cases = all;
    if (config.flags.SECTION) {
        cases = cases.filter(c => c.section === config.flags.SECTION);
    }
    if (config.flags.FILTER) {
        const f = String(config.flags.FILTER).toLowerCase();
        cases = cases.filter(c => c.fullName.toLowerCase().includes(f));
    }

    if (config.flags.LIST) {
        console.log(`\n${bold('Discovered cases:')} (${cases.length})`);
        for (const c of cases) console.log(`  - ${c.fullName}${c.skip ? dim(' [SKIP]') : ''}`);
        return 0;
    }

    if (cases.length === 0) {
        console.log(yellow('\n  No cases matched.\n'));
        return 0;
    }

    console.log(`\n${bold('═══ TreeAI Test Runner ═══')}`);
    console.log(`  base    ${config.BASE_URL}`);
    console.log(`  test_id ${config.TEST_ID}`);
    console.log(`  cases   ${cases.length}${config.flags.SECTION ? ` (section=${config.flags.SECTION})` : ''}${config.flags.FILTER ? ` (filter=${config.flags.FILTER})` : ''}`);
    console.log('');

    const api = new Api();
    const results = { pass: 0, fail: 0, skip: 0, failures: [] };
    const startedAt = Date.now();
    let lastSection = null;

    for (const c of cases) {
        if (c.section !== lastSection) {
            console.log(`\n${bold('▸ ' + c.section)}`);
            lastSection = c.section;
        }

        if (c.skip) {
            const reason = typeof c.skip === 'string' ? c.skip : 'skipped';
            console.log(`  ${dim('○')} ${c.fullName} ${dim(`(${reason})`)}`);
            results.skip++;
            continue;
        }

        const ctx = {
            api,
            db: dbClient,
            cleanup: new TestContext(c.fullName),
            assert: asserts,
            factories,
            config,
        };

        const t0 = Date.now();
        try {
            await c.run(ctx);
            const dt = Date.now() - t0;
            console.log(`  ${green('✓')} ${c.fullName} ${dim(`(${dt}ms)`)}`);
            results.pass++;
        } catch (e) {
            const dt = Date.now() - t0;
            console.log(`  ${red('✗')} ${c.fullName} ${dim(`(${dt}ms)`)}`);
            console.log(`    ${red(e.message || e)}`);
            if (config.flags.VERBOSE && e.stack) console.log(dim(e.stack));
            results.fail++;
            results.failures.push({ name: c.fullName, error: e.message || String(e) });
        } finally {
            // 一律嘗試清理
            const errs = await ctx.cleanup.cleanup(api).catch(() => []);
            if (errs && errs.length && config.flags.VERBOSE) {
                console.log(dim('    cleanup warnings: ' + errs.join('; ')));
            }
        }

        if (results.fail > 0 && config.flags.BAIL) {
            console.log(yellow('\n  --bail triggered, stopping.'));
            break;
        }
    }

    await dbClient.close();

    const dt = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n${bold('═══ Summary ═══')}`);
    console.log(`  ${green(results.pass + ' pass')}, ${results.fail ? red(results.fail + ' fail') : '0 fail'}, ${dim(results.skip + ' skip')}  in ${dt}s`);
    if (results.failures.length) {
        console.log(`\n  ${red('Failures:')}`);
        for (const f of results.failures) console.log(`    - ${f.name}: ${f.error}`);
    }
    console.log('');

    return results.fail > 0 ? 1 : 0;
}

main().then(code => process.exit(code), err => {
    console.error('\nrunner crashed:', err);
    process.exit(2);
});
