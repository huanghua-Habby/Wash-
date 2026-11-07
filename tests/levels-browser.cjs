const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Actual browser: paired traffic, independent state, level changes and resume. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = (process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/') + '?wash-test=1';
(async () => {
 const browser = await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 await installGuideReader(browser);

 try {
  const pages=[];
  for(let i=0;i<2;i++){const ctx=await browser.newContext({viewport:{width:1440,height:810}});const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));pages.push(page);}
  const [host,guest]=pages;
  await Promise.all(pages.map(async p=>{await p.goto(url);await p.waitForSelector('body.scene-ready',{timeout:60000});}));
  async function join(){if(await guest.locator('#join-room-form').isHidden())await guest.locator('#toggle-join-room').click();
   await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());await guest.locator('#join-room').click();await guest.waitForFunction(()=>__wash.connection.guest?.open);}
  await join();
  await host.locator('#select-level').click();assert.equal(await host.locator('.level-card').count(),2);await host.locator('[data-level-id="highway-02"]').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.level.id==='highway-02'&&__wash.network.phase==='game'&&!__wash.ui.iris.active,{timeout:30000})));
  for(const p of pages){assert.equal(await p.evaluate(()=>__wash.levelScenes.id),'highway-02');assert.equal(await p.evaluate(()=>__wash.game.level.road.laneCount),3);}
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.orders.length===2&&__wash.game.orders.every(o=>o.arrivalProgress===1),{timeout:30000})));
  const views=await Promise.all(pages.map(p=>p.evaluate(()=>__wash.game.orders.map(o=>({serial:o.serial,side:__wash.game.orderSide(o.serial),remaining:o.remaining,age:o.age})))));
  for(const view of views){assert.deepEqual(view.map(o=>o.side),[-1,1]);assert.equal(view[0].age,view[1].age);assert.equal(view[0].remaining,view[1].remaining);}
  assert.ok(Math.abs(views[0][0].remaining-views[1][0].remaining)<.3);
  await host.waitForTimeout(1600);
  assert.equal(await host.locator('.car-badge:visible').count(),2);
  assert.equal(await host.locator('.stain-badge:visible').count(),6);
  await host.screenshot({path:'docs/QA/level02-paired.png'});
  await host.locator('#pause-game').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.paused)));
  const before=await host.evaluate(()=>__wash.game.orders.map(o=>o.remaining));await host.waitForTimeout(350);assert.deepEqual(await host.evaluate(()=>__wash.game.orders.map(o=>o.remaining)),before);
  await host.locator('.pause-continue').click();
  await host.waitForFunction(()=>!__wash.game.paused&&!__wash.connection.authority.sim.game.paused&&__wash.game.roundStage==='playing');
  await host.evaluate(()=>{const g=__wash.connection.authority.sim.game,o=g.orders[0];o.stains.forEach(s=>{s.done=true;s.stage=s.steps.length;});g.completeOrder(o);g.completeOrder(o);});
  await guest.waitForFunction(()=>__wash.game.completed===1&&__wash.game.orders[0]?.paid);
  assert.equal(await guest.evaluate(()=>__wash.game.score),25);assert.equal(await guest.evaluate(()=>__wash.game.orders[1].mode),'working');
  await host.evaluate(()=>{__wash.connection.authority.sim.game.orders[1].remaining=.001;});
  await guest.waitForFunction(()=>__wash.game.missed===1&&__wash.game.orders.every(o=>o.mode==='leaving'));
  assert.equal(await guest.evaluate(()=>__wash.game.completed),1);assert.equal(await guest.evaluate(()=>__wash.game.score),25);
  await host.locator('#pause-game').click();await host.locator('.pause-home').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active)));
  assert.match(await host.locator('#continue-game small').textContent(),/左右来车/);
  await host.locator('#continue-game').click();await host.waitForFunction(()=>__wash.network.phase==='game'&&__wash.game.level.id==='highway-02');
  assert.equal(await host.evaluate(()=>__wash.game.waveIndex),0);
  await guest.evaluate(()=>__wash.connection.send('leave'));await guest.waitForFunction(()=>__wash.game.level.id==='highway-01'&&__wash.ui.page==='home'&&!__wash.ui.iris.active,{timeout:30000});
  await host.locator('#pause-game').click();await host.locator('.pause-home').click();await host.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active);
  await join();await guest.waitForFunction(()=>__wash.game.level.id==='highway-02'&&!__wash.ui.iris.active);
  await host.locator('#new-game').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.network.phase==='game'&&__wash.game.level.id==='highway-01'&&!__wash.ui.iris.active,{timeout:30000})));
  assert.equal(await host.evaluate(()=>__wash.game.level.road.laneCount),2);
  assert.deepEqual(errors,[]);console.log('PASS: simultaneous two-side traffic, two HUDs/six stains, independent completion/timeout, pause, resume and 01');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
