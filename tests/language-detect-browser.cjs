/** Browser language decides first, a saved manual choice wins, and the settings toggle still switches and persists. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), errors = [];
  const open = async (locale, saved) => {
    const context = await browser.newContext({ locale, viewport: { width: 1440, height: 810 } }), page = await context.newPage();
    if (saved) await page.addInitScript(saved => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('wash-language', saved); sessionStorage.setItem('seeded', '1'); } }, saved);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
    return page;
  };
  const state = page => page.evaluate(() => ({ locale: __wash.ui.localization.locale, lang: document.documentElement.lang,
    saved: localStorage.getItem('wash-language'), settings: document.querySelector('#settings').textContent.trim() }));
  try {
    const english = await open('en-US');
    assert.deepEqual(await state(english), { locale: 'en', lang: 'en', saved: null, settings: '04Settings' }, 'English browser, no preference');
    const chinese = await open('zh-TW');
    assert.deepEqual(await state(chinese), { locale: 'zh', lang: 'zh-CN', saved: null, settings: '04设置' }, 'any Chinese variant reads Chinese');
    const other = await open('ja-JP');
    assert.equal((await state(other)).locale, 'en', 'unsupported languages read English');
    const preferred = await open('en-US', 'zh');
    assert.equal((await state(preferred)).locale, 'zh', 'saved manual choice beats the browser language');

    // Manual toggle in Settings switches in place and survives reload over the detected language.
    await english.locator('#settings').click();
    await english.locator('button[data-language="zh"]').click();
    assert.equal(await english.locator('button[data-language="zh"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual((({ locale, saved }) => ({ locale, saved }))(await state(english)), { locale: 'zh', saved: 'zh' });
    await english.reload(); await english.waitForSelector('body.scene-ready', { timeout: 60000 });
    assert.equal((await state(english)).locale, 'zh');
    await english.locator('#settings').click(); await english.locator('button[data-language="en"]').click();
    await english.reload(); await english.waitForSelector('body.scene-ready', { timeout: 60000 });
    assert.deepEqual((({ locale, saved }) => ({ locale, saved }))(await state(english)), { locale: 'en', saved: 'en' });
    assert.deepEqual(errors, []);
    console.log('language detection browser ok');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
