/** Authoring data is separate from vehicle geometry and from the existing client shader. */
export const MAX_STAINS = 5;
export const STAIN_KINDS = Object.freeze({
  dust: Object.freeze(['towel']), mud: Object.freeze(['water', 'towel']), grease: Object.freeze(['soap', 'water', 'towel']),
});
export function stainLayout(spec, kinds) {
  const positions = kinds.length <= 3 ? spec.stains : (() => {
    const roof = spec.platforms[0];
    if (kinds.length === 5) {
      const left = roof.x0 + .72, right = roof.x1 - .72, mid = (left + right) / 2;
      return [[left, -.48], [(left + mid) / 2, .48], [mid, -.48], [(mid + right) / 2, .48], [right, -.48]];
    }
    return Array.from({ length: kinds.length }, (_, i) => [roof.x0 + .9 + (roof.x1 - roof.x0 - 1.8) * i / (kinds.length - 1), i % 2 ? .45 : -.45]);
  })();
  return kinds.map((kind, i) => ({ id: `stain-${i}`, kind, position: [...positions[i]] }));
}
export function validateStains(stains, spec) {
  const ids = new Set();
  if (!Array.isArray(stains) || !stains.length || stains.length > MAX_STAINS) throw new Error(`Orders require 1–${MAX_STAINS} prepared stains`);
  for (const stain of stains) {
    const [x, z] = stain.position || [];
    if (!STAIN_KINDS[stain.kind] || typeof stain.id !== 'string' || !stain.id || ids.has(stain.id) ||
        !Number.isFinite(x) || !Number.isFinite(z) || !spec.platforms.some(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1))
      throw new Error('Invalid stain identity, kind or roof position');
    ids.add(stain.id);
  }
}
