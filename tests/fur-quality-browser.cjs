const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const width = Number(process.env.WASH_WIDTH || 1280), height = Number(process.env.WASH_HEIGHT || 720);
const dpr = Number(process.env.WASH_DPR || 1);
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');
url.searchParams.set('wash-test', '1');
url.searchParams.set('fx', `fur.auto:false,render.autoRes:false,render.scale:1,render.maxPixelRatio:${dpr}`);
const layers = [12, 8, 4];
const renderWindows = Number(process.env.WASH_RENDER_WINDOWS || 4);
assert.ok([2, 4].includes(renderWindows), 'WASH_RENDER_WINDOWS must be 2 or 4');
const setLayers = (page, count) => page.evaluate(count => {
  __wash.runtime.debug.gui.controllersRecursive().find(c => c.property === 'shells').setValue(count);
}, count);
(async () => {
  const browsers = [], pages = [], errors = [], report = [];
  try {
    // Four independent Chrome processes: each actually renders four connected characters.
    for (let i = 0; i < 4; i++) {
      const browser = await chromium.launch({ channel: 'chrome', headless: process.env.WASH_HEADED !== '1', args: [
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      ] });
      browsers.push(browser);
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
      page.on('pageerror', error => errors.push(error.message)); pages.push(page);
      await page.addInitScript(() => {
        window.__furCompiles = 0;
        const compile = WebGL2RenderingContext.prototype.compileShader;
        WebGL2RenderingContext.prototype.compileShader = function(...args) { window.__furCompiles++; return compile.apply(this, args); };
      });
      await page.goto(url.href); await page.waitForSelector('body.scene-ready');
      console.log(`Browser ${i + 1} ready`);
    }
    const code = await pages[0].locator('#room-code-value').textContent();
    for (const guest of pages.slice(1)) {
      if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
      await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
      await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
      console.log('Guest connected');
    }
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.players.filter(p => p.root.visible).length === 4)));
    // Keep the roster and direct links of helper peers, but cancel their only application frame loop.
    // The 8-animal fixture retains extra helper contexts/memory; it is not an exact two-browser hardware acceptance test.
    for (const helper of pages.slice(renderWindows)) await helper.evaluate(() => __wash.app.cancelFrame(__wash.app.frameId));
    const renderedPages = pages.slice(0, renderWindows);
    const baseline = await Promise.all(renderedPages.map(page => page.evaluate(() => ({ compiles: __furCompiles, memory: { ...__wash.renderer.info.memory } }))));
    for (const count of layers) {
      await Promise.all(renderedPages.map(page => setLayers(page, count)));
      await Promise.all(renderedPages.map(page => page.waitForFunction(count => __wash.players.filter(p => p.root.visible).every(p =>
        p.body.meshes.shells.geometry.instanceCount === count && p.body.meshes.shells.visible === (count > 0)), count)));
      await Promise.all(renderedPages.map(page => page.waitForTimeout(1000)));
      await Promise.all(renderedPages.map(page => page.evaluate(() => __perf.reset())));
      await Promise.all(renderedPages.map(page => page.waitForTimeout(Number(process.env.WASH_SAMPLE_MS || 6000))));
      const results = await Promise.all(renderedPages.map(page => page.evaluate(() => {
        __perf.compute();
        const gl = __wash.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { stats: { ...__perf.stats }, samples: __perf.n, compiles: __furCompiles,
          memory: { ...__wash.renderer.info.memory }, visible: __wash.players.filter(p => p.root.visible).length,
          size: [gl.drawingBufferWidth, gl.drawingBufferHeight], hidden: document.hidden,
          gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
      })));
      results.forEach((result, i) => {
        assert.equal(result.visible, 4); assert.equal(result.hidden, false);
        assert.deepEqual(result.size, [Math.floor(width * dpr), Math.floor(height * dpr)]);
        assert.equal(result.compiles, baseline[i].compiles, 'layer switches must not compile shaders');
        assert.deepEqual(result.memory, baseline[i].memory, 'layer switches must reuse geometry and textures');
      });
      report.push({ layers: count, results }); console.log(count, results.map(r => ({ fps: r.stats.fps, low1: r.stats.low1, gpuMs: r.stats.gpuMs, tris: r.stats.tris })));
    }
    const host = pages[0];
    const adaptive = await host.evaluate(() => {
      const q = __wash.runtime.render.furQuality;
      const controller = __wash.runtime.debug.gui.controllersRecursive().find(c => c.property === 'shells');
      const options = [...controller.domElement.querySelectorAll('option')].map(option => option.textContent);
      q.config.shells = 12; q.config.auto = true;
      let id = 0;
      const run = (seconds, fps, gpuMs) => {
        for (let i = 0; i < seconds * fps; i++) q.update(1/fps, { cpuMs: 2, gpuMs, gpuId: id++, fullResolution: true });
        return q.status.shells;
      };
      // Deterministic policy checks in a real browser; these are simulated timings, not performance measurements.
      const stages = [run(7, 30, null), run(6, 30, null), run(26, 60, 2), run(26, 60, 2)];
      return { options, stages };
    });
    assert.deepEqual(adaptive.stages, [8, 4, 8, 12]);
    assert.equal(adaptive.options.length, 3); assert.ok(adaptive.options.every(label => !/16|20|关闭/.test(label)));
    await host.evaluate(() => { __wash.runtime.render.furQuality.config.auto = false; });
    await setLayers(host, 8); await host.keyboard.press('Backquote');
    await host.screenshot({ path: 'docs/QA/fur-quality-debug.png' });
    await host.keyboard.press('Backquote');
    await host.locator('#customize-player').click(); await host.waitForSelector('#customize-dialog[open]');
    fs.mkdirSync('/tmp/wash-fur-preview', { recursive: true });
    // Render the real Customize model at one frozen pose, camera and lighting for every layer count.
    for (const animal of ['cat', 'dog', 'pelican', 'elephant']) {
      await host.locator(`.animal-choice[data-animal="${animal}"]`).click();
      for (const count of [...layers].reverse()) {
        await setLayers(host, count);
        const png = await host.evaluate(() => {
          const c = __wash.customize, p = c.preview;
          p.updateVisual = () => {};
          c.renderer.setPixelRatio(2); c.renderer.setSize(360, 360, false);
          p.body.setFurShells(__wash.runtime.debug.gui.controllersRecursive().find(c => c.property === 'shells').getValue());
          c.renderer.render(c.scene, c.camera);
          return c.renderer.domElement.toDataURL('image/png').split(',')[1];
        });
        fs.writeFileSync(`/tmp/wash-fur-preview/${animal}-${count}.png`, Buffer.from(png, 'base64'));
      }
    }
    await host.locator('.customize-cancel').click();
    await setLayers(host, 8); await host.waitForTimeout(400); await host.reload(); await host.waitForSelector('body.scene-ready');
    assert.equal(await host.evaluate(() => __wash.players[0].body.meshes.shells.geometry.instanceCount), 8, 'quality persists after reload');
    const compiles = await host.evaluate(() => __furCompiles);
    await setLayers(host, 12);
    await host.waitForFunction(() => __wash.players[0].body.meshes.shells.geometry.instanceCount === 12);
    assert.equal(await host.evaluate(() => __furCompiles), compiles, 'restoring full release quality reuses the prewarmed fur shader');
    assert.deepEqual(errors, []);
    const filename = renderWindows === 4 ? 'fur-release-quality-2026-10-15.json' : 'fur-release-quality-8-2026-10-15.json';
    fs.writeFileSync(`docs/QA/${filename}`, JSON.stringify({ scenario: `${renderWindows} rendering Chrome processes, four connected cats per page (${renderWindows * 4} drawn animals), home practice idle; ${4-renderWindows} helper peers retain connections and contexts with their application frame loops cancelled; fixed ${width}x${height} DPR${dpr}; NOT a target-device, sustained active-game or cross-device acceptance test`, report }, null, 2));
    console.log(`PASS release fur quality: ${renderWindows} rendering browsers / ${renderWindows * 4} animals, 12/8/4 only, adaptive descent/recovery, fixed resolution, no new GPU resources or shader compilation, persisted setting`);
  } finally { await Promise.all(browsers.map(browser => browser.close())); }
})().catch(error => { console.error(error); process.exitCode = 1; });
