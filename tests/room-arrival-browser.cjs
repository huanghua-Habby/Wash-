/** Same-machine Chrome/WebRTC: room arrivals on host, existing guest and newcomer, with literal bilingual IDs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
const output = 'docs/QA/room-arrival'; fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  try {
    for (const [name, language] of [['设置', 'zh'], ['GuestOne', 'en'], ['新队友', 'zh']]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ name, language }) => {
        if (!localStorage.getItem('wash-name')) localStorage.setItem('wash-name', name);
        if (!localStorage.getItem('wash-language')) localStorage.setItem('wash-language', language);
      }, { name, language });
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      assert.equal(await page.locator('.network-toast.home-toast:visible').count(), 0, 'own room is quiet');
    }
    const [host, guest, newcomer] = pages;
    const code = (await host.locator('#room-code-value').textContent()).trim();
    const join = async page => {
      // Hold the test's registry request briefly so the immediate progress modal can be inspected.
      await page.evaluate(() => {
        const connection = __wash.connection, send = connection.signalSend.bind(connection);
        connection.signalSend = (type, fields) => {
          if (type !== 'join') return send(type, fields);
          connection.signalSend = send; setTimeout(() => send(type, fields), 700); return true;
        };
      });
      await page.locator('#toggle-join-room').click(); await page.locator('#join-code').fill(code); await page.locator('#join-room').click();
      await page.locator('#join-room-progress[open]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#join-room-progress-title').textContent(), await page.locator('html').getAttribute('lang') === 'en' ? 'Connecting to room' : '正在连接房间');
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#join-room-progress').evaluate(node => node.open), true);
      assert.equal(await page.evaluate(() => __wash.ui.blocksPlayer), true);
      await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('join-room-progress')).opacity) > .99);
      if (page === guest) await page.screenshot({ path: `${output}/connecting-en.png` });
      await page.waitForFunction(() => __wash.connection.guest?.open);
      await page.locator('#join-room-progress').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => __wash.network.latest?.players[__wash.connection.room.slot]?.sceneReady), true);
    };
    const notice = (page, text) => page.locator('.network-toast.home-toast').filter({ hasText: text });
    await join(guest);
    await Promise.all([
      notice(host, '新玩家入场：GuestOne').waitFor({ state: 'visible' }),
      notice(guest, 'You joined 设置’s room!').waitFor({ state: 'visible' }),
    ]);
    await host.screenshot({ path: `${output}/host-zh.png` }); await guest.screenshot({ path: `${output}/guest-en.png` });
    await guest.evaluate(() => __wash.ui.setLanguage('zh'));
    assert.equal(await guest.locator('.network-toast').textContent(), '已进入设置的房间！');
    await guest.evaluate(() => __wash.ui.setLanguage('en'));
    assert.equal(await guest.locator('.network-toast').textContent(), 'You joined 设置’s room!');
    assert.equal(await guest.locator('.network-toast *').count(), 0, 'player ID renders only as text');
    await host.waitForTimeout(5200);
    assert.equal(await host.locator('.network-toast.home-toast:visible').count(), 0);
    await guest.evaluate(() => __wash.connection.rename('Renamed'));
    await host.waitForFunction(() => __wash.connection.room.members.some(member => member.name === 'Renamed'));
    assert.equal(await host.locator('.network-toast.home-toast:visible').count(), 0, 'rename is not an arrival');
    await join(newcomer);
    await Promise.all([
      notice(host, '新玩家入场：新队友').waitFor({ state: 'visible' }),
      notice(guest, 'New player joined: 新队友').waitFor({ state: 'visible' }),
      notice(newcomer, '已进入设置的房间！').waitFor({ state: 'visible' }),
    ]);
    await guest.screenshot({ path: `${output}/existing-guest-en.png` });
    await host.waitForTimeout(5200);
    await guest.reload(); await guest.waitForSelector('body.scene-ready', { timeout: 60000 });
    await guest.waitForFunction(() => __wash.connection.guest?.open);
    assert.equal(await guest.locator('html').getAttribute('lang'), 'en');
    for (const page of pages) assert.equal(await page.locator('.network-toast.home-toast:visible').count(), 0, 'retained seat reconnect does not announce a new player');
    // An explicit leave followed by joining again is a real new entrance.
    await guest.locator('#room-action').click(); await guest.locator('.leave-party-yes').click(); await guest.waitForFunction(() => __wash.connection.isHost);
    await host.waitForFunction(() => __wash.connection.room.members.length === 2);
    await join(guest);
    await Promise.all([
      notice(host, '新玩家入场：Renamed').waitFor({ state: 'visible' }),
      notice(guest, 'You joined 设置’s room!').waitFor({ state: 'visible' }),
    ]);
    // A rejected registry join closes the modal and keeps the existing room intact.
    const before = await newcomer.locator('#room-code-value').textContent();
    await newcomer.locator('#toggle-join-room').click(); await newcomer.locator('#join-code').fill('AAAAAA'); await newcomer.locator('#join-room').click();
    await notice(newcomer, '没有找到这个房间').waitFor({ state: 'visible' });
    assert.equal(await newcomer.locator('#join-room-progress').evaluate(node => node.open), false);
    assert.equal(await newcomer.locator('#room-code-value').textContent(), before);
    assert.deepEqual(errors, []);
    console.log('Room arrivals passed: host and existing guest notices, joined-room confirmation after WebRTC open, bilingual literal IDs, language switching/persistence, rename/reconnect deduplication, explicit rejoin.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
