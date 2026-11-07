import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { CFG } from '../core/config.js';
import { GpuInstancePool } from './GpuInstancePool.js';
const SEG=24;

/** One fixed ribbon mesh, instanced. Wobble/curl/billboarding/fades are GPU-only. */
export class WindLines {
  constructor(scene, count=120) {
    this.mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
      uniforms:{uTime:{value:0},uWorldTime:{value:0},uColor:{value:new THREE.Color(PAL.wind)},uOpacity:{value:1}},
      vertexShader:`
        uniform float uTime; uniform float uWorldTime;
        attribute vec3 aOrigin;
        attribute vec4 aLife;
        attribute vec4 aFlow;
        attribute vec4 aStyle;
        varying float vAlpha;
        vec3 point(float s,float age) {
          float wob=aFlow.z*sin(s*aFlow.w+aStyle.y+uWorldTime*7.0);
          vec3 p=vec3(s*aFlow.y,wob,aFlow.z*0.5*cos(s*aFlow.w*0.7+aStyle.y));
          if(aStyle.w>0.5 && s<1.0/aFlow.y) {
            float u=s*aFlow.y*6.283185;
            p.x-=aStyle.z*sin(u); p.y+=aStyle.z*(1.0-cos(u));
          }
          return aOrigin+vec3(-aFlow.x*age,0.0,0.0)+p;
        }
        void main() {
          float rawAge=uTime-aLife.x,age=clamp(rawAge,0.0,max(aLife.y,0.001));
          if(rawAge<0.0 || rawAge>=aLife.y){vAlpha=0.0;gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
          float s=position.x;
          vec3 p=point(s,age);
          vec3 tangent=point(min(1.0,s+1.0/${SEG}.0),age)-point(max(0.0,s-1.0/${SEG}.0),age);
          vec3 side=normalize(cross(tangent,cameraPosition-p)+vec3(0.000001));
          p+=side*position.y*aStyle.x*(1.0-0.55*s);
          float fade=min(1.0,age/0.08)*min(1.0,(aLife.y-age)/0.2);
          vAlpha=step(0.0,rawAge)*(1.0-step(aLife.y,rawAge))*fade*smoothstep(0.0,0.1,s)*(1.0-smoothstep(0.5,1.0,s));
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
        }`,
      fragmentShader:`
        uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
        void main() {
          float alpha=vAlpha*uOpacity; if(alpha<0.005) discard;
          gl_FragColor=vec4(uColor,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    const geometry=new THREE.BufferGeometry(), positions=[],indices=[];
    for(let i=0;i<=SEG;i++) positions.push(i/SEG,0.5,0,i/SEG,-0.5,0);
    for(let i=0;i<SEG;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
    this.pool=new GpuInstancePool(scene,geometry,count,{aOrigin:3,aLife:4,aFlow:4,aStyle:4},this.mat);
    this.mesh=this.pool.mesh;this.mesh.renderOrder=5; // GPU geometry stays out of the override velocity mask.
    this.acc=0;this.wasEnabled=CFG.wind.enabled;
  }
  spawn(trucks,base) {
    const truck=trucks[Math.floor(Math.random()*trucks.length)],W=CFG.wind;
    const centerZ=trucks.reduce((sum,t)=>sum+t.pos.z,0)/trucks.length,outer=Math.sign(truck.pos.z-centerZ)||1,r=Math.random();
    let y,z;
    const top=truck.topY,half=truck.halfWidth;
    if(r<0.4){y=0.6+Math.random()*(top-0.6);z=truck.pos.z+outer*(half+0.3+Math.random()*1.4);}
    else if(r<0.7){y=top+0.55+Math.random()*1.3;z=truck.pos.z+(Math.random()-0.5)*2*half;}
    else if(r<0.85){y=1+Math.random()*(top-1.2);z=centerZ;}
    else{y=0.25+Math.random()*0.3;z=(Math.random()-0.5)*8;}
    const life=(0.45+Math.random()*0.4)*W.life;
    return this.pool.emit({aOrigin:[truck.pos.x+3+Math.random()*6,y,z],aLife:[this.pool.time.value,life,0,0],
      aFlow:[base*(0.65+Math.random()*0.45)*W.speed,Math.max(0.01,W.lengthMin+Math.random()*Math.max(0,W.lengthMax-W.lengthMin)),(0.06+Math.random()*0.12)*W.wobble,4+Math.random()*6],
      aStyle:[(0.045+Math.random()*0.035)*W.thickness,Math.random()*6.28,(0.22+Math.random()*0.14)*W.curlSize,Math.random()<W.curlChance?1:0]},life,Math.min(this.pool.capacity,W.maxCount));
  }
  reset() { this.pool.reset(); this.pool.time.value = 0; this.acc = 0; }
  dispose() { this.pool.dispose(); }
  update(dt,t,trucks,_camera,base) {
    const W=CFG.wind;
    this.pool.time.value+=dt;this.mat.uniforms.uWorldTime.value=t;
    if(this._color!==W.color){this._color=W.color;this.mat.uniforms.uColor.value.set(W.color);}
    this.mat.uniforms.uOpacity.value=W.enabled?W.opacity:0;
    if(this.wasEnabled&&!W.enabled){this.pool.reset();this.acc=0;}
    this.wasEnabled=W.enabled;
    this.acc+=W.enabled?dt*W.rate*(base/30):0;
    while(this.acc>=1 && trucks.length) {
      this.acc--;
      if(!this.spawn(trucks,base)){this.acc=0;break;}
    }
    this.pool.flush();
  }
}
