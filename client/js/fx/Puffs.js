import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { CFG } from '../core/config.js';
import { GpuInstancePool } from './GpuInstancePool.js';

// Original low-poly geometry/curves, now one GPU instance batch.
export class Puffs {
  constructor(scene, count = 90) {
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec3 aVelocity;
        attribute vec3 aColor;
        attribute vec4 aLife;
        varying vec3 vColor;
        varying vec3 vNormal;
        varying float vAlive;
        void main() {
          float rawAge = uTime-aLife.x;
          float age = clamp(rawAge,0.0,max(aLife.y,0.001));
          float k = age/max(aLife.y,0.001);
          vAlive = step(0.0,rawAge)*(1.0-step(aLife.y,rawAge));
          if(vAlive<0.5){vColor=vec3(0.0);vNormal=vec3(0.0,1.0,0.0);gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
          float size = aLife.z*(1.0+k*2.6)*sin(min(1.0,k*1.2)*1.570796+0.1)*(1.0-k*k);
          float angle = aLife.w+age*2.0;
          float c = cos(angle), s = sin(angle);
          float c2 = cos(angle*0.7), s2 = sin(angle*0.7);
          mat3 rotate = mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c)*mat3(1.0,0.0,0.0, 0.0,c2,s2, 0.0,-s2,c2);
          vec3 center = aOrigin+aVelocity*(1.0-exp(-1.5*age))/1.5;
          vec3 p = center+rotate*position*size;
          vNormal = normalize(mat3(modelMatrix)*rotate*normal); vColor = aColor;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying vec3 vNormal; varying float vAlive;
        void main() {
          if(vAlive<0.5) discard;
          float shade=0.72+0.28*max(0.0,dot(normalize(vNormal),normalize(vec3(10.0,30.0,7.0))));
          gl_FragColor=vec4(vColor*shade,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1,0), count,
      { aOrigin:3,aVelocity:3,aColor:3,aLife:4 }, material);
    this.mesh = this.pool.mesh; this.acc = this.accDust = 0;
    this._p = new THREE.Vector3(); this._v = new THREE.Vector3(); this._c = new THREE.Color();
  }
  emit(pos, vel, size, life, color) {
    this._c.set(color);
    this.pool.emit({aOrigin:pos.toArray(),aVelocity:vel.toArray(),aColor:this._c.toArray(),
      aLife:[this.pool.time.value,life,size,Math.random()*6]},life);
  }
  reset() { this.pool.reset(); this.pool.time.value = 0; this.acc = this.accDust = 0; }
  dispose() { this.pool.dispose(); }
  update(dt, trucks, base) {
    this.pool.time.value += dt;
    this.acc += dt*CFG.puffs.exhaust; this.accDust += dt*CFG.puffs.dust;
    const p=this._p,v=this._v;
    while(this.acc>=1) {
      this.acc--;
      // 尾部推进器喷出的气团
      for(const truck of trucks) for(const side of [0.3,-0.3]) {
        p.set(truck.pos.x+truck.spec.x0-0.1,truck.pos.y+0.35,truck.pos.z+side*truck.spec.width);
        v.set(-15-Math.random()*4,-0.4+Math.random()*0.8,(Math.random()-0.5)*0.8);
        this.emit(p,v,0.1+Math.random()*0.05,0.4+Math.random()*0.15,PAL.puff);
      }
    }
    while(this.accDust>=1) {
      this.accDust--;
      // 推进器下洗气流卷起的路面尘土，飞得越高越少
      for(const truck of trucks) {
        if(Math.random()*3<truck.pos.y-0.6) continue;
        const side=Math.random()<0.5?1:-1;
        p.set(truck.pos.x+truck.spec.x0+Math.random()*(truck.spec.x1-truck.spec.x0),0.2,truck.pos.z+side*truck.halfWidth);
        v.set(-base*0.55-Math.random()*5,0.4+Math.random()*0.6,side*(1+Math.random()*1.5));
        this.emit(p,v,0.12+Math.random()*0.1,0.5+Math.random()*0.25,PAL.dust);
      }
    }
    this.pool.flush();
  }
}
