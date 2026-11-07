/** CPU contact proxy for the existing WetSurfaces depth field, using identical shape/drying parameters.
 * A threshold excludes almost-transparent fringes; no GPU readback or change to the artist's shader. */
const fract = n => n - Math.floor(n);
/** Re-time one splash without restarting its fade-in or changing its shape. */
export function dryWetMark(mark, time, seconds) {
  const age = time - mark.birth;
  if (!mark.radius || age < 0 || mark.dry - age <= seconds) return false;
  const progress = Math.max(0, age / mark.dry);
  let dry = seconds / (1 - progress), newAge = progress * dry;
  if (age < .1) { newAge = age; dry = age + seconds; }
  else if (newAge < .1) { dry = .1 / progress; newAge = .1; }
  mark.birth = time - newAge; mark.dry = dry;
  return true;
}
const clamp = n => Math.min(1, Math.max(0, n));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), u), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
function fbm(x, y) {
  let sum = 0, amount = .5;
  for (let i = 0; i < 4; i++) { sum += amount * noise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; amount *= .5; }
  return sum;
}
export function wetCoverage(m, x, z, time) {
  if (!m.id || time < m.birth || time >= m.birth + m.dry) return 0;
  const dx = x - m.x, dz = z - m.z, cos = Math.cos(m.angle), sin = Math.sin(m.angle);
  const u = (dx * cos - dz * sin) / (m.radius * m.stretch), v = (dx * sin + dz * cos) / m.radius;
  if (Math.abs(u) > 1 || Math.abs(v) > 1) return 0;
  const r = Math.hypot(u, v);
  let depth = (1 - r) * .8 + (fbm(u * 1.7 + m.seed * 13, v * 1.7 + m.seed * 13) - .5) * .75 + .12;
  const gx = u * 3.3 + m.seed * 7, gy = v * 3.3 + m.seed * 7, cx = Math.floor(gx), cy = Math.floor(gy);
  const ox = (hash(cx + 1.3, cy + 1.3) - .5) * .45, oy = (hash(cx + 2.7, cy + 2.7) - .5) * .45;
  const drop = (.06 + .16 * hash(cx + m.seed, cy + m.seed) - Math.hypot(fract(gx) - .5 - ox, fract(gy) - .5 - oy)) * 2.2;
  if (r <= 1 && hash(cx + 4.1, cy + 4.1) >= .45) depth = Math.max(depth, drop);
  const age = time - m.birth, level = clamp(age / m.dry) * .95;
  return smooth(level, level + .1, depth) * smooth(0, .1, age);
}
