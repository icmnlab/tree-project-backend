/**
 * helpers/cleanup.js — 測試資料清理 tracker
 *
 * 設計：
 * - 每個 test 開始時 new TestContext()
 * - 建立任何資源時 ctx.track(kind, identifier)
 * - test 結束時 ctx.cleanup(api)，自動反向刪除
 * - 即使 test 中途 throw 也保證清理（runner 會 finally 觸發）
 *
 * 支援 kind：
 *   project  → DELETE /projects/:code
 *   area     → DELETE /project_areas/:id
 *   user     → DELETE /users/:id
 *   tree     → DELETE /tree_survey/:id
 *   pendingSession → DELETE /pending-measurements/session/:sessionId
 *   custom   → 傳 fn，自定義清理邏輯
 */
'use strict';

class TestContext {
    constructor(name) {
        this.name = name;
        this.resources = []; // { kind, id, fn? }
    }

    track(kind, id, fn) {
        this.resources.push({ kind, id, fn });
        return id;
    }

    /**
     * 反向清理。失敗不 throw（避免覆蓋原 test 失敗原因）。
     */
    async cleanup(api) {
        const errors = [];
        for (let i = this.resources.length - 1; i >= 0; i--) {
            const r = this.resources[i];
            try {
                if (r.fn) {
                    await r.fn(api);
                    continue;
                }
                switch (r.kind) {
                    case 'project':
                        await api.delete(`projects/${encodeURIComponent(r.id)}`);
                        break;
                    case 'area':
                        await api.delete(`project_areas/${encodeURIComponent(r.id)}`);
                        break;
                    case 'user':
                        await api.delete(`users/${encodeURIComponent(r.id)}`);
                        break;
                    case 'tree':
                        await api.delete(`tree_survey/${encodeURIComponent(r.id)}`);
                        break;
                    case 'pendingSession':
                        await api.delete(`pending-measurements/session/${encodeURIComponent(r.id)}`);
                        break;
                    default:
                        errors.push(`unknown kind: ${r.kind}`);
                }
            } catch (e) {
                errors.push(`cleanup ${r.kind}/${r.id}: ${e.message}`);
            }
        }
        return errors;
    }
}

module.exports = { TestContext };
