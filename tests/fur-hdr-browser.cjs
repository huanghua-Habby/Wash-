const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');
url.searchParams.set('wash-test', '1');

// Read the resolved HDR framebuffer, before Bloom can spread a single invalid edge pixel.
async function inspect(page) {
  return page.evaluate(() => {
    const { renderer, camera, post, players } = __wash;
    const data = new Float32Array(post.rt.width * post.rt.height * 4);
    // r160's helper requests HALF_FLOAT, while this readback needs FLOAT values.
    // Bind the resolved attachment through Three's state cache and restore it.
    const gl = renderer.getContext(), previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    let readError;
    renderer.state.bindFramebuffer(gl.FRAMEBUFFER, renderer.properties.get(post.rt).__webglFramebuffer);
    try {
      gl.readPixels(0, 0, post.rt.width, post.rt.height, gl.RGBA, gl.FLOAT, data);
      readError = gl.getError();
    } finally { renderer.state.bindFramebuffer(gl.FRAMEBUFFER, previous); }
    if (readError !== gl.NO_ERROR) throw new Error(`HDR readPixels failed: ${readError}`);
    return players.filter(player => player.root.visible).map(player => {
      const center = player.root.position.clone(); center.y += 0.5; center.project(camera);
      const x = Math.round((center.x + 1) * post.rt.width / 2);
      const y = Math.round((center.y + 1) * post.rt.height / 2);
      let invalid = 0, max = 0, pixels = 0;
      for (let yy = Math.max(0, y - 48); yy < Math.min(post.rt.height, y + 48); yy++) {
        for (let xx = Math.max(0, x - 48); xx < Math.min(post.rt.width, x + 48); xx++) {
          const offset = (yy * post.rt.width + xx) * 4; pixels++;
          for (let channel = 0; channel < 3; channel++) {
            const value = data[offset + channel];
            if (!Number.isFinite(value)) invalid++;
            else max = Math.max(max, value);
          }
        }
      }
      return { slot: player.slot, invalid, max, pixels };
    });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const pages = [], errors = [];
  try {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: i === 1 ? 2 : 1 });
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready');
    }
    const code = await pages[0].locator('#room-code-value').textContent();
    for (const guest of pages.slice(1)) {
      if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
      await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
      await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    }
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.connection.room.members.length === 3)));
    const report = [];
    for (const page of pages) {
      await page.evaluate(() => { __wash.renderConfig.autoRes = false; });
      for (const samples of [0, 2, 4]) {
        await page.evaluate(samples => { __wash.renderConfig.msaa = samples; __wash.post.setSize(); }, samples);
        for (const breed of ['ginger', 'grey', 'cream', 'tuxedo']) {
          for (const wet of [0, 1]) {
            await page.evaluate(({ breed, wet }) => {
              __wash.players.forEach(player => {
                player.cat.setAppearance(breed, player.identityColor);
                for (const mesh of [player.cat.meshes.base, player.cat.meshes.shells]) {
                  mesh.onBeforeRender = () => { player.cat.furBase.userData.fur.furWet.value = wet; };
                }
              });
            }, { breed, wet });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const regions = await inspect(page);
            assert.equal(regions.length, 3);
            for (const region of regions) {
              assert.ok(region.pixels > 0 && region.max > 0, 'the HDR read must contain actual rendered pixels');
              assert.equal(region.invalid, 0, `MSAA ${samples}, ${breed}, wet ${wet}, slot ${region.slot}: no NaN/Infinity before Bloom`);
              assert.ok(region.max < 16, `unexpected HDR spike: ${JSON.stringify(region)}`);
            }
            report.push({ samples, breed, wet, regions });
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS fur HDR: ${report.length} cases across three connected pages, DPR 1/2, MSAA 0/2/4, four coats, dry/wet; all cat pixels finite`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
