/** Real local Chrome/WebRTC integration. Authority placement/clock acceleration is explicitly test-only;
 * J/K/movement, guide confirmations, navigation, renders, rewards and peer snapshots use production paths. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8082/'); url.searchParams.set('wash-test', '1');
const qa = 'docs/QA/level-framework';
async function settlePage(page) { await page.waitForFunction(() => __wash.ui.page === 'game' && !__wash.ui.iris.active && __wash.game.roundStage === 'playing', {timeout: 30000}); }
async function readGuides(pages) {
  for (let tries = 0; tries < 60; tries++) {
    for (const page of pages) {
      const button = page.locator('.level-guide-confirm');
      if (await button.isVisible() && await button.isEnabled()) await button.click();
    }
    if (await pages[0].evaluate(() => __wash.game.roundStage !== 'guide' && __wash.ui.page === 'game')) return;
    await pages[0].waitForTimeout(150);
  }
  throw new Error('Guide did not release');
}
async function place(host, slot, serial, stain = null) {
  await host.evaluate(({slot, serial, stain}) => {
    const sim = __wash.connection.authority.sim, p = sim.players[slot];
    const order = serial === null ? null : sim.game.orders.find(o => o.serial === serial);
    const truck = order?.truck || sim.trucks[0];
    const position = stain === null ? (order ? [-2, 0] : [-2, -.5]) : order.stains[stain].position;
    p.state = 'ground'; p.ground = {truck,plat:truck.platforms[0]}; p.pos.set(truck.pos.x+position[0],truck.topY,truck.pos.z+position[1]);
    p.vel.set(0,0,0); p.externalVelocity.set(0,0,0); p.root.position.copy(p.pos);
    sim.resetInputs(); __wash.connection.authority.publish();
  }, {slot,serial,stain});
}
(async () => {
  fs.mkdirSync(qa,{recursive:true});
  const browser = await chromium.launch({headless:true,channel:'chrome'}), errors = [], report = {};
  try {
    const contexts = await Promise.all([0,1].map(() => browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'})));
    const pages = await Promise.all(contexts.map(c => c.newPage())), [host, guest] = pages;
    for (const page of pages) { page.on('pageerror',e=>errors.push(e.message)); await page.goto(url.href); await page.waitForSelector('body.scene-ready',{timeout:90000}); }
    const code = await host.locator('#room-code-value').textContent();
    await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
    await host.waitForFunction(()=>__wash.connection.authority.connectedGuests().length===1);
    await host.locator('#new-game').click(); await Promise.all(pages.map(settlePage));
    assert.equal(await host.locator('#time-value').textContent(),'--：--');
    assert.equal(await host.locator('.score-rating').isVisible(),false);
    assert.equal(await host.locator('.tutorial-task-dot:not([hidden])').count(),2);
    assert.ok(await host.evaluate(()=>__wash.game.tools.every(t=>!t.mesh.visible)));
    assert.ok(await host.evaluate(()=>__wash.game.effects.entries.get('water').system.views.every(v=>!v.root.visible)));
    await host.screenshot({path:`${qa}/01-move.png`});
    await host.keyboard.down('KeyD'); await host.waitForTimeout(180); await host.keyboard.up('KeyD');
    await host.waitForFunction(()=>__wash.game.tutorial.dots.entries.find(e=>e.slot===0).complete);
    assert.equal(await host.evaluate(()=>__wash.game.tutorial.stepId),'move','host cannot complete teammate movement');
    await guest.keyboard.down('KeyD'); await guest.waitForTimeout(180); await guest.keyboard.up('KeyD');
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.tutorial.stepId==='clean'&&__wash.game.orders.length===1)));
    assert.equal(await host.evaluate(()=>__wash.game.order.stains.length),2);
    assert.equal(await guest.evaluate(()=>__wash.game.order.stains.length),2);
    await host.waitForFunction(()=>__wash.game.order.arrivalProgress===1);
    const serial = await host.evaluate(()=>__wash.game.order.serial);
    for (const [slot, page] of pages.entries()) {
      await host.evaluate(slot=> {
        const sim=__wash.connection.authority.sim,p=sim.players[slot],t=sim.game.towels[slot];
        p.state='ground';p.ground={truck:sim.trucks[0],plat:sim.trucks[0].platforms[0]};
        p.pos.set(sim.trucks[0].pos.x+t.originalPosition.x,sim.trucks[0].topY,sim.trucks[0].pos.z+t.originalPosition.z);
        p.root.position.copy(p.pos);sim.resetInputs();__wash.connection.authority.publish();
      },slot);
      await page.waitForTimeout(200); await page.keyboard.press('KeyJ'); await host.waitForFunction(slot=>!!__wash.connection.authority.sim.players[slot].heldTool,slot);
      await place(host,slot,serial,slot); await page.waitForTimeout(200);
      await page.keyboard.down('KeyJ'); await host.waitForFunction(slot=>__wash.connection.authority.sim.game.order.stains[slot].done,slot,{timeout:10000}); await page.keyboard.up('KeyJ');
    }
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.tutorial.stepId==='release')));
    assert.equal(await host.evaluate(()=>__wash.game.score),25); assert.equal(await guest.evaluate(()=>__wash.game.order.mode),'working');
    await host.screenshot({path:`${qa}/01-release.png`});
    await Promise.all(pages.map(p=>p.keyboard.press('KeyK')));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.tutorial.stepId==='return')));
    await place(host,0,null); await host.evaluate(()=>__wash.connection.authority.sim.players[1].fallOut());
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.result?.reason==='tutorial_complete',{timeout:15000})));
    await host.waitForSelector('.result-next',{timeout:10000}); await host.screenshot({path:`${qa}/01-finish.png`});
    report.tutorial = await host.evaluate(()=>({result:__wash.game.result,save:JSON.parse(localStorage.getItem('wash-progress'))}));
    assert.equal(report.tutorial.result.stars,null); assert.equal(report.tutorial.save.version,'0.5');
    assert.equal(report.tutorial.save.levels['highway-01'].tutorialCompleted,true);
    await guest.waitForFunction(()=>JSON.parse(localStorage.getItem('wash-progress'))?.levels['highway-01']?.tutorialCompleted);
    assert.equal(await guest.evaluate(()=>JSON.parse(localStorage.getItem('wash-progress')).version),'0.5');
    await host.locator('.result-next').click();
    await host.waitForFunction(()=>__wash.game.level.id==='highway-02'&&__wash.game.roundStage==='guide');
    await host.screenshot({path:`${qa}/02-guide.png`});
    await readGuides(pages); await Promise.all(pages.map(settlePage));
    for (const id of ['highway-02','highway-03','highway-04','highway-05']) {
      if (id!=='highway-02') {
        await host.evaluate(id=>__wash.connection.send('load',{levelId:id}),id);
        await host.waitForFunction(id=>__wash.game.level.id===id&&__wash.game.roundStage==='guide',id);
        await readGuides(pages); await Promise.all(pages.map(settlePage));
      }
      await host.evaluate(()=>{const g=__wash.connection.authority.sim.game;g.elapsed=20;__wash.connection.authority.publish();});
      await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.orders.length===2&&__wash.game.orders.every(o=>o.arrivalProgress===1),{timeout:15000})));
      const state = await host.evaluate(()=>({id:__wash.game.level.id,clock:__wash.game.clock,orders:__wash.game.orders.map(o=>({id:o.id,type:o.type,kind:o.stains.map(s=>s.kind),patience:o.initialPatience,behavior:o.behaviorId})),keys:__wash.game.equipmentKeys}));
      report[id]=state; await host.screenshot({path:`${qa}/${id}.png`});
      assert.equal(state.clock.duration,id==='highway-05'?180:120);
      if (id==='highway-04'||id==='highway-05') {
        assert.ok(state.keys.includes('charger'));
        assert.ok(await guest.evaluate(()=>__wash.game.charging.source.visible&&__wash.game.chargers[0].mesh.visible));
        await host.evaluate(()=>{
          const g=__wash.connection.authority.sim.game,o=g.orders[0];g.charging.plug(g.chargers[0],o);
          o.chargeProgress=.999;__wash.connection.authority.publish();
        });
        await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.orders.every(o=>o.rewardMultiplier===1.5))));
        await host.screenshot({path:`${qa}/${id==='highway-04'?'04':'05'}-charge-bonus.png`});
      }
      if (id==='highway-05') {
        // Advance to the next warning; event history must never be rewound to replay a past invocation.
        await host.evaluate(()=>{__wash.connection.authority.sim.game.elapsed=43.3;__wash.connection.authority.publish();});
        await Promise.all(pages.map(p=>p.waitForSelector('.road-sign-warning:not([hidden])',{timeout:5000})));
        await host.screenshot({path:`${qa}/05-warning.png`});
        await host.evaluate(()=>{const a=__wash.connection.authority;a.sim.game.levelScript.events.stop('sign-2');a.publish();});
        await Promise.all(pages.map(p=>p.waitForFunction(()=>document.querySelector('.road-sign-warning').hidden&&!__wash.levelScenes.current.roadSigns.root.visible)));
        await host.evaluate(()=>{const a=__wash.connection.authority;a.sim.game.levelScript.events.trigger('sign-3');a.publish();});
        await Promise.all(pages.map(p=>p.waitForSelector('.road-sign-warning:not([hidden])')));
        await host.evaluate(()=>{const a=__wash.connection.authority;a.sim.game.elapsed+=2.4;a.publish();});
        await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.levelScenes.current.roadSigns.root.visible)));
        await host.screenshot({path:`${qa}/05-scripted-sign.png`});
        await host.evaluate(()=>{const a=__wash.connection.authority;a.sim.game.levelScript.events.stop('sign-3');a.publish();});
        await Promise.all(pages.map(p=>p.waitForFunction(()=>!__wash.levelScenes.current.roadSigns.root.visible)));
        report.events={warning:'both peers',stop:'warning and model hidden on both peers',manual:'full warning then shared passing frame'};
      }
      await host.evaluate(()=>{const g=__wash.connection.authority.sim.game;g.score=55;g.remaining=.001;});
      await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='results')));
      await host.waitForSelector('.result-retry'); assert.equal(await host.locator('.result-stars .earned').count(),id==='highway-05'?1:2);
      assert.equal(await guest.locator('.result-retry').isEnabled(),false);
      await guest.waitForFunction(({id,stars})=>JSON.parse(localStorage.getItem('wash-progress'))?.levels[id]?.bestStars===stars,{id,stars:id==='highway-05'?1:2});
    }
    assert.deepEqual(errors,[]); fs.writeFileSync(`${qa}/report.json`,JSON.stringify(report,null,2));
    console.log('PASS five real local levels: two-player tutorial J/K, guide paging, variable dirt, optional charging reward, timer/rating and host-only results; test-only placement/time acceleration used.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
