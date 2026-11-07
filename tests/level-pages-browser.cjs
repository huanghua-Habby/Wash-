/** Visual UI regression in real Chrome/WebRTC. Saved records and score completion are isolated test fixtures. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:18081/'); url.searchParams.set('wash-test', '1');
const output = path.resolve('docs/QA/level-pages');
(async () => {
  const { SAVE_VERSION } = await import('../shared/levels.js');
  const stats = (stars, score, players=2) => ({ finishedRuns: 1, bestScore: score, bestScorePlayers:players, bestCompletedOrders: 4, bestStars: stars, tutorialCompleted: false });
  const progress = { version: SAVE_VERSION, lastLevelId: 'highway-02', updatedAt: Date.now(), resultIds: [], levels: {
    'highway-01': { ...stats(0, 25), tutorialCompleted: true }, 'highway-02': stats(3, 160,4), 'highway-03': stats(2, 80,3),
  } };
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  try {
    for (let i = 0; i < 2; i++) {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' }); pages.push(p);
      p.on('pageerror', e => errors.push(e.message));
      await p.addInitScript(data => { localStorage.setItem('wash-progress', JSON.stringify(data)); }, progress);
      await p.goto(url.href); await p.waitForSelector('body.scene-ready', { timeout: 60000 });
    }
    const [host, guest] = pages;
    await host.locator('#select-level').click();
    assert.equal(await host.locator('.level-card').count(), 5);
    assert.equal(await host.locator('.level-description, .level-duration').count(), 0);
    assert.equal(await host.locator('.level-tutorial-status').textContent(), '教程完成！');
    assert.equal(await host.locator('[data-level-id="highway-01"]').getAttribute('data-status'), 'mastered');
    assert.equal(await host.locator('[data-level-id="highway-01"] .level-ribbon').textContent(), '已完成');
    assert.equal(await host.locator('[data-level-id="highway-02"]').getAttribute('data-status'), 'mastered');
    assert.equal(await host.locator('[data-level-id="highway-03"] .earned').count(), 2);
    assert.equal(await host.locator('[data-level-id="highway-03"] .level-record b').textContent(), '80');
    assert.equal(await host.locator('[data-level-id="highway-03"] .level-record-players').textContent(), '3人');
    assert.equal(await host.locator('[data-level-id="highway-02"] .level-record-players').textContent(), '4人');
    assert.equal(await host.locator('[data-level-id="highway-04"] .level-record-players').count(),0);
    assert.ok(await host.locator('.level-record-players').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize)<parseFloat(getComputedStyle(n.parentElement.querySelector('b')).fontSize)));
    assert.equal(await host.locator('[data-level-id="highway-04"] .earned').count(), 0);
    assert.equal(await host.locator('.level-card:disabled').count(), 0, 'all five levels remain available');
    assert.equal(await host.locator('.level-grid').textContent().then(text => text.includes('↗')), false);
    await host.waitForTimeout(350); await host.screenshot({ path: path.join(output, 'level-selection.png') });
    const shape = await host.locator('.level-stars .star-gold .star-face').first().getAttribute('d');
    await host.setViewportSize({ width: 600, height: 900 });
    assert.ok(await host.locator('#menu-dialog').evaluate(n => n.scrollWidth <= n.clientWidth));
    await host.screenshot({ path: path.join(output, 'level-selection-narrow.png') });
    await host.setViewportSize({ width: 1440, height: 900 }); await host.locator('#dialog-close').click();
    await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());
    await guest.locator('#join-room').click(); await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    // A role-disabled view is a UI fixture, not a newly added progression lock.
    await guest.evaluate(() => __wash.ui.menu.openLevels());
    assert.equal(await guest.locator('.level-card.unavailable:disabled').count(), 5);
    await guest.screenshot({ path: path.join(output, 'level-selection-unavailable.png') }); await guest.locator('#dialog-close').click();
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await Promise.all(pages.map(p => p.waitForSelector('#level-guide[open]')));
    await Promise.all(pages.map(p => p.locator('.level-guide-confirm').click()));
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active)));
    for(const [score,stars] of [[0,0],[24,0],[25,1],[54,1],[55,2],[129,2],[130,3],[160,3]]) {
      await host.evaluate(score=>{__wash.connection.authority.sim.game.score=score;__wash.connection.authority.publish();},score);
      for(const p of pages){await p.waitForFunction(({score,stars})=>__wash.game.score===score&&!document.querySelector('.score-rating').hidden&&Number(document.querySelector('.score-rating-track').getAttribute('aria-valuenow'))===Math.min(130,score)&&document.querySelectorAll('.score-rating .earned').length===stars,{score,stars});assert.equal(await p.locator('.score-rating').textContent(),'');assert.ok(Math.abs(parseFloat(await p.locator('.score-rating-track i').evaluate(n=>n.style.width))-Math.min(1,score/130)*100)<.01);}
      if(score===55)await host.locator('#score-panel').screenshot({path:path.join(output,'score-star-progress.png')});
    }
    assert.equal(await host.locator('.score-rating .star-gold .star-face').first().getAttribute('d'),shape);
    await host.evaluate(() => {
      window.__awards = []; const play = __wash.ui.playResultStar.bind(__wash.ui);
      __wash.ui.playResultStar = index => { __awards.push({ index, time: performance.now() }); play(index); };
      const game = __wash.connection.authority.sim.game; game.score = 150; game.finish('time_up');
    });
    await host.waitForFunction(() => __wash.ui.menu.resultReveal?.lit === 1);
    assert.equal(await host.locator('.result-stars .earned:not(.waiting)').count(), 1);
    await host.screenshot({ path: path.join(output, 'result-first-star.png') });
    await host.waitForFunction(() => __wash.ui.menu.resultReveal?.finished);
    assert.equal(await host.locator('.result-score b').textContent(), '150');
    assert.equal(await host.locator('.result-stars .earned:not(.waiting)').count(), 3);
    assert.equal(await host.locator('.result-stars .star-gold .star-face').first().getAttribute('d'), shape);
    const awards = await host.evaluate(() => __awards);
    assert.deepEqual(awards.map(a => a.index), [0, 1, 2]);
    assert.ok(awards[1].time - awards[0].time >= 300 && awards[2].time - awards[1].time >= 300);
    await host.screenshot({ path: path.join(output, 'result-three-stars.png') });
    assert.equal(await guest.locator('.result-next').isDisabled(), true);
    assert.equal(await guest.locator('.result-retry').isDisabled(), true);
    assert.equal(await guest.locator('.result-home').isEnabled(), true);
    await host.evaluate(() => __wash.connection.authority.publish()); await host.waitForTimeout(500);
    assert.equal(await host.evaluate(() => __awards.length), 3, 'snapshots cannot replay the reveal');
    assert.equal(await host.locator('#dialog-close').isVisible(), false);
    await host.keyboard.press('Space'); await host.keyboard.press('Escape');
    assert.equal(await host.locator('#menu-dialog').evaluate(n => n.open), true, 'results stay open until an action is chosen');
    await host.evaluate(() => __wash.ui.setMotionEnabled(false));
    assert.equal(await host.locator('.result-stars .waiting').count(), 0);
    await host.emulateMedia({ reducedMotion: 'reduce' });
    await host.evaluate(() => __wash.ui.setMotionEnabled(true));
    assert.equal(await host.locator('.result-stars .earned').count(), 3);
    await host.screenshot({ path: path.join(output, 'result-reduced-motion.png') });
    assert.deepEqual(errors, []);
    const report = { pass: true, scope: 'same-machine Chrome/WebRTC; isolated save and score fixtures', awards,
      checks: ['five playable cards', 'shared SVG stars', 'no level spoilers or arrows', 'grey/blue/gold ribbons', 'tutorial completion gold card', 'highest scores', 'sequential authority stars', 'no snapshot replay', 'host/guest actions', 'result dismissal guard', 'quiet/reduced motion', 'narrow layout'], errors };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) { for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {}); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
