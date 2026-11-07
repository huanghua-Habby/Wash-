const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Real browser solo play, pause and return: the page's own authority runs the world; no peer link, no gameplay traffic. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const testUrl=new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');testUrl.searchParams.set('wash-test','1');const url=testUrl.href;
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const outgoing=[],incoming=[],errors=[];
  await installGuideReader(browser);

  try {
    const page=await browser.newPage({viewport:{width:1440,height:810}});
    await page.addInitScript(()=>{window.__peer={pcs:0,sent:0};const N=window.RTCPeerConnection;window.RTCPeerConnection=class extends N{constructor(...a){super(...a);window.__peer.pcs++;}};const send=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(d){window.__peer.sent++;return send.call(this,d);};});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('websocket',socket=>{
      socket.on('framesent',frame=>{try{outgoing.push(JSON.parse(frame.payload));}catch{}});
      socket.on('framereceived',frame=>{try{incoming.push(JSON.parse(frame.payload));}catch{}});
    });
    await page.goto(url);await page.waitForSelector('body.scene-ready');
    assert.equal(await page.evaluate(()=>__wash.connection.room.mode),'solo');
    const code=await page.locator('#room-code-value').textContent();
    const quiet=()=>outgoing.filter(frame=>!['hello','host_phase'].includes(frame.type));
    await page.locator('#game').click({position:{x:700,y:400}});
    await page.keyboard.down('d');await new Promise(r=>setTimeout(r,200));await page.keyboard.up('d');
    await page.keyboard.press('Space');await page.keyboard.press('Shift');
    await new Promise(r=>setTimeout(r,5000));
    assert.deepEqual(quiet(),[],'no gameplay messages on the signaling socket');
    assert.equal(outgoing.filter(frame=>frame.type==='hello').length,1,'no false reconnect');
    assert.deepEqual(await page.evaluate(()=>window.__peer),{pcs:0,sent:0},'no peer connection while alone');
    await page.locator('#new-game').click();await page.waitForSelector('body.in-game');
    await page.waitForFunction(()=>document.querySelectorAll('.stain-badge').length===3);
    await page.locator('#pause-game').click();await page.waitForSelector('#menu-dialog[open]');
    assert.deepEqual(quiet(),[]);
    await page.locator('.pause-continue').click();await new Promise(r=>setTimeout(r,1500));
    assert.deepEqual(outgoing.filter(frame=>frame.type==='host_phase').map(frame=>frame.phase),['home','transition','game'],'only the join restriction is reported');
    await page.locator('#pause-game').click();await page.waitForSelector('#menu-dialog[open]');await page.locator('.pause-home').click();
    await page.waitForFunction(()=>!document.body.classList.contains('in-game')&&document.querySelector('#wash-iris').hasAttribute('hidden'));
    assert.equal(await page.locator('#room-code-value').textContent(),code);
    assert.deepEqual(quiet(),[]);assert.deepEqual(await page.evaluate(()=>window.__peer),{pcs:0,sent:0});
    assert.equal(incoming.filter(frame=>!['welcome','room'].includes(frame.type)).length,0,'the service only sends registry updates');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wash-progress')).version),'0.3');
    assert.deepEqual(errors,[]);
    console.log('PASS solo browser: movement, jump, ignored Shift, start, orders, pause and masked return; zero peer links and gameplay messages, phase-only registry updates, no false reconnect, progress 0.1');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
