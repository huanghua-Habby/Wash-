import * as THREE from 'three';

export const RETURN_SECONDS = 0.75;
export const CAMERA_DELAY = 0.8;
export const CAMERA_SECONDS = 2;
const smooth = (t) => t * t * (3 - 2 * t);
const truckTopAt = (truck, x, z) => truck.topYAt?.(x, z, 0) ?? truck.topY;

// Return hops, UI retreat and traffic departure run concurrently.
export class NewGameTransition {
  constructor({ director, roster, rig, camera, onReady, onPhase }) {
    Object.assign(this, { director, roster, rig, camera, onReady, onPhase });
    this.phase = 'home';
    this.clock = 0;
    this.elapsed = 0;
    this.homeTruck = director.a;
    this.blueTruck = director.b;
    this.focus = new THREE.Vector3();
    this.frustum = new THREE.Frustum();
    this.viewMatrix = new THREE.Matrix4();
    this.bounds = new THREE.Box3();
  }

  setPhase(phase) {
    this.phase = phase;
    this.clock = 0;
    this.onPhase?.(phase);
  }

  start() {
    if (this.phase !== 'home') return false;
    this.savedDirector = this.director.captureState();
    this.elapsed = 0;
    this.homeX = this.homeTruck.pos.x;
    this.homeZ = this.homeTruck.pos.z;
    this.blueX = this.blueTruck.pos.x;
    this.blueZ = this.blueTruck.pos.z;
    this.blueSpeed = Math.max(0, this.blueTruck.vel.x);
    this.holdFocus = this.rig.target.clone();
    this.tracks = this.roster.map(({ player, truck, localPosition }) => {
      player.state = 'returning';
      player.vel.set(0, 0, 0);
      player.dashRemaining = player.jumpBoost = player.jumpBuf = player.coyote = 0;
      player.lean.rotation.set(0, 0, 0);
      return { player, truck, localPosition, start: player.pos.clone() };
    });
    this.setPhase('returning');
    return true;
  }

  updateFleet(dt) {
    if (this.phase === 'home') {
      this.director.update(dt);
      return;
    }
    if (this.blueTruck.group.visible) {
      this.blueSpeed = Math.min(22, this.blueSpeed + 12 * dt);
      this.blueX += this.blueSpeed * dt;
      this.blueTruck.setState(this.blueX, this.blueZ, this.blueSpeed, 0, this.director.base);
    }
    // The main vehicle stays in its cruising frame of reference.
    this.homeTruck.setState(this.homeX, this.homeZ, 0, 0, this.director.base);
  }

  attachPlayer({ player, truck, localPosition }) {
    const x = truck.pos.x + localPosition.x, z = truck.pos.z + localPosition.z;
    player.pos.set(x, truckTopAt(truck, x, z), z);
    player.root.position.copy(player.pos);
  }

  updatePlayers(dt, time) {
    if (this.phase === 'home') return;
    this.clock += dt;
    this.elapsed += dt;
    if (this.phase === 'returning') {
      const progress = Math.min(1, this.elapsed / RETURN_SECONDS);
      const ease = smooth(progress);
      for (const track of this.tracks) {
        const { player, truck, localPosition, start } = track;
        const x = truck.pos.x + localPosition.x, z = truck.pos.z + localPosition.z;
        this.focus.set(x, truckTopAt(truck, x, z), z);
        player.pos.copy(start).lerp(this.focus, ease);
        player.pos.y += Math.sin(Math.PI * progress) * 1.9;
        player.animate(dt, time, new THREE.Vector3());
      }
      if (progress === 1) {
        for (const track of this.tracks) {
          this.attachPlayer(track);
          track.player.state = 'ground';
          track.player.ground = { truck: track.truck, plat: track.truck.platformAt(track.player.pos.x, track.player.pos.z, 0.3) };
          track.player.takeoff = track.truck;
          track.player.sqV = -3;
        }
        this.setPhase('departing');
      }
    } else {
      for (const track of this.tracks) {
        this.attachPlayer(track);
        track.player.animate(dt, time, new THREE.Vector3());
      }
    }
    if (!this.rig.gameplayPose && this.elapsed >= CAMERA_DELAY) {
      this.rig.beginGameplay();
      this.setPhase('camera');
    }
    if (this.rig.gameplayPose) this.rig.gameplayProgress = smooth(Math.min(1, (this.elapsed - CAMERA_DELAY) / CAMERA_SECONDS));
  }

  cameraFocus(homeFocus) {
    if (this.phase === 'home') return homeFocus;
    if (this.phase === 'returning' || this.phase === 'departing') return this.holdFocus;
    return this.focus.set(this.homeTruck.pos.x - 0.2, 2.2, this.homeTruck.pos.z);
  }

  afterCamera() {
    if (this.phase === 'home') return;
    if (this.blueTruck.group.visible) {
      // Bounds include the entire cab, trailer, thrusters and outline shells.
      // Test against the current camera, after its projection has been updated.
      this.camera.updateMatrixWorld();
      this.blueTruck.group.updateWorldMatrix(true, true);
      this.viewMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewMatrix);
      this.bounds.setFromObject(this.blueTruck.group);
      if (this.elapsed > 0.1 && !this.frustum.intersectsBox(this.bounds)) {
        this.blueTruck.group.visible = false;
      }
    }
    if (this.phase === 'camera' && this.elapsed >= CAMERA_DELAY + CAMERA_SECONDS && !this.blueTruck.group.visible) {
      this.rig.gameplayProgress = 1;
      this.setPhase('ready');
      this.onReady?.();
    }
  }

  reset({ restoreFleet = true } = {}) {
    if (this.phase === 'home') return;
    if (restoreFleet && this.savedDirector) this.director.restoreState(this.savedDirector);
    this.rig.resetGameplay();
    if (restoreFleet) {
      this.blueTruck.group.visible = true;
      this.director.update(0);
      for (const entry of this.roster) {
        this.attachPlayer(entry);
        entry.player.state = 'ground';
        entry.player.ground = { truck: entry.truck, plat: entry.truck.platformAt(entry.player.pos.x, entry.player.pos.z, 0.3) };
        entry.player.vel.set(0, 0, 0);
      }
    }
    this.setPhase('home');
    this.rig.snap(this.focus.set(this.homeTruck.pos.x, 2.2, this.homeTruck.pos.z));
  }
}
