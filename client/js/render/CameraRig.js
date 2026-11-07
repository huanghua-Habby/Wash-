import * as THREE from 'three';
import { damp } from '../../../shared/sim/util.js';
import { CFG, DEFAULTS } from '../core/config.js';
import { viewportSize } from '../core/viewport.js';

/** Default gameplay FOV (CFG.camera.playFov); the player's 镜头视野 setting moves it and shifts the home camera with it. */
const DEFAULT_GAMEPLAY_FOV = DEFAULTS.camera.playFov;
const gameplayFov = () => Number(CFG.camera.playFov) || DEFAULT_GAMEPLAY_FOV;

// 长焦、高俯角的“立体模型”相机：平滑跟随 + 鼠标视差 + 车速带来的 FOV 呼吸与轻微抖动
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.offset = new THREE.Vector3(CFG.camera.offsetX, CFG.camera.offsetY, CFG.camera.offsetZ);
    this.target = new THREE.Vector3(0, 2, 0);
    this.fovBase = 29;
    this.mouse = new THREE.Vector2();
    this.mouseS = new THREE.Vector2();
    this.t = 0;
    this.screenBias = 0;
    this.framingFov = 0;
    this.gameplayPose = null;
    this.gameplayProgress = 0;
    this.zoomScale = 1; // Per-browser gameplay view only; never saved or sent with player input.
    this.gameplayOffset = new THREE.Vector3();
    this.gameplayTargets = null;
    this._off = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._shake = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._cameraUp = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._recoil = new THREE.Vector3();
    // Local elephant trunk recoil: a steady rumble while spraying and a sharp kick when the jet opens.
    this.recoil = 0; this.recoilTarget = 0; this.recoilKick = 0; this.recoilOn = false; this.recoilT = 0; this.knockoutT = Infinity;
    this.syncGameplayFrame();
    this.followDistance = this.gameplayOffset.length();
  }

  /** One sharp jolt (the local player was slapped); reuses the recoil kick, so it obeys the recoil shake setting. */
  hitShake(strength = 0.7) { this.recoilKick = Math.max(this.recoilKick, strength); }

  /** Knock-off feedback (the local player knocked someone off): one soft, round thump instead of a jittery buzz: the view
   * dips and springs back on a damped low-frequency wave for about half a second. Obeys the recoil shake setting. */
  knockoutShake() { this.knockoutT = 0; }

  /** 1 while the local player's trunk jet is open, else 0. */
  setRecoil(level) { this.recoilTarget = level; }

  get gameplayFov() { return gameplayFov() * this.zoomScale; }

  /** UIManager supplies normalized vertical wheel pixels after checking its input gates. */
  zoomByWheel(delta) {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.zoomScale = THREE.MathUtils.clamp(this.zoomScale * Math.exp(THREE.MathUtils.clamp(delta, -240, 240) * .002), .5, 1.5);
  }

  resetRecoil() {
    this.recoil = this.recoilTarget = this.recoilKick = this.recoilT = 0;
    this.recoilOn = false; this._recoil.set(0, 0, 0); this.knockoutT = Infinity;
  }

  /** Screen-space shake offset for this frame (camera right/up), already scaled by CFG.camera.recoilShake. */
  recoilOffset(dt) {
    const target = this.recoilTarget;
    if (target > 0 && !this.recoilOn) this.recoilKick = 1;
    this.recoilOn = target > 0;
    this.recoil = damp(this.recoil, target, target > this.recoil ? 20 : 6, dt);
    this.recoilKick = Math.max(0, this.recoilKick - dt * 4.5);
    this.recoilT += dt;
    const t = this.recoilT, amount = 0.03 * this.recoil + 0.17 * this.recoilKick * this.recoilKick;
    this._recoil.copy(this._right).multiplyScalar((Math.sin(t * 41) * 0.6 + Math.sin(t * 67 + 2) * 0.4) * amount)
      .addScaledVector(this._cameraUp, (Math.sin(t * 53 + 1) * 0.6 + Math.sin(t * 29) * 0.4) * amount - this.recoilKick * 0.05);
    if (this.knockoutT < 0.7) {
      const k = this.knockoutT, decay = Math.exp(-k * 8) * 0.2;
      this._recoil.addScaledVector(this._cameraUp, -Math.cos(k * 34) * decay).addScaledVector(this._right, Math.sin(k * 44) * decay * 0.45);
      this.knockoutT += dt;
    }
    return this._recoil.multiplyScalar(CFG.camera.recoilShake ?? 1);
  }

  /** AppManager owns registration/cancellation; the rig only interprets the pointer. */
  handlePointerMove(event) {
    const rect = document.getElementById('app-frame').getBoundingClientRect();
    this.mouse.set(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  // Unity Wash uses ~60 degrees down from horizontal; the gameplay pitch, distance and FOV are tunable in the debug panel.
  syncGameplayFrame() {
    const { playPitch, playDistance } = CFG.camera;
    if (this._pitch === playPitch && this._distance === playDistance) return;
    this._pitch = playPitch; this._distance = playDistance;
    const pitch = playPitch * Math.PI / 180;
    this.gameplayOffset.set(-playDistance * Math.cos(pitch), playDistance * Math.sin(pitch), 0);
    this._direction.copy(this.gameplayOffset).normalize();
    this._forward.copy(this._direction).negate();
    this._right.crossVectors(this._forward, this._up).normalize();
    this._cameraUp.crossVectors(this._right, this._forward).normalize();
  }

  snap(focus) {
    this.target.copy(focus);
    this.update(0, focus, 0);
  }

  beginGameplay() {
    this.gameplayPose = {
      target: this.target.clone(),
      offset: this.camera.position.clone().sub(this.target),
      fov: this.camera.fov,
      bias: this.screenBias,
      rotation: this.camera.quaternion.clone(),
    };
    this.gameplayProgress = 0;
  }

  resetGameplay() { this.resetRecoil(); this.gameplayPose = null; this.gameplayProgress = 0; this.gameplayTargets = null; this.followDistance = this.gameplayOffset.length(); }

  followGameplay(focus, points, { safetyPoints = points, minDistance = this.gameplayOffset.length() } = {}) {
    this.gameplayTargets = { focus, points, safetyPoints, minDistance };
  }

  updateGameplayFollow(dt) {
    this.syncGameplayFrame();
    const { focus, points, safetyPoints, minDistance } = this.gameplayTargets;
    this.target.lerp(focus, 1 - Math.exp(-3.2 * dt));
    const direction = this._direction, forward = this._forward, right = this._right, up = this._cameraUp;
    const fov = this.gameplayFov, halfHeight = Math.tan(fov * Math.PI / 360);
    const fitDistance = (targets, minimum) => {
      let distance = minimum;
      for (const point of targets) {
        const delta = this._delta.copy(point).sub(this.target);
        const depth = delta.dot(forward);
        distance = Math.max(distance,
          Math.abs(delta.dot(up)) / (halfHeight * 0.78) - depth,
          Math.abs(delta.dot(right)) / (halfHeight * this.camera.aspect * 0.88) - depth);
      }
      return distance;
    };
    const desired = fitDistance(points, minDistance);
    const playerMinimum = fitDistance(safetyPoints, this.gameplayOffset.length());
    // Only the local player's motion can demand an immediate safety expansion.
    this.followDistance = Math.max(playerMinimum, damp(this.followDistance, desired, 3.2, dt));
    this.camera.position.copy(this.target).addScaledVector(direction, this.followDistance);
    this.camera.lookAt(this.target);
    this.camera.position.add(this.recoilOffset(dt));
    this.camera.fov = fov;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  update(dt, focus, speed01) {
    if (this.gameplayPose) {
      if (this.gameplayProgress === 1 && this.gameplayTargets) { this.updateGameplayFollow(dt); return; }
      this.syncGameplayFrame();
      const pose = this.gameplayPose;
      const progress = this.gameplayProgress;
      this.target.copy(pose.target).lerp(focus, progress);
      this._off.copy(pose.offset).lerp(this.gameplayOffset, progress);
      const cam = this.camera;
      cam.position.copy(this.target).add(this._off);
      cam.lookAt(this.target);
      // Preserve the first pose exactly, including its tiny menu camera roll.
      cam.quaternion.slerp(pose.rotation, 1 - progress);
      cam.fov = pose.fov + (this.gameplayFov - pose.fov) * progress;
      const { width, height } = viewportSize();
      const bias = pose.bias * (1 - progress);
      if (bias) cam.setViewOffset(width, height, width * bias, 0, width, height);
      else cam.clearViewOffset();
      cam.updateProjectionMatrix();
      return;
    }
    this.t += dt;
    const t = this.t;
    const C = CFG.camera;
    this.offset.set(C.offsetX, C.offsetY, C.offsetZ);
    this.fovBase = C.fov + gameplayFov() - DEFAULT_GAMEPLAY_FOV;
    const k = 1 - Math.exp(-C.follow * dt);
    this.target.lerp(focus, dt === 0 ? 1 : k);
    this.mouseS.x = damp(this.mouseS.x, this.mouse.x, 3, dt);
    this.mouseS.y = damp(this.mouseS.y, this.mouse.y, 3, dt);

    const off = this._off.copy(this.offset).applyAxisAngle(this._up, -this.mouseS.x * 0.16 * C.parallax);
    off.y += this.mouseS.y * 3.5 * C.parallax;

    // 低频抖动：路面颠簸感
    const sh = (0.035 + speed01 * 0.05) * C.shake;
    const shake = this._shake.set(
      Math.sin(t * 13.1) * 0.6 + Math.sin(t * 29.7) * 0.4,
      Math.sin(t * 17.3 + 1.2) * 0.6 + Math.sin(t * 37.1) * 0.4,
      Math.sin(t * 11.7 + 2.1) * 0.5
    ).multiplyScalar(sh);

    const cam = this.camera;
    cam.position.copy(this.target).add(off).add(shake);
    cam.lookAt(this.target);
    cam.rotateZ(Math.sin(t * 0.7) * 0.006 * C.roll);
    if (dt > 0) cam.position.add(this.recoilOffset(dt));

    const fov = this.fovBase + speed01 * C.fovBoost + this.framingFov;
    cam.fov = dt === 0 ? fov : damp(cam.fov, fov, 2, dt);
    // Shift the framing in screen space, preserving the existing camera angle.
    const { width: w, height: h } = viewportSize();
    if (this.screenBias) cam.setViewOffset(w, h, w * this.screenBias, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
}
