/** Shared room protocol and display-name contract. Names use 12 width units (Han=2).
 * Protocol 42: the contract splits in two (MULTIPLAYER.md 版本). REGISTRY_VERSION covers the PC room service and pages
 *   (codes, membership, signaling) and is content-agnostic: the service checks only the shape of appearances and room
 *   settings, so new animals, settings or gameplay fields never need a server restart. GAME_VERSION covers host ⇄ guest
 *   frames; a mismatch on the peer link ends the join with a clear "refresh" notice instead of a silent stall.
 * Protocol 41: player `ko` = [knock-offs caused, last victim slot] for the attacker's "砰～!" feedback (WOBBLE.md 击落反馈).
 * Protocol 40: versus hack console (game `hack`, player `use: 'hack'`, stats key `hacks`; HACK_CONSOLE.md).
 * Protocol 39: versus room settings add `aiDifficulty` (easy | normal | hard, default normal; BOTS.md §14.2); the host
 *   applies it to the match's bots at start. Co-op stand-ins always play at normal.
 * Protocol 38: home vehicle back to the single-level placeholder washer, flatbed out of the order fleet (2026-10-20 user;
 *   multi-level roofs, ladders and cargo stay supported in the rules for later vehicles).
 * Protocol 37: Mayulong's tutorial morph (player `morph`), training dummy, match stats (game `stats`, `dummy`) merged onto
 *   36 (both sides had moved past 35). Head stomps count as slap hits in the record.
 * Protocol 36: hits (WOBBLE.md) — player snapshot `down` (knockdown), `guard` (get-up guard) replace `stunGrace`, and `hits`
 *   (knockdown, stomp and stomped serials); head landings bounce. The wobble value never leaves the host.
 * Protocol 35: HouJianNan's gentle departure — order snapshot `leaveAge`; leaving a departing truck (roof, step-off, wall)
 *   carries at most DEPARTURE.carrySpeed, so guests must predict the same jump-back.
 * Protocol 34: Mayulong's Canadian goose and kangaroo (avatars; player snapshot `flaps`, `flapSerial`), slap recoil and the
 *   slapped player's held item knocked loose, merged onto 33 (both sides had moved past 31 independently).
 * Protocol 33: characters at CHARACTER_SCALE 0.8 (body radius/height, hand and mouth points, reaches) so a roof feels roomier.
 * Protocol 32: Xiexufeng's vehicles — multi-level roofs (platform `y`), ladders, the new home washer and flatbed; order cargo as box solids.
 * Protocol 31: standable prop tops and heads (player snapshot `solid`, `stand`, `standOffset`; both in the urgent signature).
 * Protocol 30: versus empty-hand slap (player snapshot `slap` = cooldown, swings, slaps taken, armed; both serials in the urgent signature).
 * Protocol 29: a player who drops mid-match keeps their character under a host bot; `game.bots` entries may carry `standIn: true`.
 * Protocol 28: emotes (`emote` on the control channel; player snapshot `emote`/`emoteCooldown`, `emoteSerial` in the urgent signature).
 * Protocol 27: versus in-match rules from HouJianNan (per-stain points, towel grime, slippery players, team cleaned/undone/charge bonus, draws).
 * Protocol 26: wet marks travel keyed by ring slot; snapshot deltas patch same-length vector lists (hose/spray nodes) per index.
 * Protocol 25: versus room settings add `aiFill`; snapshots list host-run bots in `game.bots`.
 * Protocol 24: versus pause requests and resume votes over the control channel; `game.pauseVote` in snapshots.
 * Protocol 23: squirrel wall cling joins the player snapshot (`wall`, `wallTime`, `wallLock`; `parent` also names the clung hull).
 * Protocol 22: versus members carry `ready`; the host starts only with both teams staffed and every guest ready.
 * Protocol 21: rooms carry host-set versus `settings` (score target / time limit), frozen per match.
 * Protocol 20: rooms carry a host-chosen `mode` (coop 4 / versus 8 seats) and versus members carry a `team`.
 * Protocol 19: input packets may carry a bounded `struggle` press count while swallowed; pelican swallow cooldown and glide join the player snapshot.
 * Protocol 18: merge authored levels/party balance with electric stun, short-circuit blasts and item returns.
 * Protocol 16: frozen round party factors, up to five dirt patches and normalized rewards.
 * Protocol 15: authored level scripts, vehicle instances/generations, variable dirt, page-scoped guides and rated receipts.
 * Protocol 14: elephant trunk tanks join the snapshot. Protocol 13: suspended guest seats, scoped rejoin decisions and departure presentation.
 * J interact, K place/throw, L ability; manual Shift dash is disabled.
 * The PC service only registers rooms and relays WebRTC signaling; the room owner's browser runs the
 * authority and talks to guests over two data channels (see docs/domains/wash/MULTIPLAYER.md).
 * Appearance metadata/customize registry messages use shared/avatar.js; gameplay and scene readiness stay peer-to-peer. */
/** PC room service ⇄ pages: hello/welcome, rooms, membership, settings blob, signaling. Bump only when that contract changes. */
export const REGISTRY_VERSION = 1;
/** Host ⇄ guest over WebRTC: snapshots, inputs and control. Bump on every breaking gameplay sync change. */
export const GAME_VERSION = 42;
/** The game contract version (older name, kept for tests and gameplay notes). */
export const VERSION = GAME_VERSION;
/** Co-op seat limit; also the default for any room-sized list that is not mode-aware. */
export const CAPACITY = 4;
/** Room modes. A room is one mode at a time; only its host switches it, from the main menu. */
export const MODES = ['coop', 'versus'];
/** Versus teams: 0 red, 1 blue. */
export const TEAMS = [0, 1];
export const TEAM_CAPACITY = 4;
/** Versus end conditions the host can pick; null switches a condition off. At least one stays on. */
export const VERSUS_SCORE_TARGETS = [150, 250, 400];
export const VERSUS_TIME_LIMITS = [180, 300, 480];
/** Versus seat fill at match start: none, top the smaller team up to the larger, or both teams to TEAM_CAPACITY. */
export const AI_FILL = ['off', 'balance', 'fill'];
/** Bot difficulty preset for the match (shared/sim/bots/BotDifficulty.js). */
export const AI_DIFFICULTY = ['easy', 'normal', 'hard'];
export const DEFAULT_VERSUS_SETTINGS = Object.freeze({ scoreTarget: 250, timeLimit: 300, aiFill: 'fill', aiDifficulty: 'normal' });
export function validVersusSettings(settings) {
  return !!settings && typeof settings === 'object' && Object.keys(settings).length === 4 && AI_FILL.includes(settings.aiFill) &&
    AI_DIFFICULTY.includes(settings.aiDifficulty) &&
    (settings.scoreTarget === null || VERSUS_SCORE_TARGETS.includes(settings.scoreTarget)) &&
    (settings.timeLimit === null || VERSUS_TIME_LIMITS.includes(settings.timeLimit)) &&
    (settings.scoreTarget !== null || settings.timeLimit !== null);
}
/** The room service's own check of a settings blob: a small flat object of primitives. What the values mean is the
 * host's business (normalizeVersusSettings), so new settings never need a service update. */
export function validRoomSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 12 && JSON.stringify(value).length <= 512 && entries.every(([key, item]) => /^[A-Za-z]{1,24}$/.test(key) &&
    (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || (typeof item === 'string' && item.length <= 24)));
}
/** Each known setting taken from `value` when valid, else its default; at least one end condition stays on. Pages read
 * room settings through this, so a service holding an older or newer shape still yields a playable match. */
export function normalizeVersusSettings(value) {
  const out = { ...DEFAULT_VERSUS_SETTINGS }, source = value && typeof value === 'object' ? value : {};
  if (source.scoreTarget === null || VERSUS_SCORE_TARGETS.includes(source.scoreTarget)) out.scoreTarget = source.scoreTarget;
  if (source.timeLimit === null || VERSUS_TIME_LIMITS.includes(source.timeLimit)) out.timeLimit = source.timeLimit;
  if (AI_FILL.includes(source.aiFill)) out.aiFill = source.aiFill;
  if (AI_DIFFICULTY.includes(source.aiDifficulty)) out.aiDifficulty = source.aiDifficulty;
  if (out.scoreTarget === null && out.timeLimit === null) out.scoreTarget = DEFAULT_VERSUS_SETTINGS.scoreTarget;
  return out;
}
/** The room service's check of an appearance: short identifiers and a colour index. Pages validate the animal and breed
 * against shared/avatar.js themselves (an unknown one falls back to the default look). */
export function validRegistryAppearance(value) {
  return !!value && typeof value === 'object' && /^[a-z][a-z0-9_-]{0,23}$/.test(value.animal) && /^[a-z][a-z0-9_-]{0,23}$/.test(value.breed) &&
    Number.isInteger(value.color) && value.color >= 0 && value.color < 64;
}
/** Versus start gate on a registry roster: each team needs a connected real player, and every connected guest must be
 * ready. `teams` alone gates "play again" from the results, where nobody is on the home page to ready up. */
export function versusStartCheck(room) {
  const online = (room?.members || []).filter((member) => member.connected);
  // With AI fill on, bots staff the empty side: one real player is enough to start (and to test alone).
  const filled = normalizeVersusSettings(room?.settings).aiFill !== 'off';
  const teams = filled ? online.length > 0 : TEAMS.every((team) => online.some((member) => member.team === team));
  const guests = online.filter((member) => member.id !== room.hostId);
  const ready = guests.filter((member) => member.ready).length;
  return { teams, ready, total: guests.length, ok: teams && ready === guests.length };
}
/** A versus player who started a pause waits this long after the resume before requesting another. */
export const PAUSE_COOLDOWN_SECONDS = 10;
/** Guest pause request / resume vote on the reliable control channel; the host binds it to the link's slot. */
export function validPauseControl(frame) {
  return !!frame && (frame.type === 'pause_request' || frame.type === 'resume_vote') && Number.isSafeInteger(frame.epoch);
}
/** Seats a room of this mode accepts. */
export function capacityFor(mode) { return mode === 'versus' ? TEAMS.length * TEAM_CAPACITY : CAPACITY; }
export const TICK_SECONDS = 1 / 60;
/** Host → guest state at 30 Hz; discrete gameplay changes are sent in the tick they happen (see HostAuthority). */
export const SNAPSHOT_SECONDS = 1 / 30;
export const INPUT_HEARTBEAT_SECONDS = 0.25;
export const INPUT_DIRECTION_SECONDS = 0.05;
/** Held input survives four missed heartbeats; a single Wi-Fi stall must not stop a moving player on the authority. */
export const INPUT_STALE_SECONDS = 1;
/** Data channel labels: frequent superseding state vs. lifecycle, receipts and acknowledgements. */
export const STATE_CHANNEL = 'wash-state';
export const CONTROL_CHANNEL = 'wash-control';
/** A guest that cannot open a direct channel to its host within this window reports a clear failure. */
export const PEER_CONNECT_SECONDS = 10;
/** A host whose signaling socket is gone this long ends the room; guests return to their own rooms. */
export const HOST_RECOVERY_SECONDS = 10;
/** A guest seat is kept this long for a page refresh or brief network loss. */
export const GUEST_RECOVERY_SECONDS = 30;
/** Inputs repeat this many recent samples so a lost unreliable message cannot drop a button edge. */
export const INPUT_REDUNDANCY = 6;
/** Snapshot sends skip while a channel holds more than this, so delayed state never queues up. */
export const STATE_BACKLOG_BYTES = 64 * 1024;
export const PHASES = ['home', 'transition', 'game'];
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ACTIONS = ['Space', 'KeyJ', 'KeyK', 'KeyL'];
/** Upper bound of struggle presses one input sample may report; the authority still applies its own per-second cap. */
export const MAX_STRUGGLES = 8;

/** NFC-normalize and validate a public nickname; mixed scripts share the same width budget. */
export function parseName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim();
  if (!name || !/^[\p{Script=Han}A-Za-z0-9 _.-]+$/u.test(name)) return null;
  const width = [...name].reduce((sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0);
  return width <= 12 ? name : null;
}

/** Validate a bounded input packet before it can reach a room simulation. */
export function validInput(frame) {
  return Number.isSafeInteger(frame.seq) && frame.seq > 0 &&
    Array.isArray(frame.move) && frame.move.length === 2 && frame.move.every((n) => Number.isFinite(n) && Math.abs(n) <= 1) &&
    Array.isArray(frame.axis) && frame.axis.length === 2 && frame.axis.every((n) => Number.isFinite(n) && Math.abs(n) <= 1) &&
    Array.isArray(frame.down) && frame.down.length <= ACTIONS.length && frame.down.every((s) => ACTIONS.includes(s)) &&
    Array.isArray(frame.hits) && frame.hits.length <= ACTIONS.length && frame.hits.every((s) => ACTIONS.includes(s)) &&
    (frame.struggle === undefined || Number.isSafeInteger(frame.struggle) && frame.struggle >= 1 && frame.struggle <= MAX_STRUGGLES);
}

/** Signaling payload relayed between a host and one guest; the service stamps the sender, so a peer cannot pose as another member. */
export function validSignal(data) {
  if (!data || typeof data !== 'object' || typeof data.session !== 'string' || data.session.length > 64 ||
      typeof data.link !== 'string' || !data.link.length || data.link.length > 160) return false;
  if (data.kind === 'offer' || data.kind === 'answer') return typeof data.sdp === 'string' && data.sdp.length <= 16_000;
  if (data.kind === 'ice') return data.candidate === null || data.candidate && typeof data.candidate === 'object' && typeof data.candidate.candidate === 'string' && data.candidate.candidate.length <= 1024;
  return data.kind === 'bye';
}

/** Guest → host input message on the state channel: recent samples (oldest first) plus the newest snapshot tick it holds. */
export function validGuestInput(message) {
  return message && Number.isSafeInteger(message.epoch) && Array.isArray(message.inputs) && message.inputs.length >= 1 && message.inputs.length <= INPUT_REDUNDANCY &&
    message.inputs.every(validInput) && (message.ack === undefined || Number.isSafeInteger(message.ack));
}

/** Reliable guide acknowledgement, scoped to one round and scene epoch. No client-supplied slot is trusted. */
export function validGuideReady(message) {
  return !!message && Number.isSafeInteger(message.epoch) && message.epoch > 0 &&
    typeof message.roundId === 'string' && message.roundId.length > 0 && message.roundId.length <= 64 &&
    typeof message.guideId === 'string' && message.guideId.length > 0 && message.guideId.length <= 64 &&
    Number.isSafeInteger(message.pageIndex) && message.pageIndex >= 0 && message.pageIndex < 8;
}

/** A return decision is bound to the current host-issued recovery, round and epoch. */
export function validRejoinDecision(message) {
  return !!message && Number.isSafeInteger(message.epoch) && message.epoch > 0 &&
    typeof message.roundId === 'string' && message.roundId.length > 0 && message.roundId.length <= 64 &&
    typeof message.recoveryId === 'string' && message.recoveryId.length > 0 && message.recoveryId.length <= 64 &&
    typeof message.accept === 'boolean';
}

/** Fixed-step input with world-space movement; the server never depends on a client's camera. */
export function packetInput(packet) {
  return { axis: () => ({ x: packet.axis[0], y: packet.axis[1] }), worldAxis: () => ({ x: packet.move[0], z: packet.move[1] }),
    hit: (key) => packet.hits.includes(key),
    down: (key) => packet.down.includes(key), struggles: () => packet.struggle || 0 };
}
export const EMPTY_INPUT = { seq: 0, move: [0, 0], axis: [0, 0], down: [], hits: [] };
