const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Local aim previews and host-owned cleaning over real same-machine Chrome/WebRTC. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
 const browser = await chromium.launch({headless:true,channel:'chrome'}), pages=[], errors=[];
 const output=process.env.WASH_QA_DIR || 'docs/QA'; await fs.mkdir(output,{recursive:true});
 await installGuideReader(browser);

 try {
  for(let i=0;i<2;i++) {
   const page=await (await browser.newContext({viewport:{width:1440,height:810}})).newPage();pages.push(page);
   page.on('pageerror',e=>errors.push(e.message));await page.goto(url.href);await page.waitForSelector('body.scene-ready',{timeout:60000});
   assert.equal(await page.locator('.water-aim').count(),1);assert.equal(await page.locator('.water-aim').isHidden(),true);
  }
  const [host,guest]=pages;
  if(await guest.locator('#join-room-form').isHidden())await guest.locator('#toggle-join-room').click();
  await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());await guest.locator('#join-room').click();
  await guest.waitForFunction(()=>__wash.connection.guest?.open);
  await host.locator('#new-game').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active)));
  await host.waitForFunction(()=>__wash.game.orders[0]?.arrivalProgress===1&&__wash.game.elapsed>8);
  const programs=await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length)));
  const place=async slot=>host.evaluate(slot=>{
   const sim=__wash.connection.authority.sim,order=sim.game.orders[0],stain=order.stains[1],p=sim.players[slot],truck=order.truck;
   const other=sim.players[1-slot],home=sim.trucks[0];
   other.state='ground';other.ground={truck:home,plat:home.platforms[0]};other.pos.set(home.pos.x,home.topY,home.pos.z+.8);other.root.position.copy(other.pos);other.vel.set(0,0,0);
   const target=stain.mesh.getWorldPosition(p.pos.clone());
   p.state='ground';p.ground={truck,plat:truck.platforms[0]};p.pos.set(target.x-3.8,truck.topY,target.z);
   p.root.position.copy(p.pos);p.vel.set(0,0,0);p.externalVelocity.set(0,0,0);p.yaw=0;p.yawG.rotation.y=0;
   sim.game.waterguns[0].clearHolder();sim.game.waterguns[0].pickup(p);p.skipUse=false;
  },slot);
  // Each local slot sees its own preview; the other browser does not see a duplicate cue.
  for(const slot of [0,1]) {
   await place(slot);
   await pages[slot].waitForSelector('.water-aim:not([hidden])');
   await pages[1-slot].waitForSelector('.water-aim',{state:'hidden'});
   assert.equal(await pages[slot].evaluate(slot=>__wash.ui.worldHud.playerBadges[slot].hidden,slot),false,'held-gun status and aim both remain visible when player names hide');
   assert.match(await pages[slot].locator('.held-tool:visible').textContent(),/水枪/);
  }
  await guest.waitForTimeout(600);
  const before=await host.evaluate(()=>__wash.connection.authority.sim.game.orders[0].stains[1].progress);
  assert.equal(before,0,'aiming alone never cleans');
  const aim=await guest.evaluate(()=>{
   const w=__wash,view=w.ui.waterAim,point=view.preview.sprayTarget.clone().project(w.camera),box=view.root.getBoundingClientRect();
   const frame=document.getElementById('app-frame').getBoundingClientRect();
   return {error:Math.hypot(box.x+box.width/2-frame.x-(point.x+1)*frame.width/2,box.bottom-frame.y-(1-point.y)*frame.height/2),
    events:getComputedStyle(view.root).pointerEvents,z:Number(getComputedStyle(view.root).zIndex),hudZ:Number(getComputedStyle(w.ui.worldHud.root).zIndex),width:box.width};
  });
  assert.ok(aim.error<.3,`ring tracks projected impact: ${JSON.stringify(aim)}`);assert.equal(aim.events,'none');assert.ok(aim.z<aim.hudZ);assert.ok(aim.width<=24);
  await guest.screenshot({path:path.join(output,'water-aim-game.png')});
  const r=await guest.locator('.water-aim').boundingBox();
  await guest.screenshot({path:path.join(output,'water-aim-detail.png'),clip:{x:Math.max(0,r.x-150),y:Math.max(0,r.y-90),width:340,height:240}});
  await guest.locator('#game').click();await guest.keyboard.down('KeyJ');
  await host.waitForFunction(()=>__wash.connection.authority.sim.game.orders[0].stains[1].progress>.1);
  await guest.waitForFunction(()=>__wash.ui.waterAim.root.dataset.spraying==='true');
  await guest.screenshot({path:path.join(output,'water-aim-spray.png')});await guest.keyboard.up('KeyJ');
  await host.locator('#pause-game').click();
  await Promise.all(pages.map(p=>p.waitForSelector('.water-aim',{state:'hidden'})));
  await host.locator('.pause-continue').click();await guest.waitForSelector('.water-aim:not([hidden])');
  // A teammate intercepts the shared trajectory; the indicator cannot continue through them.
  await host.evaluate(()=>{
   const sim=__wash.connection.authority.sim,[other,holder]=sim.players,truck=holder.ground.truck;
   other.state='ground';other.ground={truck,plat:truck.platforms[0]};other.pos.copy(holder.pos);other.pos.x+=1.5;
   other.root.position.copy(other.pos);other.vel.set(0,0,0);other.externalVelocity.set(0,0,0);
  });
  await guest.waitForFunction(()=>__wash.ui.waterAim.preview.hitPlayer===__wash.players[0]);
  await guest.screenshot({path:path.join(output,'water-aim-blocked.png')});
  await guest.keyboard.down('KeyK');await guest.waitForSelector('.water-aim',{state:'hidden'});await guest.keyboard.up('KeyK');
  await Promise.all(pages.map(p=>p.waitForFunction(()=>!__wash.players[1].heldTool)));
  assert.equal(await guest.locator('.water-aim').isHidden(),true);
  await host.locator('#pause-game').click();await host.locator('.pause-home').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active&&!__wash.connection.room.homeWaiting.length)));
  await Promise.all(pages.map(p=>p.waitForSelector('.water-aim',{state:'hidden'})));
  assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length))),programs,'aim adds no GPU shader programs');
  for(const page of pages) {
   await page.evaluate(()=>__wash.ui.dispose());
   assert.equal(await page.locator('.water-aim').count(),0,'UIManager disposes the registered cue');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS host/guest local-only prefire aim, precise unobtrusive projection, real J cleaning, teammate first-hit block, pause/throw/drop/home hiding, managed disposal, single reused node and zero new shader programs');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
