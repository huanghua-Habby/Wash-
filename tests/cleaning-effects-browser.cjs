/** Synthetic ten-stain peak on the actual renderer; no performance claim for a full natural playthrough. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8082/');url.searchParams.set('wash-test','1');
const out='docs/QA/level-framework/cleaning-budget';
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url.href);await page.waitForSelector('body.scene-ready',{timeout:90000});
  await page.evaluate(()=>__wash.connection.send('start',{levelId:'highway-03'}));
  await page.waitForSelector('#level-guide[open]');await page.locator('.level-guide-confirm').click();
  await page.waitForFunction(()=>__wash.game.roundStage==='playing');
  const programs=await page.evaluate(()=>__wash.renderer.info.programs.length);
  await page.evaluate(()=>{
   const sim=__wash.connection.authority.sim,g=sim.game;
   g.level={...g.level,script:{steps:[],orders:[],events:[]}};g.clearStains();g.lanes=[];
   for(let slot=1;slot<4;slot++)sim.occupy(slot,true);
   for(let i=0;i<2;i++){
    const definition={id:`budget-${i}`,side:i?1:-1,type:'cargo',behavior:'cruise',onComplete:'hold',patience:{mode:'unlimited'},
      stains:[-4.4,-3,-1.6,-.2,1.2].map((x,j)=>({id:`dirt-${j}`,kind:'grease',position:[x,j%2?.45:-.45]}))};
    g.spawnOrder(100+i,{id:definition.id,side:definition.side,vehicleSlot:i,definition});
   }
   g.lanes.forEach(l=>l.x=g.orderX());__wash.connection.authority.publish();
   const renderer=__wash.renderer,draw=renderer.renderBufferDirect;
   window.__cleaningDraws=[];
   renderer.renderBufferDirect=function(...args){
    const object=args[4],material=args[3],before={...this.info.render};const value=draw.apply(this,args);
    if(object.userData.cleaningLayer!==undefined)window.__cleaningDraws.push({frame:this.info.render.frame,
      pass:material===object.material?'color':material.type,kind:object.userData.cleaningLayer,
      instances:object.geometry.instanceCount,draws:this.info.render.calls-before.calls,triangles:this.info.render.triangles-before.triangles});
    return value;
   };
  });
  await page.waitForFunction(()=>__wash.game.orders.length===2&&__wash.game.orders.every(o=>o.stains.length===5));
  const sample=async(label)=>{
   await page.evaluate(()=>window.__cleaningDraws=[]);await page.waitForTimeout(350);
   return {label,draws:await page.evaluate(()=>window.__cleaningDraws),instances:await page.evaluate(()=>{
    const fx=__wash.game.effects.entries.get('cleaning').system;
    return [fx,fx.secondary].map(bank=>bank.layers.map(mesh=>mesh.geometry.instanceCount));
   })};
  };
  const samples=[await sample('idle')];
  await page.evaluate(()=>{for(const o of __wash.connection.authority.sim.game.orders)for(const s of o.stains)s.progress=.25;});
  samples.push(await sample('partial foam'));
  await page.evaluate(()=>{for(const o of __wash.connection.authority.sim.game.orders)for(const s of o.stains)s.progress=1;});
  samples.push(await sample('ten full foam stains / four players'));
  await page.screenshot({path:`${out}/peak.png`});
  await page.evaluate(()=>{const g=__wash.connection.authority.sim.game;for(const o of g.orders)for(const s of o.stains){s.done=true;s.cleanedAt=g.elapsed;}});
  await page.waitForFunction(()=>__wash.game.orders.every(o=>o.stains.every(s=>s.done)));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  samples.push(await sample('clean sparkle tail'));
  await page.waitForTimeout(1600);samples.push(await sample('expired tail'));
  assert.equal(samples[0].draws.length,0);assert.equal(samples.at(-1).draws.length,0);
  assert.deepEqual(samples[2].instances,[[160,0,0],[160,0,0]]);
  assert.ok(samples[2].draws.length>0);
  const grouped=samples.map(s=>{
   const frames=new Map();for(const d of s.draws){const key=`${d.frame}:${d.pass}`;const f=frames.get(key)||{draws:0,triangles:0};f.draws+=d.draws;f.triangles+=d.triangles;frames.set(key,f);}
   return {...s,passes:[...new Set(s.draws.map(d=>d.pass))],peakDraws:Math.max(0,...[...frames.values()].map(f=>f.draws)),peakTriangles:Math.max(0,...[...frames.values()].map(f=>f.triangles))};
  });
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>__wash.renderer.info.programs.length),programs,'first emissions do not compile late shader variants');
  fs.writeFileSync(`${out}/metrics.json`,JSON.stringify({scope:'actual local Chrome, synthetic capacity peak, grouped by render frame/pass',programs,samples:grouped},null,2));
  console.log(JSON.stringify(grouped.map(({label,instances,passes,peakDraws,peakTriangles})=>({label,instances,passes,peakDraws,peakTriangles}))));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
