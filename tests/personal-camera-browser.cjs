const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Same-machine real WebRTC peers, with distant grounded actors as a camera fixture. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');
url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({headless:true, channel:'chrome'}), errors=[], pages=[];
  await installGuideReader(browser);

  try {
    for (let i=0;i<2;i++) {
      const context=await browser.newContext({viewport:{width:1440,height:810}}), page=await context.newPage();
      page.on('pageerror', e=>errors.push(e.message)); pages.push(page);
    }
    await Promise.all(pages.map(async page=>{await page.goto(url.href); await page.waitForSelector('body.scene-ready');}));
    const [host, guest]=pages, code=await host.locator('#room-code-value').textContent();
    assert.equal(await host.locator('.teammate-indicators').isVisible(),false,'home experience keeps arrows hidden');
    if(await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
    await guest.waitForFunction(()=>__wash.connection.guest?.open && __wash.network.latest);
    await host.locator('#new-game').click();
    await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.game.roundStage==='playing' && !__wash.ui.iris.active)));
    await host.waitForFunction(()=>__wash.connection.authority.sim.players.slice(0,2).every(p=>p.state==='ground'));
    const baseline=await host.evaluate(()=>__wash.game.rig.followDistance);
    await host.evaluate(()=>{
      const sim=__wash.connection.authority.sim, g=sim.game; g.spawnOrder();
      const order=g.orders[0], truck=order.truck, p=sim.players[1];
      order.mode='working';order.arrivalProgress=1;truck.setState(g.homeTruck.pos.x+35,g.homeTruck.pos.z,0,0,30);
      // Freeze fleet motion only in this fixture; authority still ticks and sends real snapshots.
      g.updateFleet=()=>{};
      p.state='ground';p.ground={truck,plat:truck.platforms[0]};p.pos.set(truck.pos.x,truck.topY,truck.pos.z);p.vel.set(0,0,0);p.root.position.copy(p.pos);
    });
    await Promise.all(pages.map(page=>page.waitForFunction(()=>Math.abs(__wash.game.rig.target.x-__wash.players[__wash.connection.room.slot].pos.x)<1)));
    await host.waitForTimeout(2200);
    const states=[];
    for(let i=0;i<2;i++) {
      const state=await pages[i].evaluate(()=>{
        const w=__wash, local=w.connection.room.slot, rig=w.game.rig;
        return {local, target:rig.target.toArray(), position:w.players[local].pos.toArray(), distance:rig.followDistance,
          arrows:[...document.querySelectorAll('.teammate-indicator')].map(n=>({slot:Number(n.dataset.slot),hidden:n.hidden,name:n.getAttribute('aria-label'),color:getComputedStyle(n.querySelector('.teammate-badge')).backgroundColor,transform:n.style.transform})),
          count:document.querySelectorAll('.teammate-indicator').length};
      });
      states.push(state);assert.equal(state.count,4,'fixed DOM pool');
      assert.equal(state.arrows[state.local].hidden,true,'never point to yourself');
      const other=1-state.local;assert.equal(state.arrows[other].hidden,false,'offscreen peer has an arrow');
      assert.ok(Math.abs(state.target[0]-state.position[0])<1,'camera follows its own actor');
      assert.ok(state.distance<20.5,'distant teammate cannot pull camera out');
      assert.ok(state.arrows[other].name.length>0);
    }
    assert.ok(states[1].target[0]-states[0].target[0]>30,'each peer has an independent view');
    assert.ok(Math.abs(states[0].distance-baseline)<.5);
    await host.screenshot({path:'docs/QA/personal-camera-host.png'});await guest.screenshot({path:'docs/QA/personal-camera-guest.png'});
    await host.evaluate(()=>{
      const sim=__wash.connection.authority.sim,p=sim.players[1],truck=sim.game.homeTruck;
      p.ground={truck,plat:truck.platforms[0]};p.pos.set(truck.pos.x+1,truck.topY,truck.pos.z);p.vel.set(0,0,0);
    });
    await Promise.all(pages.map(page=>page.waitForFunction(()=>[...document.querySelectorAll('.teammate-indicator')].every(n=>n.hidden))));
    assert.deepEqual(errors,[]);
    console.log('PASS independent host/guest cameras, closer distance, offscreen arrows, local-slot exclusion, re-entry hides arrows, home unchanged; same-machine real WebRTC',JSON.stringify(states));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
