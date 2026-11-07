const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Actual Chrome/WebRTC: test-only schedule, lethal lane plate and attached corpse, edge jump, respawn and cleanup. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = (process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/')+'?wash-test=1';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
 await installGuideReader(browser);

 try {
  const pages=[];
  for(let i=0;i<2;i++){
   const ctx=await browser.newContext({viewport:{width:1440,height:810},reducedMotion:'no-preference'}),p=await ctx.newPage();
   p.on('pageerror',e=>errors.push(e.message));pages.push(p);
  }
  const [host,guest]=pages;
  await Promise.all(pages.map(async p=>{await p.goto(url);await p.waitForSelector('body.scene-ready',{timeout:60000});}));
  await guest.locator('#toggle-join-room').click();await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());
  await guest.locator('#join-room').click();await guest.waitForFunction(()=>__wash.connection.guest?.open);
  await host.locator('#select-level').click();
  const tutorial=host.locator('.level-card[data-level-id="highway-01"]');
  assert.match(await tutorial.textContent(),/新手教程/);await tutorial.click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active,{timeout:30000})));
  for(const p of pages){
   assert.equal(await p.evaluate(()=>__wash.game.level.name),'新手教程');
   assert.deepEqual(await p.evaluate(()=>__wash.game.level.roadSigns.map(entry=>Math.round(entry.atMinutes*60))),[18,45,72,99,126,153]);
  }
  const programs=await host.evaluate(()=>__wash.renderer.info.programs.length);
  await host.evaluate(()=>{
   const a=__wash.connection.authority,s=a.sim,g=s.game,t=s.trucks[0];
   const order=g.spawnOrder(0);g.lanes.find(l=>l.serial===0).x=g.orderX();
   order.truck.setAltitude(t.pos.y+t.topLocal-order.truck.topLocal);g.updateOrder(order,1/60);
   // The fixture docks instantly; do not send the artificial merge teleport velocity to client prediction.
   order.truck.vel.set(0,0,0);
   g.elapsed=15.98;g.remaining=164.02;
   s.players.forEach((p,i)=>{
    const truck=i<2?order.truck:t,z=i===0?1.15:-.4;
    p.pos.set(truck.pos.x,truck.topY,truck.pos.z+z);p.state='ground';p.ground={truck,plat:truck.platforms[0]};
    p.takeoff=truck;p.vel.set(0,0,0);p.externalVelocity.set(0,0,0);p.root.position.copy(p.pos);
   });a.publish();
  });
  await Promise.all(pages.map(p=>p.waitForSelector('.road-sign-warning[data-event="sign-01"]:visible')));
  assert.ok(await host.evaluate(()=>__wash.connection.authority.sim.game.elapsed)<16.4);
  const warningSize=await host.locator('.road-sign-warning svg').boundingBox();assert.ok(warningSize.width>=190,'large LED lane warning');
  assert.equal(await host.locator('.road-sign-beacon[data-side="-1"]:visible').count(),1);
  assert.ok(await host.locator('.road-sign-warning').evaluate(node=>node.getAnimations({subtree:true}).length)>3,'LED and chevrons animate');
  await host.waitForTimeout(250);
  const warningBounds=await host.locator('.road-sign-warning').boundingBox();assert.ok(warningBounds.x>=0&&warningBounds.y>=0&&warningBounds.x+warningBounds.width<=1440&&warningBounds.y+warningBounds.height<=810,'large warning remains fully onscreen');
  await host.screenshot({path:'docs/QA/road-sign-warning.png'});
  await host.locator('#pause-game').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.paused)));
  const pause=await host.evaluate(()=>__wash.game.elapsed);await host.waitForTimeout(250);assert.equal(await host.evaluate(()=>__wash.game.elapsed),pause);
  assert.equal(await host.locator('.road-sign-warning').evaluate(node=>node.getAnimations({subtree:true}).every(animation=>animation.playState==='paused')),true,'pause freezes LED animation');
  await host.evaluate(()=>__wash.ui.setMotionEnabled(false));
  assert.equal(await host.locator('.road-sign-warning').evaluate(node=>node.getAnimations({subtree:true}).length),0,'quiet UI keeps a static warning');
  assert.equal(await host.locator('.road-sign-beacon').evaluate(node=>node.getAnimations().length),0);
  await host.evaluate(()=>__wash.ui.setMotionEnabled(true));await host.emulateMedia({reducedMotion:'reduce'});
  await host.waitForFunction(()=>document.body.classList.contains('quiet-ui'));
  assert.equal(await host.locator('.road-sign-warning').evaluate(node=>node.getAnimations({subtree:true}).length),0,'system reduced motion suppresses blinking too');
  await host.emulateMedia({reducedMotion:'no-preference'});await host.waitForFunction(()=>!document.body.classList.contains('quiet-ui'));
  await host.locator('.pause-continue').click();
  await host.waitForFunction(()=>__wash.ui.input.enabled&&!__wash.ui.hasModal);
  // Aim near the apex at contact; a render-frame poll can be late on a machine drawing several browser views.
  await host.waitForFunction(()=>__wash.connection.authority.sim.game.elapsed>=17.98,null,{polling:10});await host.keyboard.press('Space');
  await host.waitForFunction(()=>__wash.connection.authority.sim.game.roadSigns.hits[0]!==0);
  await host.evaluate(()=>{const a=__wash.connection.authority;a.sim.game.paused=true;a.publish();});
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.paused&&__wash.game.roadSigns.hits[0]!==0)));
  for(const p of pages){
   const state=await p.evaluate(()=>({mask:__wash.game.roadSigns.hits[0],state:__wash.players[1].state,cause:__wash.players[1].deathCause,
    id:__wash.players[1].roadSignAttachment.id,scale:__wash.players[1].squash.scale.x,timer:__wash.players[1].fallTimer}));
   assert.equal(state.mask,2,'jumping host survives, exposed guest dies');assert.equal(state.state,'fallen');assert.equal(state.cause,'road-sign');
   assert.equal(state.id,'sign-01');assert.equal(state.scale,.22);assert.ok(state.timer>1.7&&state.timer<=2);
   assert.equal(await p.locator('.road-sign-warning:visible').count(),0);
   assert.equal(await p.locator('.road-sign-beacon:visible').count(),0);
   assert.equal(await p.locator('.road-sign-pop[data-tone="blue"]:visible').count(),1,'one tone-coloured impact pop per confirmed hit');
   assert.equal(await p.evaluate(()=>__wash.levelScenes.current.roadSigns.tone),'blue');
  }
  await host.waitForTimeout(100);
  await host.screenshot({path:'docs/QA/road-sign-passing.png'});
  const sticky=await guest.evaluate(()=>{
   const player=__wash.players[1],plate=__wash.levelScenes.current.roadSigns.root;
   return {x:player.root.position.x-plate.position.x,y:player.root.position.y-plate.position.y,z:player.root.position.z-plate.position.z,offset:player.roadSignAttachment.offset,timer:player.fallTimer};
  });
  assert.ok(Math.abs(sticky.x-sticky.offset[0])<.001&&Math.abs(sticky.y-sticky.offset[1])<.001&&Math.abs(sticky.z-sticky.offset[2])<.001,'corpse remains physically glued to plate presentation');
  await host.waitForTimeout(200);assert.equal(await guest.evaluate(()=>__wash.players[1].fallTimer),sticky.timer,'shared pause freezes countdown');
  await host.evaluate(()=>{const a=__wash.connection.authority;a.sim.game.paused=false;a.publish();});
  await guest.waitForFunction(()=>__wash.game.elapsed>18.9&&__wash.players[1].state==='fallen');
  for(const p of pages){
   await p.waitForFunction(()=>__wash.players[1].roadSignAttachment===null&&__wash.players[1].state==='fallen');
   assert.equal(await p.evaluate(()=>__wash.levelScenes.current.roadSigns.root.visible),false,'map exit releases the prepared sign before revival');
   assert.equal(await p.evaluate(()=>__wash.players[1].root.visible),false,'corpse is cleaned up while the timer remains');
   assert.equal(await p.locator('.respawn-counter:visible').count(),1,'countdown continues at the home spawn');
  }
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.players[1].roadSignAttachment===null&&__wash.players[1].state!=='fallen',{timeout:10000})));
  assert.ok(await guest.evaluate(()=>__wash.players[1].squash.scale.x)>.7,'normal body restored on respawn');
  assert.equal(await host.evaluate(()=>__wash.renderer.info.programs.length),programs,'no new shader compilation');
  // Second sign sweeps the right lane: the host has switched to the left order and is safe.
  await host.evaluate(()=>{
   const a=__wash.connection.authority,s=a.sim,g=s.game,home=s.trucks[0],order=g.orders[0].truck;
   g.elapsed=45.36;g.remaining=134.64;
   s.players.slice(0,2).forEach((p,i)=>{
    const t=i===0?order:home;p.pos.set(t.pos.x,t.topY,t.pos.z);p.state='ground';p.ground={truck:t,plat:t.platforms[0]};p.takeoff=t;
    p.vel.set(0,0,0);p.externalVelocity.set(0,0,0);p.root.position.copy(p.pos);
   });a.publish();
  });
  await guest.waitForFunction(()=>__wash.game.roadSigns.hits[1]!==0);
  assert.equal(await guest.evaluate(()=>__wash.game.roadSigns.hits[1]),2,'opposite vehicle survives right lane attack');
  await host.locator('#pause-game').click();await host.locator('.pause-home').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active)));
  for(const p of pages){assert.equal(await p.locator('.road-sign-warning:visible').count(),0);assert.equal(await p.evaluate(()=>__wash.levelScenes.current.roadSigns.root.visible),false);assert.equal(await p.evaluate(()=>__wash.players[1].roadSignAttachment),null);}
  await host.locator('#new-game').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active)));
  for(const p of pages)assert.deepEqual(await p.evaluate(()=>__wash.game.roadSigns.hits),[0,0,0,0,0,0]);
  assert.deepEqual(errors,[]);console.log('PASS Chrome/WebRTC: large 2s warning, whole-lane fatal plate, edge jump and other-vehicle dodge, flattened attached corpse, pause/full respawn, prepared programs and home/reset (same machine).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
