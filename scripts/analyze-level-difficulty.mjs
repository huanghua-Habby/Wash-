/** Read-only balancing study. Run: npx tsx scripts/analyze-level-difficulty.mjs
 * Uses production fleet/patience/score rules; task durations below approximate human logistics.
 * Does not drive characters and must not be interpreted as a playtest or gameplay implementation.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getLevel } from '../shared/levels.js';
import { Simulation } from '../shared/sim/RoomSimulation.ts';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { STAIN_KINDS } from '../shared/sim/StainDefinitions.js';
import { VEHICLE_BEHAVIORS } from '../shared/sim/VehicleBehaviors.js';
import { CHARGING } from '../shared/sim/chargingConfig.js';

const out = new URL('../docs/analysis/level-difficulty-live/', import.meta.url);
await fs.mkdir(out, { recursive: true });
export const assumptions = { carLogistics: 6, wideExtra: 3, stainTravel: 2, extraTool: 3 };
const levels = [2,3,4,5].map(n => getLevel(`highway-0${n}`));
const num = n => +n.toFixed(3);
const reward = (i, multiplier = 1) => Math.round((C.completionPoints + C.comboTip * Math.min(i, C.maximumMultiplier)) * multiplier);
const cumulative = (n, multiplier = 1) => Array.from({length:n},(_,i)=>reward(i+1,multiplier)).reduce((a,b)=>a+b,0);
const minimumCars = (score, multiplier=1) => { let n=0; while(cumulative(n,multiplier)<score)n++;return n; };
function counts(o) {
  const count = {dust:0,mud:0,grease:0}; o.stains.forEach(s=>count[s.kind]++);
  const towel = o.stains.length, water = count.mud + count.grease, soap = count.grease;
  const steps = towel+water+soap, pure = towel*C.wipeSeconds+water*C.spraySeconds+soap*C.soapSeconds;
  const logistics=assumptions.carLogistics+(o.behavior==='wideCruise'?assumptions.wideExtra:0);
  const travel=towel*assumptions.stainTravel, switches=((water>0)+(soap>0))*assumptions.extraTool;
  return {...count,towel,water,soap,steps,pure,logistics,travel,switches,labor:pure+logistics+travel+switches,patience:10*steps*o.patience.multiplier};
}
const orders = levels.flatMap(l=>l.script.orders.map(o=>({level:l.number,id:o.id,type:o.type,at:o.at,side:o.side,behavior:o.behavior,multiplier:o.patience.multiplier,...counts(o)})));
const summary = levels.map(l=>{
  const rows=orders.filter(o=>o.level===l.number), total=key=>rows.reduce((sum,o)=>sum+o[key],0);
  const towelWashing=Math.max(0,total('towel')-l.equipment.towels.positions.length*C.towelDurability)*C.washSeconds/C.towelDurability;
  const labor=total('labor')+towelWashing, duration=l.clock.duration;
  return {id:l.id,level:l.number,name:l.name,duration,cars:rows.length,dust:total('dust'),mud:total('mud'),grease:total('grease'),
    towel:total('towel'),water:total('water'),soap:total('soap'),steps:total('steps'),pure:num(total('pure')),towelWashing:num(towelWashing),labor:num(labor),
    laborPerMinute:num(labor*60/duration),crewLoad:[1,2,3].map(n=>num(labor/duration/n)),
    thresholds:l.rating.thresholds,minCarsNoMiss:l.rating.thresholds.map(s=>minimumCars(s)),
    minCarsFullCharge:l.rating.thresholds.map(s=>minimumCars(s,1.5)),
    perfectUnchargedScore:cumulative(rows.length),perfectFullyBuffedScore:cumulative(rows.length,1.5),
    firstGap:l.script.orders[1].at-l.script.orders[0].at,
    patienceRange:[Math.min(...rows.map(o=>o.patience)),Math.max(...rows.map(o=>o.patience))],
    gunSeconds:total('water')*C.spraySeconds,soapShare:total('grease')/total('towel'),
  };
});

/** Precedence-constrained task model using production arrivals, side queues, exits and scoring.
 * FCFS order priority, non-preemptive tasks; 1 shared gun and 3 towels, no special animal abilities.
 * Logistics charged once/order (optimistic handoffs). Wipes include proportional towel replenishment.
 * All soap is applied before this order's batched water pass; plain dust can be wiped meanwhile.
 */
function schedule(level, crew, factor) {
  const sim=new Simulation(level),g=sim.game;for(let i=0;i<crew;i++)sim.occupy(i,true);g.start(level.home.motion.speed,false);g.roundStage='playing';
  const dt=1/60,tasks=[],plans=new Map(),workers=Array(crew).fill(null),records=[];
  const patches=level.script.orders.reduce((n,o)=>n+g.levelScript.definition(o.id).stains.length,0);
  const washPerStain=Math.max(0,patches-6)*C.washSeconds/C.towelDurability/patches;
  const add=(plan,key,duration,deps=[],resource=null)=>{
    const task={plan,key,left:duration,state:'queued',deps,resource};tasks.push(task);return task;
  };
  try {
    for(let tick=0;tick<level.clock.duration/dt;tick++) {
      g.elapsed=tick*dt;g.remaining=level.clock.duration-g.elapsed;g.updateFleet(dt);
      for(const o of [...g.orders]) if(o.mode==='leaving'&&o.truck.pos.x-g.homeX>38)g.reclaimOrder(o);
      for(const task of tasks)if(task.plan.order.mode!=='working'&&!['done','cancelled'].includes(task.state))task.state='cancelled';
      for(const order of g.orders)if(order.arrivalProgress===1&&order.mode==='working'&&!plans.has(order.serial)) {
        const c=counts(order.definition),plan={order,at:g.elapsed,done:false};plans.set(order.serial,plan);
        const access=add(plan,'access',c.logistics*factor);
        const soap=c.soap?add(plan,'soap',c.soap*C.soapSeconds+assumptions.extraTool*factor,[access]):null;
        const water=c.water?add(plan,'water',c.water*C.spraySeconds+assumptions.extraTool*factor,[access,...(soap?[soap]:[])],'gun'):null;
        plan.wipes=order.stains.map((s,i)=>add(plan,`wipe${i}`,C.wipeSeconds+assumptions.stainTravel*factor+washPerStain,[access,...(s.kind!=='dust'?[water]:[])],'towel'));
        records.push({id:order.id,requested:order.definition.at,docked:num(g.elapsed),patience:order.initialPatience});
      }
      for(let w=0;w<crew;w++) {
        const task=workers[w];if(!task)continue;
        if(task.state==='cancelled'){workers[w]=null;continue;}
        task.left-=dt;
        if(task.left<=1e-8){task.state='done';workers[w]=null;}
      }
      for(const plan of plans.values())if(!plan.done&&plan.order.mode==='working'&&plan.wipes.every(t=>t.state==='done')) {
        const o=plan.order;for(const s of o.stains){s.done=true;s.stage=s.steps.length;s.progress=0;}
        const before=g.score;g.completeOrder(o);plan.done=true;
        Object.assign(records.find(r=>r.id===o.id),{completed:num(g.elapsed),points:g.score-before,score:g.score});
      }
      for(let w=0;w<crew;w++)if(!workers[w]) {
        const busy=tasks.filter(t=>t.state==='working');
        const candidates=tasks.filter(t=>t.state==='queued'&&t.plan.order.mode==='working'&&t.deps.every(d=>d.state==='done')&&
          (t.resource!=='gun'||!busy.some(b=>b.resource==='gun'))&&
          (t.resource!=='towel'||busy.filter(b=>b.resource==='towel').length<level.equipment.towels.positions.length));
        candidates.sort((a,b)=>a.plan.at-b.plan.at||tasks.indexOf(a)-tasks.indexOf(b));
        if(candidates[0]){candidates[0].state='working';workers[w]=candidates[0];}
      }
    }
    return {level:level.number,crew,logisticsFactor:factor,completed:g.completed,missed:g.missed,
      pending:level.script.orders.length-plans.size,unfinished:g.orders.filter(o=>o.mode==='working'&&!o.paid).length,
      score:g.score,stars:level.rating.thresholds.filter(t=>g.score>=t).length,records};
  } finally {sim.dispose();}
}
const simulations=levels.flatMap(l=>[1,2,3,4].flatMap(n=>[.75,1,1.25].map(f=>schedule(l,n,f))));
const scoreCurve=Array.from({length:14},(_,i)=>({cars:i+1,last:reward(i+1),score:cumulative(i+1),lastBuffed:reward(i+1,1.5),buffedScore:cumulative(i+1,1.5),noComboScore:(i+1)*reward(1)}));
const sources=['shared/levels/highway02.js','shared/levels/highway03.js','shared/levels/highway04.js','shared/levels/highway05.js','shared/levels/authoring.js','shared/sim/washConfig.js','shared/sim/Orders.js','shared/sim/VehicleBehaviors.js','shared/sim/LevelScript.js','shared/sim/ChargingRewards.js'];
const hashes=await Promise.all(sources.map(async path=>({path,sha256:crypto.createHash('sha256').update(await fs.readFile(new URL(`../${path}`,import.meta.url))).digest('hex')})));
const data={asOf:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),assumptions,constants:{wipe:C.wipeSeconds,water:C.spraySeconds,soap:C.soapSeconds,wash:C.washSeconds,towelDurability:C.towelDurability,towels:3,chargingSeconds:CHARGING.seconds,completion:C.completionPoints,comboTip:C.comboTip,comboCap:C.maximumMultiplier},summary,orders,scoreCurve,simulations,sources:hashes};
assert.deepEqual(summary.map(s=>s.steps),[20,27,37,69]);assert.equal(cumulative(4),130);assert.equal(cumulative(1,1.5),38);
for(const s of simulations)assert.equal(s.score,s.records.reduce((n,r)=>n+(r.points||0),0));
await fs.writeFile(new URL('data.json',out),JSON.stringify(data,null,2));
const csv=(rows)=>rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
await fs.writeFile(new URL('orders.csv',out),'\uFEFF'+csv([Object.keys(orders[0]),...orders.map(Object.values)]));
console.log(JSON.stringify({summary,simulations:simulations.map(({records,...r})=>r)},null,2));
