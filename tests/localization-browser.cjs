/** Actual bilingual UI and same-machine WebRTC; score completion is an isolated authority fixture. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:18083/'); url.searchParams.set('wash-test', '1');
const output = path.resolve('docs/QA/localization'); fs.mkdirSync(output, { recursive: true });
async function untranslated(page, root = 'body') {
  return page.locator(root).evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), found = []; let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,[data-l10n-literal],#profile-name,.name-tag,.teammate-name')) continue;
      const style = getComputedStyle(parent);
      if (parent.getClientRects().length && style.visibility !== 'hidden' && /\p{Script=Han}/u.test(node.textContent)) found.push(node.textContent.trim());
    }
    return [...new Set(found)];
  });
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [], requests = [];
  try {
    for (const name of ['设置', '队友']) {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }); pages.push(p);
      p.on('pageerror', error => errors.push(error.message));
      p.on('request', request => { if (/\.en-[^/]+\.webp/.test(request.url())) requests.push(request.url()); });
      await p.addInitScript(name => {
        localStorage.setItem('wash-name', name); window.__guideDecodes = [];
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () {
          if (/(?:tools-(?:water|soap|charging)|hazard-road-sign)/.test(this.src)) __guideDecodes.push(this.src);
          return decode.call(this);
        };
      }, name);
      await p.goto(url.href); await p.waitForSelector('body.scene-ready', { timeout: 60000 });
    }
    const [h, g] = pages;
    await h.locator('#settings').click();
    assert.equal(await h.locator('#dialog-content > :first-child').getAttribute('class'), 'setting-row language-setting');
    await h.locator('#setting-audio-music').fill('37'); await h.locator('#setting-audio-music').dispatchEvent('input');
    const post = await h.locator('#setting-post').isChecked();
    await h.locator('button[data-language="en"]').click();
    assert.equal(await h.locator('html').getAttribute('lang'), 'en');
    assert.equal(await h.locator('button[data-language="en"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await h.locator('button[data-language="en"]').evaluate(n => n === document.activeElement), true);
    assert.equal(await h.locator('#setting-audio-music').inputValue(), '37');
    assert.equal(await h.locator('#setting-post').isChecked(), post);
    assert.equal(await h.locator('.audio-mute small').textContent(), 'Press M to toggle');
    assert.deepEqual(await untranslated(h, '#menu-dialog'), []);
    await h.screenshot({ path: path.join(output, 'settings-en.png') });
    await h.locator('button[data-language="zh"]').click();
    assert.equal(await h.locator('.audio-mute small').textContent(), 'M 快捷切换');
    await h.locator('button[data-language="en"]').click();
    await h.reload(); await h.waitForSelector('body.scene-ready', { timeout: 60000 });
    assert.equal(await h.locator('html').getAttribute('lang'), 'en');
    assert.equal(await h.locator('#profile-name').textContent(), '设置', 'a nickname equal to a translation key stays literal');
    assert.ok((await h.locator('#new-game').textContent()).includes('New game'));
    assert.deepEqual(await untranslated(h), []);
    await h.screenshot({ path: path.join(output, 'home-en.png') });
    await h.keyboard.press('Backquote'); await h.waitForSelector('.fx-debug', { state: 'visible' });
    assert.deepEqual(await untranslated(h, '.fx-debug'), []);
    assert.deepEqual(await h.locator('.fx-debug input:disabled').evaluateAll(inputs => inputs.map(input => input.value).filter(value => /\p{Script=Han}/u.test(value))), []);
    await h.keyboard.press('Backquote');
    await h.locator('#toggle-join-room').click(); await h.locator('#join-code').fill('ABC'); await h.locator('#join-room').click();
    assert.equal(await h.locator('#room-message').textContent(), 'Enter a 6-character room code.');
    await h.locator('#toggle-join-room').click();
    await h.locator('#customize-player').click();
    for (const animal of ['cat', 'dog', 'pelican', 'elephant', 'squirrel']) {
      await h.locator(`[data-animal="${animal}"].animal-choice`).click();
      assert.deepEqual(await untranslated(h, '#customize-dialog'), []);
    }
    const draft = await h.evaluate(() => ({ ...__wash.ui.customize.draft }));
    await h.evaluate(() => __wash.ui.setLanguage('zh')); await h.evaluate(() => __wash.ui.setLanguage('en'));
    assert.deepEqual(await h.evaluate(() => __wash.ui.customize.draft), draft);
    await h.screenshot({ path: path.join(output, 'customize-elephant-en.png') });
    await h.locator('.customize-cancel').click();
    await h.locator('#select-level').click(); assert.equal(await h.locator('.level-card').count(), 5);
    assert.deepEqual(await untranslated(h, '#menu-dialog'), []);
    await h.screenshot({ path: path.join(output, 'levels-en.png') });
    await h.setViewportSize({ width: 600, height: 900 });
    assert.equal(await h.locator('#menu-dialog').evaluate(n => n.scrollWidth <= n.clientWidth), true);
    await h.screenshot({ path: path.join(output, 'levels-en-narrow.png') });
    await h.setViewportSize({ width: 1440, height: 900 }); await h.locator('#dialog-close').click();
    await h.locator('#new-game').click(); await h.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active);
    assert.ok((await h.locator('.tutorial-toast-copy').textContent()).includes('Move with WASD'));
    assert.deepEqual(await untranslated(h), []);
    await h.screenshot({ path: path.join(output, 'tutorial-en.png') });
    await h.locator('#pause-game').click(); assert.deepEqual(await untranslated(h, '#menu-dialog'), []);
    await h.locator('.pause-settings').click(); assert.deepEqual(await untranslated(h, '#menu-dialog'), []);
    await h.locator('.settings-back').click(); await h.locator('.pause-home').click();
    await h.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active);
    await g.locator('#toggle-join-room').click(); await g.locator('#join-code').fill(await h.locator('#room-code-value').textContent());
    await g.locator('#join-room').click(); await g.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    assert.equal(await g.locator('html').getAttribute('lang'), 'zh-CN');
    const decodeCounts = await Promise.all(pages.map(p => p.evaluate(() => __guideDecodes.length)));
    const requestCount = requests.length, guides = [];
    for (const [level, id] of [['02', 'tools-water'], ['03', 'tools-soap'], ['04', 'tools-charging'], ['05', 'hazard-road-sign']]) {
      await h.locator('#select-level').click(); await h.locator(`[data-level-id="highway-${level}"]`).click();
      await Promise.all(pages.map(p => p.waitForSelector('#level-guide[open]', { timeout: 30000 })));
      const englishAlt = fs.readFileSync(path.resolve(`client/assets/guides/${id}.en.alt.txt`), 'utf8');
      const chineseAlt = fs.readFileSync(path.resolve(`client/assets/guides/${id}.alt.txt`), 'utf8');
      assert.equal(await h.locator('.level-guide-image').getAttribute('alt'), englishAlt);
      assert.equal(await g.locator('.level-guide-image').getAttribute('alt'), chineseAlt);
      assert.ok((await h.locator('.level-guide-image').getAttribute('src')).includes(`${id}.en-`));
      await h.locator('.level-guide-image').evaluate(img => img.decode()); // Explicit QA decode; excluded from no-late-decode count below.
      assert.deepEqual(await untranslated(h, '#level-guide'), []);
      await h.screenshot({ path: path.join(output, `${id}-en.png`) });
      await h.locator('.level-guide-confirm').click(); await g.waitForFunction(() => !!(__wash.game.guide.ready & 1));
      await h.waitForFunction(() => !!(__wash.game.guide.ready & 1));
      const before = await h.evaluate(() => ({ ready: __wash.game.guide.ready, participants: __wash.game.guide.participants, pageIndex: __wash.game.guide.pageIndex }));
      await h.evaluate(() => __wash.ui.setLanguage('zh')); assert.equal(await h.locator('.level-guide-image').getAttribute('alt'), chineseAlt);
      await h.evaluate(() => __wash.ui.setLanguage('en')); assert.equal(await h.locator('.level-guide-image').getAttribute('alt'), englishAlt);
      assert.deepEqual(await h.evaluate(() => ({ ready: __wash.game.guide.ready, participants: __wash.game.guide.participants, pageIndex: __wash.game.guide.pageIndex })), before);
      assert.equal(await g.evaluate(() => __wash.game.roundStage), 'guide');
      await g.locator('.level-guide-confirm').click(); await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active)));
      guides.push({ id, english: true, chinesePeer: true, sharedReady: before });
      if (level !== '05') {
        if (level === '02') await g.evaluate(() => __wash.ui.setLanguage('en'));
        await h.locator('#pause-game').click();
        if (level === '02') {
          await g.waitForSelector('#host-notice[open]');
          assert.deepEqual(await untranslated(g, '#host-notice'), []);
          assert.equal(await g.locator('#host-notice-title').textContent(), 'The host paused the game');
          await g.screenshot({ path: path.join(output, 'host-paused-en.png') });
          await g.evaluate(() => __wash.ui.setLanguage('zh'));
        }
        await h.locator('.pause-home').click();
        await Promise.all(pages.map(p => p.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length)));
      }
    }
    await h.evaluate(() => { const game = __wash.connection.authority.sim.game; game.score = 1000; game.finish('time_up'); });
    await Promise.all(pages.map(p => p.waitForSelector('.result-actions')));
    assert.deepEqual(await untranslated(h, '#menu-dialog'), []);
    assert.ok((await h.locator('#dialog-kicker').textContent()).includes('Watch Your Head!'));
    assert.equal(await h.locator('.result-stars .earned').count(), 3);
    assert.equal(await g.locator('.result-retry').isDisabled(), true);
    await h.screenshot({ path: path.join(output, 'results-en.png') });
    assert.equal(requests.length, requestCount, 'language changes and guide entries do not fetch images');
    assert.deepEqual(await Promise.all(pages.map(p => p.evaluate(() => __guideDecodes.length))), [decodeCounts[0] + 4, decodeCounts[1]], 'only explicit QA decode calls occur after startup');
    assert.deepEqual(errors, []);
    const report = { pass: true, scope: 'same-machine Chrome/WebRTC; authority result fixture', startupDecodes: decodeCounts, guides,
      checks: ['first settings row', 'live focus/values/hints preserved', 'reload persistence', 'literal Chinese nickname', 'English menus/customization/tutorial/results', 'narrow level layout', 'all bilingual assets ready at startup', 'independent locales and shared guide barrier', 'no late resource fetch'], errors };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) { for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {}); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
