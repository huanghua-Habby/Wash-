import { format, literal } from '../i18n/Localization.js';

/** Registry membership edges only: scene epochs, renames and retained reconnect seats are not arrivals. */
export class RoomArrivalNotices {
  constructor() { this.scope = null; this.members = new Set(); this.pending = []; }

  observe(room) {
    if (!room) return;
    const scope = `${room.code}:${room.hostId}`;
    const changed = scope !== this.scope;
    if (changed) {
      // The first roster establishes a baseline (including a restored browser session).
      this.pending = this.scope !== null && room.playerId !== room.hostId ? [{ kind: 'entered', id: room.hostId }] : [];
      this.scope = scope;
    } else {
      for (const member of room.members) {
        if (member.id !== room.playerId && !this.members.has(member.id)) this.pending.push({ kind: 'arrival', id: member.id });
      }
    }
    this.members = new Set(room.members.map(member => member.id));
    this.pending = this.pending.filter(notice => this.members.has(notice.id));
    return changed;
  }

  take(room) {
    if (!room || `${room.code}:${room.hostId}` !== this.scope) return null;
    while (this.pending.length) {
      const notice = this.pending.shift(), member = room.members.find(member => member.id === notice.id);
      if (!member?.connected) continue;
      return format(notice.kind === 'entered' ? '已进入{0}的房间！' : '新玩家入场：{0}', literal(member.name));
    }
    return null;
  }
}
