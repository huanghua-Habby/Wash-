/** In-memory room registry and WebRTC signaling relay. Gameplay runs in each room owner's browser; this service never
 * simulates, and never carries inputs or snapshots. It owns codes, membership, slots and the host-reported phase. */
import { randomBytes, randomUUID } from 'node:crypto';
import { CODE_ALPHABET, REGISTRY_VERSION, PHASES, MODES, TEAMS, TEAM_CAPACITY, capacityFor, DEFAULT_VERSUS_SETTINGS, validRoomSettings, validRegistryAppearance, HOST_RECOVERY_SECONDS, GUEST_RECOVERY_SECONDS, parseName, validSignal } from '../../shared/protocol.js';
import { AVATAR_COLORS, defaultAvatar } from '../../shared/avatar.js';

/** The service keeps appearances by shape only (REGISTRY_VERSION is content-agnostic); pages check animals and breeds. */
const registryAppearance = (value: any) => ({ animal: value.animal as string, breed: value.breed as string, color: value.color as number });

type Peer = { send: (data: string) => void; readyState: number; close: (code?: number, reason?: string) => void };
/** A connection's identity and current room. `session` changes on every (re)connection and scopes peer links. */
export class Member {
  readonly id = randomUUID();
  readonly token = randomBytes(24).toString('hex');
  session = randomUUID();
  room!: Room;
  slot = 0;
  /** Versus team (0 red, 1 blue); null in co-op rooms. */
  team: number | null = null;
  /** Versus guest is ready for the next match; cleared by any room change and at every start. */
  ready = false;
  expires = Infinity;
  lastReconnect = -Infinity;
  appearance = defaultAvatar();
  customized = false;
  constructor(public peer: Peer | null, public name: string) {}
}
export type Room = { code: string; host: string; members: Member[]; revision: number; phase: string; mode: string; settings: Record<string, string | number | boolean | null> };
export class RoomError extends Error { constructor(public code: string, message: string) { super(message); } }

/** One service owns all room codes. Codes retired during the process lifetime are never reused. */
export class Rooms {
  rooms = new Map<string,Room>();
  sessions = new Map<string,Member>();
  private issued = new Set<string>();
  constructor(private maxRooms = 256, private iceServers: (request?: unknown) => object[] = () => []) {}

  /** Recover a still-live session or automatically register a personal room for a new browser. */
  connect(peer: Peer, name: unknown, token?: string, request?: unknown, appearance?: unknown): Member {
    const existing = token ? this.sessions.get(token) : undefined;
    if (existing && existing.expires > Date.now()) {
      existing.peer?.close(4001,'session_replaced'); existing.peer = peer; existing.expires = Infinity; existing.session = randomUUID();
      this.welcome(existing, request); this.broadcast(existing.room);
      return existing;
    }
    if (existing) { this.detach(existing); this.sessions.delete(existing.token); }
    if (this.rooms.size >= this.maxRooms || this.sessions.size >= this.maxRooms) throw new RoomError('server_full','服务器房间已满，请稍后再试');
    const member = new Member(peer, parseName(name) || '洗车员');
    if (validRegistryAppearance(appearance)) { member.appearance = registryAppearance(appearance); member.customized = true; }
    this.createRoom(member); this.sessions.set(member.token,member);
    this.welcome(member, request, !!token); this.broadcast(member.room);
    return member;
  }

  private welcome(member: Member, request?: unknown, recoveryExpired = false) {
    this.send(member,{ type:'welcome',token:member.token,playerId:member.id,session:member.session,iceServers:this.iceServers(request), recoveryExpired });
  }

  private createRoom(host: Member): Room {
    let code = '';
    do { code = Array.from(randomBytes(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join(''); } while (this.issued.has(code));
    this.issued.add(code);
    const room: Room = { code,host:host.id,members:[host],revision:1,phase:'home',mode:'coop',settings:{ ...DEFAULT_VERSUS_SETTINGS } };
    host.room = room; host.slot = 0; host.team = null; this.rooms.set(code,room); return room;
  }

  /** Validate the destination before touching the source room; failed joins preserve the user's code. */
  join(member: Member, rawCode: unknown) {
    if (typeof rawCode !== 'string' || !/^[A-Z2-9]{6}$/.test(rawCode.trim().toUpperCase())) throw new RoomError('invalid_code','请输入 6 位房间码');
    const target = this.rooms.get(rawCode.trim().toUpperCase());
    if (!target) throw new RoomError('room_not_found','没有找到这个房间，房间码可能已失效');
    if (target === member.room) { this.broadcast(target); return; }
    if (target.phase !== 'home') throw new RoomError('room_started','这个房间已经出发，请等房主回到主菜单');
    const capacity = capacityFor(target.mode);
    if (target.members.length >= capacity) throw new RoomError('room_full','这个房间已经满员了');
    const host = target.members.find((m) => m.id === target.host);
    if (!host?.peer) throw new RoomError('host_offline','房主暂时离线，请稍后再试');
    this.detach(member);
    member.room = target;
    member.slot = Array.from({ length: capacity }, (_, slot) => slot).find((slot) => !target.members.some((m) => m.slot === slot))!;
    member.team = target.mode === 'versus' ? this.smallerTeam(target) : null;
    const preferred = member.customized ? member.appearance : defaultAvatar(member.slot);
    const used = new Set(target.members.map(m => m.appearance.color));
    const color = !used.has(preferred.color) ? preferred.color :
      [member.slot, ...AVATAR_COLORS.map((_, i) => i)].find(index => !used.has(index))!;
    member.appearance = { ...preferred, color };
    target.members.push(member);
    this.clearReady(target); this.broadcast(target);
  }

  /** Leave as a guest (or after a failed direct connection) and get a fresh searchable code. */
  leave(member: Member) {
    if (member.room.host === member.id) return;
    if (this.rooms.size >= this.maxRooms) throw new RoomError('server_full','服务器房间已满，请稍后再试');
    this.detach(member); this.createRoom(member); this.broadcast(member.room);
  }

  /** A departing host retires the room; its guests each get a new personal room. */
  private detach(member: Member) {
    const old = member.room;
    if (old.host === member.id) {
      this.rooms.delete(old.code);
      for (const guest of old.members.filter((m) => m !== member)) {
        this.createRoom(guest); this.send(guest,{ type:'notice',message:'房主已离开，已为你创建新房间。正式的网络服务器即将上线，请见谅！' }); this.broadcast(guest.room);
      }
    } else {
      old.members = old.members.filter((m) => m !== member);
      this.clearReady(old); this.broadcast(old);
    }
  }

  rename(member: Member, rawName: unknown) {
    const name = parseName(rawName);
    if (!name) throw new RoomError('invalid_name','ID 最多 12 位英文或 6 个汉字，中英混合按长度折算');
    member.name = name; this.broadcast(member.room);
  }

  /** Member appearance is committed atomically; disconnected recovery seats still reserve their color. */
  customize(member: Member, value: unknown, requestId: string) {
    if (member.room.phase !== 'home') throw new RoomError('room_started','请回到主页后定制角色');
    if (!validRegistryAppearance(value)) throw new RoomError('invalid_avatar','角色选项无效，请重新选择');
    const appearance = registryAppearance(value);
    if (member.room.members.some(other => other !== member && other.appearance.color === appearance.color))
      throw new RoomError('color_taken','这个颜色刚被队友选走了，请换一种');
    member.appearance = appearance; member.customized = true;
    this.broadcast(member.room);
    this.send(member,{ type:'customized',requestId,appearance });
  }

  /** Versus joiners go to the team with fewer members; red on a tie. */
  private smallerTeam(room: Room) {
    const count = (team: number) => room.members.filter((m) => m.team === team).length;
    return TEAMS.reduce((best, team) => count(team) < count(best) ? team : best, TEAMS[0]);
  }

  /** Only the host switches the whole room's mode, and only from the main menu. */
  setMode(member: Member, mode: unknown) {
    const room = member.room;
    if (room.host !== member.id || typeof mode !== 'string' || !MODES.includes(mode)) throw new RoomError('bad_request','房间模式更新无效');
    if (room.phase !== 'home') throw new RoomError('room_started','请回到主页后切换模式');
    if (room.mode === mode) return;
    if (room.members.length > capacityFor(mode)) throw new RoomError('too_many_for_coop','房间人数超过合作模式上限，无法切换');
    room.mode = mode; this.clearReady(room);
    for (const m of room.members) m.team = null;
    if (mode === 'versus') for (const m of [...room.members].sort((a, b) => a.slot - b.slot)) m.team = this.smallerTeam(room);
    this.broadcast(room);
  }

  /** Only the host sets the versus end conditions, from the main menu; a running match keeps its frozen copy. */
  setSettings(member: Member, settings: unknown) {
    const room = member.room;
    // Shape only: what each value means is the host's business (normalizeVersusSettings), so new settings need no update here.
    if (room.host !== member.id || !validRoomSettings(settings)) throw new RoomError('bad_request','房间设置无效');
    if (room.phase !== 'home') throw new RoomError('room_started','请回到主页后修改房间设置');
    if (JSON.stringify(settings) === JSON.stringify(room.settings)) return;
    room.settings = { ...(settings as Room['settings']) };
    this.clearReady(room); this.broadcast(room);
  }

  /** A versus member picks a side from the main menu; a full team refuses. */
  setTeam(member: Member, team: unknown) {
    const room = member.room;
    if (room.mode !== 'versus' || !TEAMS.includes(team as number)) throw new RoomError('bad_request','队伍选择无效');
    if (room.phase !== 'home') throw new RoomError('room_started','请回到主页后选择队伍');
    if (member.team === team) return;
    if (room.members.filter((m) => m.team === team).length >= TEAM_CAPACITY) throw new RoomError('team_full','这个队伍已经满员了');
    member.team = team as number; this.clearReady(room); this.broadcast(room);
  }

  /** A versus guest toggles ready on the main menu; the host is never asked to ready up. */
  setReady(member: Member, ready: unknown) {
    const room = member.room;
    if (room.mode !== 'versus' || room.host === member.id || typeof ready !== 'boolean') throw new RoomError('bad_request','准备状态无效');
    if (room.phase !== 'home') throw new RoomError('room_started','请回到主页后准备');
    if (member.ready === ready) return;
    member.ready = ready; this.broadcast(room);
  }

  /** Every change to who plays, on which side or under which rules asks everyone to ready up again. */
  private clearReady(room: Room) { for (const m of room.members) m.ready = false; }

  /** Only the host reports its authority's phase; it restricts joins to the main menu. */
  hostPhase(member: Member, phase: unknown) {
    const room = member.room;
    if (room.host !== member.id || typeof phase !== 'string' || !PHASES.includes(phase)) throw new RoomError('bad_request','房间阶段更新无效');
    if (room.phase !== phase) { room.phase = phase; if (phase !== 'home') this.clearReady(room); this.broadcast(room); }
  }

  /** The host turns away a guest that slipped in while its world was leaving the main menu. */
  turnAway(member: Member, guestId: unknown) {
    const room = member.room, guest = room.members.find((m) => m.id === guestId);
    if (room.host !== member.id || !guest || guest === member) return;
    this.detach(guest); this.createRoom(guest);
    this.send(guest,{ type:'error',code:'room_started',message:'这个房间已经出发，请等房主回到主菜单' }); this.broadcast(guest.room);
  }

  /** Membership only: the host has already removed the actor in its own shared authority. */
  releaseGuest(member: Member, guestId: unknown, reason: unknown) {
    const room = member.room, guest = room.members.find(m => m.id === guestId);
    if (room.host !== member.id || !guest || guest === member || !['expired', 'declined'].includes(String(reason))) return;
    this.detach(guest);
    if (guest.peer) {
      this.createRoom(guest); this.broadcast(guest.room);
      if (reason === 'expired') this.send(guest, {type:'notice', code:'recovery_expired', message:'房间已超时'});
    } else this.sessions.delete(guest.token);
  }

  /** One guest-requested session rotation renegotiates a lost direct link; no game state goes through here. */
  reconnect(member: Member) {
    const now = Date.now();
    if (member.room.host === member.id || now - member.lastReconnect < 2000) return;
    member.lastReconnect = now;
    member.session = randomUUID(); this.broadcast(member.room);
  }

  /** Relay an offer/answer/ICE payload between the host and one of its guests, stamped with the sender's identity. */
  signal(member: Member, to: unknown, data: unknown) {
    if (!validSignal(data)) throw new RoomError('bad_signal','连接协商数据格式错误');
    const room = member.room, target = room.members.find((m) => m.id === to);
    if (!target || target === member || room.host !== member.id && room.host !== target.id) return;
    this.send(target,{ type:'signal',code:room.code,from:member.id,fromSession:member.session,data });
  }

  /** Keep a seat for a short recovery window; the host's window is shorter because guests depend on it. */
  disconnect(member: Member, peer: Peer, now = Date.now()) {
    if (member.peer !== peer) return;
    member.peer = null;
    member.expires = now + 1000 * (member.room.host === member.id ? HOST_RECOVERY_SECONDS : GUEST_RECOVERY_SECONDS);
    this.broadcast(member.room);
  }

  sweep(now = Date.now()) {
    for (const member of this.sessions.values()) if (!member.peer && member.expires <= now) {
      this.detach(member); this.sessions.delete(member.token);
    }
  }

  /** Roster for each member: identity, slot and session of everyone, so the host can bind each peer link to its slot. */
  broadcast(room: Room) {
    room.revision++;
    const members = room.members.map((m) => ({ id:m.id,name:m.name,slot:m.slot,team:m.team,ready:m.ready,connected:!!m.peer,session:m.session,appearance:m.appearance }));
    for (const member of room.members) this.send(member,{ type:'room',code:room.code,ownCode:member.id === room.host ? room.code : null,
      hostId:room.host,playerId:member.id,slot:member.slot,revision:room.revision,phase:room.phase,mode:room.mode,settings:{ ...room.settings },members });
  }

  send(member: Member, data: object) { if (member.peer?.readyState === 1) member.peer.send(JSON.stringify({ v:REGISTRY_VERSION,...data })); }
  close() { this.rooms.clear(); this.sessions.clear(); }
}
