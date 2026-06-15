'use strict';

/**
 * treeLifecycle.js — 樹木生命週期狀態工具（純邏輯，免 DB）
 *
 * 由「樹況（健康狀態文字）」推導生命週期狀態：
 *   active  = 存活 / 恢復正常（納入活立木碳匯與維護待辦）
 *   dead    = 枯死
 *   fallen  = 倒塌
 *   removed = 移除 / 砍除
 *
 * 淘汰木（dead/fallen/removed）依政府「活立木生物量法」(環境部 AR-TMS0001、
 * 林業署森林碳匯調查與監測手冊 表6-4) 不計入活立木碳儲量總計。
 */

const RETIRED_STATES = new Set(['dead', 'fallen', 'removed']);

/**
 * @param {string|null|undefined} status 樹況文字（如「正常」「枯死」「倒塌」「已移除」）
 * @returns {'active'|'dead'|'fallen'|'removed'|null}
 *   null 表示空字串（無法判斷，呼叫端通常視為不變更）。
 */
function lifecycleFromStatus(status) {
  const s = (status || '').trim();
  if (!s) return null;
  if (s.includes('移除') || s.includes('砍除') || s.includes('砍伐')) return 'removed';
  // 枯立木（立枯死木 / snag）與枯死／死亡皆為非活立木；
  // 注意「枯萎」為可回復之逆境壓力，仍屬活立木，不在此列。
  if (s.includes('枯死') || s.includes('死亡') || s.includes('枯立')) return 'dead';
  if (s.includes('倒塌') || s.includes('倒伏')) return 'fallen';
  return 'active';
}

/** 是否為淘汰狀態 */
function isRetiredLifecycle(lifecycle) {
  return RETIRED_STATES.has(String(lifecycle || '').trim());
}

module.exports = { lifecycleFromStatus, isRetiredLifecycle, RETIRED_STATES };
