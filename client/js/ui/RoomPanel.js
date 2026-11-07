import { localizedText, localizedAttr, format, literal } from '../i18n/Localization.js';
/** Room ticket in the home screen: current room code, prominent occupant count and role-dependent primary action. */
import { parseName, capacityFor, TEAMS, TEAM_CAPACITY } from '../../../shared/protocol.js';
import { AVATAR_COLORS, animalInfo, breedInfo, cleanAvatar } from '../../../shared/avatar.js';
import { RoomArrivalNotices } from './RoomArrivalNotices.js';
import { teamColor } from '../core/teamColors.js';

const CROWN = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2 12h12l1-7-3.5 2.5L8 3 4.5 7.5 1 5z"/></svg>';
export class RoomPanel {
  constructor(connection,ui) {
    this.connection = connection; this.ui = ui;
    this.arrivals = new RoomArrivalNotices(); this.arrivals.observe(connection.room); this.arrivalDelay = 0;
    this.root = document.getElementById('room-panel');
    this.name = document.getElementById('player-name');
    this.code = document.getElementById('join-code');
    this.message = document.getElementById('room-message');
    this.name.value = connection.name;
    this.editor = document.getElementById('player-name-editor');
    this.summary = document.getElementById('profile-summary');
    this.joinForm = document.getElementById('join-room-form');
    this.toast = document.createElement('p'); this.toast.className = 'network-toast'; this.toast.hidden = true; this.toast.setAttribute('role','status'); document.getElementById('ui-stage').appendChild(this.toast);
    this.pending = false;
    // Versus team card (its own card under the sidebar book): one block per team in the team color, four reusable seats
    // each a portrait (same art as "my character") with small badges for host / ready and a white outline for you. The
    // name is the tooltip and the accessible label. The "join" button lives in the other team's block.
    this.teams = document.getElementById('room-teams');
    this.teamBlocks = TEAMS.map(team => {
      const block = this.teams.querySelector(`.team-block[data-team="${team}"]`), list = block.querySelector('.team-seats');
      const seats = Array.from({ length: TEAM_CAPACITY }, () => {
        const seat = document.createElement('li'), coat = document.createElement('i'), badge = document.createElement('b'), tip = document.createElement('span');
        seat.className = 'team-seat'; coat.className = 'coat-sample'; coat.hidden = true; seat.tabIndex = -1;
        badge.className = 'seat-badge'; badge.setAttribute('aria-hidden', 'true');
        tip.className = 'seat-tip'; tip.setAttribute('aria-hidden', 'true');
        seat.append(coat, badge, tip); list.appendChild(seat); return { seat, coat, badge, tip };
      });
      const join = block.querySelector('.team-join');
      block.style.setProperty('--team', teamColor(team));
      ui.listen(join, 'click', () => connection.setTeam(team));
      return { block, count: block.querySelector('.team-count'), join, seats };
    });
    ui.listen(document.getElementById('edit-player-name'), 'click', () => this.editName(!this.editingName));
    ui.listen(document.getElementById('toggle-join-room'), 'click', () => this.expandJoin(!this.joinExpanded));
    ui.listen(this.editor,'submit',(event) => {
      event.preventDefault();
      const name = parseName(this.name.value);
      if (!name) { localizedText(this.message, '最多 12 位英文 / 6 个汉字，中英混合折算'); this.name.value = connection.name; return; }
      this.name.value = name;
      if (!connection.rename(name)) { localizedText(this.message, '连接恢复后才能更改 ID'); return; }
      this.editName(false);
    });
    ui.listen(this.name,'keydown',(event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.editName(false); }
    });
    ui.listen(this.joinForm,'submit',(event) => {
      event.preventDefault();
      if (this.pending) return;
      const code = this.code.value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) { localizedText(this.message, '请输入 6 位房间码'); return; }
      if (!ui.joinProgress.start(code)) return;
      this.pending = connection.send('join',{code});
      if (!this.pending) ui.joinProgress.finish();
      localizedText(this.message, this.pending ? '正在加入…' : '连接恢复后才能加入');
      this.refresh();
    });
    ui.listen(this.code,'input',() => { this.code.value = this.code.value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6); });
    ui.listen(document.getElementById('room-action'),'click',async () => {
      if (!connection.connected || !connection.room) return;
      if (!connection.room.ownCode) { ui.open('leave-confirm'); return; }
      try { await navigator.clipboard.writeText(connection.room.ownCode); localizedText(this.message, '房间码已复制，发给朋友就能加入'); }
      catch { localizedText(this.message, '选中房间码即可复制'); }
    });
    ui.listen(connection,'room',() => {
      ui.joinProgress.observeRoom(connection.room);
      if (this.arrivals.observe(connection.room)) this.arrivalDelay = 0;
      this.pending = false; localizedText(this.message, ''); this.refresh(); if (!connection.room?.ownCode) this.expandJoin(false);
    });
    ui.listen(connection,'status',(event) => {
      const failed = ui.joinProgress.active && !connection.connected;
      if (failed) ui.joinProgress.finish();
      ui.notify(event.detail, event.detail !== '已连接', failed); localizedText(this.message, event.detail); this.pending = false; this.refresh();
    });
    ui.listen(connection,'message',(event) => {
      const failed = ui.joinProgress.failed || ui.joinProgress.active && event.detail.type === 'error';
      ui.joinProgress.failed = false;
      if (failed) ui.joinProgress.finish();
      ui.notify(event.detail.message, true, failed || event.detail.code === 'recovery_expired'); this.pending = false; localizedText(this.message, event.detail.message); this.refresh();
    });
    this.refresh();
  }
  editName(open) {
    this.editingName = open;
    if (open) this.expandJoin(false);
    this.ui.setDisclosure(this.summary, !open);
    this.ui.setDisclosure(this.editor, open);
    document.getElementById('edit-player-name').setAttribute('aria-expanded', String(open));
    this.name.value = this.connection.name;
    if (open) { this.name.focus(); this.name.select(); }
    else { this.name.blur(); document.getElementById('edit-player-name').focus({ preventScroll: true }); }
    this.ui.syncInteraction();
  }
  expandJoin(open) {
    this.joinExpanded = open;
    if (open && this.editingName) this.editName(false);
    if (!open && this.joinForm.contains(document.activeElement)) document.getElementById('toggle-join-room').focus({ preventScroll: true });
    this.ui.setDisclosure(this.joinForm, open);
    document.getElementById('toggle-join-room').setAttribute('aria-expanded', String(open));
    if (open) this.code.focus();
    this.ui.syncInteraction();
  }
  showToast(message, show = true, showAtHome = false) {
    clearTimeout(this.toastTimer); localizedText(this.toast, message); this.toast.hidden = !show;
    this.toast.classList.toggle('home-toast', showAtHome);
    if (show) this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, 5000);
  }
  update(dt) {
    this.arrivalDelay = Math.max(0, this.arrivalDelay - dt);
    const { connection, ui } = this;
    // Joining is only successful once the direct connection is open. Keep notices through startup/covering UI.
    if (this.arrivalDelay > 0 || !connection.playing || !ui.ready || ui.iris.active || ui.hasModal || !['home', 'game'].includes(ui.page)) return;
    const message = this.arrivals.take(connection.room);
    if (message) { ui.notify(message, true, true); this.arrivalDelay = 5; }
  }
  refresh() {
    const { room } = this.connection;
    const connected = this.connection.connected && !!room;
    const host = !!room?.ownCode;
    localizedText(document.getElementById('room-code-label'), connected && !host ? '当前房间' : '我的房间');
    localizedText(document.getElementById('room-code-value'), connected ? room.code : '连接中');
    const action = document.getElementById('room-action');
    action.disabled = !connected; localizedText(action, connected && !host ? '退出组队' : '复制');
    localizedAttr(action, 'aria-label', connected && !host ? '退出组队' : '复制房间码');
    action.classList.toggle('leave-room', connected && !host);
    localizedText(document.getElementById('room-role'), !connected ? '连接中' : format("{0} · {1}/{2}", host ? '房主' : '队友', room.members.length, capacityFor(this.ui.gameMode)));
    this.refreshTeams(connected ? room : null);
    const member = room?.members.find(member => member.id === this.connection.playerId);
    const appearance = cleanAvatar(member?.appearance, member?.slot ?? 0);
    document.getElementById('profile-name').textContent = this.connection.name;
    document.getElementById('profile-name').title = this.connection.name;
    localizedText(document.getElementById('profile-breed'), format("{0} · {1}", animalInfo(appearance.animal).name, breedInfo(appearance.animal, appearance.breed).name));
    // Versus frames your own portrait in your team's color (everyone is drawn in team colors there); co-op in your color.
    const team = this.ui.gameMode === 'versus' ? teamColor(member?.team) : null;
    document.getElementById('profile-portrait').style.setProperty('--profile-color', team || AVATAR_COLORS[appearance.color]);
    document.getElementById('profile-coat').className = `coat-sample ${appearance.animal}-sample coat-${appearance.breed}`;
    this.name.disabled = !connected;
    document.getElementById('edit-player-name').disabled = !connected;
    document.getElementById('save-player-name').disabled = !connected;
    document.getElementById('toggle-join-room').disabled = !connected || this.pending;
    document.getElementById('join-room').disabled = !connected || this.pending;
    if (document.activeElement !== this.name) this.name.value = this.connection.name;
  }
  /** Versus only: each team's four seats in slot order, and the "join" button in the other team's block. */
  refreshTeams(room) {
    const versus = !!room && this.ui.gameMode === 'versus';
    this.teams.hidden = !versus;
    // The taller versus card takes the space of the home controls card.
    document.body.classList.toggle('versus-room', versus);
    if (!versus) return;
    const mine = room.members.find(member => member.id === room.playerId)?.team;
    for (const [team, view] of this.teamBlocks.entries()) {
      const members = room.members.filter(member => member.team === team).sort((a, b) => a.slot - b.slot);
      localizedText(view.count, format("{0}/{1}", members.length, TEAM_CAPACITY));
      // Only the other team's button shows (you are always on one of the two).
      view.join.hidden = mine === undefined || mine === team;
      view.join.disabled = room.phase !== 'home' || members.length >= TEAM_CAPACITY || !this.connection.connected;
      view.seats.forEach(({ seat, coat, badge, tip }, i) => {
        const member = members[i];
        seat.toggleAttribute('data-empty', !member);
        seat.toggleAttribute('data-offline', !!member && !member.connected);
        seat.toggleAttribute('data-self', member?.id === room.playerId);
        const role = !member ? '' : member.id === room.hostId ? 'host' : member.ready ? 'ready' : '';
        if (seat.dataset.role !== role) { if (role) seat.dataset.role = role; else delete seat.dataset.role; }
        coat.hidden = !member;
        if (!member) {
          localizedText(tip, '空位'); localizedAttr(seat, 'aria-label', '空位'); badge.dataset.icon = ''; badge.textContent = ''; return;
        }
        const appearance = cleanAvatar(member.appearance, member.slot);
        const coatClass = `coat-sample ${appearance.animal}-sample coat-${appearance.breed}`;
        if (coat.className !== coatClass) coat.className = coatClass;
        if (badge.dataset.icon !== role) { badge.dataset.icon = role; badge.innerHTML = role === 'host' ? CROWN : role === 'ready' ? '✓' : ''; }
        // Name (user text) stays literal; the role words are localized and follow a language switch.
        const parts = [literal(member.name || '')];
        if (member.id === room.playerId) parts.push('你');
        if (role === 'host') parts.push('房主'); else if (role === 'ready') parts.push('已准备');
        if (!member.connected) parts.push('已掉线');
        const label = format(parts.map((_, k) => `{${k}}`).join(' · '), ...parts);
        localizedText(tip, label); localizedAttr(seat, 'aria-label', label);
      });
    }
  }
  dispose() { clearTimeout(this.toastTimer); this.toast.remove(); }
}
