import { isPreparing } from '../../../shared/sim/roundFlow.js';
import { ROAD_SIGN, roadSignFrame } from '../../../shared/sim/RoadSigns.js';
import { slideSpeed } from '../../../shared/sim/WallCling.js';
import { MAX_PLAYER_SLOTS } from '../../../shared/levels.js';
import { WASH_CONFIG } from '../../../shared/sim/washConfig.js';
/**
 * Game audio listener. Presentation only: reads the authoritative snapshot state (stain stages,
 * paid orders, spraying guns, use actions) and player visual reactions, and submits numeric
 * requests to the AudioManager. It never feeds anything back into the simulation.
 * Steady playback reuses scratch vectors and bounded per-order state; new orders establish their baseline.
 */
import * as THREE from 'three';
import { SFX, MUSIC, PROGRESS } from './sounds.js';

const EMPTY_ORDERS = [];
const USE_LOOPS = { soap: SFX.soap_loop, wipe: SFX.wipe_loop, wash: SFX.rinse_loop };
const MAX_STAINS = 8, MAX_GUNS = 4, SLOTS = MAX_PLAYER_SLOTS.length, MAX_TRUNKS = SLOTS;
// Loop channels: each gun's jet and impact, then one block per prepared character slot (eight for versus) for
// scrubbing, the trunk jet, its impact and squirrel claws, with one shared electric hum in between.
const SPRAY_CHANNEL = 0, IMPACT_CHANNEL = MAX_GUNS, USE_CHANNEL = 2 * MAX_GUNS, TRUNK_CHANNEL = USE_CHANNEL + SLOTS;
const TRUNK_IMPACT_CHANNEL = TRUNK_CHANNEL + SLOTS, ELECTRIC_CHANNEL = TRUNK_IMPACT_CHANNEL + SLOTS, CLING_CHANNEL = ELECTRIC_CHANNEL + 1;
/** Versus soap (HouJianNan): one quiet sliding loop shared by every slippery player, louder the faster they slide. */
const SLIDE_CHANNEL = CLING_CHANNEL + SLOTS, SLIDE_VOLUME = 0.28;
/** Loop channels this listener needs; AudioManager must provide at least this many. */
export const GAME_LOOP_CHANNELS = SLIDE_CHANNEL + 1;
/** Squirrel claws scraping down a wall reach full volume and pitch at this slide speed. */
const SCRAPE_FULL = slideSpeed(WASH_CONFIG.squirrelGripSeconds * 0.8);
/** A short-circuit this late (s) when first seen was missed while hidden or reconnecting. */
const BLAST_LATE = 0.5;
const BOUNCE_VOLUME = [0.9, 0.6, 0.35];
/** Progress keeps bubbling this long after the last authoritative increase (snapshots arrive in steps). */
const PROGRESS_HOLD = 0.3;
const _ndc = new THREE.Vector3(), _at = new THREE.Vector3();
/** A sign launch this late (s) is still worth its whoosh; older ones were missed while hidden or reconnecting. */
const WHOOSH_LATE = 0.25;
/** A vehicle first seen this young is a real arrival; older ones were already on screen when we joined/reset. */
const ARRIVAL_LATE = 0.5;

export class GameAudio {
  /** @param {{ manager: any, game: any, players: any[], localPlayer: () => any, canPlay?: () => boolean }} options */
  constructor({ manager, game, players, localPlayer, canPlay = () => true }) {
    this.canPlay = canPlay;
    this.manager = manager; this.game = game; this.players = players; this.localPlayer = localPlayer;
    this.camera = null;
    this.orders = new Map(); this.disposed = false; this.suppressReactions = false;
    this.spraying = new Uint8Array(MAX_GUNS); this.trunking = new Uint8Array(MAX_TRUNKS);
    this.ended = null;
    this.liveRevision = -1; this.liveCount = 0; this.liveAt = new THREE.Vector3(); this.returns = new Map();
    this.slippery = new Float32Array(players.length);
    this.emoteSerials = new Float64Array(players.length); this.emoteBaseline = false;
    this.slapSerials = new Float64Array(players.length); this.swingSerials = new Float64Array(players.length);
    this.morphSerials = new Float64Array(players.length); this.dummyHits = 0;
    this.bindings = players.map((player, slot) => {
      const previous = player.onSound;
      const callback = (event, strength) => this.playerEvent(player, slot, event, strength);
      player.onSound = callback;
      return { player, previous, callback };
    });
    manager.addListener(this);
  }

  /** Stereo position of an object (or world point) in the current camera view. */
  pan(object) {
    if (!this.camera || !object) return 0;
    if (object.getWorldPosition) object.getWorldPosition(_ndc); else _ndc.copy(object);
    _ndc.project(this.camera);
    return (_ndc.x < -1 ? -1 : _ndc.x > 1 ? 1 : _ndc.x) * 0.6;
  }

  /** Teammates sit a little behind the local cat in the mix. */
  weight(player) { return player && player !== this.localPlayer() ? 0.75 : 1; }

  playerEvent(player, slot, event, strength = 1) {
    if (this.disposed || this.suppressReactions || !this.canPlay() || isPreparing(this.game) || this.game.paused || this.game.ended ||
        player.occupied === false || player.connected === false || !player.root.visible) return;
    const m = this.manager, pan = this.pan(player.root), w = this.weight(player);
    switch (event) {
      case 'jump': m.post(SFX.jump, pan, w, slot); break;
      // Soft hops stay quiet; real drops thump.
      case 'land': if (strength > 2) m.post(SFX.land, pan, w * Math.min(1, 0.3 + strength / 16), slot); break;
      case 'fall':
        // Flattened by a road sign: an anime metal "kuang~" instead of the road thump.
        if (player.deathCause === 'road-sign') { m.post(SFX.road_sign_hit, pan, w, slot); if (Math.random() < 0.6) m.post(SFX.mew, pan, w, slot, 0.3); break; }
        m.post(SFX.fall_hit, pan, w, slot);
        if (Math.random() < 0.6) m.post(SFX.mew, pan, w, slot, 0.14);
        break;
      case 'bounce': if (strength < 3) m.post(SFX.fall_bounce, pan, w * BOUNCE_VOLUME[strength], slot); break;
      case 'pickup': m.post(SFX.pickup, pan, w, slot); break;
      // Pelican: a bubbly pop on the gulp; a pop plus a whoosh on the spit.
      case 'gulp': m.post(SFX.pop, pan, w, slot); m.post(SFX.pickup, pan, w * 0.7, slot); break;
      case 'spit': m.post(SFX.pop, pan, w, slot); m.post(SFX.throw, pan, w, slot); break;
      case 'drop': m.post(SFX.drop, pan, w, slot); break;
      case 'throw': m.post(SFX.throw, pan, w * (0.6 + 0.4 * strength), slot); break;
      case 'dash': m.post(SFX.dash, pan, w, slot); break;
      case 'flap': m.post(SFX.wing_flap, pan, w, slot); break;
      case 'slip': m.post(SFX.slip, pan, w, slot); break;
      case 'step': m.post(SFX.step, pan, w, slot); break;
      // Back from the respawn ring: a soft bubbly pop with a light landing tap.
      case 'respawn': m.post(SFX.pop, pan, w, slot, 0, 0.85); m.post(SFX.land, pan, w * 0.5, slot, 0.05); break;
      // Elephant jet opening: a low, heavy thump under the gush.
      case 'trunk': m.post(SFX.land, pan, w, slot, 0, 0.62); m.post(SFX.spray_start, pan, w, -1, 0, 0.78); break;
      // Squirrel: a soft slap and claw tick on a grab, a springy hop off the wall, a squeak when the paws give out.
      case 'cling': m.post(SFX.land, pan, w * (0.45 + 0.35 * strength), slot, 0, 1.45); m.post(SFX.pickup, pan, w * 0.6, -1, 0.02, 1.5); break;
      case 'wallJump': m.post(SFX.jump, pan, w, slot, 0, 1.2); m.post(SFX.dash, pan, w * 0.5, -1, 0, 1.3); break;
      case 'wallSlip': m.post(SFX.slip, pan, w * 0.7, slot, 0, 1.25); if (Math.random() < 0.6) m.post(SFX.mew, pan, w, slot, 0.08, 1.35); break;
      // Stepped into live water: a zap and crackle, often with a startled mew.
      case 'shock': m.post(SFX.shock_zap, pan, w, slot); if (Math.random() < 0.7) m.post(SFX.mew, pan, w, slot, 0.12, 1.15); break;
    }
  }

  /**
   * What the stream lands on, from the synced spray end point (presentation only):
   * a cat in the stream, a stain, the road, or otherwise a vehicle roof.
   */
  surface(gun) {
    const p = gun.sprayTarget;
    for (let i = 0; i < this.players.length; i++) {
      const cat = this.players[i], c = cat.root.position;
      if (cat === gun.holder || !cat.root.visible) continue;
      if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < 0.36 && p.y > c.y - 0.1 && p.y < c.y + 1.3) return SFX.splash_cat_loop;
    }
    for (const order of this.game.orders || (this.game.order ? [this.game.order] : EMPTY_ORDERS)) {
      const stains = order.stains;
      for (let i = 0; i < stains.length; i++) {
        if (stains[i].done) continue;
        stains[i].mesh.getWorldPosition(_at);
        if (Math.abs(p.y - _at.y) < 0.35 && (p.x - _at.x) ** 2 + (p.z - _at.z) ** 2 < 0.3) return SFX.splash_stain_loop;
      }
    }
    return p.y < 0.08 ? SFX.splash_ground_loop : SFX.splash_truck_loop;
  }

  /** Called by the manager once per frame, after snapshots and visuals are presented. */
  audioUpdate(m, camera) {
    if (this.disposed) return;
    this.camera = camera;
    const game = this.game, live = this.canPlay() && (game.active || game.practice) && !isPreparing(game) && !game.paused && !game.ended;

    // Emotes: one bright pop per new host-confirmed emote of a drawn (or out-of-play) player, also on the home page and while paused.
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i], serial = player.emoteSerial || 0;
      if (this.emoteBaseline && serial !== this.emoteSerials[i] && player.emoteId && (player.root?.visible || ['fallen', 'swallowed'].includes(player.state)) && this.canPlay()) m.post(SFX.pop, this.pan(player.root), this.weight(player), i, 0, 1.3);
      this.emoteSerials[i] = serial;
      // Slap: one smack per host-confirmed hit taken by a drawn player.
      const slapped = player.slappedSerial || 0;
      if (this.emoteBaseline && slapped > this.slapSerials[i] && player.root?.visible && this.canPlay()) {
        // A real smack; a kangaroo's double-strength punch lands lower and heavier (read from the strongest shove).
        const heavy = Math.hypot(player.externalVelocity?.x || 0, player.externalVelocity?.z || 0) > 20;
        m.post(SFX.slap_hit, this.pan(player.root), this.weight(player), i, 0, heavy ? 0.82 : 1);
      }
      this.slapSerials[i] = slapped;
      // Every swing, hit or miss: a short bright whoosh from the slapper (quicker for the goose, deeper for the kangaroo).
      const swings = player.slapSerial || 0;
      if (this.emoteBaseline && swings > this.swingSerials[i] && player.root?.visible && player.state !== 'fallen' && this.canPlay()) m.post(SFX.slap_swing, this.pan(player.root), this.weight(player), i, 0, player.animal === 'goose' ? 1.15 : player.animal === 'kangaroo' ? 0.9 : 1);
      this.swingSerials[i] = swings;
      // Lent body swap (tutorial L lesson): one low, round "poof" with the MorphPoof smoke.
      const morphs = player.morphSerial || 0;
      if (this.emoteBaseline && morphs > this.morphSerials[i] && player.root?.visible && this.canPlay()) m.post(SFX.pop, this.pan(player.root), this.weight(player), i, 0, 0.62);
      this.morphSerials[i] = morphs;
    }
    // Knock-off feedback: the local attacker hears a round, punchy "砰～" (a pitched-up blast over a low smack).
    const local = this.localPlayer?.(), knockouts = local?.knockoutSerial || 0;
    if (this.emoteBaseline && local === this.knockoutPlayer && knockouts > this.knockouts && this.canPlay()) {
      m.post(SFX.short_explosion, 0, 0.75, -1, 0, 1.4); m.post(SFX.slap_hit, 0, 1, -1, 0, 0.62); m.post(SFX.pop, 0, 0.8, -1, 0.06, 0.7);
    }
    this.knockouts = knockouts; this.knockoutPlayer = local;
    // Tutorial dummy: the same smack as hitting a body, a little hollower (wood under the sack).
    const dummy = game.dummy, dummyHits = dummy?.hitSerial || 0;
    if (this.emoteBaseline && dummyHits > this.dummyHits && dummy.group.visible && this.canPlay()) m.post(SFX.slap_hit, this.pan(dummy.group), 1, -1, 0, 0.88);
    this.dummyHits = dummyHits;
    this.emoteBaseline = true;

    // Water guns: one loop channel per gun, started once; any stop condition fades it out.
    for (let i = 0; i < MAX_GUNS; i++) {
      const gun = game.waterguns[i];
      const on = live && game.equipmentVisible && !!gun?.spraying && !!gun.holder &&
        gun.holder.state !== 'fallen' && gun.holder.occupied !== false && gun.holder.connected !== false;
      const pan = on ? this.pan(gun.mesh) : 0, w = this.weight(gun?.holder);
      if (on && !this.spraying[i]) m.post(SFX.spray_start, pan, w);
      this.spraying[i] = on ? 1 : 0;
      // The hiss swells and rises with the synced hose pressure.
      const pressure = gun?.pressure ?? 1;
      m.setLoop(SPRAY_CHANNEL + i, SFX.spray_loop, on, pan, w * (0.55 + 0.45 * pressure), 0.86 + 0.18 * pressure);
      // The splash where the water lands: road, vehicle, stain and fur each sound different.
      const surface = on ? this.surface(gun) : -1;
      m.setLoop(IMPACT_CHANNEL + i, surface, on, on ? this.pan(gun.sprayTarget) : 0, w);
    }

    // Elephant trunks: a deeper, slower gush per slot, with the same landing-surface splash as a gun.
    for (let i = 0; i < MAX_TRUNKS; i++) {
      const trunk = game.trunks?.[i], player = trunk?.player;
      const on = live && game.equipmentVisible && !!trunk?.spraying && player.root.visible && player.state !== 'fallen' &&
        player.occupied !== false && player.connected !== false;
      const pan = on ? this.pan(player.root) : 0, w = this.weight(player);
      this.trunking[i] = on ? 1 : 0;
      const pressure = trunk?.pressure ?? 1;
      m.setLoop(TRUNK_CHANNEL + i, SFX.spray_loop, on, pan, w * 1.1 * (0.55 + 0.45 * pressure), 0.72 * (0.88 + 0.12 * pressure));
      const surface = on && trunk.sprayNodes.length > 1 ? this.surface(trunk) : -1;
      m.setLoop(TRUNK_IMPACT_CHANNEL + i, surface, surface >= 0, surface >= 0 ? this.pan(trunk.sprayTarget) : 0, w);
    }

    // Scrubbing / wiping / rinsing follow each cat's authoritative use action.
    // A clinging squirrel's claws scrape louder and higher the faster it slides.
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i], present = live && player.root.visible && player.occupied !== false && player.connected !== false;
      const bank = present && player.state !== 'fallen' ? USE_LOOPS[player.useAction] : undefined;
      m.setLoop(USE_CHANNEL + i, bank ?? -1, bank !== undefined, bank !== undefined ? this.pan(player.root) : 0, this.weight(player));
      const scrape = present && player.state === 'air' && !!player.wall && !(player.wall.ladder >= 0) ? Math.min(1, slideSpeed(player.wallTime) / SCRAPE_FULL) : -1;
      m.setLoop(CLING_CHANNEL + i, SFX.wipe_loop, scrape >= 0, scrape >= 0 ? this.pan(player.root) : 0, this.weight(player) * (0.35 + 0.65 * scrape), 1.25 + 0.55 * scrape);
    }

    // Each simultaneous order has its own high-water marks; removing the primary order
    // never re-seeds its neighbour. Initial/reconnected snapshots only establish a baseline.
    const orders = game.active ? (game.orders || (game.order ? [game.order] : EMPTY_ORDERS)) : EMPTY_ORDERS;
    const now = m.now;
    for (const serial of this.orders.keys()) if (!orders.some(order => order.serial === serial)) this.orders.delete(serial);
    for (const order of orders) {
      let state = this.orders.get(order.serial);
      if (!state) {
        state = { paid: order.paid, leaving: order.mode === 'leaving', stages: new Int16Array(MAX_STAINS), progress: new Float32Array(MAX_STAINS),
          progressAt: -1, progressValue: 0, progressStain: 0, nextBubble: 0 };
        this.orders.set(order.serial, state);
        // A vehicle that only just spawned flies in along its merge lane; one already docked stays silent.
        if (live && !this.suppressReactions && order.mode !== 'leaving' && order.age < ARRIVAL_LATE) m.post(SFX.vehicle_arrive, this.pan(order.truck.group), 1);
        for (let i = 0; i < order.stains.length && i < MAX_STAINS; i++) {
          state.stages[i] = order.stains[i].stage; state.progress[i] = cleaned(order.stains[i]);
        }
      } else {
        for (let i = 0; i < order.stains.length && i < MAX_STAINS; i++) {
          const stain = order.stains[i], value = cleaned(stain);
          if (stain.stage > state.stages[i]) {
            if (live) m.post(stain.done ? SFX.clean : SFX.pop, this.pan(stain.mesh), 1);
            state.stages[i] = stain.stage;
          }
          if (value > state.progress[i] + 1e-4) {
            if (live && !stain.done) { state.progressAt = now; state.progressValue = value; state.progressStain = i; }
            state.progress[i] = value;
          }
        }
        if (order.paid && !state.paid) {
          // Versus: the other team's washed vehicle gets its own darker cue, never your team's cheerful arpeggio.
          const team = this.localPlayer()?.team, rival = order.team != null && Number.isInteger(team) && order.team !== team;
          if (live) m.post(rival ? SFX.order_complete_rival : SFX.order_complete, rival ? this.pan(order.truck.group) : 0, 1, -1, 0.22);
          state.paid = true;
        }
        if (order.mode === 'leaving' && !state.leaving) { if (live) m.post(SFX.vehicle_leave, this.pan(order.truck.group), 1, -1, order.paid ? 0.5 : 0); state.leaving = true; }
      }
      const stain = order.stains[state.progressStain];
      if (!live) state.progressAt = -1;
      if (live && stain && !stain.done && state.progressAt >= 0 && now - state.progressAt < PROGRESS_HOLD && now >= state.nextBubble) {
        const rate = PROGRESS.low * Math.pow(2, PROGRESS.octaves * state.progressValue);
        m.post(SFX.progress_bubble, this.pan(stain.mesh), 1, -1, 0, rate);
        state.nextBubble = now + PROGRESS.interval + Math.random() * PROGRESS.jitter;
      }
    }

    // Soap: a slip "whoops" when a player's slippery timer starts (or is refreshed by a new touch), then one soft
    // sliding loop for whoever is sliding fastest. Only the shared timer and drawn motion are read.
    // Named `fastest`, not after the WallCling slide-speed import the squirrel claws above call in this same function.
    let slide = null, fastest = 0;
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i], remaining = live && player.root.visible && player.occupied !== false && player.state !== 'fallen' ? player.slipperyRemaining || 0 : 0;
      // A fresh soaping only (from dry, or a refresh with time already ticking away); a reset baseline is silent.
      if (this.slipperyBaseline && remaining > this.slippery[i] + 0.05) m.post(SFX.slip, this.pan(player.root), this.weight(player), i);
      this.slippery[i] = remaining;
      if (remaining <= 0 || player.state !== 'ground') continue;
      const speed = player.iceVelocity ? Math.hypot(player.iceVelocity.x, player.iceVelocity.z) : 0;
      if (speed > fastest) { fastest = speed; slide = player; }
    }
    this.slipperyBaseline = true;
    const sliding = !!slide && fastest > 0.6;
    m.setLoop(SLIDE_CHANNEL, SFX.wipe_loop, sliding, sliding ? this.pan(slide.root) : 0,
      sliding ? SLIDE_VOLUME * this.weight(slide) * Math.min(1, fastest / 5.5) : 0, sliding ? 1.35 + 0.15 * Math.min(1, fastest / 5.5) : 1);

    // Live water: one crackling 刺啦 loop that swells with the electrified area, panned to its centre.
    const wet = game.wet;
    if (wet && wet.liveRevision !== this.liveRevision) { this.liveRevision = wet.liveRevision; this.measureLive(wet); }
    const crackle = live && game.equipmentVisible && this.liveCount > 0;
    m.setLoop(ELECTRIC_CHANNEL, SFX.electric_loop, crackle, crackle ? this.pan(this.liveAt) : 0, Math.min(1.2, 0.55 + 0.08 * this.liveCount));

    // Short-circuit at a socket: the bang, then the connector popping out and flying off.
    const blast = game.charging?.blast;
    if (blast && blast.id !== this.blastId) {
      if (live && this.blastId !== undefined && blast.id && (wet.tick - blast.tick) / 60 < BLAST_LATE) {
        const pan = this.pan(_at.fromArray(blast.at));
        m.post(SFX.short_explosion, pan, 1); m.post(SFX.plug_pop, pan, 0.9, -1, 0.06);
      }
      this.blastId = blast.id;
    }

    // A thrown item touching the road: a bubbly "pa!" where it vanished, and a softer one as it pops back home.
    for (const tool of game.tools || EMPTY_ORDERS) {
      const serial = tool.returnSerial || 0, seen = this.returns.get(tool.id);
      if (seen === serial) continue;
      this.returns.set(tool.id, serial);
      if (!live || seen === undefined || !serial || tool.returnAge >= BLAST_LATE) continue;
      m.post(SFX.pop, this.pan(tool.returnFrom), 1, -1, 0, 0.8);
      if (tool.kind !== 'soap') m.post(SFX.pop, this.pan(tool.mesh), 0.7, -1, 0.1, 1.1);
    }

    // Road sign: one rushing whoosh per launch; its swell peaks as the sign reaches the cats.
    let sign = null;
    for (const entry of game.active ? game.roadSigns?.entries?.() || game.level?.roadSigns || EMPTY_ORDERS : EMPTY_ORDERS) {
      const frame = roadSignFrame(entry, game.roadSigns.presentationTime(), game.homeTruck, game.level.road);
      if (frame?.phase === 'passing') { sign = frame; break; }
    }
    const signId = sign?.id ?? null;
    if (signId !== this.signId) {
      const age = sign ? (game.homeTruck.pos.x + ROAD_SIGN.startX - sign.x) / ROAD_SIGN.speed : Infinity;
      if (live && this.signId !== undefined && signId && age < WHOOSH_LATE) {
        m.post(SFX.road_sign_whoosh, this.pan(_at.set(game.homeTruck.pos.x, sign.y + 0.7, sign.z)), 1);
      }
      this.signId = signId;
    }

    // Menu music at home, band music in a round; pause and the end screen muffle it to half volume.
    m.setMusic(game.active ? MUSIC.game : MUSIC.menu, 1, game.active && (!!game.paused || !!game.ended));

    // Loops already stop because `live` is false once the round ends.
    const ended = game.active && !!game.ended;
    if (ended && this.ended === false) m.post(SFX.round_end, 0, 1);
    this.ended = ended;
    const second = game.active ? Math.ceil(game.remaining) : null;
    if (live && second > 0 && second <= 10 && this.timerSecond != null && second < this.timerSecond) m.post(SFX.pop, 0, .45);
    this.timerSecond = second;
    this.suppressReactions = false;
  }

  /** Count live puddles and their centre (only when the shared live set changes). */
  measureLive(wet) {
    let count = 0, x = 0, z = 0;
    wet.surfaces.forEach((surface, i) => {
      const truck = i ? wet.trucks[i - 1] : null;
      for (const mark of surface.marks) if (mark.id && mark.live) {
        count++; x += truck ? truck.pos.x + mark.x : mark.x - wet.scroll; z += truck ? truck.pos.z + mark.z : mark.z;
      }
    });
    this.liveCount = count;
    if (count) this.liveAt.set(x / count, wet.trucks[0]?.topY ?? 0, z / count);
  }

  reset() {
    this.liveRevision = -1; this.liveCount = 0; this.blastId = undefined; this.returns = new Map((this.game.tools || []).map(tool => [tool.id, tool.returnSerial || 0]));
    this.orders.clear(); this.spraying.fill(0); this.trunking.fill(0); this.ended = null; this.timerSecond = null; this.signId = undefined; this.suppressReactions = true;
    this.slippery.fill(0); this.slipperyBaseline = false; this.emoteBaseline = false;
  }

  dispose() {
    if (this.disposed) return;
    for (const { player, previous, callback } of this.bindings) if (player.onSound === callback) player.onSound = previous;
    this.manager.removeListener(this); this.reset(); this.bindings.length = 0; this.disposed = true;
  }
}

/** A stain's overall cleaning 0…1 across all of its steps (the per-step bar resets; this never does). */
function cleaned(stain) {
  return stain.done ? 1 : (stain.stage + stain.progress) / stain.steps.length;
}
