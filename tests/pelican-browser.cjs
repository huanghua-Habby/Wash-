const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
// Two pages in one room: the guest becomes a pelican, swallows the host with L (host authority), shows the pouch on both pages, then spits.
// Close-up crop around the pelican (slot 1) for the gulp/spit screenshots.
const closeUp=async(page,file)=>{const c=await page.evaluate(()=>{const p=__wash.players[1].root.position.clone();p.y+=0.6;p.project(__wash.camera);return {x:(p.x+1)/2*innerWidth,y:(1-p.y)/2*innerHeight};});
 await page.screenshot({path:file,clip:{x:Math.max(0,c.x-170),y:Math.max(0,c.y-150),width:340,height:260}});};
const pressL=async(page)=>{await page.keyboard.down('KeyL');await page.waitForTimeout(90);await page.keyboard.up('KeyL');};
const standInFront=(host)=>host.evaluate(()=>{const [h,p]=__wash.connection.authority.sim.players;p.yaw=0;h.pos.copy(p.pos);h.pos.x+=0.55;h.vel.set(0,0,0);});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.WASH_BROWSER_CHANNEL||'chrome'}),errors=[],pages=[];
 try{
  for(let i=0;i<2;i++){
   const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:2}),page=await context.newPage();
   await page.addInitScript(()=>{window.__shaderCompiles=0;for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){const compile=prototype.compileShader;prototype.compileShader=function(...args){window.__shaderCompiles++;return compile.apply(this,args);};}});
   page.on('pageerror',e=>errors.push(e.message));pages.push(page);
  }
  await Promise.all(pages.map(async page=>{await page.goto(url.href);await page.waitForSelector('body.scene-ready');}));
  const [host,guest]=pages;
  if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
  await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());await guest.locator('#join-room').click();
  await guest.waitForFunction(()=>__wash.connection.guest?.open&&__wash.network.latest);
  await host.waitForFunction(()=>__wash.connection.room.members.length===2);
  const compiles=await Promise.all(pages.map(page=>page.evaluate(()=>__shaderCompiles)));
  await guest.locator('#customize-player').click();await guest.locator('.animal-choice[data-animal="pelican"]').click();
  assert.deepEqual(await guest.locator('.ability-action:visible kbd').allTextContents(),['L','空格（长按）']);
  assert.equal(await guest.locator('.ability-description').textContent(),'按L可以吞掉任何道具，或队友！没吃东西的话可以在天上滑翔！');
  assert.deepEqual(await guest.locator('.breed-choice:visible span').allTextContents(),['白鹈鹕','褐鹈鹕','粉鹈鹕','卷羽鹈鹕']);
  await guest.locator('.breed-choice[data-breed="brown"]').click();
  await guest.waitForTimeout(800); // let the pressed-state color transition settle
  await guest.screenshot({path:'docs/QA/customize-pelican.png'});
  await guest.locator('.customize-confirm').click();await guest.waitForSelector('#customize-dialog',{state:'hidden'});
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].animal==='pelican');
  // Stand the host right in front of the pelican's beak on the authority, then gulp.
  await standInFront(host);
  await guest.bringToFront();await pressL(guest);
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].swallowed===__wash.connection.authority.sim.players[0]);
  await guest.waitForFunction(()=>__wash.players[1].swallowed===__wash.players[0]&&-__wash.players[1].pelican.bones.jaw.rotation.z>1.1);
  await closeUp(guest,'docs/QA/pelican-gulp.png');
  await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.players[0].state==='swallowed'&&__wash.players[1].swallowed===__wash.players[0])));
  await guest.waitForTimeout(700);
  assert.equal(await guest.evaluate(()=>__wash.players[0].squash.visible),false,'the swallowed host is hidden inside the pouch');
  assert.ok(await guest.evaluate(()=>__wash.players[1].pelican.bones.pouch.scale.y)>2,'the pouch is visibly full for teammates');
  // Break-free countdown on both pages, in the swallowed player's slot.
  for (const page of pages) {
    const counter=page.locator('.respawn-counter.player-1.swallowed');
    assert.equal(await counter.isVisible(),true);assert.match(await counter.locator('strong').textContent(),/^[1-5]$/);
  }
  assert.equal(await host.locator('.name-tag.player-1').isVisible(),false,'the passenger name tag yields to the countdown');
  await guest.screenshot({path:'docs/QA/pelican-swallow.png'});
  // No L: the countdown runs out and the pelican spits the host out by itself.
  await guest.waitForFunction(()=>!__wash.players[1].swallowed,null,{timeout:8000});
  await guest.waitForFunction(()=>-__wash.players[1].pelican.bones.jaw.rotation.z>1.1);
  await closeUp(guest,'docs/QA/pelican-spit.png');
  await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.players[0].state!=='swallowed'&&document.querySelector('.respawn-counter.player-1').hidden)));
  // Swallow again and spit with L.
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[0].state==='ground',null,{timeout:8000});
  await standInFront(host);await pressL(guest);
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].swallowed);
  await guest.waitForTimeout(300);await pressL(guest);
  await Promise.all(pages.map(page=>page.waitForFunction(()=>!__wash.players[1].swallowed&&__wash.players[0].state!=='swallowed')));
  assert.deepEqual(await Promise.all(pages.map(page=>page.evaluate(()=>__shaderCompiles))),compiles,'pelican selection, gulp and spit compile no shaders');
  assert.deepEqual(errors,[]);
  console.log('PASS Pelican: customize with L ability, host-authoritative swallow of a teammate, gape close-up, pouch and hidden passenger, synced break-free countdown and auto escape, L spit, zero shader compilation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
