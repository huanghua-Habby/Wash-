// Product decision and evidence: docs/domains/wash/PERFORMANCE.md (adaptive animal fur).
// Release default 8 (8 players × 8 shells); 12 is a manual opt-in. Extra (16/20) remains internal capacity, never a release setting or automatic tier.
export const FUR_TIERS = Object.freeze([4, 8, 12]);
export function normalizeFurShells(value) {
  if (!Number.isFinite(value)) return 8;
  return value >= 12 ? 12 : value >= 8 ? 8 : 4;
}
export const FUR_STATUS = { shells: 8, reason: '默认画质' };
