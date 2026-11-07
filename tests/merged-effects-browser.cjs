/** Actual renderer submission budgets for event pools; synthetic emissions do not assert gameplay outcomes. */
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'chrome' });
 const output = 'docs/QA/merge-2026-10-15'; fs.mkdirSync(output, { recursive: true });
 try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 810 } }), errors = [];
  p.on('pageerror', e => errors.push(e.message)); await p.goto(url.href); await p.waitForSelector('body.scene-ready', { timeout: 90000 });
  await p.evaluate(() => {
   window.__fxDraws = [];
   const renderer = __wash.renderer, draw = renderer.renderBufferDirect;
   const meshes = new Map(['chargerBlast', 'roadSign', 'itemPoof'].map(key => [__wash.game.effects.entries.get(key).system.mesh, key]));
   renderer.renderBufferDirect = function(...args) {
    const before = { ...this.info.render }, result = draw.apply(this, args), name = meshes.get(args[4]);
    if (name) __fxDraws.push({ frame: this.info.render.frame, name, pass: args[3] === args[4].material ? 'color' : args[3].type,
      draws: this.info.render.calls - before.calls, triangles: this.info.render.triangles - before.triangles, instances: args[4].geometry.instanceCount });
    return result;
   };
  });
  const sample = async label => {
   await p.evaluate(() => __fxDraws = []); await p.waitForTimeout(200);
   const draws = await p.evaluate(() => __fxDraws);
   return { label, draws, maximumInstances: Object.fromEntries(['chargerBlast','roadSign','itemPoof'].map(name=>[name,Math.max(0,...draws.filter(d=>d.name===name).map(d=>d.instances))])) };
  };
  const idle = await sample('idle'); assert.equal(idle.draws.length, 0);
  await p.evaluate(() => {
   const game = __wash.game, at = game.players[0].root.position;
   const blast = game.effects.entries.get('chargerBlast').system, sign = game.effects.entries.get('roadSign').system, poof = game.effects.entries.get('itemPoof').system;
   for (let i=0;i<2;i++) blast.burst(at);
   for (let i=0;i<4;i++) { sign.burst(at,'blue'); poof.burst(at); poof.burst(at); }
  });
  const peak = await sample('two overlapping blasts / four sign hits / four double poofs');
  assert.deepEqual(peak.maximumInstances,{chargerBlast:124,roadSign:104,itemPoof:80});
  assert.ok(peak.draws.every(d=>d.triangles===d.instances*80 && d.draws===1));
  await p.screenshot({ path: `${output}/effects-peak.png` });
  await p.waitForTimeout(2200); const tail = await sample('expired tail'); assert.equal(tail.draws.length,0);
  assert.deepEqual(errors,[]); const result = {scope:'same-machine Chrome, actual renderBufferDirect submissions; synthetic bounded burst peak', samples:[idle,peak,tail],errors};
  fs.writeFileSync(`${output}/effects-metrics.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.samples.map(({label,maximumInstances,draws})=>({label,maximumInstances,passes:[...new Set(draws.map(d=>d.pass))]}))));
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
