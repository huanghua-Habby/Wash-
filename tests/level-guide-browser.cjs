/** Real same-machine Chrome/WebRTC: startup decode, four-reader barrier, input safety and global UI motion. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
const all = (pages, callback) => Promise.all(pages.map(callback));
const enterGuide = pages => all(pages, p => p.waitForFunction(() => __wash.game.roundStage === 'guide' && document.getElementById('level-guide').open));
const sceneMotion = p => p.evaluate(() => new Promise(resolve => {
  const render=__wash.runtime.render, draw=render.draw;
  render.draw=function(...args) {
    const result=draw.apply(this,args); this.draw=draw;
  const w=__wash, uniform=w.runtime.environment.grass.uniforms, clocks=[];
  w.game.scene.traverse(mesh => { const t=mesh.material?.uniforms?.uTime?.value; if(typeof t==='number')clocks.push([mesh.id,t]); });
  resolve({time:w.network.renderTime,scroll:w.network.renderScroll,grass:[uniform.uTime.value,uniform.uScroll.value],
    camera:[...w.camera.position.toArray(),...w.camera.quaternion.toArray(),w.camera.fov],
    vehicle:[...w.game.homeTruck.body.position.toArray(),...w.game.homeTruck.body.rotation.toArray()],
    players:w.players.filter(p=>p.occupied).map(p=>[...p.root.position.toArray(),p.visual.clock]),clocks});
    return result;
  };
}));
const assertSceneStopped = async pages => {
  const before=await all(pages,sceneMotion);
  await pages[0].waitForTimeout(650);
  assert.deepEqual(await all(pages,sceneMotion),before,'guide freezes the road, grass, vehicles, characters, camera and GPU effects on every viewer');
};
const returnHome = async (host, pages) => {
  await host.locator('#pause-game').click(); await host.locator('.pause-home').click();
  await all(pages, p => p.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length));
};
(async () => {
  const browser = await chromium.launch({ headless:true, channel:'chrome' }), pages = [], errors = [];
  try {
    let releaseImage, requestedImage;
    const gate = new Promise(resolve => { releaseImage = resolve; }), requested = new Promise(resolve => { requestedImage = resolve; });
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext({viewport:{width:1440,height:810}, reducedMotion:i === 2 ? 'reduce' : 'no-preference'});
      const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message));
      if (i === 0) await page.route('**/basic-controls-*.webp', async route => { requestedImage(); await gate; await route.continue(); });
      await page.goto(url.href, {waitUntil:'domcontentloaded'});
      if (i === 0) {
        await requested; assert.equal(await page.locator('body').evaluate(n => n.classList.contains('scene-ready')),false);
        assert.equal(await page.locator('#boot-loading').isVisible(),true); assert.notEqual(await page.locator('#boot-percent').textContent(),'100%');
        releaseImage();
      }
      await page.waitForSelector('body.scene-ready',{timeout:60000});
      assert.equal(await page.evaluate(() => __wash.resources.status.assets.find(a => a.name === 'UI 资源：level-guide')?.state),'ready');
    }
    const [host,a,b,c] = pages;
    const code = await host.locator('#room-code-value').textContent();
    for (const p of [a,b,c]) {
      if (await p.locator('#join-room-form').isHidden()) await p.locator('#toggle-join-room').click();
      await p.locator('#join-code').fill(code); await p.locator('#join-room').click();
      await p.waitForFunction(() => __wash.connection.guest?.open);
    }
    await host.waitForFunction(() => __wash.connection.room.members.length === 4 && __wash.connection.authority.connectedGuests().length === 3);
    const programs = await all(pages,p => p.evaluate(() => __wash.renderer.info.programs.length));
    await host.locator('#new-game').click(); await enterGuide(pages);
    for (const p of pages) {
      assert.equal(await p.locator('.level-guide-dot:not([hidden])').count(),4);
      assert.equal(await p.locator('.level-guide-dot.ready').count(),0);
      assert.equal(await p.locator('#round-cue').isVisible(),false);
      assert.equal(await p.evaluate(() => __wash.ui.menu.rig.gameplayProgress),1);
      assert.equal(await p.evaluate(() => __wash.ui.input.enabled),false);
      assert.equal(await p.locator('#pause-game').isEnabled(),true);
      assert.equal(await p.locator('.level-guide-image').evaluate(img => img.complete && img.naturalWidth === 2560),true);
    }
    await host.locator('#level-guide').evaluate(async n => { await Promise.allSettled(n.getAnimations().map(a => a.finished)); });
    await host.screenshot({path:'docs/QA/level-guide-reading.png'});
    await assertSceneStopped(pages);
    const positions = await host.evaluate(() => __wash.connection.authority.sim.players.map(p => [p.pos.x,p.pos.z]));
    await host.keyboard.press('Escape'); await host.waitForSelector('#menu-dialog[open]');
    assert.equal(await host.locator('#level-guide').isVisible(),true,'pause retains the guide below');
    await a.waitForFunction(() => __wash.game.paused);
    assert.equal(await a.locator('#host-notice').isVisible(),false,'guide pause stays silent for peers');
    await a.keyboard.press('KeyP'); await a.waitForSelector('#menu-dialog[open]');
    await a.keyboard.press('KeyJ'); assert.equal(await host.evaluate(() => __wash.game.guide.ready),0,'pause keypress cannot confirm the guide beneath it');
    await a.keyboard.press('Escape'); await a.waitForFunction(() => !document.getElementById('menu-dialog').open);
    await host.locator('#menu-dialog').evaluate(async n => { await Promise.allSettled(n.getAnimations().map(a => a.finished)); });
    await host.screenshot({path:'docs/QA/level-guide-pause.png'});
    await host.keyboard.press('KeyP'); await host.waitForFunction(() => !document.getElementById('menu-dialog').open && !__wash.game.paused);
    await assertSceneStopped(pages);
    await host.locator('#level-guide').evaluate(n => { n.tabIndex = -1; n.focus(); });
    await host.keyboard.down('KeyW'); await host.keyboard.press('Space');
    await host.waitForTimeout(250); await host.keyboard.up('KeyW');
    assert.deepEqual(await host.evaluate(() => __wash.connection.authority.sim.players.map(p => [p.pos.x,p.pos.z])),positions);
    await a.evaluate(() => __wash.connection.send('guide_ready',{epoch:0,roundId:__wash.connection.room.roundId,guideId:'basic-controls',slot:0}));
    await a.waitForTimeout(100); assert.equal(await host.evaluate(() => __wash.game.guide.ready),0);
    await host.keyboard.press('KeyJ');
    await all(pages,p => p.waitForFunction(() => __wash.game.guide.ready === 1));
    assert.equal(await host.locator('.level-guide-confirm').isEnabled(),false);
    await a.keyboard.press('KeyK'); await b.keyboard.press('KeyL');
    await host.waitForTimeout(160);
    for(const p of pages) assert.equal(await p.evaluate(()=>__wash.game.guide.ready),1,'K/L do not confirm reading');
    assert.equal(await a.locator('.level-guide-confirm').textContent(),'确认 · J');
    await a.keyboard.press('KeyJ'); await b.locator('.level-guide-confirm').click();
    await all(pages,p => p.waitForFunction(() => __wash.game.guide.ready === 7));
    await c.waitForTimeout(1000);
    for (const p of pages) {
      assert.equal(await p.locator('.level-guide-dot.ready').count(),3);
      assert.equal(await p.locator('#level-guide').isVisible(),true);
      assert.deepEqual(await p.evaluate(() => [__wash.game.elapsed,__wash.game.remaining,__wash.game.orders.length,__wash.game.roundStageTime]),[0,180,0,0]);
    }
    await host.screenshot({path:'docs/QA/level-guide-waiting.png'});
    assert.equal(await b.evaluate(() => __wash.ui.motionAllowed),false);
    assert.equal(await b.locator('#level-guide').evaluate(n => n.getAnimations({subtree:true}).length),0);
    await host.keyboard.press('KeyP'); await host.waitForSelector('#menu-dialog[open]');
    await c.locator('.level-guide-confirm').click();
    await all(pages,p => p.waitForFunction(() => __wash.game.guide.ready === 15));
    await c.waitForTimeout(400);
    for(const p of pages) {
      assert.equal(await p.evaluate(() => __wash.game.roundStage),'guide','host pause holds the all-ready release');
      assert.equal(await p.locator('#level-guide').isVisible(),true);
      assert.equal(await p.locator('#host-notice').isVisible(),false);
    }
    await host.keyboard.press('Escape');
    await all(pages,p => p.waitForFunction(() => __wash.game.roundStage === 'ready' && !document.getElementById('level-guide').open));
    for (const p of pages) { assert.equal(await p.evaluate(() => __wash.game.guide.ready),15); assert.equal(await p.locator('#round-cue').isVisible(),true); }
    await all(pages,p => p.waitForFunction(() => __wash.game.roundStage === 'playing' && __wash.ui.input.enabled));
    assert.ok(await host.evaluate(() => __wash.connection.authority.sim.players.every(p => !p.heldTool && !p.useAction && p.state === 'ground')));
    assert.deepEqual(await all(pages,p => p.evaluate(() => __wash.renderer.info.programs.length)),programs);
    await host.keyboard.press('KeyP'); await a.waitForSelector('#host-notice[open]');
    await host.keyboard.press('Escape'); await a.waitForFunction(() => !__wash.game.paused && !document.getElementById('host-notice').open);
    await returnHome(host,pages);

    // A reader leaving cannot block the remaining players; keep the fixed nodes but hide the abandoned slot.
    await host.locator('#new-game').click(); await enterGuide(pages);
    await c.evaluate(() => __wash.connection.send('leave'));
    await c.waitForFunction(() => __wash.connection.isHost && __wash.ui.page === 'home');
    await all([host,a,b],p => p.waitForFunction(() => __wash.game.guide.participants === 7));
    for(const p of [host,a,b]) assert.equal(await p.locator('.level-guide-dot:not([hidden])').count(),3);
    await all([host,a,b],p => p.locator('.level-guide-confirm').click());
    await all([host,a,b],p => p.waitForFunction(() => __wash.game.roundStage === 'playing'));
    await returnHome(host,[host,a,b]);

    // Authority return takes precedence over an unread modal; late closes must leave the return mask locked.
    await host.locator('#new-game').click(); await enterGuide([host,a,b]);
    await host.keyboard.press('Escape'); await host.waitForSelector('#menu-dialog[open]');
    assert.equal(await a.locator('#host-notice').isVisible(),false);
    await host.locator('.pause-home').click();
    await a.waitForSelector('#host-notice[open]');
    assert.equal(await a.locator('#level-guide').isVisible(),false,'host return takes precedence over the guide');
    await all([host,a,b],p => p.waitForFunction(() => !document.getElementById('level-guide').open));
    await all([host,a,b],p => p.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length));

    // Later levels retain their original entry and countdown without a guide inherited from tutorial.
    await host.locator('#select-level').click(); await host.locator('.level-card[data-level-id="highway-02"]').click();
    await all([host,a,b],p => p.waitForFunction(() => __wash.game.roundStage === 'ready' && __wash.game.level.id === 'highway-02'));
    for(const p of [host,a,b]) { assert.equal(await p.locator('#level-guide').isVisible(),false); assert.equal(await p.evaluate(() => __wash.game.guide.id),null); }
    await all([host,a,b],p => p.waitForFunction(() => __wash.game.roundStage === 'playing'));
    await returnHome(host,[host,a,b]);
    await all([a,b],p => p.evaluate(() => __wash.connection.send('leave')));
    await host.waitForFunction(() => __wash.connection.room.members.length === 1);

    // Settings disable both enter/exit animations; the same solo barrier still waits for confirmation.
    await host.evaluate(() => __wash.ui.setMotionEnabled(false));
    await host.locator('#select-level').click(); await host.locator('.level-card[data-level-id="highway-01"]').click();
    await enterGuide([host]);
    await assertSceneStopped([host]);
    const frozenScroll=await host.evaluate(()=>__wash.network.renderScroll);
    assert.equal(await host.locator('.level-guide-dot:not([hidden])').count(),1);
    assert.equal(await host.locator('#level-guide').evaluate(n => n.getAnimations({subtree:true}).length),0);
    await host.keyboard.down('KeyJ'); await host.waitForFunction(() => __wash.game.roundStage === 'ready');
    assert.equal(await host.locator('#level-guide').isVisible(),false);
    await host.waitForFunction(scroll=>__wash.network.renderScroll>scroll+1,frozenScroll);
    await host.waitForFunction(() => __wash.game.roundStage === 'playing');
    await host.waitForTimeout(180); assert.equal(await host.evaluate(() => __wash.ui.input.down('KeyJ')),false,'held confirmation cannot become gameplay input after Go');
    await host.keyboard.up('KeyJ');
    await returnHome(host,[host]);
    await host.evaluate(() => __wash.app.dispose());
    assert.equal(await host.locator('#level-guide').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS Chrome: guide image startup gate, four-player J/button barrier, K/L rejection and dots, frozen scene/gameplay, no input/shader leak, leave/restart, later-level skip, reduced motion + UI motion-off, disposal');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
