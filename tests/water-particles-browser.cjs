/** Same-machine Chrome/WebRTC: idle, water gun and four simultaneous elephant jets, real draw submissions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const { installGuideReader } = require('./helpers/guide-browser.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
const output = process.env.WASH_WATER_OUTPUT || 'docs/QA/water-mesh-2026-10-15';
fs.mkdirSync(output, { recursive: true });

async function capture(page, mode) {
  await page.evaluate(() => { __waterAudit.samples.length = 0; __waterAudit.capture = true; });
  await page.waitForFunction(() => __waterAudit.samples.length >= 12);
  return page.evaluate(mode => {
    __waterAudit.capture = false;
    const samples = __waterAudit.samples;
    return { mode, frames: samples.length,
      minTriangles: Math.min(...samples.map(s => s.triangles)), maxTriangles: Math.max(...samples.map(s => s.triangles)),
      minInstances: Math.min(...samples.map(s => s.instances)), maxInstances: Math.max(...samples.map(s => s.instances)),
      maxLive: Math.max(...samples.map(s => s.live)), maxCalls: Math.max(...samples.map(s => s.calls)),
      maxFrameTriangles: Math.max(...samples.map(s => s.frameTriangles)),
      sources: samples.at(-1).sources };
  }, mode);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.WASH_BROWSER_CHANNEL || 'chrome' });
  await installGuideReader(browser);
  const pages = [], errors = [], report = [];
  try {
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__waterShaderCompiles = 0;
        for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
          const compile = prototype.compileShader;
          prototype.compileShader = function (...args) { __waterShaderCompiles++; return compile.apply(this, args); };
        }
      });
    }
    await Promise.all(pages.map(async page => { await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 }); }));
    const host = pages[0], code = await host.locator('#room-code-value').textContent();
    for (const guest of pages.slice(1)) {
      if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
      await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
      await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    }
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.connection.room.members.length === 4)));
    for (const [i, page] of pages.entries()) {
      await page.locator('#customize-player').click();
      await page.locator('.animal-choice[data-animal="elephant"]').click();
      await page.locator(`.breed-choice[data-animal="elephant"][data-breed="${['grey', 'pink', 'snow', 'sky'][i]}"]`).click();
      await page.locator('.customize-confirm').click(); await page.waitForSelector('#customize-dialog', { state: 'hidden' });
    }
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.players.every(p => p.animal === 'elephant'))));
    const compiles = await Promise.all(pages.map(page => page.evaluate(() => __waterShaderCompiles)));
    await Promise.all(pages.map(page => page.evaluate(() => {
      const { renderer: r, post } = __wash, water = __wash.game.effects.entries.get('water').system;
      const sprays = [...water.views, ...water.trunkViews].map(v => v.spray), owners = new Map();
      for (const [source, spray] of sprays.entries()) for (const key of ['stream', 'splash', 'fill']) owners.set(spray[key].mesh, source);
      window.__waterAudit = { samples: [], capture: false, sprays,
        geometries: sprays.flatMap(spray => ['stream', 'splash', 'fill'].map(key => spray[key].mesh.geometry)) };
      const render = post.render;
      post.render = function (...args) {
        if (!__waterAudit.capture) return render.apply(this, args);
        const direct = r.renderBufferDirect, sources = sprays.map(() => 0);
        let triangles = 0, calls = 0;
        r.renderBufferDirect = function (...draw) {
          const before = r.info.render.triangles, beforeCalls = r.info.render.calls;
          const result = direct.apply(this, draw), source = owners.get(draw[4]);
          if (source !== undefined) { const delta = r.info.render.triangles - before; triangles += delta; sources[source] += delta; calls += r.info.render.calls - beforeCalls; }
          return result;
        };
        try { return render.apply(this, args); }
        finally {
          r.renderBufferDirect = direct;
          let live = 0;
          for (const spray of sprays) for (const key of ['stream', 'splash', 'fill']) {
            const a = spray[key].attributes.aLife;
            for (let i = 0; i < spray[key].mesh.geometry.instanceCount; i++) { const age = spray.time.value - a.getX(i); if (a.getZ(i) > 0 && age >= 0 && age < a.getY(i)) live++; }
          }
          __waterAudit.samples.push({ triangles, instances: triangles / 274, calls, sources, live, frameTriangles: r.info.render.triangles });
        }
      };
    })));
    report.push(await capture(host, 'idle-four-elephants'));
    assert.equal(report.at(-1).maxTriangles, 0, 'idle water submits no triangles');

    // Authority fixture places the gun in the host's hand; ordinary J input starts the actual shared spray.
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, truck = sim.trucks[0];
      sim.players.forEach((p, i) => {
        p.pos.set(truck.pos.x - 1.6, truck.topY, truck.pos.z + [-1.05, -.35, .35, 1.05][i]);
        p.root.position.copy(p.pos); p.state = 'ground'; p.yaw = 0;
        p.ground = { truck, plat: truck.platformAt(p.pos.x, p.pos.z, .3) };
        p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0);
      });
      sim.game.waterguns[0].pickup(sim.players[0]);
    });
    await host.keyboard.down('KeyJ');
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.waterguns[0].spraying && __wash.game.effects.entries.get('water').system.views[0].spray.serial > 30)));
    report.push(await capture(host, 'single-water-gun'));
    assert.ok(report.at(-1).minTriangles > 0); assert.ok(report.at(-1).maxTriangles < 20000);
    await host.screenshot({ path: path.join(output, 'single-gun.png') });
    await host.keyboard.up('KeyJ');
    await host.waitForTimeout(1100);

    // Four real member slots hold L on their own pages, with authority recoil/tanks mirrored to every peer.
    await Promise.all(pages.map(page => page.keyboard.down('KeyL')));
    await host.waitForFunction(() => __wash.connection.authority.sim.players.every(p => p.trunk.spraying));
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.trunks.every(t => t.spraying && t.water < .9))));
    report.push(await capture(host, 'four-elephants'));
    report.push(await capture(pages[1], 'four-elephants-peer'));
    for (const item of report.slice(-2)) {
      assert.ok(item.minTriangles > 0); assert.ok(item.maxTriangles < 80000, 'four jet meshes stay below the old single-pool allocation');
      assert.equal(item.sources[0], 0, 'the idle water gun contributes no particles');
      assert.ok(item.sources.slice(1).every(n => n > 0), 'each elephant actually renders');
    }
    await host.screenshot({ path: path.join(output, 'four-elephants-host.png') });
    await pages[1].screenshot({ path: path.join(output, 'four-elephants-peer.png') });
    await Promise.all(pages.map(page => page.keyboard.up('KeyL')));
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.trunks.every(t => !t.spraying))));
    await host.waitForTimeout(1100);
    for (const page of pages) {
      const item = await capture(page, 'drained'); report.push(item);
      assert.equal(item.maxTriangles, 0, 'every peer drains all jet tails back to zero draws');
    }
    await host.locator('#new-game').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && __wash.ui.page === 'game' && !__wash.ui.iris.active)));
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, p = sim.players[0];
      if (p.heldTool) p.heldTool.release(p);
      sim.game.waterguns[0].pickup(p);
    });
    await host.keyboard.down('KeyJ');
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.effects.entries.get('water').system.views[0].spray.stream.count > 0)));
    await host.locator('#pause-game').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.paused)));
    const clocks = await Promise.all(pages.map(page => page.evaluate(() => __waterAudit.sprays.map(s => s.time.value))));
    await host.waitForTimeout(200);
    for (const [i, page] of pages.entries()) assert.deepEqual(await page.evaluate(() => __waterAudit.sprays.map(s => s.time.value)), clocks[i], 'pause freezes pending arrivals and visible tails on every peer');
    await host.keyboard.up('KeyJ');
    await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active)));
    for (const page of pages) {
      assert.equal(await page.evaluate(() => __waterAudit.sprays.every(s => s.pendingImpacts.length === 0 && ['stream', 'splash', 'fill'].every(k => s[k].mesh.geometry.instanceCount === 0))), true, 'scene reset cancels pending hits and clears draw counts');
      assert.equal(await page.evaluate(() => __waterAudit.sprays.flatMap(s => ['stream', 'splash', 'fill'].map(k => s[k].mesh.geometry)).every((g, i) => g === __waterAudit.geometries[i])), true, 'all warmed particle geometry survives scene transitions');
    }
    assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => __waterShaderCompiles))), compiles, 'first spray and all later modes use warmed shaders');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify({ report, errors }, null, 2));
    console.log(JSON.stringify({ report }, null, 2));
    console.log('PASS same-machine host + three WebRTC peers: water-gun use, four elephant jets, real per-source submissions, tail drain, pause/reset, pool reuse and zero late shader compilation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
