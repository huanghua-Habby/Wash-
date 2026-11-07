const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Real browsers against a running signaling service: rooms hosted by browsers, guests over WebRTC data channels.
 * Same-machine Chrome contexts only — this is not a cross-device LAN measurement. Requires installed Google Chrome. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const testUrl = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/mp/wash-cn/');
testUrl.searchParams.set('wash-test', '1');
const url = testUrl.href;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mark = (label) => { if (process.env.WASH_TEST_VERBOSE) console.log(`[${new Date().toISOString().slice(11, 23)}] ${label}`); };

/** Count data channel traffic and peer connections inside the page; `relay` forces a link that can never connect. */
function instrument({ fail }) {
  window.__peer = { sent: 0, pcs: 0 };
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Native {
    constructor(config = {}) { super(fail ? { ...config, iceServers: [], iceTransportPolicy: 'relay' } : config); window.__peer.pcs++; }
  };
  const send = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (data) { window.__peer.sent++; return send.call(this, data); };
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket { constructor(...args) { super(...args); window.__socket = this; } };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  // Keep the four-player room in one process, and the independent room in another.
  // A single headless GPU process can stall parallel shader preparation with 10+ contexts.
  const extraBrowser = await chromium.launch({ headless: true, channel: 'chrome' });
  await installGuideReader(browser); await installGuideReader(extraBrowser);
  const errors = [], pages = [], signaling = [];
  const open = async (i, options = {}) => {
    const context = await (i >= 4 ? extraBrowser : browser).newContext({ viewport: { width: 1440, height: 810 } });
    await context.addInitScript(instrument, { fail: !!options.fail });
    const page = await context.newPage();
    if (process.env.WASH_TEST_VERBOSE) page.on('console', message => { if (message.type() === 'error' || /Context Lost|active WebGL|GPU/.test(message.text())) console.log(`browser ${i} ${message.text()}`); });
    page.on("pageerror", (e) => errors.push(`${i}: ${process.env.WASH_TEST_VERBOSE ? e.stack.split("\n").slice(0, 8).join(" | ") : e.message}`));
    signaling[i] = { sent: [], received: [] };
    page.on('websocket', (ws) => {
      ws.on('framesent', (f) => { try { signaling[i].sent.push(JSON.parse(f.payload)); } catch {} });
      ws.on('framereceived', (f) => { try { signaling[i].received.push(JSON.parse(f.payload)); } catch {} });
    });
    mark(`opening browser ${i}`);
    await page.goto(url);
    try { await page.waitForSelector('body.scene-ready'); } catch (error) {
      console.error('Startup diagnostics', i, await page.locator('#boot-label').textContent(), await page.locator('#boot-percent').textContent(), await page.evaluate(() => [...document.querySelectorAll('canvas')].map(c => { const gl=c.getContext('webgl2'); return { id:c.id, lost:gl?.isContextLost() }; })), errors);
      throw error;
    }
    mark(`browser ${i} ready`);
    return page;
  };
  const label = (page) => page.locator('#room-code-label').textContent();
  const codeOf = (page) => page.locator('#room-code-value').textContent();
  const join = async (page, code) => { if (await page.locator('#join-room-form').isHidden()) await page.locator('#toggle-join-room').click(); await page.locator('#join-code').fill(code); await page.locator('#join-room').click(); };
  const linked = (page) => page.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest, null, { timeout: 15000 });
  const peerSent = (page) => page.evaluate(() => window.__peer.sent);
  const onTruck = (page, slot) => page.evaluate((s) => { const sim = __wash.connection.authority.sim, p = sim.players[s]; return [p.pos.x - sim.trucks[0].pos.x, p.pos.z - sim.trucks[0].pos.z]; }, slot);
  try {
    for (let i = 0; i < 6; i++) pages.push(await open(i));
    mark('1. Alone: no peer connections and no data t');
    // 1. Alone: no peer connections and no data traffic while idle.
    const idle = await Promise.all(pages.map(peerSent)); await wait(2000);
    assert.deepEqual(await Promise.all(pages.map(peerSent)), idle);
    assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => [__wash.connection.room.mode, window.__peer.pcs]))), pages.map(() => ['solo', 0]));

    const code = await codeOf(pages[0]); assert.match(code, /^[A-Z2-9]{6}$/);
    for (let i = 0; i < 4; i++) { await pages[i].locator('#edit-player-name').click(); await pages[i].locator('#player-name').fill(['房主', '洗车员二', 'Alice', 'Bob'][i]); await pages[i].locator('#player-name').press('Enter'); }
    mark('2. Four independent browsers in one hosts ');
    // 2. Four independent browsers in one host's room, each on a direct link.
    const t0 = Date.now();
    for (let i = 1; i < 4; i++) { await join(pages[i], code); await pages[i].waitForFunction(() => document.querySelector('#room-code-label').textContent === '当前房间'); }
    await Promise.all(pages.slice(1, 4).map(linked));
    const linkMs = Date.now() - t0;
    assert.equal(await pages[0].evaluate(() => __wash.connection.room.mode), 'multiplayer');
    assert.equal(await pages[1].locator('#room-action').textContent(), '离开房间');
    assert.deepEqual(await pages[0].locator('.name-tag').allTextContents(), ['房主', '洗车员二', 'Alice', 'Bob']);
    mark('Full room keeps'); // Full room keeps the fifth player's own code.
    const fifthCode = await codeOf(pages[4]);
    await join(pages[4], code); await pages[4].waitForFunction(() => document.querySelector('#room-message').textContent.includes('四位'));
    assert.equal(await codeOf(pages[4]), fifthCode);
    mark('3. A second room has its own browser author');
    // 3. A second room has its own browser authority.
    await join(pages[4], await codeOf(pages[5])); await linked(pages[4]);
    const hosts = await Promise.all([pages[1], pages[4]].map((p) => p.evaluate(() => __wash.connection.guest.hostId)));
    assert.deepEqual(hosts, await Promise.all([pages[0], pages[5]].map((p) => p.evaluate(() => __wash.connection.playerId))));
    assert.equal(await pages[0].evaluate(() => __wash.connection.authority.sim.players.filter((p) => p.occupied).length), 4);
    assert.equal(await pages[5].evaluate(() => __wash.connection.authority.sim.players.filter((p) => p.occupied).length), 2);
    mark('Signaling socket loss'); // Signaling socket loss: the direct link keeps playing while the registry session resumes.
    const token = await pages[2].evaluate(() => sessionStorage.getItem('wash-session'));
    const hellos = () => signaling[2].sent.filter((m) => m.type === 'hello').length, hellosBefore = hellos();
    await pages[2].evaluate(() => window.__socket.close());
    for (const end = Date.now() + 10000; hellos() === hellosBefore; await wait(50)) if (Date.now() > end) throw new Error('signaling did not reconnect');
    await pages[2].waitForFunction(() => __wash.connection.connected && __wash.connection.guest?.open, null, { timeout: 15000 });
    assert.equal(await pages[2].evaluate(() => sessionStorage.getItem('wash-session')), token);
    mark('Leaving creates'); // Leaving creates a fresh code; the old one is retired.
    await pages[2].locator('#room-action').click(); await pages[2].waitForFunction(() => document.querySelector('#room-code-label').textContent === '我的房间');
    const retired = await codeOf(pages[2]);
    await join(pages[2], code); await linked(pages[2]);
    await join(pages[4], retired); await pages[4].waitForFunction(() => document.querySelector('#room-message').textContent.includes('没有找到'));
    await pages[0].screenshot({ path: path.resolve('docs/QA/multiplayer-home.png') });

    mark('4. A guests keys drive only its registry s');

    // 4. A guest's keys drive only its registry slot on the host.
    for (const p of pages.slice(0, 4)) await p.waitForFunction(() => __wash.network.latest?.players.every((s) => s.state === 'ground'), null, { timeout: 10000 });
    const before = await Promise.all([1, 2, 3].map((s) => onTruck(pages[0], s)));
    await pages[1].locator('#game').click({ position: { x: 700, y: 400 } }); await pages[1].keyboard.down('d'); await wait(300); await pages[1].keyboard.up('d'); await wait(300);
    const after = await Promise.all([1, 2, 3].map((s) => onTruck(pages[0], s)));
    const moved = after.map((a, i) => Math.hypot(a[0] - before[i][0], a[1] - before[i][1]));
    assert.ok(moved[0] > 0.2 && moved[1] < 0.02 && moved[2] < 0.02, `only slot 1 moved: ${moved.map((m) => m.toFixed(3))}`);

    mark('5. Two guests press J on the same towel at ');

    // 5. Two guests press J on the same towel at once: one owner, the same answer in every browser.
    await pages[0].evaluate(() => {
      const sim = __wash.connection.authority.sim, towel = sim.game.towels[0], spot = towel.mesh.getWorldPosition(towel.mesh.position.clone()), truck = sim.trucks[0];
      for (const s of [1, 2]) { const p = sim.players[s]; p.state = 'ground'; p.ground = { truck, plat: truck.platforms[0] }; p.pos.set(spot.x, truck.topY, spot.z); p.vel.set(0, 0, 0); }
    });
    await Promise.all([pages[1], pages[2]].map((p) => p.locator('#game').click({ position: { x: 700, y: 400 } })));
    await Promise.all([pages[1], pages[2]].map((p) => p.keyboard.press('j')));
    await wait(400);
    const holders = await Promise.all(pages.slice(0, 4).map((p) => p.evaluate(() => __wash.network.latest.game.towels[0].holder)));
    assert.ok([1, 2].includes(holders[0]), `host owner ${holders[0]}`); assert.deepEqual(holders, holders.map(() => holders[0]));

    mark('6. Start, guest-only pause, host pause and ');

    // 6. Start, guest-only pause, host pause and shared return.
    const signalBefore = signaling.map((s) => s.received.length), peerBefore = await Promise.all(pages.slice(0, 4).map(peerSent));
    await pages[0].locator('#new-game').click();
    await Promise.all(pages.slice(0, 4).map((p) => p.waitForFunction(() => document.body.classList.contains('in-game'))));
    mark('A mid-game join'); // A mid-game join is refused by the registry.
    const fourth = await codeOf(pages[4]);
    const errorsBefore = signaling[4].received.length;
    await join(pages[4], code);
    for (const end = Date.now() + 5000; !signaling[4].received.slice(errorsBefore).some((m) => m.code === 'room_started'); await wait(50))
      if (Date.now() > end) throw new Error(`mid-game join not refused: ${JSON.stringify(signaling[4].received.slice(errorsBefore).map((m) => [m.type, m.code, m.phase]))}`);
    assert.equal(await codeOf(pages[4]), fourth);
    await pages[0].screenshot({ path: path.resolve('docs/QA/multiplayer-game.png') });
    await pages[1].locator('#pause-game').click(); await pages[1].waitForSelector('#menu-dialog[open]');
    assert.equal(await pages[0].evaluate(() => __wash.connection.authority.sim.game.paused), false, 'a guest menu does not pause the room');
    await pages[1].locator('.pause-continue').click();
    await pages[0].locator('#pause-game').click(); await pages[0].waitForSelector('#menu-dialog[open]');
    await Promise.all(pages.slice(1, 4).map((p) => p.waitForFunction(() => __wash.network.latest.game.paused)));
    mark('9. Gameplay traffic follows the peer links,');
    // 9. Gameplay traffic follows the peer links, not the signaling service.
    const signalDuring = signaling.slice(0, 4).map((s, i) => s.received.slice(signalBefore[i]).filter((m) => m.type !== 'room' && m.type !== 'error'));
    assert.ok(signalDuring.every((list) => list.length === 0), 'no gameplay frames on the signaling socket');
    const peerAfter = await Promise.all(pages.slice(0, 4).map(peerSent));
    assert.ok(peerAfter.every((n, i) => n > peerBefore[i]), 'host and guests exchanged data channel messages');
    await pages[0].locator('.pause-home').click();
    await Promise.all(pages.slice(0, 4).map((p) => p.waitForFunction(() => !document.body.classList.contains('in-game') && __wash.network.latest?.phase === 'home')));
    const stats = await pages[1].evaluate(() => __wash.network.stats);

    mark('7. Guest departure keeps the host world; ho');

    // 7. Guest departure keeps the host world; host departure returns guests to their own rooms.
    await pages[3].locator('#room-action').click(); await pages[3].waitForFunction(() => document.querySelector('#room-code-label').textContent === '我的房间');
    await pages[0].waitForFunction(() => __wash.connection.room.members.length === 3);
    await join(pages[4], await codeOf(pages[5])).catch(() => {});
    await pages[4].waitForFunction(() => __wash.connection.guest?.open, null, { timeout: 15000 });
    await pages[5].close();
    await pages[4].waitForFunction(() => document.querySelector('#room-code-label').textContent === '我的房间' && __wash.connection.isHost, null, { timeout: 20000 });
    mark('Connection failure'); // Connection failure: a browser that cannot form any direct path reports it and gets its own room back.
    const blocked = await open(6, { fail: true });
    await join(blocked, code);
    await blocked.waitForFunction(() => document.querySelector('#room-message').textContent.includes('无法与房主建立直连'), null, { timeout: 20000 });
    await blocked.waitForFunction(() => document.querySelector('#room-code-label').textContent === '我的房间' && __wash.connection.isHost, null, { timeout: 10000 });
    await pages[0].waitForFunction(() => __wash.connection.room.members.length === 3);
    assert.deepEqual(errors, []);
    console.log(`Direct links for 3 guests ready in ${linkMs} ms (same machine). Guest stats:`, stats);
    console.log('PASS browser-hosted rooms: solo zero traffic, four players, full room, two rooms, signaling resume, retired code, slot isolation, concurrent pickup, start/pause/return, mid-game join refused, peer-only gameplay traffic, guest/host departure, direct-link failure');
  } finally { await extraBrowser.close(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
