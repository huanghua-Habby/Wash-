const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Real same-machine Chrome/WebRTC: host snapshots drive icon-only vehicle work and patience displays. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),pages=[],errors=[];
 const output=process.env.WASH_QA_DIR||'docs/QA';await fs.mkdir(output,{recursive:true});
 await installGuideReader(browser);

 try{
  for(let i=0;i<2;i++){
   const page=await (await browser.newContext({viewport:{width:1440,height:810}})).newPage();pages.push(page);
   page.on('pageerror',e=>errors.push(e.message));await page.goto(url.href);await page.waitForSelector('body.scene-ready',{timeout:60000});
   assert.equal(await page.locator('.car-badge').count(),2);assert.equal(await page.locator('.car-badge:visible').count(),0);
   assert.equal(await page.locator('.station-badge[data-tool="soap"] span').textContent(),'肥皂箱');
   assert.equal(await page.locator('.charging-badge').first().locator('span').textContent(),'充电线起点');
  }
  const [host,guest]=pages;
  if(await guest.locator('#join-room-form').isHidden())await guest.locator('#toggle-join-room').click();
  await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());await guest.locator('#join-room').click();
  await guest.waitForFunction(()=>__wash.connection.guest?.open);
  await host.locator('#select-level').click();await host.locator('[data-level-id="highway-02"]').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&__wash.game.orders.length===2)));
  await host.waitForFunction(()=>__wash.game.elapsed>8&&__wash.game.orders.every(o=>o.arrivalProgress===1));
  const programs=await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length)));
  await host.locator('#pause-game').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.paused)));
  await host.evaluate(()=>{
   const [a,b]=__wash.connection.authority.sim.game.orders;a.remaining=30;b.remaining=8.2;
   a.stains[0].stage=1;a.stains[0].progress=0;a.stains[0].done=true;
   a.stains[1].stage=1;a.stains[1].progress=.5;a.stains[1].done=false;
   a.stains[2].stage=0;a.stains[2].progress=.5;a.stains[2].done=false;
   b.stains[0].stage=0;b.stains[0].progress=0;b.stains[0].done=false;
   b.stains[1].stage=0;b.stains[1].progress=0;b.stains[1].done=false;
   b.stains[2].stage=1;b.stains[2].progress=0;b.stains[2].done=false;
  });
  for(const page of pages){
   await page.waitForFunction(()=>{
    const e=__wash.ui.worldHud.vehicleOrders.entries;
    return e[0].seconds.textContent==='30'&&e[1].seconds.textContent==='9'&&e[0].fill.style.width==='50%'&&e[1].fill.style.width==='16.7%';
   });
   assert.deepEqual((await page.locator('.car-badge').allTextContents()).map(s=>s.replace(/\s/g,'')),['30','9']);
   assert.equal(await page.locator('.car-badge.urgent').count(),1);
   const state=await page.evaluate(()=>__wash.ui.worldHud.vehicleOrders.entries.map(({badge,ring,bar,fill})=>({
    ring:Number(ring.style.strokeDashoffset),progress:bar.getAttribute('aria-valuenow'),color:getComputedStyle(fill).backgroundColor,width:badge.getBoundingClientRect().width,
   })));
   assert.ok(Math.abs(state[0].ring-.5)<.0001);assert.ok(Math.abs(state[1].ring-(1-8.2/60))<.0001);
   assert.deepEqual(state.map(s=>s.progress),['50','17']);assert.equal(state[0].color,state[1].color,'urgent time does not recolor cleaning progress');
   assert.ok(state.every(s=>s.width<180));
   assert.equal(await page.evaluate(()=>__wash.ui.worldHud.vehicleOrders.entries.every(({badge},i)=>{
    const a=badge.getBoundingClientRect(),b=__wash.ui.worldHud.chargingHud.ports[i].getBoundingClientRect();
    return a.right<=b.left||a.left>=b.right||a.bottom+2<=b.top||a.top>=b.bottom;
   })),true,'order cards leave a gap above the charging labels');
   assert.equal(await page.locator('.charging-badge').evaluateAll(nodes=>nodes.some(n=>n.textContent.includes('J'))),false);
  }
  // Hide the modal only for a representative frozen frame; authority stays paused.
  const style=await host.addStyleTag({content:'dialog[open]{opacity:0!important}dialog::backdrop{background:transparent!important;backdrop-filter:none!important}'});
  await host.screenshot({path:path.join(output,'vehicle-order-hud-game.png')});
  const box=await host.locator('.car-badge').first().boundingBox();
  await host.screenshot({path:path.join(output,'vehicle-order-hud-detail.png'),clip:{x:Math.max(0,box.x-65),y:Math.max(0,box.y-25),width:330,height:115}});
  await style.evaluate(node=>node.remove());
  await host.evaluate(()=>{__wash.connection.authority.sim.game.orders[0].mode='leaving';});
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.worldHud.vehicleOrders.entries[0].badge.hidden)));
  await host.locator('.pause-home').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active&&!__wash.connection.room.homeWaiting.length)));
  await host.locator('#select-level').click();await host.locator('[data-level-id="highway-01"]').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&__wash.game.orders.length===1)));
  for(const page of pages){
   await page.waitForFunction(()=>{const e=__wash.ui.worldHud.vehicleOrders.entries;return !e[0].badge.hidden&&e[0].timer.hidden&&e[1].badge.hidden;});
   assert.equal((await page.locator('.car-badge').first().textContent()).trim(),'','untimed order has no frozen clock or infinity text');
   assert.equal(await page.locator('.order-clean-bar').first().getAttribute('aria-valuenow'),'0','new order resets the reused bar');
   assert.equal(await page.locator('.car-badge').count(),2);
  }
  assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length))),programs);
  for(const page of pages){await page.evaluate(()=>__wash.ui.dispose());assert.equal(await page.locator('.car-badge').count(),0);}
  assert.deepEqual(errors,[]);
  console.log('PASS host/guest icon-only vehicle HUD: timer rings, continuous cleaning bars, independent orders, isolated urgency, name-only sources, leave/home/reset/untimed reuse and managed disposal; zero new GPU programs');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
