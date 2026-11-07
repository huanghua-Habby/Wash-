const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[],pages=[];
 try{
  for(let i=0;i<2;i++){
   const context=await browser.newContext({viewport:{width:1440,height:810}}),page=await context.newPage();
   await page.addInitScript(()=>{window.__shaderCompiles=0;for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){const compile=prototype.compileShader;prototype.compileShader=function(...args){window.__shaderCompiles++;return compile.apply(this,args);};}});
   page.on('pageerror',e=>errors.push(e.message));pages.push(page);
  }
  await Promise.all(pages.map(async page=>{await page.goto(url.href);await page.waitForSelector('body.scene-ready');}));
  const [host,guest]=pages;if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());await guest.locator('#join-room').click();
  await guest.waitForFunction(()=>__wash.connection.guest?.open&&__wash.network.latest);
  await host.waitForFunction(()=>__wash.connection.room.members.length===2);
  const layout=await host.evaluate(()=>{
   const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};};
   return {todo:rect('#todo'),room:rect('#room-panel'),keys:rect('.keys'),homeLayer:+getComputedStyle(document.querySelector('#hud')).zIndex,worldLayer:+getComputedStyle(document.querySelector('.world-hud')).zIndex};
  });
  assert.notEqual(await host.locator('#room-panel').evaluate(node=>getComputedStyle(node).animationName),'none','room ticket uses managed entry motion');
  assert.ok(layout.homeLayer>layout.worldLayer);assert.ok(layout.room.bottom<layout.keys.top,'room and keys do not overlap');assert.equal(await host.locator('#todo').isHidden(),true,'checklist shares the role bookmark slot');
  await host.screenshot({path:'docs/QA/customize-home.png'});
  const initial=await host.evaluate(()=>({...__wash.players[0].appearance}));
  const compiles=await host.evaluate(()=>__shaderCompiles);
  await host.locator('#customize-player').click();await host.waitForSelector('#customize-dialog[open]');
  assert.notEqual(await host.locator('#customize-dialog').evaluate(node=>getComputedStyle(node).animationName),'none','normal UI mode has an entry transition');
  assert.equal(await host.locator('.color-choice').count(),16);assert.equal(await host.locator('.breed-choice:visible').count(),4);
  assert.deepEqual(await host.locator('.animal-choice').allTextContents(),['猫猫 快速复活','狗狗 尽职尽责','鹈鹕 大嘴吞吞']);
  assert.equal(await host.locator('.color-choice[data-color="1"]').isEnabled(),false);
  for(const breed of ['grey','cream','tuxedo','ginger'])await host.locator(`.breed-choice[data-breed="${breed}"]`).click();
  await host.locator('.animal-choice[data-animal="dog"]').click();
  assert.deepEqual(await host.locator('.breed-choice:visible span').allTextContents(),['柯基','二哈','柴犬','土狗']);
  assert.equal(await host.locator('.ability-description').textContent(),'狗狗很勤奋，用肥皂和毛巾的速度提升50%');
  for(const breed of ['husky','shiba','tugou','corgi'])await host.locator(`.breed-choice[data-breed="${breed}"]`).click();
  assert.equal(await host.locator('.customize-preview-name').textContent(),'柯基');
  assert.equal(await host.evaluate(()=>__wash.customize.preview.body===__wash.customize.preview.dog),true);
  await host.screenshot({path:'docs/QA/customize-dog.png'});
  await host.locator('.animal-choice[data-animal="cat"]').click();
  assert.equal(await host.evaluate(()=>__wash.customize.preview.appearance.breed),'ginger','returning to cats keeps the cat breed');
  await host.locator('.breed-choice[data-breed="tuxedo"]').click();await host.locator('.color-choice[data-color="5"]').click();
  assert.deepEqual(await host.evaluate(()=>({...__wash.players[0].appearance})),initial,'draft does not alter the scene');
  assert.equal(await host.evaluate(()=>__wash.customize.preview.appearance.breed),'tuxedo');
  assert.equal(await host.evaluate(()=>__shaderCompiles),compiles,'first open, animal and all breed switches compile no new shaders');
  assert.equal(await host.locator('.ability-description').textContent(),'猫猫有九条命，等待复活的时间降低60%');
  assert.equal(await host.locator('.ability-actions').isVisible(),false);
  assert.equal(await host.getByText('确认后，才会换上新造型').count(),0);
  await host.screenshot({path:'docs/QA/customize-panel.png'});
  // Layout fixture only: future species and Q gameplay are not added by this check.
  await host.evaluate(()=>__wash.customize.showAbility({type:'主动',description:'鹈鹕的嘴能装下额外一件东西（水枪除外）。它可以在携带工具时保留另一件物品，并按自己的需要切换身上的物品。',actions:[{key:'L',description:'切换身上的物品'}]}));
  assert.deepEqual(await host.locator('.ability-action:visible kbd').allTextContents(),['L']);
  const longLayout=await host.evaluate(()=>{const d=document.querySelector('#customize-dialog').getBoundingClientRect(),a=document.querySelector('.customize-ability').getBoundingClientRect(),f=document.querySelector('.customize-confirm').getBoundingClientRect();return {bottom:d.bottom,ability:a.bottom,footer:f.top,height:innerHeight};});
  await host.screenshot({path:'docs/QA/customize-long-ability.png'});
  assert.ok(longLayout.bottom<longLayout.height&&longLayout.ability<longLayout.footer,`long ability layout ${JSON.stringify(longLayout)}`);
  await host.setViewportSize({width:1280,height:720});
  const compact=await host.locator('.customize-confirm').boundingBox();assert.ok(compact.y+compact.height<720,'long ability leaves confirm visible on a shorter desktop window');
  await host.setViewportSize({width:1440,height:810});
  await host.evaluate(()=>__wash.customize.refresh());
  await host.locator('.customize-cancel').click();assert.deepEqual(await host.evaluate(()=>({...__wash.players[0].appearance})),initial);
  await host.locator('#customize-player').click();await host.locator('.breed-choice[data-breed="cream"]').click();await host.locator('.color-choice[data-color="5"]').click();
  await host.locator('.customize-confirm').click();await host.waitForSelector('#customize-dialog',{state:'hidden'});
  await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.players[0].appearance.color===5&&__wash.players[0].appearance.breed==='cream')));
  assert.equal(await host.evaluate(()=>__shaderCompiles),compiles,'confirmation changes no shader programs');
  assert.equal(await host.evaluate(()=>JSON.parse(localStorage.getItem('wash-appearance')).color),5);
  await guest.locator('#customize-player').click();assert.equal(await guest.locator('.color-choice[data-color="5"]').isEnabled(),false);
  await guest.locator('.animal-choice[data-animal="dog"]').click();await guest.locator('.breed-choice[data-breed="husky"]').click();
  await guest.locator('.color-choice[data-color="6"]').click();await guest.locator('.customize-confirm').click();await guest.waitForSelector('#customize-dialog',{state:'hidden'});
  await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.players[1].appearance.color===6&&__wash.players[1].appearance.animal==='dog'&&__wash.players[1].body===__wash.players[1].dog)));
  assert.deepEqual(await host.evaluate(()=>{const p=__wash.connection.authority.sim.players[1];return [p.animal,p.workSpeed,p.respawnReduction];}),['dog',1.5,0],'host authority applies the confirmed dog passive');
  assert.equal(await guest.locator('#profile-breed').textContent(),'狗狗 · 二哈');
  await host.screenshot({path:'docs/QA/customize-dog-teammate.png'});
  assert.equal(await host.evaluate(()=>__shaderCompiles),compiles,'a teammate becoming a dog compiles no shaders');
  // Both browsers submit an unclaimed color before either UI can learn of the claim.
  const race=await Promise.all(pages.map(page=>page.evaluate(async()=>{try{await __wash.connection.customize({animal:'cat',breed:'grey',color:7});return 'ok';}catch(e){return e.message;}})));
  assert.equal(race.filter(value=>value==='ok').length,1);assert.ok(race.some(value=>value.includes('队友')));
  const room=await host.evaluate(()=>__wash.connection.room.members);assert.equal(new Set(room.map(member=>member.appearance.color)).size,2);
  await guest.reload();await guest.waitForSelector('body.scene-ready');await guest.waitForFunction(()=>__wash.connection.guest?.open);
  await Promise.all(pages.map(page=>page.waitForFunction(()=>__wash.connection.room.members.length===2)));
  assert.deepEqual(await guest.evaluate(()=>__wash.connection.room.members.map(m=>m.appearance)),await host.evaluate(()=>__wash.connection.room.members.map(m=>m.appearance)));
  await host.locator('#settings').click();await host.locator('#setting-motion').uncheck();await host.locator('#dialog-close').click();
  await host.locator('#customize-player').click();
  assert.equal(await host.locator('#room-panel').evaluate(node=>getComputedStyle(node).animationName),'none','room ticket also follows quiet UI setting');
  assert.equal(await host.locator('#customize-dialog').evaluate(node=>getComputedStyle(node).animationName),'none','quiet UI setting disables Customize entry motion');
  assert.equal(await host.locator('#customize-dialog').evaluate(node=>getComputedStyle(node,'::backdrop').animationName),'none','backdrop follows the same setting');
  await host.locator('.customize-cancel').click();await host.waitForSelector('#customize-dialog',{state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS Customize: home hierarchy/layout, 16 colors/cat+dog with 4 breeds each, dog passive on the host authority, draft-only 3D preview, cancel, confirmed peer appearance, occupied colors, atomic race, recovery, zero shader compilation on open/switch/confirm');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
