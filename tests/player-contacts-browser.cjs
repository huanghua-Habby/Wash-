/** Two real Chrome/WebRTC peers: actual keyboard movement pushes either player off the roof. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const url = new URL(process.env.WASH_TEST_URL || 'http://192.168.1.10:8080/');
url.searchParams.set('wash-test', '1');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  try {
    for (const language of ['zh', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
      page.setDefaultTimeout(30000);
      await page.addInitScript(language => localStorage.setItem('wash-language', language), language);
      page.on('pageerror', error => errors.push(error.message)); pages.push(page);
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      await page.waitForFunction(() => __wash.connection.connected);
    }
    const [host, guest] = pages;
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open && !__wash.ui.iris.active && !__wash.ui.hasModal);
    await host.waitForFunction(() => __wash.connection.authority.sim.players.slice(0, 2).every(p => p.state === 'ground'));
    for (const pusher of [1, 0]) {
      const target = 1 - pusher, page = pages[pusher];
      await Promise.all(pages.map(p => p.evaluate(target => {
        if (window.__contactSnapshotListener) __wash.connection.removeEventListener('snapshot', window.__contactSnapshotListener);
        window.__contactStates = [];
        window.__contactSnapshotListener = event => {
          const state = event.detail.players[target].state;
          if (window.__contactStates.at(-1) !== state) window.__contactStates.push(state);
        };
        __wash.connection.addEventListener('snapshot', window.__contactSnapshotListener);
      }, target)));
      await page.bringToFront();
      const direction = await page.evaluate(() => {
        const forward = __wash.camera.getWorldDirection(__wash.players[0].pos.clone()); forward.y = 0; forward.normalize();
        return Math.abs(forward.z) >= Math.abs(forward.x)
          ? { key: 'KeyW', x: forward.x, z: forward.z }
          : { key: 'KeyD', x: -forward.z, z: forward.x };
      });
      await host.evaluate(({ pusher, target, direction }) => {
        const sim = __wash.connection.authority.sim, truck = sim.trucks[0];
        const at = truck.pos.clone(); at.x -= 2; at.y = truck.topY; at.z += Math.sign(direction.z) * 1.88;
        for (const slot of [target, pusher]) {
          const p = sim.players[slot]; p.pos.copy(at);
          if (slot === pusher) { p.pos.x -= direction.x * 0.79; p.pos.z -= direction.z * 0.79; }
          p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(p.pos.x, p.pos.z, 0.3) };
          p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.root.position.copy(p.pos); p.fallTimer = 0;
        }
      }, { pusher, target, direction });
      await page.waitForTimeout(200); await page.keyboard.down(direction.key);
      await host.waitForFunction(target => {
        const sim = __wash.connection.authority.sim, p = sim.players[target], truck = sim.trucks[0];
        // Push clear of the moving roof, not just into its first airborne frame where sway can catch the player again.
        return p.state === 'air' && Math.abs(p.pos.z - truck.pos.z) > truck.halfWidth + 0.3 + 0.2;
      }, target, { timeout: 5000 });
      await page.keyboard.up(direction.key);
      const contact = await host.evaluate(({ pusher, target }) => {
        const sim = __wash.connection.authority.sim, a = sim.players[pusher], b = sim.players[target];
        return { pusher, target, distance: Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z), pusherState: a.state, targetState: b.state };
      }, { pusher, target });
      assert.ok(contact.distance >= 0.75, 'bodies stay separated while pushing');
      assert.equal(contact.pusherState, 'ground', 'the stationary target is pushed off first');
      // Record delivered snapshots: background tabs may skip the short fallen state between two RAF polls.
      await Promise.all(pages.map(p => p.waitForFunction(() => window.__contactStates.includes('fallen'), null, { timeout: 10000, polling: 100 })));
      console.log('Authoritative body push:', contact, 'both peers received fallen');
      if (pusher === 1) await guest.screenshot({ path: '/tmp/wash-player-contacts.png' });
      await host.waitForFunction(target => __wash.connection.authority.sim.players[target].state === 'ground', target, { timeout: 10000 });
    }
    assert.deepEqual(errors, []);
    console.log('PASS real host/guest keyboard body collision, separation, push over edge, shared fall and authority respawn');
  } catch (error) {
    for (const page of pages) console.log('Collision failure state:', await page.evaluate(() => ({
      observed: window.__contactStates, players: __wash.network.latest.players.map(p => ({ pos: p.pos, state: p.state })),
    })).catch(() => null));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
