/** Actual solo tutorial UI: movement, one-participant state and ordinary pause. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'});try{
 const p=await b.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));await p.goto(url.href);await p.waitForSelector('body.scene-ready');
 await p.locator('#new-game').click();await p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active);
 assert.equal(await p.locator('#time-value').textContent(),'--：--');assert.equal(await p.locator('.tutorial-task-dot:visible').count(),1);
 await p.keyboard.down('d');await p.waitForTimeout(450);await p.keyboard.up('d');
 await p.waitForFunction(()=>__wash.game.tutorial?.stepId==='clean'&&__wash.game.orders.length===1);
 assert.equal(await p.evaluate(()=>__wash.game.orders[0].stains.length),1);
 await p.locator('#pause-game').click();await p.waitForFunction(()=>__wash.game.paused);
 await p.waitForSelector('.tutorial-toast',{state:'hidden'});
 const elapsed=await p.evaluate(()=>__wash.game.elapsed);await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>__wash.game.elapsed),elapsed);
 await p.locator('.pause-continue').click();await p.waitForFunction(()=>!__wash.game.paused);await p.waitForSelector('.tutorial-toast');
 assert.equal(await p.evaluate(()=>__wash.ui.motionAllowed),false);assert.deepEqual(errors,[]);
 const output=path.resolve('docs/QA/level-ui');fs.mkdirSync(output,{recursive:true});
 const report={pass:true,scope:'actual single-page solo tutorial',checks:['unlimited clock','one participant and stain','real movement','pause freezes authority','toast/modal visibility','reduced motion'],errors};
 fs.writeFileSync(path.join(output,'solo-integration.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
