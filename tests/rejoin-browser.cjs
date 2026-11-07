/** Actual same-machine Chrome/WebRTC: refresh, direct-link recovery, Y/N, deadline and prepared GPU smoke. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8084/'); url.searchParams.set('wash-test','1');
const ready=page=>page.waitForFunction(()=>document.body.classList.contains('scene-ready')&&__wash.ui.ready&&!__wash.ui.iris.active,{},{timeout:60000});
const home=pages=>Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active&&!__wash.connection.room.homeWaiting?.length)));
const join=async(page,code)=>{
  if(await page.locator('#join-room-form').isHidden())await page.locator('#toggle-join-room').click();
  await page.locator('#join-code').fill(code);await page.locator('#join-room').click();
  await page.waitForFunction(()=>__wash.connection.guest?.open);
};
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'}), pages=[],errors=[];
  try {
    for(let i=0;i<3;i++) {
      const context=await browser.newContext({viewport:{width:1280,height:800}}),p=await context.newPage();pages.push(p);
      p.on('pageerror',e=>errors.push(e.message));await p.goto(url.href);await ready(p);
    }
    const [host,a,b]=pages,code=await host.locator('#room-code-value').textContent();
    await join(a,code);await join(b,code);
    await host.waitForFunction(()=>__wash.connection.authority.connectedGuests().length===2);
    console.log('Joined three players');
    await a.reload();await ready(a);await a.waitForFunction(()=>__wash.connection.guest?.open);
    assert.equal(await a.locator('#rejoin-dialog').isVisible(),false,'home refresh never asks');
    console.log('Home refresh recovered');
    await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].occupied);
    await host.locator('#select-level').click();await host.locator('.level-card[data-level-id="highway-02"]').click();
    // highway-02 opens with a guide since the level guides landed; everyone confirms it.
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='guide'&&document.getElementById('level-guide').open)));
    await Promise.all(pages.map(p=>p.locator('.level-guide-confirm').click()));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&__wash.ui.page==='game')));
    const programs=await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length)));
    const aId=await a.evaluate(()=>__wash.connection.room.playerId);
    await host.evaluate(()=>{
      const s=__wash.connection.authority.sim;s.game.towels[0].pickup(s.players[1]);
    });
    await b.waitForFunction(()=>__wash.players[1].heldTool?.kind==='towel');
    for(const page of [host,b])await page.evaluate(()=>{
      const fx=__wash.game.effects.entries.get('departure').system,update=fx.update.bind(fx);window.__smokeFrames=[];
      fx.update=dt=>{update(dt);const p=__wash.players[1];if(p.departure.serial>0&&__smokeFrames.length<90)__smokeFrames.push({serial:p.departure.serial,visible:p.root.visible,occupied:p.occupied,clock:fx.pool.time.value});};
    });
    await a.reload();
    // Mid-match a bot stands in: the character, its towel and its place stay; nobody sees departure smoke.
    await host.waitForFunction(()=>{const s=__wash.connection.authority.sim;return s.isStandIn(1)&&s.players[1].occupied&&s.players[1].heldTool?.kind==='towel';});
    await ready(a);await a.waitForSelector('#rejoin-dialog[open]');
    for(const page of [host,b]) {
      await page.waitForFunction(()=>__wash.players[1].standIn===true&&__wash.players[1].occupied&&__wash.players[1].root.visible);
      assert.deepEqual(await page.evaluate(()=>__smokeFrames),[],'no departure smoke mid-match');
    }
    assert.equal(await a.evaluate(()=>__wash.ui.input.enabled),false);
    const elapsed=await host.evaluate(()=>__wash.game.elapsed);
    await a.keyboard.press('Escape');await a.keyboard.press('KeyJ');await a.waitForTimeout(200);
    assert.equal(await a.locator('#menu-dialog').isVisible(),false);assert.equal(await a.locator('#rejoin-dialog').isVisible(),true);
    assert.ok(await host.evaluate(t=>__wash.game.elapsed>t,elapsed),'rejoin prompt never pauses other players');
    await a.screenshot({path:'docs/QA/rejoin-confirm.png'});
    await a.keyboard.press('KeyY');await host.waitForFunction(()=>!__wash.connection.authority.sim.isStandIn(1));
    await a.waitForFunction(()=>!document.getElementById('rejoin-dialog').open&&__wash.players[1].occupied&&!__wash.players[1].standIn);
    await a.waitForTimeout(300);
    const gap=await Promise.all([host,a].map(page=>page.evaluate(()=>{const p=__wash.players[1];return [p.root.position.x,p.root.position.z];})));
    assert.ok(Math.hypot(gap[0][0]-gap[1][0],gap[0][1]-gap[1][1])<1,'the returned player takes over where the bot left the character');
    assert.equal(await host.evaluate(()=>__wash.connection.authority.sim.players[1].heldTool?.kind),'towel','the towel stays in hand');
    await b.waitForFunction(()=>__wash.players[1].standIn===false,null,{timeout:5000});
    assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length))),programs,'a stand-in hand-over creates no shaders');
    console.log('Refresh: bot stand-in kept the character and towel; Y took it back in place');

    // Data-channel-only interruption: exactly one registry session rotation starts the re-offer.
    await a.evaluate(()=>{
      window.__registryTypes=[];const c=__wash.connection,send=c.signalSend.bind(c);
      c.signalSend=(type,fields)=>{__registryTypes.push(type);return send(type,fields);};
    });
    await a.evaluate(()=>{__wash.connection.guest.link.close('test-drop');});
    await a.waitForSelector('#rejoin-dialog[open]');
    assert.equal(await host.evaluate(()=>__wash.connection.authority.sim.isStandIn(1)),true);
    await a.locator('.rejoin-yes').click();await a.waitForFunction(()=>!__wash.connection.guest.rejoinPending&&__wash.players[1].occupied);
    assert.equal(await a.evaluate(()=>__registryTypes.filter(type=>type==='reconnect').length),1,'one recovery request, no polling');
    console.log('Direct-link-only recovery passed');

    await a.reload();await ready(a);await a.waitForSelector('#rejoin-dialog[open]');await a.keyboard.press('KeyN');
    await a.waitForFunction(()=>__wash.connection.isHost&&__wash.ui.page==='home'&&!__wash.ui.iris.active);
    await host.waitForFunction(id=>!__wash.connection.room.members.some(m=>m.id===id),aId);
    assert.equal(await host.evaluate(()=>__wash.game.roundStage),'playing');
    assert.equal(await b.evaluate(()=>__wash.players[2].occupied),true);
    await b.waitForFunction(()=>__wash.players[1].occupied&&__wash.players[1].root.visible&&__wash.players[1].standIn);
    assert.equal(await host.evaluate(()=>__wash.connection.authority.sim.isStandIn(1)),true,'after N the bot plays the character to the end');
    console.log('N released the reserved seat; the bot plays on');

    // A connected reader can time out too. The authority's wall-time deadline is accelerated, not the game clock.
    await b.reload();await ready(b);await b.waitForSelector('#rejoin-dialog[open]');
    const bId=await b.evaluate(()=>__wash.connection.room.playerId);
    await host.evaluate(id=>{__wash.connection.authority.recoveries.get(id).deadline=0;},bId);
    await b.waitForFunction(()=>__wash.connection.isHost&&__wash.ui.page==='home'&&!__wash.ui.iris.active);
    await b.waitForFunction(()=>document.querySelector('.network-toast').textContent==='房间已超时');
    assert.equal(await b.locator('#host-notice').isVisible(),false);assert.equal(await b.locator('#rejoin-dialog').isVisible(),false);
    await host.waitForFunction(()=>__wash.connection.room.members.length===1&&__wash.connection.authority.connectedGuests().length===0);
    assert.equal(await host.evaluate(()=>__wash.connection.room.mode),'solo');assert.equal(await host.evaluate(()=>__wash.game.roundStage),'playing');
    console.log('Connected prompt deadline returned with a toast');

    // Expired token restoration also uses a toast after startup, never the rejoin/host-return modal.
    await b.evaluate(()=>sessionStorage.setItem('wash-session','expired-test-token'));
    await b.reload();await ready(b);
    await b.waitForFunction(()=>document.querySelector('.network-toast').textContent==='房间已超时');
    assert.equal(await b.locator('#rejoin-dialog').isVisible(),false);assert.equal(await b.locator('#host-notice').isVisible(),false);
    assert.equal(await b.locator('.network-toast').isVisible(),true);
    console.log('Expired token returned with a visible toast');

    await host.keyboard.press('Escape');await host.locator('.pause-home').click();await home([host]);
    await join(a,code);await join(b,code);
    await host.locator('#select-level').click();await host.locator('.level-card[data-level-id="highway-02"]').click(); // highway-01 has no guide any more
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='guide'&&document.getElementById('level-guide').open)));
    await a.reload();await ready(a);await a.waitForSelector('#rejoin-dialog[open]');
    assert.equal(await a.locator('#level-guide').isVisible(),false,'the rejoin question takes priority over reading');
    await a.keyboard.press('KeyY');await a.waitForSelector('#level-guide[open]');
    assert.equal(await a.evaluate(()=>!!(__wash.game.guide.ready&(1<<__wash.connection.room.slot))),false);
    await Promise.all(pages.map(p=>p.locator('.level-guide-confirm').click()));
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing')));
    assert.deepEqual(errors,[]);
    console.log('PASS Chrome/WebRTC: home auto-return, mid-match bot stand-in (character, towel and place kept, no smoke), refresh + direct-link Y in place, no shader creation, N seat release with the bot playing on, deadline/token toast, solo continuation, tutorial re-confirm');
  } catch(error) {
    for(let i=0;i<pages.length;i++) {
      console.log('Failure page',i,await pages[i].evaluate(()=>({ui:__wash.ui.page,stage:__wash.game.roundStage,
        room:__wash.connection.room,guest:__wash.connection.guest&&{open:__wash.connection.guest.open,state:__wash.connection.guest.state},
        roster:__wash.connection.roster,toast:document.querySelector('.network-toast').textContent,
        recovery:__wash.connection.authority&&[...__wash.connection.authority.recoveries],errors:window.__errors})).catch(e=>String(e)));
    }
    console.log('Page errors',errors);throw error;
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
