/** Input prediction/reconciliation and remote interpolation over the authoritative room stream. */
import * as THREE from 'three';
import { ACTIONS, MAX_STRUGGLES, TICK_SECONDS, SNAPSHOT_SECONDS, packetInput } from '../../../shared/protocol.js';
import { isPreparing, isWorldFrozen } from '../../../shared/sim/roundFlow.js';
import { applyWorld, applyPlayer } from '../../../shared/snapshot.js';
import { InputTransmitter } from '../../../shared/InputTransmitter.js';
import { bodyHeight } from '../../../shared/sim/TruckState.js';
import { resolvePlayerContacts } from '../../../shared/sim/PlayerContacts.js';
/** Render clock: extrapolate through short snapshot gaps, ease toward the authority, and snap only on a real discontinuity. */
const PRESENT_EXTRAPOLATION_SECONDS = 0.25, PRESENT_SNAP_SECONDS = 0.25, PRESENT_CORRECTION_RATE = 8;
/** Remote entities are drawn from a tick-keyed buffer, `delay` ticks behind the newest expected snapshot.
 *  The delay covers one periodic interval plus the observed arrival jitter, so a late snapshot is absorbed instead of freezing motion. */
const SNAPSHOT_TICKS = Math.round(SNAPSHOT_SECONDS / TICK_SECONDS), BUFFER_LENGTH = 32, ARRIVAL_WINDOW_MS = 2000;
const MIN_DELAY_TICKS = SNAPSHOT_TICKS, MAX_DELAY_TICKS = 12, RENDER_SNAP_TICKS = 15, RENDER_CORRECTION_RATE = 4;
const TICK_MS = TICK_SECONDS * 1000;
export class NetworkGame {
  constructor({ connection,players,trucks,game,input,camera,onPhase,onLevelChange = null,onSnapshot = null,onHomeWaiting = null }) {
    Object.assign(this,{ connection,players,trucks,game,input,camera,onPhase,onLevelChange,onSnapshot,onHomeWaiting });
    this.pending = []; this.seq = 0; this.accumulator = 0; this.latest = null; this.previous = null; this.received = 0; this.hits = new Set(); this.struggles = 0;
    this.visualError = new THREE.Vector3(); this.phase = 'home';
    // Prediction runs on authority-timed platforms; the drawn player is then glued to the interpolated truck it stands on.
    this.ackBase = 0; this.platformShift = new THREE.Vector3(); this.platformTruck = null; this.saved = [];
    // The local player's position before the latest prediction tick: drawn between the two by the leftover accumulator,
    // so 60 Hz ticks never step against the render rate (0/2 ticks per frame read as jitter, worst mid-air).
    this.tickFrom = null; this._drawn = new THREE.Vector3(); this._offset = new THREE.Vector3();
    this.transmitter=new InputTransmitter();this.inputTime=0;
    this.renderTime=0; this.renderScroll=0; this.clockReset=true;
    this.sentAt=new Map(); this.window={ start:performance.now(),count:0,gap:0,correction:0,ack:[] };
    this.stats={ snapshotHz:0,gapMaxMs:0,bytes:0,ackMs:0,correctionCm:0,clockErrorMs:0,delayMs:0,rttMs:0 };
    this.buffer=[]; this.arrivals=[]; this.renderTick=0; this.renderReset=true; this.delayTicks=MIN_DELAY_TICKS+1;
    connection.addEventListener('room',(event) => {
      const room = event.detail;
      const changedRoom = this.code !== room.code;
      const waiting = !connection.isHost && room.homeWaiting?.includes(room.playerId);
      if (waiting) this.onHomeWaiting?.();
      if (changedRoom || this.epoch !== room.epoch) {
        this.pending=[]; this.seq=0; this.visualError.set(0,0,0);
        if (!this.homeHold || changedRoom) this.latest=this.previous=null;
        if (this.homeHold) { this.pendingHome = null; this.homeReady = new Promise(resolve => { this.resolveHome = resolve; }); }
        this.accumulator=0; this.tickFrom=null; this.hits.clear();this.transmitter.reset();this.inputTime=0;this.sentAt.clear();this.clockReset=true;this.ackBase=0;this.platformShift.set(0,0,0);this.platformTruck=null;this.resetBuffer();
      }
      this.code=room.code; this.epoch=room.epoch;
      // The roster's versus team drives the team look (hat and foot ring); co-op characters have no team.
      players.forEach((player,i) => { if (room.members.some((m) => m.slot===i) || !player.isBot) this.presentMember(player, i, room); });
      game.localSlot = room.slot;
      if (changedRoom && this.homeHold && !waiting) this.onPhase('home');
    });
    connection.addEventListener('snapshot',(event) => this.receive(event.detail));
    connection.addEventListener('disconnect',() => { this.pending=[]; this.hits.clear(); input.clear();this.transmitter.reset(); });
  }

  /** Foreground/background handoff resets local prediction, not the host world. */
  backgroundModeChanged(hidden) {
    this.accumulator = 0; this.pending = []; this.hits.clear(); this.input.clear(); this.transmitter.reset();
    this.clockReset = true; this.renderReset = true;
    if (hidden && this.connection.playing) this.connection.send('input', { seq: ++this.seq, axis: [0, 0], move: [0, 0], down: [], hits: [] });
  }

  bindBackgroundClock(clock) { this.backgroundClock = clock; }

  /** Bot name, look and team from the snapshot; clears the bot look when the slot is no longer a bot. */
  /** A registry member's name, link state, versus team and look on its slot. */
  presentMember(player, slot, room) {
    const member = room?.members?.find((m) => m.slot === slot);
    player.connected = !!member?.connected; player.displayName = member?.name || '';
    player.team = room?.gameMode === 'versus' && (member?.team === 0 || member?.team === 1) ? member.team : null;
    if (member) player.setAppearance?.(member.appearance);
  }

  /** Bot-run slots from the snapshot: seat fill (`AI n`) or a stand-in that keeps the dropped player's name and look. */
  presentBot(player, bot, slot) {
    if (!bot) {
      // A handed-back stand-in shows its registry member again; an emptied fill seat shows nobody.
      if (player.isBot) { player.isBot = player.standIn = false; player.botKey = ''; this.presentMember(player, slot, this.connection.room); }
      return;
    }
    const key = `${bot.name}|${bot.team}|${bot.appearance.animal}|${bot.appearance.breed}|${bot.appearance.color}`;
    player.isBot = true; player.standIn = !!bot.standIn; player.connected = true; player.displayName = bot.name; player.team = bot.team;
    if (player.botKey !== key) { player.botKey = key; player.setAppearance?.(bot.appearance); }
  }

  /** Restore the matching acknowledged state, then replay only unacknowledged local movement. */
  receive(data) {
    const room=this.connection.room;
    if (!room) return;
    // Preserve the complete outgoing scene until this viewer's mask is fully black.
    if (!this.homeHold && data.phase === 'home' && this.phase !== 'home') this.onPhase('home');
    if (this.homeHold) {
      if (data.phase === 'home') { this.pendingHome = data; this.resolveHome?.(); }
      return;
    }
    if (this.levelHold) { this.pendingLevel = data; return; }
    if (room.levelId && room.levelId !== this.game.level.id) {
      this.levelHold = true; this.pendingLevel = data; this.input.clear();
      return this.onLevelChange(room.levelId, () => {
        const pending = this.pendingLevel;
        this.pendingLevel = null; this.levelHold = false;
        this.latest = this.previous = null; this.clockReset = true; this.resetBuffer();
        this.receive(pending);
      });
    }
    const phaseChanged = this.phase !== data.phase;
    if (phaseChanged) { this.phase=data.phase; this.onPhase(data.phase); this.pending=[]; this.visualError.set(0,0,0); this.platformShift.set(0,0,0); this.platformTruck=null; this.clockReset=true; this.resetBuffer(); }
    const now=performance.now(), applied=!!this.latest;
    if (applied) this.window.gap=Math.max(this.window.gap,now-this.received);
    this.window.count++; this.stats.bytes=this.connection.lastSnapshotBytes || 0;
    this.previous=this.latest; this.latest=data; this.received=now;
    this.buffered(data,now);
    const local=this.players[room.slot], oldPosition=local.pos.clone(), wasOccupied=local.occupied;
    applyWorld(this,data);
    if (this.roundStage !== this.game.roundStage) {
      this.roundStage = this.game.roundStage;
      this.input.clear(); this.hits.clear(); this.pending = []; this.transmitter.reset();
    }
    data.players.forEach((state,i) => {
      // Host-run bots have no registry member: the snapshot names their slots, and every page shows the same look.
      const bot = data.game?.bots?.find(entry => entry.slot === i);
      this.presentBot(this.players[i], bot, i);
      const occupied = (room.members ? room.members.some(member => member.slot === i) : state.occupied !== false) || !!bot;
      applyPlayer(this.players[i],state,this.trucks);
      this.players[i].occupied = state.occupied !== false && state.sceneReady !== false && occupied;
      if (!this.players[i].occupied) this.players[i].root.visible = false;
    });
    // Characters prepared beyond this world's slots (a co-op world in an eight-actor client) are absent.
    for (let i = data.players.length; i < this.players.length; i++) { this.players[i].occupied = false; this.players[i].root.visible = false; }
    this.onSnapshot?.(data);
    this.seq=Math.max(this.seq,data.players[room.slot].ack);
    const state=data.players[room.slot];
    if (this.sentAt.has(state.ack)) this.window.ack.push(now-this.sentAt.get(state.ack));
    for (const seq of this.sentAt.keys()) if (seq<=state.ack) this.sentAt.delete(seq);
    const acknowledged=state.ackTick;
    this.pending=this.pending.filter((packet) => packet.seq > acknowledged); this.ackBase=acknowledged;
    if (!wasOccupied && local.occupied) {
      this.pending=[]; this.visualError.set(0,0,0); this.platformShift.set(0,0,0); this.platformTruck=null;
      oldPosition.copy(local.pos);
    }
    if (local.occupied && !this.connection.guest?.homePending && !this.connection.guest?.rejoinPending && data.phase!=='transition' && !isPreparing(data.game) && !data.game.paused && !data.game.ended) {
      local.suppressEvents = true;
      try { for (const packet of this.pending) this.predictTick(local,packet,data.time); }
      finally { local.suppressEvents = false; }
    }
    // Prediction error only; the visual offset accumulates so a correction is eased out instead of snapped.
    const correction=oldPosition.distanceTo(local.pos);
    if (!phaseChanged && applied) this.window.correction=Math.max(this.window.correction,correction);
    // The previous tick moves with the correction; the eased visual error alone carries the difference.
    if (!phaseChanged && applied && correction<2) { this.tickFrom?.add(local.pos).sub(oldPosition); this.visualError.add(oldPosition.sub(local.pos)); }
    else { this.visualError.set(0,0,0); this.tickFrom=null; }
  }

  holdHomePresentation() {
    if (this.homeHold) return;
    this.homeHold = true; this.pendingHome = null;
    this.homeReady = new Promise((resolve) => { this.resolveHome = resolve; });
    this.pending = []; this.hits.clear(); this.input.clear();
    this.game.paused = true;
  }

  /** Called only under a fully opaque mask, after the home resources are ready. */
  async commitHomePresentation() {
    while (!this.pendingHome) await this.homeReady;
    const data = this.pendingHome;
    this.homeHold = false; this.resolveHome = null; this.pendingHome = null;
    this.latest = this.previous = null; this.visualError.set(0, 0, 0); this.clockReset = true; this.resetBuffer();
    await this.receive(data);
  }

  activeTrucks() { return this.latest?.game.active ? this.game.activeTrucks() : this.trucks.slice(0,2); }

  /** Where the authority will have truck i on the k-th tick after the latest snapshot: constant velocity, shared body bob. */
  platformAt(truck,k,out,vel) {
    const i=this.trucks.indexOf(truck), state=this.latest.trucks[i], older=this.previous?.trucks[i];
    const span=this.previous ? this.latest.time-this.previous.time : 0, t=k*TICK_SECONDS;
    const accel=(axis) => span>0 && older?.visible && state.visible && older.generation === state.generation ? (state.vel[axis]-older.vel[axis])/span : 0;
    out.set(state.pos[0]+state.vel[0]*t+0.5*accel(0)*t*t,
      state.pos[1]+state.vel[1]*t+0.5*accel(1)*t*t,state.pos[2]+state.vel[2]*t+0.5*accel(2)*t*t);
    vel?.set(state.vel[0]+accel(0)*t,state.vel[1]+accel(1)*t,state.vel[2]+accel(2)*t);
    return bodyHeight(this.latest.time+t,truck.phase);
  }

  /** Run one local tick on authority-timed platforms, then restore the interpolated transforms the renderer owns. */
  predictTick(local,packet,time) {
    const trucks=this.activeTrucks(), k=packet.seq-this.ackBase;
    trucks.forEach((truck,i) => {
      const saved=this.saved[i] || (this.saved[i]={ pos:new THREE.Vector3(),vel:new THREE.Vector3(),bob:0 });
      saved.pos.copy(truck.pos); saved.vel.copy(truck.vel); saved.bob=truck.body.position.y;
      truck.body.position.y=this.platformAt(truck,k,truck.pos,truck.vel);
    });
    // Prediction uses the shared wait/drift rules; revival requires a host snapshot.
    try {
      // Contacts use the newest authority poses on the predicted platforms, never the delayed render positions.
      // Peers are scratch bodies: this browser can predict its own response but cannot move another player.
      const bodies = this.players.map((player, slot) => {
        if (player === local) return player;
        const state = this.latest.players[slot];
        if (!state) return { pos:player.pos.clone(), occupied:false, sceneReady:false, state:'fallen' };
        const truck = this.trucks[state.parent];
        const pos = new THREE.Vector3().fromArray(state.pos);
        // Grounded peers stand on the roof, on a prop top or on a head (whose height the local offset already carries).
        if (truck && state.local) { pos.fromArray(state.local).add(truck.pos); if (state.state === 'ground' && !(state.stand >= 0)) pos.y = state.solid >= 0 && truck.solids?.[state.solid] ? truck.topYAt(truck.pos.x + truck.solids[state.solid].x, truck.pos.z + truck.solids[state.solid].z) + truck.solids[state.solid].height : truck.topYAt(pos.x, pos.z, 0.3); }
        return { pos, occupied:player.occupied, sceneReady:player.sceneReady, state:state.state, vel:new THREE.Vector3(),
          ground: state.state === 'ground' && truck ? { truck, plat:null, stand: state.stand ?? -1 } : null, takeoff: truck || null,
          animal:player.animal, heldTool:player.heldTool, swallowed:player.swallowed, swallowedBy:player.swallowedBy };
      });
      const previousPositions = bodies.map(body => body.pos.clone());
      local.update(TICK_SECONDS,time,packetInput(packet),trucks,this.camera,this.latest.base,{ allowRespawn: false });
      resolvePlayerContacts(bodies,previousPositions,TICK_SECONDS,local);
    }
    finally { trucks.forEach((truck,i) => { truck.pos.copy(this.saved[i].pos); truck.vel.copy(this.saved[i].vel); truck.body.position.y=this.saved[i].bob; }); }
  }

  /** Offset from the predicted platform to the drawn one, so the local player stays on the roof (or hull wall) the viewer sees. */
  platformOffset(player,out,ticksBack=0) {
    const truck=this.phase!=='transition' ? player.carrierTruck : null;
    if (!truck || this.trucks.indexOf(truck)<0) return out.set(0,0,0);
    const bob=this.platformAt(truck,this.seq-this.ackBase-ticksBack,out);
    out.negate().add(truck.pos);
    out.y += truck.body.position.y-bob;
    return out;
  }

  /** Advance the shared world clock and background scroll every frame; late snapshots no longer freeze them after 50 ms. */
  present(dt) {
    const latest=this.latest;
    if (!latest) return;
    const paused=isWorldFrozen(this.game) || this.connection?.guest?.homePending, ahead=paused ? 0 : Math.min(PRESENT_EXTRAPOLATION_SECONDS,(performance.now()-this.received)/1000);
    const time=latest.time+ahead, scroll=latest.scroll+latest.base*ahead;
    if (this.clockReset || paused || Math.abs(time-this.renderTime)>PRESENT_SNAP_SECONDS || Math.abs(scroll-this.renderScroll)>latest.base*PRESENT_SNAP_SECONDS) {
      this.renderTime=time; this.renderScroll=scroll; this.clockReset=false;
    } else {
      const k=1-Math.exp(-PRESENT_CORRECTION_RATE*dt);
      this.renderTime+=dt; this.renderScroll+=latest.base*dt;
      this.renderTime+=(time-this.renderTime)*k; this.renderScroll+=(scroll-this.renderScroll)*k;
    }
    this.publishStats(time);
  }

  resetBuffer() { this.buffer=[]; this.arrivals=[]; this.renderReset=true; }

  /** Keep the snapshot for interpolation and record how late it arrived relative to its server tick. */
  buffered(data,now) {
    if (this.buffer.length && data.tick<=this.buffer.at(-1).tick) {
      // A new authority (solo sim rebuilt) restarts its tick; an equal tick is a duplicate urgent/periodic pair.
      if (data.tick<this.buffer.at(-1).tick) this.resetBuffer(); else this.buffer.pop();
    }
    this.buffer.push(data); if (this.buffer.length>BUFFER_LENGTH) this.buffer.shift();
    this.arrivals.push({ at:now,offset:now-data.tick*TICK_MS });
    while (this.arrivals.length && now-this.arrivals[0].at>ARRIVAL_WINDOW_MS) this.arrivals.shift();
    const offsets=this.arrivals.map((a) => a.offset).sort((a,b) => a-b), fastest=offsets[0];
    const jitter=offsets[Math.min(offsets.length-1,Math.floor(offsets.length*0.95))]-fastest;
    this.fastestOffset=fastest;
    this.targetDelay=Math.min(MAX_DELAY_TICKS,Math.max(MIN_DELAY_TICKS,SNAPSHOT_TICKS+jitter/TICK_MS+0.5));
  }

  /** Advance the remote render tick smoothly toward (estimated newest server tick − delay); returns the two bracketing snapshots. */
  sample(dt) {
    if (this.game.roundStage === 'guide') return { a:this.latest, b:this.latest, alpha:1 };
    const buffer=this.buffer;
    if (!buffer.length) return { a:this.latest,b:this.latest,alpha:1 };
    this.delayTicks+=(this.targetDelay-this.delayTicks)*(1-Math.exp(-2*dt));
    const target=(performance.now()-this.fastestOffset)/TICK_MS-this.delayTicks;
    if (this.renderReset || Math.abs(target-this.renderTick)>RENDER_SNAP_TICKS) { this.renderTick=target; this.renderReset=false; }
    else { this.renderTick+=dt/TICK_SECONDS; this.renderTick+=(target-this.renderTick)*(1-Math.exp(-RENDER_CORRECTION_RATE*dt)); }
    this.stats.delayMs=Math.round(this.delayTicks*TICK_MS);
    const tick=this.renderTick, newest=buffer.at(-1);
    if (tick>=newest.tick) return { a:buffer.at(-2) || newest,b:newest,alpha:1 };
    if (tick<=buffer[0].tick) return { a:buffer[0],b:buffer[0],alpha:1 };
    let i=buffer.length-2; while (i>0 && buffer[i].tick>tick) i--;
    const a=buffer[i], b=buffer[i+1];
    return { a,b,alpha:(tick-a.tick)/(b.tick-a.tick) };
  }

  /** One-second network window for the debug panel: arrival rate, worst gap, input confirmation, local correction. */
  publishStats(authorityTime) {
    const now=performance.now(), w=this.window, elapsed=now-w.start;
    if (elapsed<1000) return;
    const acks=[...w.ack].sort((a,b) => a-b);
    Object.assign(this.stats,{ snapshotHz:Math.round(w.count*1000/elapsed),gapMaxMs:Math.round(w.gap),ackMs:Math.round(acks[acks.length>>1] || 0),
      correctionCm:Math.round(w.correction*100),clockErrorMs:Math.round((authorityTime-this.renderTime)*1000),rttMs:this.connection.guest?.rttMs ?? 0 });
    this.window={ start:now,count:0,gap:0,correction:0,ack:[] };
  }

  /** Sample world-space movement at 60 Hz, preserving short key presses between render frames. */
  step(dt,time) {
    if ((this.homeHold && !this.connection.isHost) || this.connection.guest?.homePending) return;
    // The hidden-tab clock owns advancement exclusively; a late render callback cannot tick twice.
    if (this.backgroundClock?.active && this.connection.isHost) return;
    if (this.levelHold) { if (this.connection.isHost) { this.accumulator = Math.min(this.accumulator + dt, 0.1); while (this.accumulator >= TICK_SECONDS) { this.accumulator -= TICK_SECONDS; this.connection.advanceLocal(); } } return; }
    if (!this.latest || !this.connection.playing) return;
    for (const key of ACTIONS) if (this.input.hit(key)) this.hits.add(key);
    // Struggle presses only matter while the authority shows this player in a pelican's pouch.
    const struggles=this.input.struggles?.() || 0;
    this.struggles=this.players[this.connection.room.slot]?.swallowedBy ? Math.min(MAX_STRUGGLES,(this.struggles || 0)+struggles) : 0;
    this.accumulator=Math.min(this.accumulator+dt,0.1);
    while (this.accumulator>=TICK_SECONDS) {
      this.accumulator-=TICK_SECONDS;
      const axis=this.input.axis(), forward=this.camera.getWorldDirection(new THREE.Vector3()); forward.y=0;forward.normalize();
      const move=new THREE.Vector3(-forward.z*axis.x-forward.x*axis.y,0,forward.x*axis.x-forward.z*axis.y); if (move.lengthSq()>1) move.normalize();
      const blocked=this.levelHold || this.homeHold || this.connection.guest?.rejoinPending || !this.players[this.connection.room.slot].occupied || this.phase==='transition' || isPreparing(this.game) || this.game.paused || this.game.ended;
      const packet={ seq:++this.seq,axis:blocked?[0,0]:[axis.x,axis.y],move:blocked?[0,0]:[move.x,move.z],down:blocked?[]:ACTIONS.filter((key) => this.input.down(key)),hits:blocked?[]:[...this.hits] };
      if (!blocked && this.struggles) packet.struggle=this.struggles;
      this.hits.clear(); this.struggles=0;
      this.inputTime+=TICK_SECONDS;
      if(this.transmitter.shouldSend(packet,this.inputTime)) {
        this.connection.send('input',{ ...packet,code:this.code,epoch:this.epoch });
        this.sentAt.set(packet.seq,performance.now()); if (this.sentAt.size>64) this.sentAt.delete(this.sentAt.keys().next().value);
      }
      // An unsent sample is held on the authority with the last sent direction; predict that, not the throttled camera turn.
      else packet.move=[...this.transmitter.previous.move];
      this.pending.push(packet); if (this.pending.length>120) this.pending.shift();
      const local=this.players[this.connection.room.slot];
      (this.tickFrom ||= new THREE.Vector3()).copy(local.pos);
      if (!blocked) this.predictTick(local,packet,time);
      if(this.connection.isHost)this.connection.advanceLocal();
    }
    const { a,b,alpha }=this.sample(dt), latest=this.latest, mix=(x,y) => x+(y-x)*alpha;
    const lerpArray=(target,from,to) => target.set(mix(from[0],to[0]),mix(from[1],to[1]),mix(from[2],to[2]));
    const sampleTime=mix(a.time,b.time);
    this.trucks.forEach((truck,i) => {
      const now=latest.trucks[i], older=a.trucks[i], newer=b.trucks[i];
      // Hidden transforms belong to a parked/reclaimed vehicle; a vehicle that just appeared starts at its authority spawn.
      if (now.visible) {
        if (older.visible && newer.visible && older.generation === now.generation && newer.generation === now.generation) lerpArray(truck.pos,older.pos,newer.pos);
        else truck.pos.fromArray(newer.visible ? newer.pos : now.pos);
      }
      truck.pose(sampleTime);
    });
    const tools=(snap) => [...snap.game.towels,...snap.game.waterguns,...snap.game.soaps,...snap.game.chargers];
    const nowTools=tools(latest), olderTools=tools(a), newerTools=tools(b);
    // Ownership and flight come from the newest snapshot; positions interpolate only while all three agree on them.
    const same=(x,y) => x && y && x.id===y.id && x.generation===y.generation && x.holder===y.holder && x.swallowedBy===y.swallowedBy && x.truck===y.truck && x.flight===y.flight && x.active===y.active && x.connectedSerial===y.connectedSerial && x.groundedRoad===y.groundedRoad && x.returnSerial===y.returnSerial;
    this.game.tools.forEach((tool,i) => {
      const now=nowTools[i], older=olderTools[i], newer=newerTools[i];
      if (now && now.active!==false && same(now,newer) && same(newer,older)) lerpArray(tool.mesh.position,older.pos,newer.pos);
    });
    this.game.hoses.forEach((hose,i) => {
      const older=a.game.hoses[i], newer=b.game.hoses[i];
      if (older && newer && older.nodes.length===newer.nodes.length) hose.nodes.forEach((node,j) => lerpArray(node,older.nodes[j],newer.nodes[j]));
    });
    this.game.effectTime = this.latest.time;
    // A grounded player's interpolation is evaluated in the moving truck's coordinate frame.
    this.players.forEach((player,i) => {
      if (!player.occupied) { player.root.visible=false; return; }
      if (i===this.connection.room.slot) {
        if (this.game.roundStage === 'guide') {
          // Transport sequences still advance while world time is stopped: no platform prediction or correction easing.
          this.visualError.set(0,0,0); this.platformShift.set(0,0,0); this.platformTruck=null;
          player.root.position.copy(player.pos); return;
        }
        // Draw the sub-tick moment between the last two predictions; a teleport/respawn draws the newest one.
        const from=this.tickFrom, blend=from && from.distanceToSquared(player.pos)<4 ? Math.min(1,this.accumulator/TICK_SECONDS) : 1;
        const drawn=blend<1 ? this._drawn.lerpVectors(from,player.pos,blend) : this._drawn.copy(player.pos);
        const offset=this.platformOffset(player,this._offset,1-blend), truck=player.carrierTruck;
        // Changing platform (jump, land, fall) folds the old glue into the eased error instead of popping.
        if (truck!==this.platformTruck) { this.visualError.add(this.platformShift).sub(offset); this.platformTruck=truck; }
        this.platformShift.copy(offset);
        this.visualError.multiplyScalar(Math.exp(-14*dt)); player.root.position.copy(drawn).add(this.visualError).add(this.platformShift); return;
      }
      const target=b.players[i], previous=a.players[i];
      const current=latest.players[i];
      if (target.occupied !== current.occupied || previous.occupied !== current.occupied) {
        player.pos.fromArray(current.pos); player.yaw=current.yaw;
        player.animate(isWorldFrozen(this.game) ? 0 : dt,time,new THREE.Vector3().fromArray(current.vel)); return;
      }
      if (target.parent>=0 && previous.parent===target.parent && target.local && previous.local && a.trucks[target.parent].generation === b.trucks[target.parent].generation) {
        lerpArray(player.pos,previous.local,target.local).add(this.trucks[target.parent].pos);
      } else if (Math.hypot(target.pos[0]-previous.pos[0],target.pos[1]-previous.pos[1],target.pos[2]-previous.pos[2])<3) lerpArray(player.pos,previous.pos,target.pos);
      else player.pos.fromArray(target.pos); // respawn teleport
      player.yaw=previous.yaw+Math.atan2(Math.sin(target.yaw-previous.yaw),Math.cos(target.yaw-previous.yaw))*alpha;
      player.animate(isWorldFrozen(this.game) ? 0 : dt,time,new THREE.Vector3().fromArray(target.vel));
    });

  }
}
