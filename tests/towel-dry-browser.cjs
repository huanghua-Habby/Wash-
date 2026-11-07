/** Real WebRTC guest input dries authority-owned water on both pages, including the original renderer. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),pages=[],errors=[];
 try{
  for(let i=0;i<2;i++){
   const page=await (await browser.newContext({viewport:{width:1440,height:810}})).newPage();pages.push(page);
   page.on('pageerror',e=>errors.push(e.message));await page.goto(url.href);await page.waitForSelector('body.scene-ready');
  }
  const [host,guest]=pages;
  if(await guest.locator('#join-room-form').isHidden())await guest.locator('#toggle-join-room').click();
  await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());await guest.locator('#join-room').click();
  await guest.waitForFunction(()=>__wash.connection.guest?.open&&__wash.network.latest);
  await host.waitForFunction(()=>__wash.connection.authority.sim.players.slice(0,2).every(p=>p.state==='ground'));
  const programs=await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length)));
  await host.evaluate(()=>{
   const sim=__wash.connection.authority.sim,g=sim.game,truck=sim.trucks[0],p=sim.players[1];
   p.state='ground';p.ground={truck,plat:truck.platformAt(truck.pos.x+1,truck.pos.z+.5,0)};
   p.pos.set(truck.pos.x+1,truck.topY,truck.pos.z+.5);p.root.position.copy(p.pos);p.vel.set(0,0,0);p.yaw=0;
   g.towels[0].pickup(p);p.skipUse=false;g.wet.random=()=>.5;g.wet.splash(truck,1.46,.5);g.wet.advance(.2,0);
  });
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.wet.surfaces[1].marks.some(m=>m.id))));
  await guest.locator('#game').click();await guest.keyboard.down('KeyJ');
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.players[1].useAction==='wipe'&&__wash.game.wet.surfaces[1].marks.some(m=>m.id&&m.dry<9))));
  for(const page of pages){
   await page.waitForFunction(()=>{
    const view=__wash.game.effects.entries.get('wet').system,mark=__wash.game.wet.surfaces[1].marks.find(m=>m.id),record=view.sharedRoofs[0].records[0];
    return mark&&Math.abs(record.birth-mark.birth)<.0002&&Math.abs(record.dry-mark.dry)<.0002;
   });
  }
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.wet.surfaces[1].marks.every(m=>!m.id),null,{timeout:5000})));
  await guest.keyboard.up('KeyJ');
  for(const page of pages)await page.waitForFunction(()=>__wash.game.effects.entries.get('wet').system.sharedRoofs[0].geometry.instanceCount===0);
  assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length))),programs);
  assert.deepEqual(errors,[]);
  console.log('PASS real guest J input: host-authoritative towel drying, both peers and original wet renderer agree, wet contact removed, zero new shader programs');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
