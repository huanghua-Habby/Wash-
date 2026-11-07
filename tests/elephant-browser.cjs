const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
// Two pages in one room: the guest becomes an elephant and holds L. The host authority opens the trunk, drains the tank and
// pushes the elephant back; both pages show the jet, the tank gauge and the raised trunk, then the tank refills.
// Also checks the 镜头视野 setting and the EV charging post / connector models on the home vehicle.
const closeUp=async(page,file,slot=1,lift=0.6)=>{const c=await page.evaluate(([slot,lift])=>{const p=__wash.players[slot].root.position.clone();p.y+=lift;p.project(__wash.camera);return {x:(p.x+1)/2*innerWidth,y:(1-p.y)/2*innerHeight};},[slot,lift]);
 await page.screenshot({path:file,clip:{x:Math.max(0,c.x-210),y:Math.max(0,c.y-170),width:420,height:300}});};
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
  // Customize: elephant with the L ability and four breeds.
  await guest.locator('#customize-player').click();await guest.locator('.animal-choice[data-animal="elephant"]').click();
  assert.deepEqual(await guest.locator('.ability-action:visible kbd').allTextContents(),['L']);
  assert.equal(await guest.locator('.ability-description').textContent(),'按住L可以发射水柱！但是你也会被推开！');
  assert.deepEqual(await guest.locator('.breed-choice:visible span').allTextContents(),['灰象','粉粉象','白象','蓝宝象']);
  await guest.locator('.breed-choice[data-breed="sky"]').click();
  await guest.waitForTimeout(800);
  await guest.screenshot({path:'docs/QA/customize-elephant.png'});
  await guest.locator('.customize-confirm').click();await guest.waitForSelector('#customize-dialog',{state:'hidden'});
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].animal==='elephant');
  await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.players[1].body===__wash.players[1].elephant)));
  // Face the host along +z so the jet crosses the roof, then hold L on the guest.
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].state==='ground',null,{timeout:8000});
  const start=await host.evaluate(()=>{const p=__wash.connection.authority.sim.players[1];return p.pos.toArray();});
  await guest.bringToFront();await guest.keyboard.down('KeyL');
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].trunk.spraying);
  await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.players[1].trunk.spraying&&__wash.players[1].trunk.sprayNodes.length>1)));
  await guest.waitForTimeout(650);
  for (const page of pages) {
    assert.equal(await page.locator('.trunk-tank.player-2').isVisible(),true,'both pages show the elephant tank');
    assert.ok(await page.evaluate(()=>__wash.players[1].trunk.water)<0.95,'the tank drains on every page');
  }
  const tip=await guest.evaluate(()=>{const p=__wash.players[1],t=p.elephant.trunkTip.getWorldPosition(p.root.position.clone()),r=p.root.position;return t.y-r.y;});
  assert.ok(tip>0.55,'the drawn trunk is raised to spray');
  await closeUp(guest,'docs/QA/elephant-spray.png');
  await host.screenshot({path:'docs/QA/elephant-spray-host.png'});
  const moved=await host.evaluate((start)=>{const p=__wash.connection.authority.sim.players[1],c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    return -((p.pos.x-start[0])*c-(p.pos.z-start[2])*s);},start);
  assert.ok(moved>0.25,`recoil pushes the elephant backwards on the authority (${moved.toFixed(2)} m)`);
  // Keep holding until dry: the jet stops even with L held, and the gauge flashes empty.
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].trunk.empty,null,{timeout:5000});
  await guest.waitForFunction(()=>!__wash.players[1].trunk.spraying&&document.querySelector('.trunk-tank.player-2').classList.contains('empty'));
  await guest.keyboard.up('KeyL');
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].trunk.water>0.5,null,{timeout:5000});
  await guest.waitForFunction(()=>__wash.players[1].trunk.water>0.5);
  // 镜头视野: the settings slider changes the live camera and persists.
  const before=await host.evaluate(()=>__wash.camera.fov);
  await host.locator('#settings').click();await host.waitForSelector('#setting-camera-fov');
  await host.locator('#setting-camera-fov').fill('46');
  await host.keyboard.press('Escape');
  await host.waitForFunction((before)=>__wash.camera.fov>before+6,before,{timeout:5000});
  assert.equal(await host.evaluate(()=>JSON.parse(localStorage.getItem('cube-highway-fx-v2')).camera.playFov),46);
  // EV charging post and connector on the home vehicle.
  const post=await host.evaluate(()=>{const c=__wash.game.charging;c.source.updateWorldMatrix(true,false);const p=c.source.getWorldPosition(c.source.position.clone());p.project(__wash.camera);return {x:(p.x+1)/2*innerWidth,y:(1-p.y)/2*innerHeight};});
  await host.screenshot({path:'docs/QA/charging-post.png',clip:{x:Math.max(0,post.x-260),y:Math.max(0,post.y-230),width:520,height:330}});
  assert.ok(await host.evaluate(()=>__wash.game.charging.source.children.length>=3&&!!__wash.game.chargers[0].mesh.children[0].userData.light));
  assert.deepEqual(await Promise.all(pages.map(page=>page.evaluate(()=>__shaderCompiles))),compiles,'elephant selection and trunk spray compile no shaders');
  assert.deepEqual(errors,[]);
  console.log('PASS Elephant: customize with L ability, host-authoritative trunk jet with recoil and tank drain/empty/refill synced to both pages, raised trunk and gauge, FOV setting, EV charging post, zero shader compilation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
