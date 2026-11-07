/** Browser room connection. A signaling socket to the PC room service (codes, membership, WebRTC negotiation), plus
 * either this page's own HostAuthority (room owner) or a GuestLink to the owner's browser. The page sees one API:
 * `room`, `snapshot`, `round_started`, `round_result`, `message`, `status` and `disconnect` events.
 * Private resume credentials are per tab; nicknames persist across sessions. */
import { REGISTRY_VERSION, HOST_RECOVERY_SECONDS, validSignal } from '../../../shared/protocol.js';
import { roomEndpoint } from './roomEndpoint.js';
import { HostAuthority } from './HostAuthority.js';
import { GuestLink } from './GuestLink.js';
import { validAvatar, cleanAvatar } from '../../../shared/avatar.js';

const FAILURE = {
  connect_failed:'无法与房主建立直连（网络可能限制点对点连接），已回到你自己的房间',
  host_lost:'与房主的直连已断开，已回到你自己的房间。正式的网络服务器即将上线，请见谅！',
  version_mismatch:'你和房主的游戏版本不同，请双方都刷新页面后再加入。已回到你自己的房间',
};

export class RoomConnection extends EventTarget {
  constructor({ endpoint } = {}) {
    super(); this.room = null; this.roster = null; this.connected = false; this.socket = null; this.retry = 0; this.stopped = false;
    this.endpoint = endpoint;
    this.name = this.read('localStorage','wash-name') || '洗车员';
    this.token = this.read('sessionStorage','wash-session') || '';
    this.leavingCode = this.read('sessionStorage','wash-leave-room') || null; this.leaveSession = null;
    this.authority = null; this.guest = null; this.iceServers = []; this.voice = null;
    this.customizations = new Map(); this.customizationSeq = 0;
    try { const appearance = JSON.parse(this.read('localStorage','wash-appearance')); if (validAvatar(appearance)) this.appearance = cleanAvatar(appearance); } catch {}
  }
  /** Party voice rides on the direct links this connection opens; bind before connecting. */
  bindVoice(voice) { if (this.voice) throw new Error('Voice chat already bound'); this.voice = voice; }
  read(storage,key) { try { return globalThis[storage].getItem(key); } catch { return null; } }
  emit(type,detail) { this.dispatchEvent(new CustomEvent(type,{ detail })); }

  /** The room owner runs the world locally; gameplay continues even while the signaling socket reconnects. */
  get isHost() { return !!this.authority; }
  /** A guest may only play while its direct link to the host is open. */
  get playing() { return this.isHost || !!this.guest?.open; }

  connect() {
    if (this.stopped) return;
    const endpoint = this.endpoint || roomEndpoint(location, import.meta.env?.VITE_ROOM_WS_URL);
    this.socket = new WebSocket(endpoint);
    const socket = this.socket;
    this.emit('status','正在连接…');
    socket.addEventListener('open',() => { if (socket === this.socket) this.signalSend('hello',{ name:this.name,token:this.token,...(this.appearance ? {appearance:this.appearance} : {}) }); });
    socket.addEventListener('message',(event) => {
      if (socket !== this.socket) return;
      let frame; try { frame = JSON.parse(event.data); } catch { return; }
      // Another room-service contract: only its error gets through, as a clear "refresh" message instead of a silent stall.
      if (frame.v !== REGISTRY_VERSION) { if (frame.type === 'error') this.emit('message', { type:'error', code:'protocol_mismatch', message:'房间服务版本不一致，请刷新页面' }); return; }
      if (frame.type === 'welcome') {
        this.connected = true; this.retry = 0; this.token = frame.token; this.playerId = frame.playerId; this.session = frame.session;
        this.iceServers = Array.isArray(frame.iceServers) ? frame.iceServers : [];
        if (frame.recoveryExpired) this.pendingNotice = {message:'房间已超时', code:'recovery_expired'};
        try { sessionStorage.setItem('wash-session',this.token); } catch { /* Optional persistence. */ }
        this.emit('status','已连接');
      }
      if (frame.type === 'room') this.setRoster(frame);
      if (frame.requestId && this.customizations.has(frame.requestId) && ['customized','error'].includes(frame.type)) {
        const request = this.customizations.get(frame.requestId); this.customizations.delete(frame.requestId); clearTimeout(request.timer);
        if (frame.type === 'customized' && validAvatar(frame.appearance)) {
          this.appearance = cleanAvatar(frame.appearance);
          try { localStorage.setItem('wash-appearance', JSON.stringify(this.appearance)); } catch {}
          request.resolve(this.appearance);
        } else request.reject(new Error(frame.message || '定制失败，请重试'));
      }
      if (frame.type === 'signal' && frame.code === this.roster?.code && validSignal(frame.data)) {
        if (this.authority) this.authority.receiveSignal(frame.from,frame.fromSession,frame.data);
        else this.guest?.receiveSignal(frame.from,frame.fromSession,frame.data);
      }
      if (frame.type === 'error' || frame.type === 'notice') this.emit('message',frame);
    });
    socket.addEventListener('close',(event) => this.lost(socket, event.code));
    socket.addEventListener('error',() => {});
  }

  /** The registry decides who hosts; switching role tears down the previous authority or link. */
  setRoster(roster) {
    this.roster = roster;
    this.session = roster.members.find(member => member.id === roster.playerId)?.session || this.session;
    this.name = roster.members.find((m) => m.id === roster.playerId)?.name || this.name;
    if (roster.hostId === roster.playerId || this.leavingCode && this.leavingCode !== roster.code) {
      this.leavingCode = this.leaveSession = null;
      try { sessionStorage.removeItem('wash-leave-room'); } catch { /* Optional persistence. */ }
    } else this.flushLeave();
    if (roster.hostId === roster.playerId) {
      if (this.guest) { this.guest.end('left'); this.guest = null; }
      if (!this.authority) this.authority = new HostAuthority({ emit:(type,detail) => this.fromAuthority(type,detail),
        signal:(to,data) => this.signalSend('signal',{ to,data }), iceServers:this.iceServers, voice:this.voice });
      this.authority.setRoster(roster);
    } else {
      if (this.authority) { this.authority.dispose(); this.authority = null; }
      const host = roster.members.find((m) => m.id === roster.hostId);
      const current = this.guest && !this.guest.closed && this.guest.code === roster.code && this.guest.hostSession === host?.session && this.guest.session === this.session;
      if (!current && !this.leavingCode) {
        this.guest?.end('replaced');
        this.guest = host?.connected ? this.openGuest(roster) : null;
        this.emit('status', host?.connected ? '正在直连房主…' : '房主暂时离线，等待重连…');
        this.emit('disconnect');
      }
    }
    this.publishRoom();
    if (this.pendingNotice && this.authority) {
      const notice = typeof this.pendingNotice === 'string' ? {message:this.pendingNotice} : this.pendingNotice;
      this.emit('message',{type:'notice', ...notice}); this.pendingNotice = null;
    }
  }

  openGuest(roster) {
    const guest = new GuestLink({ roster, session:this.session, iceServers:this.iceServers, voice:this.voice, signal:(to,data) => this.signalSend('signal',{ to,data }) });
    guest.addEventListener('open',() => { clearTimeout(this.recovery); this.emit('status','已直连房主'); });
    guest.addEventListener('state',() => this.publishRoom());
    guest.addEventListener('snapshot',(event) => { this.lastSnapshotBytes = guest.lastSnapshotBytes; this.emit('snapshot',event.detail); });
    guest.addEventListener('round_started',(event) => this.emit('round_started',event.detail));
    guest.addEventListener('round_result',(event) => this.emit('round_result',event.detail));
    guest.addEventListener('end',(event) => {
      if (this.guest !== guest) return;
      this.guest = null; this.emit('disconnect');
      if (guest.rejoinLeaving || this.leavingCode) return;
      const message = FAILURE[event.detail.reason], code = this.roster?.code;
      if (!message) return;
      const giveUp = () => { this.pendingNotice = message; this.signalSend('leave'); };
      if (event.detail.reason === 'connect_failed' || event.detail.reason === 'version_mismatch') { giveUp(); return; }
      // A lost host may be reloading: within its recovery window the registry re-lists it with a new session and a new
      // link opens. If the room ends, the registry moves us; if no link ever returns, give up with a clear notice.
      this.emit('status','与房主的直连中断，等待房主恢复…');
      if (this.connected && this.roster?.members.find(member => member.id === this.roster.hostId)?.connected) this.signalSend('reconnect');
      clearTimeout(this.recovery);
      this.recovery = setTimeout(() => { if (!this.guest?.open && !this.authority && this.roster?.code === code) giveUp(); }, (HOST_RECOVERY_SECONDS + 2) * 1000);
    });
    return guest;
  }

  fromAuthority(type,detail) {
    // A host command's effects reach the page after send() returns, as a network reply would; callers that send from
    // inside a 'room' listener (e.g. the menu's return-home request) must not re-enter themselves.
    if (this.deferred) { this.deferred.push([type,detail]); return; }
    if (type === 'host_phase') this.signalSend('host_phase',{ phase:detail });
    else if (type === 'turn_away') this.signalSend('turn_away',{ member:detail });
    else if (type === 'release_guest') this.signalSend('release_guest', detail);
    else if (type === 'state' || type === 'peers') this.publishRoom();
    else if (type === 'message') this.emit('message',{ type:'error',message:detail });
    else this.emit(type,detail);
  }

  /** Registry roster merged with the authority's scene state (epoch, level, round, mode). */
  publishRoom() {
    if (!this.roster) return;
    const scene = this.authority ? this.authority.state() : this.guest?.state || { epoch:0,levelId:null,roundId:null,mode:'multiplayer' };
    // `mode` in the merged view stays the network mode (solo/multiplayer); the room's gameplay mode is `gameMode`.
    const room = { ...this.roster, gameMode: this.roster.mode === 'versus' ? 'versus' : 'coop', ...scene };
    const previous = this.room;
    this.room = room;
    if (previous && JSON.stringify(previous) === JSON.stringify(room)) return;
    this.emit('room',room);
  }

  /** Signaling loss: the host keeps simulating locally; a guest's direct link is independent of this socket. */
  lost(socket, code) {
    if (socket !== this.socket) return;
    this.socket = null; this.connected = false; this.emit('status','房间服连接中断，正在重连…');
    for (const request of this.customizations.values()) { clearTimeout(request.timer); request.reject(new Error('连接中断，请恢复后重试')); }
    this.customizations.clear();
    if (code === 4001) { this.stopped = true; this.emit('status','此连接已在另一窗口恢复，请刷新'); }
    if (!this.stopped) this.timer = setTimeout(() => this.connect(),Math.min(5000,500 * 2 ** this.retry++));
  }

  /** Explicit departure is one registry lifecycle request, with no reconnect prompt or gameplay command. */
  requestLeave() {
    if (!this.roster || this.roster.hostId === this.roster.playerId) return false;
    if (!this.leavingCode) {
      this.leavingCode = this.roster.code; clearTimeout(this.recovery);
      try { sessionStorage.setItem('wash-leave-room', this.leavingCode); } catch { /* Optional persistence. */ }
    }
    this.flushLeave(); return true;
  }
  flushLeave() {
    if (this.leavingCode !== this.roster?.code || this.leaveSession === this.session) return;
    if (this.signalSend('leave')) this.leaveSession = this.session;
  }

  signalSend(type,fields = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ v:REGISTRY_VERSION,type,...fields })); return true;
  }

  /** Gameplay goes to this page's authority or over the direct link; registry actions go to the room service. */
  send(type,fields = {}) {
    if (type === 'input') return this.authority ? (this.authority.localInput(fields), true) : !!this.guest?.sendInput(fields);
    if (type === 'guide_ready') return this.authority ? this.authority.guideReady(this.authority.slot, fields) : !!this.guest?.sendControl({ type, ...fields });
    if (type === 'rejoin_decision') return !!this.guest?.sendControl({ type, ...fields });
    if (type === 'pause_request' || type === 'resume_vote') return this.authority ? this.authority.pauseControl(this.authority.slot, type) : !!this.guest?.sendControl({ type, epoch:this.guest.state?.epoch });
    if (type === 'emote') return this.authority ? this.authority.emote(this.authority.slot, fields.id) : !!this.guest?.sendControl({ type, id:fields.id, epoch:this.guest.state?.epoch });
    if (type === 'result_ack') return this.authority ? true : !!this.guest?.sendControl({ type:'result_ack',roundId:fields.roundId });
    if (['start','load','home','pause'].includes(type)) {
      if (!this.authority) return false;
      const deferred = this.deferred = [];
      let error;
      try { error = this.authority.command(type,fields); } finally { this.deferred = null; }
      queueMicrotask(() => { for (const [kind,detail] of deferred) this.fromAuthority(kind,detail); });
      if (error) { queueMicrotask(() => this.emit('message',{ type:'error',message:error })); return false; }
      return true;
    }
    return this.signalSend(type,fields);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.stopped = true; clearTimeout(this.timer); clearTimeout(this.recovery);
    const authority = this.authority, guest = this.guest, socket = this.socket;
    this.authority = this.guest = this.socket = null; this.connected = false;
    for (const request of this.customizations.values()) { clearTimeout(request.timer); request.reject(new Error('应用已关闭')); }
    this.customizations.clear(); authority?.dispose(); guest?.end('left'); socket?.close();
  }

  /** Advance this page's authority by one fixed tick (host only). */
  advanceLocal() { this.authority?.advance(); }
  confirmGuide(guideId, pageIndex = 0) {
    if (!this.playing || !this.room?.roundId) return false;
    return this.send('guide_ready', { guideId, pageIndex, epoch: this.room.epoch, roundId: this.room.roundId });
  }
  /** Host only: ask the registry to switch the whole room between co-op and versus (main menu only). */
  setGameMode(mode) { return this.connected && !!this.room?.ownCode && this.send('set_mode', { mode }); }
  /** Host only: the versus end conditions the next match freezes at start (main menu only). */
  setRoomSettings(settings) { return this.connected && !!this.room?.ownCode && this.send('set_settings', { settings }); }
  /** Versus guest: tell the registry this player is (not) ready for the next match (main menu only). */
  setReady(ready) { return this.connected && !this.room?.ownCode && this.send('set_ready', { ready: !!ready }); }
  /** Versus member: ask the registry to move this player to the other team (main menu only). */
  setTeam(team) { return this.connected && this.send('set_team', { team }); }
  rename(name) { if (!this.connected || !this.send('rename',{name})) return false; try { localStorage.setItem('wash-name',name); } catch {} return true; }

  customize(appearance) {
    if (!validAvatar(appearance) || !this.connected) return Promise.reject(new Error('连接恢复后才能定制角色'));
    const requestId = `${Date.now()}-${++this.customizationSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.customizations.delete(requestId); reject(new Error('确认超时，请重试')); }, 5000);
      this.customizations.set(requestId, { resolve, reject, timer });
      if (!this.signalSend('customize', { requestId, appearance: cleanAvatar(appearance) })) {
        clearTimeout(timer); this.customizations.delete(requestId); reject(new Error('连接恢复后才能定制角色'));
      }
    });
  }
}
