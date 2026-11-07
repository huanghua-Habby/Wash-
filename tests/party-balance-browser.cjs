/** Same-machine Chrome/WebRTC check. Actor placement and pre-cleaned stages are test fixtures;
 * the guest's final J action, authority completion, snapshots, results and saves are production paths. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
const out='docs/QA/party-balance';
async function guides(pages){for(let i=0;i<80;i++){for(const p of pages){const b=p.locator('.level-guide-confirm');if(await b.isVisible()&&await b.isEnabled())await b.click();}if(await pages[0].evaluate(()=>__wash.game.roundStage!=='guide'&&__wash.ui.page==='game'))return;await pages[0].waitForTimeout(100);}throw Error('guide barrier timed out');}
async function playing(p){await p.waitForFunction(()=>__wash.ui.page==='game'&&!__wash.ui.iris.active&&__wash.game.roundStage==='playing',{timeout:30000});}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[],report=[];
 try{
  for(const count of [2,3,4]){
   const contexts=await Promise.all(Array.from({length:count},()=>browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'})));
   try{
    const pages=await Promise.all(contexts.map(c=>c.newPage())),[host,guest]=pages;
    for(const p of pages)p.on('pageerror',e=>errors.push(e.message));
    await Promise.all(pages.map(async p=>{await p.goto(url.href);await p.waitForSelector('body.scene-ready',{timeout:90000});}));
    const code=await host.locator('#room-code-value').textContent();
    for(const p of pages.slice(1)){await p.locator('#toggle-join-room').click();await p.locator('#join-code').fill(code);await p.locator('#join-room').click();await p.waitForFunction(()=>!__wash.connection.isHost);}
    await host.waitForFunction(n=>__wash.connection.authority.connectedGuests().length===n-1,count);
    await host.evaluate(()=>__wash.connection.send('start',{levelId:'highway-05'}));
    await host.waitForSelector('#level-guide[open]');await guides(pages);await Promise.all(pages.map(playing));
    const expected={playerCount:count,stainMultiplier:[1,1.25,1.4,1.5][count-1],patienceMultiplier:[1,.8,.72,.66][count-1],scoreMultiplier:[1,.9,.85,.83][count-1]};
    for(const p of pages)assert.deepEqual(await p.evaluate(()=>__wash.game.partyBalance),expected);
    const fixture=await host.evaluate(()=>{
     const sim=__wash.connection.authority.sim,g=sim.game;g.elapsed=5;g.levelScript.beforeFleet(1/60);
     for(const o of [...g.orders])g.reclaimOrder(o);g.lanes=[];
     // Reuse actual authored party variants, including an order with five stains.
     const definition=g.level.script.orders.find(o=>g.levelScript.definition(o.id).stains.length===5);
     g.levelScript.enqueue(definition.id);g.levelScript.beforeFleet(1/60);
     const request=g.levelScript.requests.find(r=>r.id===definition.id);
     const o=g.orders.find(o=>o.id===definition.id)||g.spawnOrder(request.serial);
     if(!o)throw Error('five-stain slot unavailable');
     g.lanes.forEach(l=>l.x=g.orderX());__wash.connection.authority.publish();
     return {serial:o.serial,total:g.level.script.orders.reduce((n,o)=>n+g.levelScript.definition(o.id).stains.length,0),layout:o.definition.stains};
    });
    assert.equal(fixture.total,[0,0,51,57,62][count]);
    await Promise.all(pages.map(p=>p.waitForFunction(serial=>__wash.game.orders.some(o=>o.serial===serial&&o.stains.length===5&&o.arrivalProgress===1),fixture.serial)));
    await host.evaluate(serial=>{
     const sim=__wash.connection.authority.sim,g=sim.game,o=g.orders.find(o=>o.serial===serial),p=sim.players[1],s=o.stains[4];
     for(const stain of o.stains.slice(0,4)){stain.done=true;stain.stage=stain.steps.length;}
     s.stage=s.steps.length-1;s.progress=0;
     g.towels[0].pickup(p);p.skipUse=false;p.state='ground';p.ground={truck:o.truck,plat:o.truck.platforms[0]};
     p.pos.set(o.truck.pos.x+s.position[0],o.truck.topY,o.truck.pos.z+s.position[1]);p.vel.set(0,0,0);p.externalVelocity.set(0,0,0);p.root.position.copy(p.pos);
     const source=g.orders.find(other=>other!==o)||o;
     if(!g.charging.plug(g.chargers[0],source))throw Error('cannot plug actual connector');source.chargeProgress=.999;
     sim.resetInputs();__wash.connection.authority.publish();
    },fixture.serial);
    await Promise.all(pages.map(p=>p.waitForFunction(serial=>__wash.game.orders.find(o=>o.serial===serial)?.rewardMultiplier===1.5,fixture.serial)));
    const gScore=[0,0,34,32,31][count];
    await host.screenshot({path:`${out}/${count}p-five-patches.png`});
    await guest.keyboard.down('KeyJ');await host.waitForFunction(()=>__wash.game.completed===1,{timeout:10000});await guest.keyboard.up('KeyJ');
    await Promise.all(pages.map(p=>p.waitForFunction(score=>__wash.game.score===score,gScore)));
    await host.evaluate(()=>__wash.connection.authority.sim.game.remaining=.001);
    await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='results')));
    for(const p of pages){const result=await p.evaluate(()=>__wash.game.result);assert.equal(result.score,gScore);assert.equal(result.stars,0);assert.deepEqual(result.partyBalance,expected);await p.waitForFunction(n=>JSON.parse(localStorage.getItem('wash-progress'))?.levels['highway-05']?.bestScorePlayers===n,count);}
    const result=await host.evaluate(()=>__wash.game.result);await host.screenshot({path:`${out}/${count}p-result.png`});
    await host.evaluate(()=>__wash.connection.send('load',{levelId:'highway-03'}));await host.waitForSelector('#level-guide[open]');await guides(pages);await Promise.all(pages.map(playing));
    const third=await host.evaluate(()=>{const g=__wash.connection.authority.sim.game;return {count:g.level.script.orders.length,total:g.level.script.orders.reduce((n,o)=>n+g.levelScript.definition(o.id).stains.length,0),at:g.level.script.orders.map(o=>o.at)};});
    assert.equal(third.count,6);assert.equal(third.total,[0,0,19,21,23][count]);assert.deepEqual(third.at,[2,20,40,59,80,99]);
    report.push({count,fixture,result,third});console.log(`PASS ${count} players: five-patch guest J, once-rounded charge reward ${gScore}, matching peers/results/save and six-car third level`);
   }finally{await Promise.all(contexts.map(c=>c.close()));}
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/report.json`,JSON.stringify({scope:'same-machine actual Chrome/WebRTC; explicit actor/stage fixtures; no full-play balance claim',report,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
