/** Read-only analysis of the implemented party baselines. Run: node scripts/analyze-party-balance.mjs
 * No gameplay files are mutated.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { getLevel } from '../shared/levels.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { STAIN_KINDS } from '../shared/sim/StainDefinitions.js';

const targets=[.90,1.25,1.70,2.15],patience=[1,.8,.72,.66],stains=[1,1.25,1.4,1.5],score=[1,.9,.85,.83];
const a={carLogistics:6,wideExtra:3,stainTravel:2,extraTool:3};
const kinds=['dust','mud','grease'];
const base=[2,3,4,5].map(n=>{
 const level=getLevel(`highway-0${n}`),orders=level.script.orders.map(o=>({id:o.id,type:o.type,at:o.at,side:o.side,behavior:o.behavior,kinds:o.stains.map(s=>s.kind)}));
 return {level:level.number,duration:level.clock.duration,patienceBase:level.script.orders[0].patience.multiplier,thresholds:level.rating.thresholds,orders,target:targets[n-2]};
});
function roundedMix(total,weights){
 const sum=weights.reduce((a,b)=>a+b,0),q=weights.map(w=>total*w/sum),c=q.map(Math.floor),remaining=total-c.reduce((a,b)=>a+b,0);
 const order=q.map((n,i)=>({i,f:n-c[i]})).sort((a,b)=>b.f-a.f||a.i-b.i);for(let k=0;k<remaining;k++)c[order[k].i]++;
 return c;
}
function count(orders){return kinds.map(k=>orders.reduce((n,o)=>n+o.kinds.filter(x=>x===k).length,0));}
function fixed(orders){return orders.reduce((n,o)=>n+a.carLogistics+(o.behavior==='wideCruise'?a.wideExtra:0)+(new Set(o.kinds.flatMap(k=>STAIN_KINDS[k])).size-1)*a.extraTool,0);}
function totals(c,f,duration){
 const pieces=c.reduce((a,b)=>a+b,0),water=c[1]+c[2],soap=c[2],steps=pieces+water+soap;
 const pure=pieces*C.wipeSeconds+water*C.spraySeconds+soap*C.soapSeconds,wash=Math.max(0,pieces-6)*C.washSeconds/C.towelDurability;
 const labor=f+pure+pieces*a.stainTravel+wash;return{pieces,water,soap,steps,pure,wash,fixed:f,labor,soloLoad:labor/duration};
}
const points=(n,party,charge=1)=>Math.round((C.completionPoints+C.comboTip*Math.min(n,C.maximumMultiplier))*score[party-1]*charge);
const curve=(party,charge=1)=>Array.from({length:20},(_,i)=>points(i+1,party,charge)).map((_,i,arr)=>arr.slice(0,i+1).reduce((a,b)=>a+b,0));
const minimum=(thresholds,party,charge=1)=>thresholds.map(t=>curve(party,charge).findIndex(p=>p>=t)+1);
const rows=base.flatMap((b,i)=>{
 const mix=count(b.orders),f=fixed(b.orders),single=totals(mix,f,b.duration);
 assert.ok(Math.abs(single.soloLoad-b.target)<=.10);
 return [1,2,3,4].map(crew=>{
  const c=roundedMix(Math.round(single.pieces*stains[crew-1]),mix),t=totals(c,f,b.duration);
  return {level:b.level,duration:b.duration,crew,baseMix:mix,mix:c,target:b.target,baselineLoad:single.soloLoad,
   stainMultiplier:stains[crew-1],patienceMultiplier:patience[crew-1],scoreMultiplier:score[crew-1],
   finalPatienceCoefficient:b.patienceBase*patience[crew-1],averagePatienceRatio:t.steps/single.steps*patience[crew-1],
   ...t,perPlayerLoad:t.labor/b.duration/crew,cars:b.orders.length,maxFourCapacity:b.orders.length*4,
   excessBeyondFour:Math.max(0,t.pieces-b.orders.length*4),minimumUncharged:minimum(b.thresholds,crew),
   maxFiveCapacity:b.orders.length*5,excessBeyondFive:Math.max(0,t.pieces-b.orders.length*5),
   minimumFullyCharged:i>=2?minimum(b.thresholds,crew,1.5):null,
   firstReward:points(1,crew),fourCarScore:curve(crew)[3],fiveCarScore:curve(crew)[4],sixCarScore:curve(crew)[5],
   perfectScore:curve(crew)[b.orders.length-1],thresholds:b.thresholds,
  };
 });
});
const theoretical=targets.map((load,i)=>({level:String(i+2).padStart(2,'0'),loadByCrew:stains.map((s,j)=>load*s/(j+1))}));
const sequences=[1,2,3,4].map(crew=>({crew,rewards:Array.from({length:6},(_,i)=>points(i+1,crew)),cumulative:curve(crew).slice(0,6),charged:curve(crew,1.5).slice(0,6)}));
const data={asOf:'2026-10-15',status:'implemented_baselines',assumptions:a,targets,party:{patience,stains,score},base,rows,theoretical,sequences,
 constants:{wipe:C.wipeSeconds,water:C.spraySeconds,soap:C.soapSeconds,wash:C.washSeconds,towelDurability:C.towelDurability,towels:3,completion:C.completionPoints,comboTip:C.comboTip,comboCap:C.maximumMultiplier,chargeMultiplier:1.5}};
assert.deepEqual(rows.filter(r=>r.crew===1).map(r=>r.pieces),[15,15,21,41]);
assert.deepEqual(rows.filter(r=>r.level==='05').map(r=>r.pieces),[41,51,57,62]);
assert.equal(rows.find(r=>r.level==='03'&&r.crew===2).minimumUncharged[2],5);
const out=new URL('../docs/analysis/party-balance-2026-10-15/',import.meta.url);await fs.mkdir(out,{recursive:true});await fs.writeFile(new URL('data.json',out),JSON.stringify(data,null,2));
console.table(rows.map(r=>({level:r.level,crew:r.crew,pieces:r.pieces,steps:r.steps,load:`${(100*r.perPlayerLoad).toFixed(1)}%`,patience:`${(100*r.averagePatienceRatio).toFixed(1)}%`,minCars:r.minimumUncharged.join('/'),capacityExcess:r.excessBeyondFour})));
console.log('PASS 16 counterfactual workload / patience / score combinations; no gameplay edits.');
