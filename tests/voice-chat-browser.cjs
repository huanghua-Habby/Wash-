/** Party voice over real Chrome WebRTC with Chrome's fake microphone (a beep tone): solo opens no mic, joining
 * connects voice automatically, the host mix carries guest↔guest audio, and mute silences only that speaker.
 * Same-machine browser contexts; not a cross-device LAN test. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');
url.searchParams.set('wash-test', '1');
const shots = process.env.WASH_VOICE_SHOTS;

/** Received audio energy over a window, per inbound audio stream on this page's links. */
const energy = (page, ms = 1500) => page.evaluate(async (ms) => {
  const c = __wash.connection, pcs = c.authority ? [...c.authority.guests.values()].map(g => g.link.pc) : [c.guest.link.pc];
  const read = async () => Promise.all(pcs.map(async pc => { let e = 0; (await pc.getStats()).forEach(s => { if (s.type === 'inbound-rtp' && s.kind === 'audio') e += s.totalAudioEnergy || 0; }); return e; }));
  const a = await read(); await new Promise(r => setTimeout(r, ms)); const b = await read();
  return b.map((v, i) => v - a[i]);
}, ms);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, permissions: ['microphone'] });
  const pages = [], errors = [];
  try {
    for (const language of ['zh', 'en', 'zh']) {
      const page = await context.newPage();
      await page.addInitScript(language => { localStorage.setItem('wash-language', language); localStorage.removeItem('wash-voice-muted'); }, language);
      page.on('pageerror', error => errors.push(error.message)); pages.push(page);
      await page.goto(url.href);
      await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      await page.waitForFunction(() => __wash.connection.connected);
    }
    const [host, a, b] = pages;
    // Solo: no link, no microphone, no voice UI.
    assert.deepEqual(await host.evaluate(() => ({ active: __wash.connection.voice.active, mic: __wash.connection.voice.mic,
      row: document.querySelector('.voice-row').hidden })), { active: false, mic: 'off', row: true });
    const code = await host.locator('#room-code-value').textContent();
    for (const guest of [a, b]) {
      if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
      await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
      await guest.waitForFunction(() => __wash.connection.guest?.open && !__wash.ui.iris.active && !__wash.ui.hasModal, null, { timeout: 30000 });
    }
    for (const page of pages) await page.waitForFunction(() => { const v = __wash.connection.voice; return v.mic === 'on' && v.peers === v.links.size && v.links.size > 0; }, null, { timeout: 15000 });
    assert.equal(await host.evaluate(() => __wash.connection.voice.peers), 2);
    assert.equal(await host.locator('.voice-status').textContent(), '语音已连通');
    assert.equal(await a.locator('.voice-status').textContent(), 'Voice connected');
    if (shots) await host.locator('#room-panel').screenshot({ path: `${shots}/voice-room-zh.png` });
    if (shots) await a.locator('#room-panel').screenshot({ path: `${shots}/voice-room-en.png` });

    const [hostFromA, hostFromB] = await energy(host), [aHears] = await energy(a), [bHears] = await energy(b);
    console.log('energy everyone live', { hostFromA, hostFromB, aHears, bHears });
    assert.ok(hostFromA > 0 && hostFromB > 0 && aHears > 0 && bHears > 0, 'all directions carry audio');

    // Host muted: guests still hear each other through the host's mix.
    await host.locator('.voice-toggle:not(.voice-listen)').click();
    assert.equal(await host.evaluate(() => __wash.connection.voice.micTrack.enabled), false);
    assert.equal(await host.locator('.voice-status').textContent(), '麦克风已静音');
    await host.waitForTimeout(500);
    const [bViaHost] = await energy(b);
    // Guest A muted too (V shortcut): B's mix now holds only muted speakers.
    await a.locator('canvas#game').click({ position: { x: 700, y: 400 } }); await a.keyboard.press('KeyV');
    assert.equal(await a.evaluate(() => __wash.connection.voice.muted), true);
    await a.waitForTimeout(800);
    const [bSilent] = await energy(b);
    const [hostFromBStill] = (await energy(host)).slice(1);
    console.log('energy after mutes', { bViaHost, bSilent, hostFromBStill });
    assert.ok(bViaHost > 0, 'guest B hears guest A through the host mix while the host is muted');
    assert.ok(bSilent < bViaHost * 0.05, 'muting both other speakers silences B');
    assert.ok(hostFromBStill > 0, 'B is still heard');
    await a.keyboard.press('KeyV'); assert.equal(await a.evaluate(() => __wash.connection.voice.muted), false);

    // B: stop hearing voice on this page only — playback muted, own mic and the host mix untouched; remembered.
    const playback = page => page.evaluate(() => [...__wash.audio.voiceElements.values()].map(element => [element.muted, element.volume]));
    assert.ok((await playback(b)).every(([muted, volume]) => !muted && volume === .5), 'voice plays at the 50% default');
    await b.locator('canvas#game').click({ position: { x: 700, y: 400 } }); await b.keyboard.press('KeyB');
    assert.ok((await playback(b)).every(([muted]) => muted), 'B mutes local voice playback');
    assert.equal(await b.locator('.voice-toggle.voice-listen').getAttribute('data-state'), 'muted');
    assert.equal(await b.evaluate(() => [__wash.connection.voice.muted, localStorage.getItem('wash-voice-deafened')].join()), 'false,1', 'own mic stays on');
    const [, hostHearsB] = await energy(host); assert.ok(hostHearsB > 0, 'others still hear B');
    await b.locator('.voice-toggle.voice-listen').click();
    assert.ok((await playback(b)).every(([muted]) => !muted), 'the speaker button turns listening back on');

    // In game: the mic button sits beside pause.
    await host.locator('#new-game').click();
    await host.waitForFunction(() => __wash.ui.page === 'game' && !__wash.ui.iris.active, null, { timeout: 60000 });
    assert.equal(await host.locator('.voice-game-button:not(.voice-listen)').isVisible(), true);
    assert.equal(await host.locator('.voice-game-button:not(.voice-listen)').getAttribute('data-state'), 'muted');
    assert.equal(await host.locator('.voice-game-button.voice-listen').isVisible(), true, 'the speaker sits beside the mic in game');
    if (shots) await host.screenshot({ path: `${shots}/voice-game-host.png`, clip: { x: 0, y: 0, width: 420, height: 160 } });

    // Leaving the party ends voice; the microphone closes after the grace period.
    await b.evaluate(() => __wash.connection.requestLeave());
    await b.waitForFunction(() => !__wash.connection.voice.active && __wash.connection.voice.mic === 'off', null, { timeout: 15000 });
    assert.equal(await b.locator('.voice-row').isHidden(), true);
    await host.waitForFunction(() => __wash.connection.voice.links.size === 1, null, { timeout: 15000 });
    assert.deepEqual(errors, []);
    console.log('voice chat browser ok');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
