const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Controlled HTTPS static hosting + LAN page share the PC signaling service and room codes, then play over a direct
 * WebRTC link (the static page's browser hosts). No cloud relay; same-machine Chrome only.
 * Only the disposable test context receives LNA permission; personal browser settings are untouched.
 * This does not verify Game Share's deployment headers or iframe permissions policy.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const lan = process.env.WASH_TEST_URL || 'http://192.168.1.10:8080/';
const origin = 'https://wash-static-test.example';
const root = path.resolve('dist/game-share');
(async () => {
  const browser = await chromium.launch({ headless:true, channel:'chrome' });
  await installGuideReader(browser);

  try {
    const context = await browser.newContext({viewport:{width:1440,height:810}});
    const published = await context.newPage();
    await published.addInitScript(() => {
      const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get;
      Object.defineProperty(document, 'visibilityState', { get: () => window.__hiddenForTest ? 'hidden' : visibility.call(document) });
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => {
        if (window.__haltFrames) { window.__heldFrame = callback; return 0; }
        return raf(callback);
      };
    });
    const frames = [], sockets = [], errors = [];
    published.on('pageerror',e=>errors.push(e.message));
    published.on('websocket',socket=>{sockets.push(socket.url());socket.on('framereceived',f=>{try{frames.push(JSON.parse(f.payload));}catch{}});});
    await published.route(`${origin}/**`, async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname+'index.html' : pathname));
      if (!file.startsWith(root+path.sep)) return route.fulfill({status:403,body:''});
      try {
        const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary'};
        await route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});
      } catch { await route.fulfill({status:404,body:'Not found'}); }
    });
    const cdp = await context.newCDPSession(published);
    const {targetInfo} = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission',{permission:{name:'local-network'},setting:'granted',origin,browserContextId:targetInfo.browserContextId});
    await cdp.send('Browser.setPermission',{permission:{name:'local-network-access'},setting:'granted',origin,browserContextId:targetInfo.browserContextId});
    // Newer Chrome splits loopback from LAN; grant it too so a 127.0.0.1 service works in this disposable context.
    await cdp.send('Browser.setPermission',{permission:{name:'loopback-network'},setting:'granted',origin,browserContextId:targetInfo.browserContextId}).catch(()=>{});
    await published.goto(origin+'/?wash-test=1');
    await published.waitForSelector('body.scene-ready',{timeout:60000});
    assert.equal(await published.evaluate(()=>__wash.resources.status.assets.find(asset=>asset.name==='音效与音乐')?.state),'ready','compressed FLAC effects and MP3 music decode without degradation');
    assert.equal(await published.evaluate(()=>__wash.audio.musicBuffers.every(Boolean)),true);
    assert.equal(await published.evaluate(()=>__wash.connection.room.mode),'solo');
    assert.deepEqual(sockets,[new URL('/ws',lan).href.replace(/^http/,'ws')]);
    const code = await published.locator('#room-code-value').textContent();
    const guestContext = await browser.newContext({viewport:{width:1440,height:810}});
    const guest = await guestContext.newPage();
    const lanUrl=new URL(lan);lanUrl.searchParams.set('wash-test','1');
    await guest.goto(lanUrl.href);await guest.waitForSelector('body.scene-ready',{timeout:60000});
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(code);await guest.locator('#join-room').click();
    await guest.waitForFunction(c=>document.querySelector('#room-code-value').textContent===c&&__wash.connection.guest?.open,code,{timeout:20000});
    await published.waitForFunction(()=>document.querySelector('#room-role').textContent.includes('2/4'));
    assert.equal(await guest.locator('#room-action').textContent(),'离开房间');
    await guest.waitForFunction(() => __wash.network.latest && __wash.connection.guest?.open);
    const before = await guest.evaluate(() => __wash.network.latest.time);
    await published.evaluate(() => {
      window.__hiddenForTest = true; window.__haltFrames = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await guest.waitForFunction(time => __wash.connection.guest?.open && __wash.network.latest.time > time + 6, before, { timeout:15000 });
    assert.equal(await published.evaluate(() => __wash.connection.socket.readyState), 1, 'registry socket remains open');
    assert.equal(await published.evaluate(() => __wash.network.backgroundClock.active), true);
    assert.equal(await guest.evaluate(() => __wash.connection.guest.open), true, 'six seconds without host rendering never trips the four-second watchdog');
    await published.evaluate(() => {
      window.__hiddenForTest = false; window.__haltFrames = false;
      document.dispatchEvent(new Event('visibilitychange'));
      if (window.__heldFrame) { const callback = window.__heldFrame; window.__heldFrame = null; requestAnimationFrame(callback); }
    });
    assert.equal(await published.evaluate(() => __wash.network.backgroundClock.active), false, 'foreground takes back authority without overlapping clocks');
    await published.locator('#new-game').click();
    await Promise.all([published.waitForSelector('body.in-game'),guest.waitForSelector('body.in-game')]);
    assert.equal(await published.evaluate(()=>__wash.connection.room.mode),'multiplayer');
    await guest.waitForFunction(()=>__wash.network.latest?.phase==='game',null,{timeout:30000});
    assert.equal(frames.some(f=>f.type==='snapshot'),false,'gameplay state never crosses the signaling service');
    await published.locator('#pause-game').click();await published.waitForSelector('#menu-dialog[open]');await published.locator('.pause-home').click();
    await Promise.all([published.waitForFunction(()=>!document.body.classList.contains('in-game')&&document.querySelector('#wash-iris').hasAttribute('hidden')),guest.waitForFunction(()=>!document.body.classList.contains('in-game')&&document.querySelector('#wash-iris').hasAttribute('hidden'))]);
    assert.deepEqual(errors,[]);
    console.log('PASS Chrome '+browser.version()+': compressed audio decode, HTTPS static + LAN direct link, hidden host keeps snapshots for >6s with no render frames, foreground resumes, host-browser game and masked return');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
