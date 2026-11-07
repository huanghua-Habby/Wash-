/** Same-machine WebRTC UI integration. Authority fixtures finish cleaning/rounds; not manual gameplay acceptance. */
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
(async()=>{
 const b=await chromium.launch({headless:true,channel:'chrome'}),pages=[],errors=[],steps=[];
 const output=path.resolve('docs/QA/level-ui');fs.mkdirSync(output,{recursive:true});
 try{
  for(let i=0;i<2;i++){const ctx=await b.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGL|Shader Error/.test(m.text()))errors.push(m.text())});await p.goto(url.href);await p.waitForSelector('body.scene-ready',{timeout:60000});}
  const[h,g]=pages;
  if(await g.locator('#join-room-form').isHidden())await g.locator('#toggle-join-room').click();
  await g.locator('#join-code').fill(await h.locator('#room-code-value').textContent());await g.locator('#join-room').click();await g.waitForFunction(()=>__wash.connection.guest?.open&&__wash.network.latest);
  const programs=await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length)));
  await h.locator('#select-level').click();assert.equal(await h.locator('.level-card').count(),5);await h.screenshot({path:path.join(output,'five-level-menu.png')});await h.locator('#dialog-close').click();
  await h.locator('#new-game').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active)));
  for(const p of pages){assert.equal(await p.locator('#time-value').textContent(),'--：--');assert.equal(await p.locator('.tutorial-toast').isVisible(),true);assert.equal(await p.evaluate(()=>__wash.ui.input.enabled),true);assert.equal(await p.evaluate(()=>__wash.game.equipmentKeys.length),0);}
  await h.screenshot({path:path.join(output,'tutorial-move.png')});steps.push('unlimited move tutorial with active input and empty equipment');console.log(steps.at(-1));
  for(const p of pages){await p.keyboard.down('d');await p.waitForTimeout(400);await p.keyboard.up('d');}
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.tutorial?.stepId==='clean')));
  await h.waitForFunction(()=>__wash.game.orders.length===1&&__wash.game.orders[0].arrivalProgress===1);
  assert.equal(await g.evaluate(()=>__wash.game.tutorial.dots.kind),'stains');assert.equal(await g.evaluate(()=>__wash.game.tutorial.dots.entries.length),2);
  await h.evaluate(()=>{const sim=__wash.connection.authority.sim,G=sim.game;G.towels[0].pickup(sim.players[0]);for(const s of G.orders[0].stains)s.done=true;G.completeOrder(G.orders[0]);});
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.tutorial?.stepId==='release')));
  assert.equal(await g.evaluate(()=>__wash.game.tutorial.dots.entries[0].complete),false);
  await h.evaluate(()=>__wash.connection.authority.sim.game.drop(__wash.connection.authority.sim.players[0]));
  await g.waitForFunction(()=>__wash.game.tutorial.dots.entries[0].complete===true);
  await h.evaluate(()=>__wash.connection.authority.sim.game.towels[0].pickup(__wash.connection.authority.sim.players[0]));
  await g.waitForFunction(()=>__wash.game.tutorial.dots.entries[0].complete===false);
  await h.screenshot({path:path.join(output,'tutorial-release.png')});
  await h.evaluate(()=>__wash.connection.authority.sim.game.drop(__wash.connection.authority.sim.players[0]));
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='finish',{},{timeout:30000})));
  assert.equal(await h.locator('.round-cue-title').textContent(),'教程结束！');
  await Promise.all(pages.map(p=>p.waitForSelector('.result-next')));
  assert.equal(await g.locator('.result-next').isDisabled(),true);assert.equal(await h.locator('.result-stars').count(),0);
  await h.screenshot({path:path.join(output,'tutorial-results.png')});steps.push('tutorial lamps reverse on re-pick; authority tutorial finish and guest permissions');console.log(steps.at(-1));
  await h.locator('.result-next').click();
  const readPages=async(id,count)=>{
   for(let i=0;i<count;i++){
    await Promise.all(pages.map(p=>p.waitForFunction(({id,i})=>__wash.game.guide.id===id&&__wash.game.guide.pageIndex===i&&document.getElementById('level-guide').open,{id,i})));
    assert.equal(await h.evaluate(()=>__wash.game.guide.pageCount),1,'production guides have one final hook');
    await g.evaluate(id=>__wash.connection.confirmGuide(id,1),id);
    await h.waitForTimeout(150);assert.equal(await h.evaluate(()=>__wash.game.guide.ready),0,'retired second page confirmation rejected');
    if(id==='tools-water')await h.keyboard.down('j');else await h.locator('.level-guide-confirm').click();
    await g.waitForFunction(()=>!!(__wash.game.guide.ready&1));
    assert.equal(await g.evaluate(()=>__wash.game.guide.pageIndex),i,'one reader cannot flip the page');
    await g.locator('.level-guide-confirm').click();
   }
   await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active)));
   await h.keyboard.up('j');
  };
  await readPages('tools-water',1);assert.equal(await h.evaluate(()=>__wash.game.clock.duration),120);
  await h.evaluate(()=>__wash.connection.authority.sim.game.finish('time_up'));
  await Promise.all(pages.map(p=>p.waitForSelector('.result-retry')));
  assert.equal(await h.locator('.result-next').count(),0);assert.equal(await g.locator('.result-retry').isDisabled(),true);
  await h.screenshot({path:path.join(output,'failed-results.png')});
  await h.locator('.result-retry').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='guide'&&__wash.game.guide.pageIndex===0)));
  await h.keyboard.press('Escape');await h.locator('.pause-home').click();
  const home=async()=>{await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active&&!__wash.connection.room.homeWaiting.length)));};await home();
  steps.push('single-page shared guide, invalid-page rejection, failure/retry and return lifecycle');console.log(steps.at(-1));
  for(const[number,guide,count,duration]of [['03','tools-soap',1,120],['04','tools-charging',1,120],['05','hazard-road-sign',1,180]]){
   await h.locator('#select-level').click();await h.locator(`[data-level-id="highway-${number}"]`).click();await readPages(guide,count);
   assert.equal(await g.evaluate(()=>__wash.game.clock.duration),duration);
   assert.equal(await g.evaluate(()=>__wash.game.equipmentEnabled('charger')),number==='04'||number==='05');
   if(number==='04'){
    await h.waitForFunction(()=>__wash.game.orders.length===2&&__wash.game.orders.every(o=>o.arrivalProgress===1),{},{timeout:25000});
    // Fixture only positions the connector/actor; host ChargingSystem advances the actual charge and bonus.
    await h.evaluate(()=>{const sim=__wash.connection.authority.sim,G=sim.game,o=G.orders[0],p=sim.players[0],front=o.truck.platforms.reduce((a,b)=>a.x1>b.x1?a:b);p.state='ground';p.ground={truck:o.truck,plat:front};p.pos.set(o.truck.pos.x+front.x1-.3,o.truck.topY,o.truck.pos.z);p.root.position.copy(p.pos);p.vel.set(0,0,0);G.chargers[0].pickup(p);p.skipUse=false;});
    await h.keyboard.press('j');await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.orders[0].charged,{},{timeout:20000})));
    for(const p of pages){assert.deepEqual(await p.evaluate(()=>__wash.game.orders.map(o=>o.rewardMultiplier)),[1.5,1.5]);assert.equal(await p.locator('.car-badge.reward-boosted').count(),2);assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.charging-badge.charged .charging-progress i')).backgroundColor),'rgb(154, 122, 189)');}
    await h.screenshot({path:path.join(output,'charging-boost.png')});
    await h.evaluate(()=>{const G=__wash.connection.authority.sim.game,o=G.orders[0];for(const s of o.stains)s.done=true;G.completeOrder(o);});
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.score===38)));
    steps.push('host charging bonus sync, two purple order bars and combo-inclusive 38 point settlement');console.log(steps.at(-1));
   }
   await h.evaluate(()=>__wash.connection.authority.sim.game.finish('time_up'));await h.waitForSelector('.result-home');await h.locator('.result-home').click();await home();
  }
  assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>__wash.renderer.info.programs.length))),programs,'all level/hidden resources prepared at boot');
  assert.deepEqual(errors,[]);const report={pass:true,scope:'same-machine two-page real WebRTC with documented authority fixtures',steps,errors};fs.writeFileSync(path.join(output,'game-integration.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(output,`failure-${i}.png`)}).catch(()=>{});throw e;}
 finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
