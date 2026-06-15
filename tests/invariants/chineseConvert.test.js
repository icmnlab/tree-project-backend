/**
 * invariants/chineseConvert.test.js — utils/chineseConvert.js 純函式單元
 *
 * 驗證簡體 → 台灣繁體轉換（樹種俗名一致性的進入點防線）。
 * 純函式，不需 BASE_URL / DB，於無 server 時亦可執行。
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { toTraditional, toTraditionalList } = require(
  path.resolve(__dirname, '..', '..', 'utils', 'chineseConvert.js'),
);

module.exports = {
  section: 'invariants',
  cases: [
    {
      name: 'chineseConvert.toTraditional: 簡體樹種俗名 → 台灣繁體',
      run: async () => {
        assert.strictEqual(toTraditional('银枫树'), '銀楓樹');
        assert.strictEqual(toTraditional('桦树'), '樺樹');
        assert.strictEqual(toTraditional('枫香'), '楓香');
        assert.strictEqual(toTraditional('樟树'), '樟樹');
      },
    },
    {
      name: 'chineseConvert.toTraditional: 已是繁體為無操作（idempotent）',
      run: async () => {
        assert.strictEqual(toTraditional('銀楓樹'), '銀楓樹');
        assert.strictEqual(toTraditional('楓香'), '楓香');
        assert.strictEqual(toTraditional('臺灣欒樹'), '臺灣欒樹');
      },
    },
    {
      name: 'chineseConvert.toTraditional: 非字串/空值原樣回傳',
      run: async () => {
        assert.strictEqual(toTraditional(''), '');
        assert.strictEqual(toTraditional(null), null);
        assert.strictEqual(toTraditional(undefined), undefined);
        assert.strictEqual(toTraditional(123), 123);
      },
    },
    {
      name: 'chineseConvert.toTraditionalList: 逐項轉換並去重',
      run: async () => {
        const out = toTraditionalList(['银枫树', '銀楓樹', '枫香']);
        // 银枫树 與 銀楓樹 轉換後相同 → 去重保留一個
        assert.deepStrictEqual(out, ['銀楓樹', '楓香']);
      },
    },
    {
      name: 'chineseConvert.toTraditionalList: 非陣列原樣回傳',
      run: async () => {
        assert.strictEqual(toTraditionalList(null), null);
        assert.strictEqual(toTraditionalList('x'), 'x');
      },
    },
  ],
};
