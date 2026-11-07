/** Accepted single-image hooks: startup decode, complete alt, host/guest barrier and retired page rejection. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const{chromium}=require('playwright');const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:18081/');url.searchParams.set('wash-test','1');
require('./helpers/browser-locale.cjs');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'}),pages=[],errors=[];const output=path.resolve('docs/QA/level-ui');fs.mkdirSync(output,{recursive:true});try{
 for(let i=0;i<2;i++){const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.__guideDecodes=[];const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){if(/(?:tools-(?:water|soap|charging)|hazard-road-sign)/.test(this.src))__guideDecodes.push(this.src);return decode.call(this)}});await page.goto(url.href);await page.waitForSelector('body.scene-ready',{timeout:60000});}
 const[h,g]=pages;
 const prepared=await Promise.all(pages.map(p=>p.evaluate(()=>Object.fromEntries(['tools-water:0','tools-soap:0','tools-charging:0','hazard-road-sign:0'].flatMap(key=>[key,`en:${key}`]).map(key=>{const img=__wash.ui.levelGuide.images[key];return[key,{complete:img.complete,width:img.naturalWidth,height:img.naturalHeight}]})))));
 for(const page of prepared)for(const img of Object.values(page)){assert.equal(img.complete,true);assert.deepEqual([img.width,img.height],[2560,1440]);}
 const decodeCounts=await Promise.all(pages.map(p=>p.evaluate(()=>__guideDecodes.length)));assert.deepEqual(decodeCounts,[8,8]);
 if(await g.locator('#join-room-form').isHidden())await g.locator('#toggle-join-room').click();await g.locator('#join-code').fill(await h.locator('#room-code-value').textContent());await g.locator('#join-room').click();await g.waitForFunction(()=>__wash.connection.guest?.open&&__wash.network.latest);
 for(const[level,id]of[['02','tools-water'],['03','tools-soap'],['04','tools-charging'],['05','hazard-road-sign']]){
  await h.locator('#select-level').click();await h.locator(`[data-level-id="highway-${level}"]`).click();
  await Promise.all(pages.map(p=>p.waitForFunction(id=>__wash.game.guide.id===id&&document.getElementById('level-guide').open,id)));
  const alt=fs.readFileSync(path.resolve(`client/assets/guides/${id}.alt.txt`),'utf8');
  for(const p of pages){assert.equal(await p.evaluate(()=>__wash.game.guide.pageCount),1);assert.equal(await p.locator('.level-guide-pages').isVisible(),false);assert.equal(await p.locator('.level-guide-body').isVisible(),false);assert.equal(await p.locator('.level-guide-image').getAttribute('alt'),alt);assert.equal(await p.locator('.level-guide-image').isVisible(),true);}
  await h.screenshot({path:path.join(output,`${id}-single-page.png`)});
  assert.equal(await h.evaluate(id=>__wash.connection.confirmGuide(id,1),id),false);
  await h.locator('.level-guide-confirm').click();await g.waitForFunction(()=>!!(__wash.game.guide.ready&1));assert.equal(await g.evaluate(()=>__wash.game.roundStage),'guide');
  await g.locator('.level-guide-confirm').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.game.roundStage==='playing'&&!__wash.ui.iris.active)));
  await h.locator('#pause-game').click();await h.locator('.pause-home').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>__wash.ui.page==='home'&&!__wash.ui.iris.active&&!__wash.connection.room.homeWaiting.length)));
 }
 assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>__guideDecodes.length))),decodeCounts,'opening guides performs no new image.decode calls');assert.deepEqual(errors,[]);
 const report={pass:true,hooks:['tools-water:0','tools-soap:0','tools-charging:0','hazard-road-sign:0'],prepared,decodeCounts,checks:['accepted WebP at 2560x1440','startup decode','complete delivered alt','single-page host/guest barrier','retired page rejected','no late decode'],errors};fs.writeFileSync(path.join(output,'accepted-images.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
