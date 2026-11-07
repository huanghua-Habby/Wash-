/** In-memory host↔guest rooms for authority tests: a PeerLink stand-in with JSON on the wire and optional loss/reordering. */
import { HostAuthority } from '../../client/js/online/HostAuthority.js';
import { GuestLink } from '../../client/js/online/GuestLink.js';
import { quantize } from '../../shared/delta.js';
import { guestView, restoreView } from '../../shared/wire.js';
import { VERSION, STATE_CHANNEL, CONTROL_CHANNEL } from '../../shared/protocol.js';
import { Simulation } from '../fixtures/Simulation.js';
import { getLevel } from '../fixtures/levels.js';

/** Minimal PeerLink stand-in: two ends, JSON on the wire, optional loss/reordering on the state channel. */
export class FakeLink extends EventTarget {
  other: FakeLink | null = null; open = false; closed = false; identity: any; sent: Record<string, number> = { [STATE_CHANNEL]: 0, [CONTROL_CHANNEL]: 0 };
  loss = 0; reorder = false; held: any[] = []; random = mulberry(7);
  constructor(options: any) { super(); this.identity = options.identity; }
  emit(type: string, detail?: any) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async receive() {}
  buffered() { return 0; }
  send(label: string, frame: object) {
    if (!this.open || !this.other) return false;
    const text = JSON.stringify({ v: VERSION, code: this.identity.code, link: this.identity.link, ...frame });
    this.sent[label]++;
    const deliver = () => this.other?.emit(label === CONTROL_CHANNEL ? 'control' : 'state', { frame: JSON.parse(text), bytes: text.length });
    if (label === STATE_CHANNEL && this.random() < this.loss) return text.length;
    if (label === STATE_CHANNEL && this.reorder) { this.held.push(deliver); if (this.held.length > 2) this.held.splice(Math.floor(this.random() * this.held.length), 1)[0](); }
    else deliver();
    return text.length;
  }
  close(reason = 'closed') { if (this.closed) return; this.closed = true; this.open = false; this.emit('close', reason); this.other?.close('remote'); }
}
function mulberry(seed: number) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function pair(host: FakeLink, guest: FakeLink) { host.other = guest; guest.other = host; host.open = guest.open = true; guest.emit('open'); host.emit('open'); }

export const member = (id: string, slot: number, extra: object = {}) => ({ id, name: id, slot, connected: true, session: `${id}-s`, ...extra });
export const rosterOf = (members: any[], playerId = 'host') => ({ code: 'ABC234', hostId: 'host', playerId, slot: members.find((m) => m.id === playerId).slot, members, phase: 'home' });

export function room(guestIds: string[], { autoHome = true, autoGuide = true, legacy = true } = {}) {
  const events: any[] = [], hostLinks = new Map<string, FakeLink>();
  const host = new HostAuthority({ emit: (type: string, detail: any) => events.push({ type, detail }), signal() {},
    ...(legacy ? { createSimulation: (level: any) => new Simulation(getLevel(level.id) || level) } : {}),
    createLink: ((options: any) => { const link = new FakeLink(options); hostLinks.set(options.identity.link.split(":")[1], link); return link; }) as any });
  const members = [member('host', 0), ...guestIds.map((id, i) => member(id, i + 1))];
  host.setRoster(rosterOf(members.slice(0, 1)));
  host.setRoster(rosterOf(members));
  const guests = guestIds.map((id) => {
    const received: any[] = [], results: any[] = [];
    let link!: FakeLink;
    const guest = new GuestLink({ roster: rosterOf(members, id), session: `${id}-s`, signal() {}, createLink: ((options: any) => (link = new FakeLink(options))) as any });
    guest.addEventListener('snapshot', (event: any) => received.push(event.detail));
    guest.addEventListener('round_result', (event: any) => results.push(event.detail));
    pair(hostLinks.get(`${id}-s`)!, link);
    return { id, guest, link, hostLink: hostLinks.get(`${id}-s`)!, received, results };
  });
  const sent = new Map<number, any>();
  // Most world tests omit UI: acknowledge the two-step home transaction after the host command completes.
  const command = host.command.bind(host);
  host.command = (type: string, fields = {}) => {
    const error = command(type, fields);
    if (!error && type === 'home' && autoHome) for (const g of guests) { g.guest.requestHome(); g.guest.homeVisible(); }
    return error;
  };
  const advance = () => {
    if (autoGuide && host.sim.game.roundStage === 'guide') {
      const frame = { type: 'guide_ready', epoch: host.epoch, roundId: host.roundId, guideId: host.sim.game.guide.id, pageIndex: host.sim.game.guide.pageIndex };
      host.guideReady(host.slot, frame);
      for (const g of guests) g.guest.sendControl(frame);
    }
    host.advance(); sent.set(host.sim.tickCount, quantize(host.sim.snapshot()));
  };
  /** What guest `g` should hold for `tick`: the host's quantized state through that guest's wire view (shared/wire.js). */
  const view = (g: { id: string }, tick: number) => restoreView(structuredClone(guestView(sent.get(tick), members.find((m) => m.id === g.id)!.slot)));
  return { host, guests, events, members, advance, sent, view, dispose() { for (const g of guests) g.guest.end('test'); host.dispose(); } };
}
