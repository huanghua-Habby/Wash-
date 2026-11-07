import { installGuideReader } from './helpers/guide-browser.cjs';
/** Real browser persistence/restore with an isolated signaling service; the host browser's authority issues results.
 * Accelerates only the test round's final tick (through the opt-in test hook). */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import './helpers/browser-locale.cjs';
import { createServer } from '../server/src/main.js';
import { FIRST_LEVEL_ID } from '../shared/levels.js';
const { app } = await createServer({clientRoot:resolve('dist/client'),basePath:'/mp/wash-cn'});
await app.listen({host:'127.0.0.1',port:0});
const port=(app.server.address() as {port:number}).port;
const url=`http://127.0.0.1:${port}/mp/wash-cn/?wash-test=1`;
const browser=await chromium.launch({headless:true,channel:'chrome'});
await installGuideReader(browser);
const errors:string[]=[];
try {
  const contexts=await Promise.all(Array.from({length:4},()=>browser.newContext({viewport:{width:1440,height:810}})));
  const pages=await Promise.all(contexts.map(context=>context.newPage()));
  pages.forEach(page=>page.on('pageerror',error=>errors.push(error.message)));
  await Promise.all(pages.map(page=>page.goto(url)));await Promise.all(pages.map(page=>page.waitForSelector('body.scene-ready')));
  assert.equal(await pages[0].locator('#continue-game').isDisabled(),true);
  const code=(await pages[0].locator('#room-code-value').textContent())!;
  for(const guest of pages.slice(1)) {if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(code);await guest.locator('#join-room').click();await guest.waitForFunction(()=>document.querySelector('#room-code-label')!.textContent==='当前房间'&&(globalThis as any).__wash.connection.guest?.open);}
  assert.equal(await pages[1].locator('#room-code-value').textContent(),code);
  assert.equal(await pages[1].locator('#room-action').textContent(),'离开房间');
  assert.match(await pages[1].locator('#room-role').textContent() || '',/^队友 · /);
  await pages[1].locator('#room-panel').screenshot({path:resolve('docs/QA/room-guest-panel.png')});
  await pages[0].locator('#new-game').click();await Promise.all(pages.map(page=>page.waitForFunction(()=>document.body.classList.contains('in-game'))));
  await Promise.all(pages.map(page=>page.waitForFunction(()=>JSON.parse(localStorage.getItem('wash-progress')||'null')?.lastLevelId==='highway-01')));
  const host=pages[0];
  const sim=(expression:string)=>host.evaluate((source)=>new Function('sim',`return ${source}`)((globalThis as any).__wash.connection.authority.sim),expression);
  await sim('(sim.game.score=100,sim.game.completed=3,sim.game.remaining=0.03)');
  await Promise.all(pages.map(page=>page.waitForFunction(()=>JSON.parse(localStorage.getItem('wash-progress')||'null')?.levels['highway-01']?.finishedRuns===1)));
  for(const page of pages) {const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('wash-progress')!));assert.equal(data.version,'0.3');assert.equal(data.levels[FIRST_LEVEL_ID].bestScore,100);assert.equal(data.levels[FIRST_LEVEL_ID].bestCompletedOrders,3);}
  // Every guest browser acknowledges its durable save back to the host over the direct link.
  await host.waitForFunction(()=>[...(globalThis as any).__wash.connection.authority.receipts.values()].every((receipts:Map<string,unknown>)=>receipts.size===0),null,{timeout:3000});
  await pages[0].waitForSelector('#menu-dialog[open]');await pages[0].locator('.pause-home').click();
  await Promise.all(pages.map(page=>page.waitForFunction(()=> {
    const wash=(globalThis as any).__wash;
    return wash.ui.page==='home' && !wash.ui.iris.active && !wash.network.homeHold && !wash.connection.guest?.homePending;
  })));
  await pages[0].reload();await pages[0].waitForSelector('body.scene-ready');await pages[0].waitForFunction(()=>!(document.querySelector('#continue-game') as HTMLButtonElement).disabled);
  await pages[0].locator('#select-level').click();assert.match(await pages[0].locator('.level-card[data-level-id="highway-01"] small').innerText(),/完成 1 局.*100 分.*3 辆/);
  await pages[0].locator('#menu-dialog').evaluate(node => Promise.allSettled(node.getAnimations().map(animation => animation.finished)));
  await pages[0].screenshot({path:resolve('docs/QA/save-level-progress.png')});await pages[0].locator('#dialog-close').click();
  // A reloaded host is a new browser authority; guests re-link before it can start (it refuses until then).
  await host.waitForFunction(()=>(globalThis as any).__wash.connection.authority.connectedGuests().length===3,null,{timeout:15000});
  await pages[0].locator('#continue-game').click();await Promise.all(pages.map(page=>page.waitForFunction(()=>document.body.classList.contains('in-game'))));
  assert.equal(await sim('sim.game.score'),0);assert.equal(await sim('sim.game.completed'),0);assert.ok(await sim('sim.game.remaining')>175,'resume restarts the round instead of restoring the 100-point scene');
  const roundId=()=>host.evaluate(()=>(globalThis as any).__wash.connection.authority.roundId);
  const before=await roundId();await pages[0].locator('#pause-game').click();await pages[0].waitForSelector('#menu-dialog[open]');await pages[0].locator('.pause-load').click();
  await pages[0].waitForFunction(()=>document.body.classList.contains('starting-game'));await Promise.all(pages.map(page=>page.waitForFunction(()=>document.body.classList.contains('in-game'))));
  assert.notEqual(await roundId(),before);assert.equal(await sim('sim.game.score'),0);
  assert.equal((await pages[0].evaluate(()=>JSON.parse(localStorage.getItem('wash-progress')!))).levels[FIRST_LEVEL_ID].finishedRuns,1,'loading abandons the partial round without awarding a completion');
  const sameProfile=await contexts[0].newPage();await sameProfile.goto(url);await sameProfile.waitForSelector('body.scene-ready');await sameProfile.waitForFunction(()=>!(document.querySelector('#continue-game') as HTMLButtonElement).disabled);await sameProfile.close();
  const legacy=await browser.newContext({viewport:{width:1440,height:810}});await legacy.addInitScript(()=>localStorage.setItem('wash-progress',JSON.stringify({version:'0.1'})));
  const old=await legacy.newPage();old.on('pageerror',error=>errors.push(error.message));await old.goto(url);await old.waitForSelector('body.scene-ready');
  assert.equal(await old.locator('#continue-game').isDisabled(),true);assert.match(await old.locator('#save-status').innerText(),/不兼容/);
  assert.equal(await old.evaluate(()=>JSON.parse(localStorage.getItem('wash-progress')!).version),'0.1');
  await old.screenshot({path:resolve('docs/QA/save-version-mismatch.png')});await old.locator('#new-game').click();await old.waitForFunction(()=>JSON.parse(localStorage.getItem('wash-progress')!).version==='0.3');
  assert.deepEqual(errors,[]);
  console.log('PASS real browsers: host + three guests save authority results, refresh/continue, clean round reload, same-profile sharing, incompatible-version rejection');
} finally {await browser.close();await app.close();}
