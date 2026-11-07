import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

/** Four bounded bursts, immutable births. Smoke covers the frozen visual pose before it disappears.
 * The avatar has already left the authority's physics; this short hold is presentation only.
 */
export class DepartureSmoke {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({uniforms:{uTime:{value:0}}, transparent:true, depthWrite:false,
      vertexShader:`
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec3 aMotion;
        attribute vec4 aLife;
        varying vec3 vNormal; varying float vAlpha; varying float vAlive;
        void main() {
          float age = uTime - aLife.x;
          vAlive = step(0.0, age) * (1.0 - step(aLife.y, age));
          if (vAlive < .5) { vNormal=vec3(0.,1.,0.); vAlpha=0.; gl_Position=vec4(2.,2.,2.,1.); return; }
          float k = age / aLife.y;
          vec3 center = aOrigin + aMotion * (1.0 - exp(-5.0 * age)) / 5.0;
          float grow = smoothstep(0.0, .10, age);
          float size = aLife.z * grow * (1.0 + .65*k);
          vAlpha = (1.0 - smoothstep(.35, 1.0, k)) * .94;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + position * size, 1.0);
        }`,
      fragmentShader:`
        varying vec3 vNormal; varying float vAlpha; varying float vAlive;
        void main() {
          if(vAlive < .5) discard;
          float shade=.78+.22*max(0.,dot(normalize(vNormal),normalize(vec3(10.,30.,7.))));
          gl_FragColor=vec4(vec3(.91,.93,.88)*shade,vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1,1), 64, {aOrigin:3,aMotion:3,aLife:4}, material);
    this.mesh = this.pool.mesh; this.reset();
  }
  burst(position) {
    const now = this.pool.time.value;
    for (let i=0;i<12;i++) {
      const angle=i*Math.PI*2/12, height=.25+(i%3)*.48, life=.55+Math.random()*.15;
      this.pool.emit({aOrigin:[position[0]+Math.cos(angle)*.22,position[1]+height,position[2]+Math.sin(angle)*.22],
        aMotion:[Math.cos(angle)*2.5,1.1+Math.random(),Math.sin(angle)*2.5],
        aLife:[now,life,.30+Math.random()*.13,0]},life);
    }
    this.until = now+.75;
  }
  update(dt) {
    this.game.players.forEach((player, slot) => {
      const record=this.records[slot], departure=player.departure;
      if (!departure || !player.root) return;
      if (record.serial !== departure.serial) {
        record.serial=departure.serial;
        if (departure.visible) { this.burst(departure.position); record.hold=.14; record.position=[...departure.position]; }
      }
      if (player.occupied !== false) { record.hold=0; return; }
      if (record.hold>0) {
        player.root.position.fromArray(record.position); player.root.visible=true;
        record.hold=Math.max(0,record.hold-dt);
      } else player.root.visible=false;
    });
    // Lifecycle cosmetics finish even on a paused/tutorial world; otherwise this clock remains still.
    if (this.pool.time.value<this.until) this.pool.time.value+=dt;
    this.pool.flush();
  }
  reset() {
    this.pool.reset(); this.pool.time.value=0; this.until=0;
    this.records=this.game.players.map(player => ({serial:player.departure?.serial || 0,hold:0,position:[0,0,0]}));
  }
  dispose() { this.pool.dispose(); this.records=[]; }
}
