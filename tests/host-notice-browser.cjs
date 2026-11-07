const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Same-machine Chrome: host pause/return notice and a deliberately delayed scene-ready acknowledgement. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test','1');
(async () => {
  const browser = await chromium.launch({headless:true,channel:'chrome'}); const errors=[];
  await installGuideReader(browser);

  try {
    const pages=[];
    for(let i=0;i<2;i++) {
      const ctx=await browser.newContext({viewport:{width:1440,height:810}}); const p=await ctx.newPage();
      p.on('pageerror',e=>errors.push(e.message)); pages.push(p);
      await p.goto(url.href); await p.waitForSelector('body.scene-ready',{timeout:60000});
    }
    const [host,guest]=pages;
    const roomCode=await host.locator('#room-code-value').textContent();
    await guest.locator('#toggle-join-room').click();await guest.locator('#join-code').fill(roomCode);await guest.locator('#join-room').click();
    await guest.waitForFunction(()=>__wash.connection.guest?.open && __wash.network.latest);
    const memberId=await guest.evaluate(()=>__wash.connection.playerId);
    const start=async()=>{
      await host.locator('#new-game').click();
      await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active)));
    };
    await start(); await host.locator('#pause-game').click();
    await guest.waitForSelector('#host-notice[open]');
    assert.equal(await guest.locator('#host-notice-title').textContent(),'房主暂停了游戏');
    assert.equal(await guest.locator('#host-notice-confirm').isVisible(),false);
    assert.equal(await guest.evaluate(()=>__wash.ui.input.enabled),false);
    const remaining=await guest.evaluate(()=>__wash.game.remaining);
    await guest.keyboard.press('Escape'); assert.equal(await guest.locator('#host-notice').isVisible(),true);
    await guest.waitForTimeout(450);assert.equal(await guest.evaluate(()=>__wash.game.remaining),remaining);
    await guest.screenshot({path:'docs/QA/host-paused-guest.png'});
    await host.locator('.pause-continue').click();await guest.waitForSelector('#host-notice',{state:'hidden'});
    await guest.waitForFunction(()=>!__wash.game.paused&&__wash.ui.input.enabled);
    await guest.keyboard.down('KeyD');await guest.waitForTimeout(180);await guest.keyboard.up('KeyD');
    await host.evaluate((id)=>{
      const link=__wash.connection.authority.guests.get(id).link, send=link.send.bind(link);
      window.__homeFrames=[]; window.__homeEpoch=null;
      link.send=(channel,frame)=>{
        if(frame.type==='state'&&frame.phase==='home'&&frame.homeWaiting.includes(id)&&window.__homeEpoch!==frame.epoch) {
          window.__homeFrames=[];window.__homeEpoch=frame.epoch;
        }
        window.__homeFrames.push({type:frame.type,bytes:JSON.stringify(frame).length});return send(channel,frame);
      };
    },memberId);
    // Keep resource readiness pending past the snapshot stall threshold, while the existing ping remains alive.
    await guest.evaluate(()=>{
      const resources=__wash.resources, prepare=resources.prepare.bind(resources);
      window.__releaseHome=()=>{resources.prepare=prepare;window.__resolveHome();};
      const pending=new Promise(resolve=>{window.__resolveHome=resolve;});resources.prepare=()=>pending;
    });
    await host.locator('#pause-game').click();await host.locator('.pause-home').click();
    await guest.waitForFunction(()=>__wash.ui.hostNotice.mode==='home'&&document.getElementById('host-notice').open);
    assert.equal(await guest.locator('#host-notice-title').textContent(),'房主退出了游戏');
    assert.match(await guest.locator('#host-notice-count').textContent(),/3 秒|2 秒/);
    await guest.screenshot({path:'docs/QA/host-return-guest.png'});
    await host.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active);
    assert.equal(await host.locator('#new-game').isEnabled(),false);
    assert.match(await host.evaluate(()=>__wash.connection.authority.command('start')),/返回主菜单/);
    await guest.locator('#host-notice-confirm').click();await guest.waitForFunction(()=>__wash.ui.iris.phase==='wait');
    await guest.waitForTimeout(5200);
    assert.equal(await guest.evaluate(()=>__wash.game.active),true,'outgoing world remains until the covered resource gate is ready');
    assert.equal(await guest.evaluate(()=>__wash.connection.guest?.open&&__wash.connection.guest.homePending),true,'pending UI does not look like host loss');
    assert.equal(await host.evaluate((id)=>__wash.connection.authority.homeWaiting.has(id),memberId),true);
    assert.equal(await host.evaluate(()=>__wash.connection.room.members.length),2,'reserved seat remains in the registry');
    const frames=await host.evaluate(()=>window.__homeFrames);
    assert.equal(frames.filter(f=>f.type==='snapshot').length,0,'no streaming snapshots to a waiting guest');
    assert.equal(frames.filter(f=>f.type==='home_snapshot').length,1,'one prepared full world');
    assert.ok(frames.filter(f=>f.type==='home_snapshot').every(f=>f.bytes<20000));
    await guest.evaluate(()=>window.__releaseHome());
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active&&!__wash.connection.room.homeWaiting.length)));
    assert.equal(await guest.locator('#room-code-value').textContent(),roomCode);assert.equal(await guest.locator('#room-code-label').textContent(),'当前房间');
    assert.equal(await guest.evaluate(()=>__wash.players[__wash.connection.room.slot].sceneReady&&__wash.ui.input.enabled),true);
    await host.waitForFunction(()=>window.__homeFrames.filter(f=>f.type==='snapshot').length>0);
    assert.equal(await host.evaluate(()=>window.__homeFrames.filter(f=>f.type==='home_snapshot').length),2);
    const fullBytes=await host.evaluate(()=>window.__homeFrames.filter(f=>f.type==='home_snapshot').map(f=>f.bytes));
    // A second return uses the automatic three-second confirmation and keeps the same room/slot.
    await start();await host.locator('#pause-game').click();await host.locator('.pause-home').click();
    await guest.waitForSelector('#host-notice[open]');const began=Date.now();
    await guest.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active&&!__wash.connection.guest.homePending);
    assert.ok(Date.now()-began>=2800);assert.equal(await guest.evaluate(()=>__wash.connection.playerId),memberId);
    assert.equal(await guest.locator('#room-code-value').textContent(),roomCode);
    assert.deepEqual(errors,[]);
    console.log('PASS: host pause/resume notice, confirm/3s auto return, >4s waiting without disconnect, reserved slot, zero streaming/one preparation frame while blocked, fresh avatar and resumed deltas; boundary frame bytes:',fullBytes);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
