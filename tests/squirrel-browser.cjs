const assert=require('node:assert/strict');
const {chromium}=require('playwright');
require('./helpers/browser-locale.cjs');
const url=new URL(process.env.WASH_TEST_URL||'http://127.0.0.1:8080/');url.searchParams.set('wash-test','1');
// Two pages in one room: the guest becomes a squirrel; the host authority drops it beside the home vehicle's flank,
// both pages show the cling (pose, grip bar, haze), then the guest kicks off the wall with Space.
const closeUp=async(page,file)=>{const c=await page.evaluate(()=>{const p=__wash.players[1].root.position.clone();p.y+=0.5;p.project(__wash.camera);return {x:(p.x+1)/2*innerWidth,y:(1-p.y)/2*innerHeight};});
 await page.screenshot({path:file,clip:{x:Math.max(0,c.x-210),y:Math.max(0,c.y-170),width:420,height:320}});};
// Feet 2.4 m above the hull underside, half a metre outside the left flank, falling.
const dropBesideFlank=(host)=>host.evaluate(()=>{const sim=__wash.connection.authority.sim,p=sim.players[1],t=sim.trucks[0],box=t.spec.walls[0];
 Object.assign(p,{state:'air',ground:null,wall:null,wallLock:0,wallTime:0,takeoff:t});
 p.pos.set(t.pos.x+(box.x0+box.x1)/2-1,t.pos.y+t.body.position.y+2.4,t.pos.z+box.z1+0.5);p.vel.set(t.vel.x,-2,t.vel.z);p.airBase.set(t.vel.x,t.vel.z);});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.WASH_BROWSER_CHANNEL||'chrome'}),errors=[],pages=[];
 try{
  for(let i=0;i<2;i++){
   const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:2}),page=await context.newPage();
   page.on('pageerror',e=>errors.push(e.message));pages.push(page);
  }
  await Promise.all(pages.map(async page=>{await page.goto(url.href);await page.waitForSelector('body.scene-ready');}));
  const [host,guest]=pages;
  if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
  await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());await guest.locator('#join-room').click();
  await guest.waitForFunction(()=>__wash.connection.guest?.open&&__wash.network.latest);
  await host.waitForFunction(()=>__wash.connection.room.members.length===2);
  await guest.locator('#customize-player').click();await guest.locator('.animal-choice[data-animal="squirrel"]').click();
  assert.equal(await guest.locator('.ability-type').textContent(),'被动');
  assert.equal(await guest.locator('.ability-action kbd').textContent(),'空格');
  assert.match(await guest.locator('.ability-description').textContent(),/移动速度提升25%/);
  assert.deepEqual(await guest.locator('.breed-choice:visible span').allTextContents(),['红松鼠','灰松鼠','花栗鼠','黑松鼠']);
  await guest.locator('.breed-choice[data-breed="red"]').click();
  await guest.waitForTimeout(800); // let the pressed-state color transition settle
  await guest.screenshot({path:'docs/QA/customize-squirrel.png'});
  await guest.locator('.customize-confirm').click();await guest.waitForSelector('#customize-dialog',{state:'hidden'});
  await host.waitForFunction(()=>__wash.connection.authority.sim.players[1].animal==='squirrel');
  assert.equal(await host.evaluate(()=>__wash.connection.authority.sim.players[1].speedScale),1.25);
  await guest.waitForFunction(()=>__wash.players[1].body===__wash.players[1].squirrel);
  await guest.waitForTimeout(1500);
  await dropBesideFlank(host);
  await host.waitForFunction(()=>!!__wash.connection.authority.sim.players[1].wall);
  await Promise.all(pages.map(page=>page.waitForFunction(()=>!!__wash.players[1].wall&&__wash.players[1].animator.blend.wall>0.8)));
  // Let it slide a while: the grip bar drains on both pages and the haze thickens.
  await guest.waitForTimeout(900);
  for (const page of pages) {
   const grip=page.locator('.trunk-tank.player-2.grip');
   assert.equal(await grip.isVisible(),true,'grip bar over the clinging squirrel');
   assert.ok(Number(await grip.getAttribute('aria-valuenow'))<90);
  }
  assert.ok(await guest.evaluate(()=>__wash.players[1].footRing.visible)===false,'no foot ring while hanging on a wall');
  await closeUp(guest,'docs/QA/squirrel-cling.png');await closeUp(host,'docs/QA/squirrel-cling-host.png');
  // Space on the wall: a kick off, on the authority and on both pages.
  await guest.bringToFront();await guest.keyboard.down('Space');await guest.waitForTimeout(90);await guest.keyboard.up('Space');
  await host.waitForFunction(()=>{const p=__wash.connection.authority.sim.players[1];return !p.wall&&p.vel.y>1;});
  await guest.waitForTimeout(120);await closeUp(guest,'docs/QA/squirrel-wall-jump.png');
  await host.waitForFunction(()=>['ground','fallen'].includes(__wash.connection.authority.sim.players[1].state)||!!__wash.connection.authority.sim.players[1].wall,null,{timeout:6000});
  assert.deepEqual(errors,[]);
  console.log('PASS squirrel customize, authoritative cling seen by host and guest, grip bar, wall jump');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
