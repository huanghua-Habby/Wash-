/** Snapshot traffic budget (MULTIPLAYER.md 流量): an 8-player versus (1 human + 7 bots) for 60 s, deltas at 30 Hz with
 * ~100 ms acknowledgement lag, sizes before (raw JSON) and after (per-guest wire view + deflate-raw, as PeerLink sends).
 * Run: npx tsx scripts/measure-snapshot-traffic.ts */
import { getLevel } from '../shared/levels.js';
import { Simulation } from '../tests/fixtures/Simulation.js';
import { enterPlaying } from '../tests/helpers/guide.js';
import { quantize, SnapshotEncoder } from '../shared/delta.js';
import { guestView } from '../shared/wire.js';
const deflate = async (text: string) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).length;
const sim: any = new Simulation(getLevel('versus-01') as any);
sim.game.matchSettings = { scoreTarget: null, timeLimit: null };
sim.occupy(0, true); sim.setTeam(0, 0);
sim.placeBots([1, 2, 3].map(slot => ({ slot, team: 0 })).concat([4, 5, 6, 7].map(slot => ({ slot, team: 1 }))));
sim.command('start'); enterPlaying(sim);
const before = new SnapshotEncoder(), after = new SnapshotEncoder(); const pb: number[] = [], pa: number[] = [];
const raw: number[] = [], wire: number[] = []; let keyRaw = 0, keyWire = 0;
for (let i = 0; i < 60 * 60; i++) {
  sim.tick(); if (i % 2) continue;
  const state = quantize(sim.snapshot());
  const fb: any = before.encode(state, 's'), fa: any = after.encode(guestView(state, 3), 's');
  pb.push(state.tick); pa.push(state.tick); if (pb.length > 3) { before.ack(pb.shift()!); after.ack(pa.shift()!); }
  if (i === 0) { keyRaw = JSON.stringify(fb).length; keyWire = await deflate(JSON.stringify(fa)); }
  if (i > 600 && fb.delta && fa.delta) { raw.push(JSON.stringify(fb).length); wire.push(await deflate(JSON.stringify(fa))); }
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length, p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * .95)], mx = (a: number[]) => Math.max(...a);
console.log(`before: delta avg ${avg(raw).toFixed(0)} B, p95 ${p95(raw)}, max ${mx(raw)}, ${(avg(raw) * 30 * 8 / 1000).toFixed(0)} kbps/guest, >1200B ${(100 * raw.filter(s => s > 1200).length / raw.length).toFixed(0)}%, keyframe ${(keyRaw / 1024).toFixed(1)} KB`);
console.log(`after:  delta avg ${avg(wire).toFixed(0)} B, p95 ${p95(wire)}, max ${mx(wire)}, ${(avg(wire) * 30 * 8 / 1000).toFixed(0)} kbps/guest, >1200B ${(100 * wire.filter(s => s > 1200).length / wire.length).toFixed(1)}%, keyframe ${(keyWire / 1024).toFixed(1)} KB (reliable channel)`);
console.log(`8 players: host upload ${(avg(raw) * 30 * 8 * 7 / 1e6).toFixed(1)} → ${(avg(wire) * 30 * 8 * 7 / 1e6).toFixed(1)} Mbps`);
sim.dispose();
