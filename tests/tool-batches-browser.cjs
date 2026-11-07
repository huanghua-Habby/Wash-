/** Local isolated renderer: raw vs batched tool geometry/materials/shadows, then per-scene ring batching. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
(async () => {
  const { createServer } = await import('vite');
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'docs/QA/tool-batches');
  fs.mkdirSync(output, { recursive: true });
  const server = await createServer({ configFile: false, root: path.join(root, 'client'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } });
  await server.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /WebGL|Shader Error|VALIDATE_STATUS/.test(m.text())) errors.push(m.text()); });
    const origin = server.resolvedUrls.local[0];
    await page.route('**/__tool-batch-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="view"></canvas>' }));
    await page.goto(new URL('__tool-batch-qa', origin).href);
    const report = await page.evaluate(async root => {
      const T = await import(`/@fs/${root}/node_modules/three/build/three.module.js`);
      const models = await import(`/@fs/${root}/shared/sim/ToolModels.js`);
      const { batchTool } = await import('/js/render/ToolBatches.js');
      const renderer = new T.WebGLRenderer({ canvas: document.getElementById('view'), antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(480, 480); renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      const scene = new T.Scene(); scene.background = new T.Color('#dce4d8');
      scene.add(new T.HemisphereLight('#fff9e9', '#818f86', 2));
      const light = new T.DirectionalLight('#fff3dc', 2.4); light.position.set(2, 4, 3); light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = light.shadow.camera.bottom = -2; light.shadow.camera.right = light.shadow.camera.top = 2;
      light.shadow.camera.near = .1; light.shadow.camera.far = 12; scene.add(light);
      const floor = new T.Mesh(new T.PlaneGeometry(5, 5), new T.MeshLambertMaterial({ color: '#efe5c9' }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.32; floor.receiveShadow = true; scene.add(floor);
      const camera = new T.PerspectiveCamera(30, 1, .1, 20); camera.position.set(2.8, 2.3, 3.1); camera.lookAt(0, .35, 0);
      const target = new T.WebGLRenderTarget(480, 480), before = new Uint8Array(480 * 480 * 4), after = new Uint8Array(before.length);
      const read = data => { renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 480, 480, data); renderer.setRenderTarget(null); renderer.render(scene, camera); return document.getElementById('view').toDataURL('image/png').split(',')[1]; };
      const rows = [];
      for (const name of ['buildWashStation', 'buildSoapBox', 'buildSupplyPoint', 'buildChargingPost', 'buildChargingGun', 'buildChargePort']) {
        const model = models[name](); scene.add(model);
        const imageBefore = read(before); batchTool(model); const imageAfter = read(after);
        let changed = 0, maximum = 0, total = 0;
        for (let i = 0; i < before.length; i += 4) {
          let delta = 0;
          for (let c = 0; c < 3; c++) { const d = Math.abs(before[i + c] - after[i + c]); delta = Math.max(delta, d); maximum = Math.max(maximum, d); total += d; }
          if (delta > 1) changed++;
        }
        const calls = { main: 0, shadow: 0, mask: 0 };
        model.traverse(n => { if (n.isMesh) { if (n.layers.isEnabled(0)) calls.main++; if (n.castShadow) calls.shadow++; if (n.layers.isEnabled(1)) calls.mask++; } });
        rows.push({ name, changedPixels: changed, changedRatio: changed / (480 * 480), maxChannelDifference: maximum, meanChannelDifference: total / (480 * 480 * 3), calls, imageBefore, imageAfter });
        model.removeFromParent();
      }
      renderer.dispose(); target.dispose(); return rows;
    }, root);
    for (const row of report) {
      fs.writeFileSync(path.join(output, `${row.name}-before.png`), Buffer.from(row.imageBefore, 'base64'));
      fs.writeFileSync(path.join(output, `${row.name}-after.png`), Buffer.from(row.imageAfter, 'base64'));
      delete row.imageBefore; delete row.imageAfter;
      assert.ok(row.changedRatio < .015, `${row.name}: material/silhouette/shadow image differs: ${JSON.stringify(row)}`);
      assert.ok(row.calls.main + row.calls.shadow + row.calls.mask <= 9);
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'visual-metrics.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('PASS raw vs batched tool frames retain colors, material response, silhouettes and shadows within image tolerance; all models use single-digit total draws');
  } finally { await browser.close(); await server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
