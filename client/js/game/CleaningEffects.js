/** Fixed, startup-warmed instance pools. GPU animates foam, polish and sparkle. */
import * as THREE from 'three';
import puff from '../../assets/unity/water-puff.json';
import { MAX_STAINS } from '../../../shared/sim/StainDefinitions.js';
const vertex = `
 uniform float uTime;
 uniform float uTop;
 uniform float uKind;
 uniform vec4 uState[${MAX_STAINS}];
 attribute vec2 aSeed;
 varying vec2 vUv;
 varying vec3 vNormal;
 varying float vAlpha;
 varying float vSeed;
 varying float vAge;
 void main() {
   int slot = int(aSeed.x);
   vec4 state = uState[slot];
   float seed = aSeed.y;
   float age = uTime - state.y;
   vAge = age; vSeed = seed; vUv = uv;
   vec3 p;
   if(uKind < 0.5) {
     float angle = seed * 2.399963;
     float radius = sqrt((seed + 0.5) / 32.0) * 0.43;
     vec3 center = vec3(cos(angle)*radius, 0.075, sin(angle)*radius*0.72);
     center += vec3(sin(uTime*0.85+seed)*0.025, sin(uTime*1.1+seed*2.0)*0.025, cos(uTime*0.7+seed)*0.02);
     float size = 0.095 + 0.035*sin(seed*7.0+uTime*0.65);
     float grow = smoothstep(seed/40.0, seed/40.0+0.2, state.x);
     p = center + position * size * grow * vec3(1.05,0.65,1.0);
     vAlpha = grow;
     vNormal = normalize(normalMatrix * normal);
   } else {
     float delay = uKind > 1.5 ? seed*0.14 : 0.0;
     float t = age - delay;
     vAlpha = step(0.0,t) * (1.0-step(1.05,t)) * sin(clamp(t/1.05,0.0,1.0)*3.14159);
     float size = uKind < 1.5 ? 1.12 : (0.3+seed*0.04) * (0.65+vAlpha*0.45);
     p = vec3(position.x*size, 0.1+position.y*size*(uKind>1.5 ? 1.0 : 0.0), uKind<1.5 ? position.y*size*0.8 : 0.0);
     if(uKind>1.5) p += vec3((seed-1.0)*0.3, 0.22+seed*0.06, sin(seed*4.0)*0.2);
   }
   p += vec3(state.z, uTop + 0.055, state.w);
   gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
 }
`;
const fragment = `
 uniform float uKind;
 varying vec2 vUv;
 varying vec3 vNormal;
 varying float vAlpha;
 varying float vSeed;
 varying float vAge;
 void main() {
   if(vAlpha < 0.005) discard;
   float alpha = vAlpha;
   vec3 color = vec3(1.0);
   if(uKind < 0.5) {
     float light = max(0.0,dot(normalize(vNormal),normalize(vec3(-0.3,0.9,0.5))));
     color = mix(vec3(0.84,0.87,0.86),vec3(1.0),0.45+0.55*light);
   } else if(uKind < 1.5) {
     vec2 p = vUv*2.0-1.0;
     float sweep = abs(p.x+p.y*0.45 - (vAge*2.9-1.3));
     alpha *= (1.0-smoothstep(0.06,0.21,sweep))*(1.0-smoothstep(0.62,1.0,length(p)));
     color = vec3(1.0,0.99,0.87);
   } else {
     vec2 p = abs(vUv*2.0-1.0);
     float star = pow(p.x,0.65)+pow(p.y,0.65);
     alpha *= 1.0-smoothstep(0.94,1.02,star);
     color = mix(vec3(1.0),vec3(1.0,0.94,0.65),smoothstep(0.0,0.9,star));
   }
   if(alpha<0.005) discard;
   gl_FragColor = vec4(color,alpha);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
 }
`;
export class CleaningEffects {
  constructor(game, bank = 0) {
    this.game = game; this.bank = bank;
    this.time = { value: 0 };
    this.states = { value: Array.from({ length: MAX_STAINS }, () => new THREE.Vector4(0,-100,0,0)) };
    this.top = { value: game.orderTruck.topLocal };
    this.root = new THREE.Group(); game.orderTruck.body.add(this.root);
    this.layers = [this.makeLayer(0,32),this.makeLayer(1,1),this.makeLayer(2,3)];
    this.root.visible = false;
    if (bank === 0) this.secondary = new CleaningEffects(game, 1);
  }
  makeLayer(kind, count) {
    const source = kind === 0 ? null : new THREE.PlaneGeometry(1,1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', source ? source.attributes.position.clone() : new THREE.Float32BufferAttribute(puff.positions,3));
    geometry.setAttribute('normal', source ? source.attributes.normal.clone() : new THREE.Float32BufferAttribute(puff.normals,3));
    geometry.setAttribute('uv', source ? source.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(puff.positions.length/3*2),2));
    geometry.setIndex(source ? source.index.clone() : puff.indices); source?.dispose();
    const seeds = [];
    for(let stain=0;stain<MAX_STAINS;stain++) for(let seed=0;seed<count;seed++) seeds.push(stain,seed);
    geometry.setAttribute('aSeed',new THREE.InstancedBufferAttribute(new Float32Array(seeds),2));
    geometry.instanceCount = 0;
    geometry.attributes.aSeed.setUsage(THREE.DynamicDrawUsage);
    const material = new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,
      uniforms:{uTime:this.time,uTop:this.top,uState:this.states,uKind:{value:kind}},transparent:kind!==0,
      depthWrite:kind===0,side:THREE.DoubleSide});
    const mesh = new THREE.Mesh(geometry,material); mesh.frustumCulled=false;
    mesh.userData.gpuParticle=true; mesh.userData.cleaningLayer=kind; mesh.userData.recordKey=""; mesh.visible=false; this.root.add(mesh); return mesh;
  }
  update(dt = 0) {
    const game=this.game, order=game.orders[this.bank];
    this.secondary?.update(dt);
    this.root.visible=!!order && game.active;
    // The pool rides whichever vehicle type carries the current order.
    if(order && this.root.parent!==order.truck.body) order.truck.body.add(this.root);
    if(order) this.top.value=order.truck.topLocal;
    const elapsed=game.elapsed || 0;
    this.time.value=game.paused || !game.active || this.time.value > elapsed + 0.1
      ? elapsed : Math.min(elapsed + 0.1, Math.max(elapsed, this.time.value + dt));
    const ranges = [[],[],[]];
    this.states.value.forEach((state,i)=> {
      const stain=order?.stains[i];
      const soapStage=stain?.steps.indexOf('soap') ?? -1;
      let coverage=0;
      if(stain && soapStage>=0 && !stain.done) {
        if(stain.stage===soapStage) coverage=stain.progress;
        else if(stain.steps[stain.stage]==='water') coverage=1-stain.progress;
      }
      state.x=coverage; state.y=stain?.cleanedAt ?? -100;
      if(stain) { state.z=stain.mesh.position.x; state.w=stain.mesh.position.z; }
      // Bounded analytic stain states, never a CPU particle motion/expiry loop.
      const age=this.time.value-state.y;
      ranges[0].push([0,Math.min(32,Math.max(0,Math.ceil(coverage*40)))]);
      ranges[1].push([0,stain && age>=0 && age<1.05 ? 1 : 0]);
      const first=Math.max(0,Math.floor((age-1.05)/.14)+1), end=Math.min(3,Math.floor(age/.14)+1);
      ranges[2].push(stain && age>=0 && first<end ? [first,end] : [0,0]);
    });
    this.layers.forEach((mesh,i)=>this.submit(mesh,ranges[i]));
  }
  /** Repack immutable seed/birth records only on emission/retirement changes. GPU does all motion. */
  submit(mesh,ranges) {
    const key=ranges.map(([first,end])=>`${first}:${end}`).join(',');
    if(mesh.userData.recordKey===key) return;
    mesh.userData.recordKey=key;
    const attribute=mesh.geometry.attributes.aSeed;
    let records=0;
    ranges.forEach(([first,end],stain)=> {
      for(let seed=first;seed<end;seed++) attribute.setXY(records++,stain,seed);
    });
    mesh.geometry.instanceCount=records; mesh.visible=records>0;
    if(records) attribute.needsUpdate=true;
  }
  reset() { this.secondary?.reset(); this.root.visible=false; this.states.value.forEach(state=>{state.x=0;state.y=-100;}); this.layers.forEach(mesh=>{mesh.visible=false;mesh.geometry.instanceCount=0;mesh.userData.recordKey="";}); }
  dispose() {
    this.secondary?.dispose();
    for (const mesh of this.layers) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.root.removeFromParent();
  }
}
