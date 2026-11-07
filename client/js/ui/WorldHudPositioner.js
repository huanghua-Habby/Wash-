import { Vector3 } from 'three';
import { UI_WIDTH, UI_HEIGHT } from '../core/viewport.js';

/** UIManager-owned projection and bounded damping for every world-anchored label.
 * Camera motion follows immediately; only changes to the anchor receive damping.
 * Distances are design pixels, independent of viewport scaling and render DPR.
 */
export class WorldHudPositioner {
  constructor({ response = 12, maxLag = 6, snapDistance = 64, pixelStep = 0.25, edgeHysteresis = 0.04, now = () => performance.now() } = {}) {
    Object.assign(this, { response, maxLag, snapDistance, pixelStep, edgeHysteresis, now });
    this.point = new Vector3(); this.frame = 0; this.states = new WeakMap();
  }
  begin(camera, dt, { motionEnabled = true, context = '' } = {}) {
    if (context !== this.context) { this.reset(); this.context = context; }
    const time = this.now(), longGap = this.lastFrameTime !== undefined && time - this.lastFrameTime > 250;
    // Game dt is capped by the runtime; use wall time only to recognize resuming
    // after a suspended tab, never to advance gameplay or run another frame loop.
    this.lastFrameTime = time;
    this.camera = camera; this.dt = longGap ? 0 : dt; this.motionEnabled = motionEnabled; this.frame++;
  }
  reset() { this.states = new WeakMap(); }
  hide(node) { node.hidden = true; this.states.delete(node); }
  /**
   * @param {{hidden: boolean, style: {transform: string}}} node
   * @param {Vector3} anchor
   * @param {{visible?: boolean, margin?: number, identity?: string | number | null, immediate?: boolean, screenInsets?: {left: number, right: number, top: number, bottom: number}}} [options]
   */
  place(node, anchor, options = {}) {
    const { visible = true, identity = null, immediate = false, screenInsets = null } = options;
    // A label already on screen leaves a little later than it enters, so an anchor riding the
    // edge cannot strobe on and off with every small camera or vehicle movement.
    const margin = (options.margin ?? Infinity) + (this.states.has(node) ? this.edgeHysteresis : 0);
    this.point.copy(anchor).project(this.camera);
    if (!visible || !Number.isFinite(this.point.x + this.point.y + this.point.z) ||
        this.point.z < -1 || this.point.z > 1 || Math.abs(this.point.x) >= margin || Math.abs(this.point.y) >= margin) {
      this.hide(node); return;
    }
    let x = (this.point.x + 1) * UI_WIDTH / 2, y = (1 - this.point.y) * UI_HEIGHT / 2;
    if (screenInsets) {
      x = Math.max(screenInsets.left, Math.min(UI_WIDTH-screenInsets.right, x));
      y = Math.max(screenInsets.top, Math.min(UI_HEIGHT-screenInsets.bottom, y));
    }
    let state = this.states.get(node);
    if (!state) {
      state = { world: new Vector3(), x, y, rawX: x, rawY: y, frame: -1, identity };
      this.states.set(node, state);
    }
    // Reproject the old raw anchor through the final camera of this frame,
    // carrying pans and zooms without making the label trail the camera.
    this.point.copy(state.world).project(this.camera);
    let previousX = (this.point.x + 1) * UI_WIDTH / 2, previousY = (1 - this.point.y) * UI_HEIGHT / 2;
    if (screenInsets) {
      previousX = Math.max(screenInsets.left, Math.min(UI_WIDTH-screenInsets.right, previousX));
      previousY = Math.max(screenInsets.top, Math.min(UI_HEIGHT-screenInsets.bottom, previousY));
    }
    const snap = immediate || state.frame !== this.frame - 1 || state.identity !== identity || !this.motionEnabled ||
      this.dt <= 0 || this.dt > 0.25 || !Number.isFinite(previousX + previousY) ||
      Math.hypot(x - previousX, y - previousY) > this.snapDistance;
    if (snap) { state.x = x; state.y = y; }
    else {
      state.x += previousX - state.rawX; state.y += previousY - state.rawY;
      const alpha = 1 - Math.exp(-this.response * this.dt);
      state.x += (x - state.x) * alpha; state.y += (y - state.y) * alpha;
      const dx = state.x - x, dy = state.y - y, distance = Math.hypot(dx, dy);
      if (distance > this.maxLag) {
        state.x = x + dx * this.maxLag / distance; state.y = y + dy * this.maxLag / distance;
      }
    }
    state.world.copy(anchor); state.rawX = x; state.rawY = y; state.frame = this.frame; state.identity = identity;
    node.hidden = false;
    const px = Math.round(state.x / this.pixelStep) * this.pixelStep;
    const py = Math.round(state.y / this.pixelStep) * this.pixelStep;
    const transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
    if (node.style.transform !== transform) node.style.transform = transform;
  }
}
