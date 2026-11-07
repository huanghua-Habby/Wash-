const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Four real browser peers: one guest dies while everyone shares an unchanged camera and wait. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'}), errors=[],pages=[];
  await installGuideReader(browser);

  try {
    for(let i=0;i<4;i++) {
      const context=await browser.newContext({viewport:{width:1440,height:810}}),page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));pages.push(page);
    }
    await Promise.all(pages.map(async p=>{await p.goto(url.href);await p.waitForSelector('body.scene-ready');}));
    const host=pages[0],code=await host.locator('#room-code-value').textContent();
    for(const page of pages.slice(1)) {
      if (await page.locator('#join-room-form').isHidden()) await page.locator('#toggle-join-room').click(); await page.locator('#join-code').fill(code);await page.locator('#join-room').click();
      await page.waitForFunction(()=>__wash.connection.guest?.open && __wash.network.latest);
    }
    await host.locator('#new-game').click();
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.active && __wash.network.phase==='game')));
    await host.waitForFunction(()=>__wash.connection.authority.sim.players.every(p=>p.state==='ground'));
    await host.waitForTimeout(1000);
    for (const page of pages) {
      const identities=await page.evaluate(()=>__wash.players.map((player,i)=>({
        color:player.identityColor, ring:`#${player.footRing.material.color.getHexString()}`,
        label:getComputedStyle(document.querySelector(`.name-tag.player-${i+1}`)).borderTopColor,
        respawn:getComputedStyle(document.querySelector(`.respawn-counter.player-${i+1} .respawn-progress`)).stroke,
        visible:player.footRing.visible,
      })));
      assert.deepEqual(identities.map(p=>p.color),['#e36c5c','#e3ba42','#579fd2','#69aa72']);
      for(const player of identities){assert.equal(player.ring,player.color);assert.equal(player.label,player.respawn);assert.ok(player.visible);}
    }
    const distances=await Promise.all(pages.map(p=>p.evaluate(()=>__wash.game.rig.followDistance)));
    await host.evaluate(()=>new Promise(resolve=>{
      const sim=__wash.connection.authority.sim,p=sim.players[1];
      p.state='air';p.ground=null;p.pos.set(sim.trucks[0].pos.x-15,0.01,12);p.vel.set(0,-1,0);
      function freeze(){if(p.state==='fallen'){__wash.connection.authority.command('pause',{paused:true});resolve();}else requestAnimationFrame(freeze);}freeze();
    }));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.players[1].state==='fallen' && __wash.game.paused)));
    for(let i=0;i<4;i++) {
      const page=pages[i];assert.equal(await page.locator('.respawn-counter.player-2 strong').textContent(),'2');
      assert.equal(await page.locator('.respawn-counter.player-2').textContent(),'2','visible counter contains only the numeral');
      assert.equal(await page.locator('.respawn-counter.player-2').isVisible(),true);
      const distance=await page.evaluate(()=>__wash.game.rig.followDistance);
      assert.ok(Math.abs(distance-distances[i])<0.5,`peer ${i} changed camera by ${distance-distances[i]}`);
      assert.equal(await page.evaluate(()=>__wash.runtime.sceneCamera.gameplayTargets().safetyPoints.length),i===1?0:2);
      assert.equal(await page.evaluate(()=>__wash.players[1].footRing.visible),false);
    }
    const frozen=await host.evaluate(()=>__wash.connection.authority.sim.players[1].fallTimer);
    await host.waitForTimeout(500);assert.equal(await host.evaluate(()=>__wash.connection.authority.sim.players[1].fallTimer),frozen);
    await host.screenshot({path:'docs/QA/respawn-camera-host.png'});
    await pages[1].screenshot({path:'docs/QA/respawn-camera-guest.png'});
    await host.evaluate(()=>__wash.connection.authority.command('pause',{paused:false}));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>document.querySelector('.respawn-counter.player-2 strong').textContent==='1')));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.players[1].state!=='fallen')));
    for(const page of pages){assert.equal(await page.locator('.respawn-counter.player-2').isVisible(),false);await page.waitForFunction(()=>__wash.players[1].footRing.visible);}
    assert.deepEqual(errors,[]);
    console.log('PASS four same-machine browser peers: guest death, stable cameras, shared 2→1 countdown at home respawn point, pause freeze, host-confirmed revival, no page errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
