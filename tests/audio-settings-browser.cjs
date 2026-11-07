const { installGuideReader } = require('./helpers/guide-browser.cjs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');

async function setSlider(page, channel, value) {
  await page.locator(`#setting-audio-${channel}`).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), errors = [];
  await installGuideReader(browser);

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 810 } }), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url.href); await page.waitForSelector('body.scene-ready');
    await page.locator('#settings').click();
    assert.equal(await page.getByRole('slider').count(), 5);
    assert.equal(await page.evaluate(() => __wash.ui.input.enabled), false);
    await page.waitForFunction(() => __wash.audio.music.source && __wash.audio.running);
    await page.evaluate(() => {
      window.__originalMusic = __wash.audio.music.source;
      __wash.audio.setLoop(15, 16, true); __wash.audio.flush();
      window.__originalLoop = __wash.audio.loops[15].chains[0].source;
    });
    await setSlider(page, 'master', 70); await setSlider(page, 'music', 25); await setSlider(page, 'sfx', 0);
    await page.waitForTimeout(150);
    const levels = await page.evaluate(() => ({ levels: __wash.audio.volumes,
      master: __wash.audio.master.gain.value, music: __wash.audio.musicBus.gain.value, sfx: __wash.audio.sfxBus.gain.value,
      musicReused: __wash.audio.music.source === __originalMusic, loopReused: __wash.audio.loops[15].chains[0].source === __originalLoop }));
    assert.deepEqual(levels.levels, { master: .7, music: .25, sfx: 0, voice: 1 });
    assert.ok(Math.abs(levels.master - .56) < .01 && Math.abs(levels.music - .25) < .01 && levels.sfx < .01);
    assert.ok(levels.musicReused && levels.loopReused, 'sliders preserve current music and SFX sources');
    await page.locator('#setting-audio-muted').check();
    await page.waitForTimeout(150); assert.ok(await page.evaluate(() => __wash.audio.master.gain.value < .01));
    await page.locator('#dialog-title').click(); await page.keyboard.press('KeyM');
    assert.equal(await page.locator('#setting-audio-muted').isChecked(), false);
    await page.waitForTimeout(150); assert.ok(await page.evaluate(() => Math.abs(__wash.audio.master.gain.value - .56) < .01));
    await page.locator('#setting-audio-sfx').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#setting-audio-sfx').inputValue(), '1');
    await page.screenshot({ path: 'docs/QA/audio-settings-home.png' });
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.locator('#setting-audio-muted').scrollIntoViewIfNeeded();
    const box = await page.locator('#setting-audio-muted').boundingBox(); assert.ok(box && box.y >= 0 && box.y + box.height <= 600);
    await page.setViewportSize({ width: 1440, height: 810 });
    await page.locator('#dialog-close').click(); await page.locator('#settings').click();
    assert.equal(await page.locator('#setting-audio-music').inputValue(), '25');
    await page.reload(); await page.waitForSelector('body.scene-ready'); await page.locator('#settings').click();
    assert.equal(await page.locator('#setting-audio-master').inputValue(), '70');
    assert.equal(await page.locator('#setting-audio-music').inputValue(), '25');
    assert.equal(await page.locator('#setting-audio-sfx').inputValue(), '1');
    assert.equal(await page.locator('#setting-audio-muted').isChecked(), false);
    await page.locator('#dialog-close').click(); await page.locator('#new-game').click();
    await page.waitForFunction(() => __wash.network.phase === 'game' && __wash.game.roundStage === 'playing' && !__wash.ui.iris.active);
    await page.locator('#pause-game').click(); await page.locator('.pause-settings').click();
    assert.equal(await page.locator('#setting-audio-music').inputValue(), '25');
    await setSlider(page, 'music', 0); await setSlider(page, 'sfx', 80);
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => __wash.audio.musicBus.gain.value < .01 && Math.abs(__wash.audio.sfxBus.gain.value - .8) < .01));
    await page.screenshot({ path: 'docs/QA/audio-settings-pause.png' });
    await page.locator('.settings-back').click(); await page.locator('.pause-continue').click();
    await page.waitForFunction(() => __wash.ui.input.enabled && !__wash.game.paused);
    assert.deepEqual(errors, []);
    console.log('PASS audio settings: home/pause UI, live independent buses, zero volume, source reuse, keyboard slider/mute, saved levels/reload, small viewport and modal input ownership');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
