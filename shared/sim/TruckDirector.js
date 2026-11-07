/** Shared fleet motion; level configuration, random source and speed are injected by the owner. */
import { FIRST_LEVEL_ID, getLevel } from '../levels.js';

// 控制两辆车的相对节奏：一会儿洗车飞车冲到前面，一会儿蓝车超回来；
// 车距也会在“舒适”与“贴得很紧”之间变化。用弹簧阻尼让变化有惯性、略带回弹。
/** Home-menu terminal hack (HACK_CONSOLE.md): the partner truck speeds off for `seconds`, then a fresh one drives in
 * from behind. */
export const PRACTICE_AWAY = Object.freeze({ seconds: 2, accel: 40, maxSpeed: 45, enterFrom: -36, enterSpeed: 10 });

export class TruckDirector {
  constructor(a, b, { speedMultiplier = () => 1, random = Math.random, motion = getLevel(FIRST_LEVEL_ID).home.motion } = {}) {
    this.speedMultiplier = speedMultiplier; this.random = random; this.motion = motion;
    this.a = a;
    this.b = b;
    this.t = 0;
    this.base = motion.speed;
    this.sa = { x: motion.initialX[0], v: 0, target: motion.initialX[0] };
    this.sb = { x: motion.initialX[1], v: 0, target: motion.initialX[1] };
    this.phaseTimer = motion.phaseDelay;
    this.gap = motion.initialGap;
    this.gapV = 0;
    this.gapTarget = motion.initialGap;
    this.gapTimer = motion.gapDelay;
    this.away = 0; // > 0 while the partner truck is sent away by a home-menu hack
  }

  // Edge-to-edge distance between the two hulls.
  get clearance() { return this.gap - (this.a.spec.width + this.b.spec.width) / 2; }
  get leader() { return this.sa.x - this.sb.x > 1.2 ? 'a' : this.sb.x - this.sa.x > 1.2 ? 'b' : null; }

  captureState() {
    const { t, base, sa, sb, phaseTimer, gap, gapV, gapTarget, gapTimer, away } = this;
    return { t, base, sa: { ...sa }, sb: { ...sb }, phaseTimer, gap, gapV, gapTarget, gapTimer, away };
  }

  restoreState(state) {
    Object.assign(this, { away: 0 }, state, { sa: { ...state.sa }, sb: { ...state.sb } });
  }

  /** Home-menu hack: send the partner truck away (false while it is already away). */
  sendAway() { if (this.away > 0) return false; this.away = PRACTICE_AWAY.seconds; return true; }

  update(dt) {
    this.t += dt;
    const t = this.t, m = this.motion;
    const range = ([min, max]) => min + this.random() * (max - min);
    this.base = (m.speed + m.speedWaves.reduce((sum, [amplitude, frequency]) => sum + amplitude * Math.sin(t * frequency), 0)) * this.speedMultiplier();

    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) {
      this.phaseTimer = range(m.phaseInterval);
      const leadA = this.random() < 0.5;
      const lead = leadA ? this.sa : this.sb;
      const other = leadA ? this.sb : this.sa;
      lead.target = range(m.leadRange);
      other.target = range(m.followRange);
      if (this.random() < m.parallelChance) lead.target = other.target = range(m.parallelRange); // 并排巡航
    }
    for (const s of [this.sa, this.sb]) {
      if (s === this.sb && this.away > 0) continue;
      s.v += (m.longitudinalSpring * (s.target - s.x) - m.longitudinalDamping * s.v) * dt;
      s.x += s.v * dt;
    }
    if (this.away > 0) {
      // Sent away: flat out forward and off screen; when the time is up a fresh partner drives in from behind.
      const s = this.sb; s.v = Math.min(PRACTICE_AWAY.maxSpeed, s.v + PRACTICE_AWAY.accel * dt); s.x += s.v * dt;
      this.away = this.away - dt < 1e-9 ? 0 : this.away - dt;
      // A new generation tells viewers this is a teleport: they snap instead of interpolating the jump across the screen.
      if (!this.away) { s.x = PRACTICE_AWAY.enterFrom; s.v = PRACTICE_AWAY.enterSpeed; this.b.generation = (this.b.generation || 0) + 1; }
    }

    this.gapTimer -= dt;
    if (this.gapTimer <= 0) {
      this.gapTimer = range(m.gapInterval);
      this.gapTarget = this.random() < m.closeGapChance ? range(m.closeGapRange) : range(m.cruiseGapRange);
    }
    this.gapV += (m.gapSpring * (this.gapTarget - this.gap) - m.gapDamping * this.gapV) * dt;
    this.gap += this.gapV * dt;

    const drift = m.driftAmplitude * Math.sin(t * m.driftFrequency);
    const driftV = m.driftAmplitude * m.driftFrequency * Math.cos(t * m.driftFrequency);
    // 红车 A 在靠近镜头的一侧
    this.a.setState(this.sa.x, drift + (m.centerHome ? 0 : this.gap / 2), this.sa.v, driftV + (m.centerHome ? 0 : this.gapV / 2), this.base);
    this.b.setState(this.sb.x, drift - (m.centerHome ? this.gap : this.gap / 2), this.sb.v, driftV - (m.centerHome ? this.gapV : this.gapV / 2), this.base);
    // 伙伴车贴着玩家车顶面飞，带一点持续的细微高度变化
    const ay = this.a.pos.y, by = this.b.pos.y;
    this.a.setAltitude(this.a.spec.hover);
    this.b.setAltitude(this.a.spec.hover + this.a.spec.top - this.b.spec.top + m.roofWobble * Math.sin(t * 0.83 + 1.1) + m.roofWobble * 0.4 * Math.sin(t * 2.1));
    this.a.vel.y = dt > 0 ? (this.a.pos.y - ay) / dt : 0;
    this.b.vel.y = dt > 0 ? (this.b.pos.y - by) / dt : 0;
  }
}
