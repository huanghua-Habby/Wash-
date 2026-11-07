/** Hold-Tab match board (UIManager panel): who did the most work and who caused the most trouble, ranked live.
 * Co-op ranks one crew by contribution with mischief beside it; versus shows the two teams with contribution,
 * disruption and rating. Read-only over the applied snapshot; it never blocks input. */
import { localizedText, localizedAttr, format } from '../i18n/Localization.js';
import { TITLES, liveRecord } from './matchRecord.js';

const REFRESH = 0.2; // Seconds between rebuilds while open; numbers move with every wipe.
const TEAM = ['红队', '蓝队'];

const el = (tag, className, text) => {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) localizedText(node, text);
  return node;
};

export class Scoreboard {
  constructor(motionAllowed) {
    this.motionAllowed = motionAllowed;
    this.root = el('section', 'scoreboard'); this.root.hidden = true;
    localizedAttr(this.root, 'aria-label', '战绩榜');
    // Title only: the live score stays visible in the top HUD (the board sits below it).
    const header = el('header', 'scoreboard-header');
    this.title = el('h2', 'scoreboard-title');
    header.append(this.title);
    this.body = el('div', 'scoreboard-body');
    this.root.append(header, this.body);
    document.getElementById('ui-stage').appendChild(this.root);
    this.reset();
  }

  /** @param {boolean} open Tab held in a running match. */
  update(dt, open, game, players, localSlot) {
    if (!open || !game?.active) { this.close(); return; }
    this.wait -= dt;
    const opening = this.root.hidden;
    if (opening) {
      this.root.hidden = false; this.wait = 0;
      if (this.motionAllowed()) this.root.animate([{ opacity: 0, transform: 'translate(-50%, -10px) scale(.97)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 150, easing: 'ease-out' });
    }
    // Team scores follow the top HUD every frame (cheap text writes); the tables rebuild on the slower REFRESH.
    if (game.mode === 'versus') for (const node of this.body.querySelectorAll('.scoreboard-team-score')) {
      const value = String(game.teamScores?.[Number(node.dataset.team)] ?? 0); if (node.textContent !== value) node.textContent = value;
    }
    if (this.wait > 0) return;
    this.wait = REFRESH;
    const versus = game.mode === 'versus', rows = liveRecord(game, players);
    const signature = JSON.stringify([versus, localSlot, game.teamScores, rows.map(row => [row.slot, row.team, row.title, row.points, row.stats.stains, Math.round(row.stats.charge), row.stats.slaps, row.stats.knockoffs])]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.dataset.mode = versus ? 'versus' : 'coop';
    localizedText(this.title, versus ? '对抗战绩' : '本局贡献榜');
    this.body.replaceChildren(...(versus
      ? [0, 1].map(team => this.teamBlock(team, rows.filter(row => row.team === team), localSlot, game.teamScores?.[team] ?? 0))
      : [this.table(rows, localSlot, false)]));
  }

  /** Same card as the results page: saturated header strip (team and live score) over a light tint with the table. */
  teamBlock(team, rows, localSlot, score) {
    const block = el('section', `scoreboard-team team-${team}`);
    const heading = el('header', 'scoreboard-team-head');
    const value = el('b', 'scoreboard-team-score', String(score)); value.dataset.team = String(team);
    heading.append(el('h3', 'scoreboard-team-name', TEAM[team]), value);
    block.append(heading, this.table(rows, localSlot, true));
    return block;
  }

  table(rows, localSlot, versus) {
    const table = el('div', 'scoreboard-table');
    table.setAttribute('role', 'table');
    const head = el('div', 'scoreboard-row scoreboard-head'); head.setAttribute('role', 'row');
    for (const [label, className] of [['#', 'rank'], ['玩家', 'name'], ['称号', 'title'], ['贡献', 'num work'], [versus ? '干扰' : '捣蛋', 'num harm'], [versus ? '评分' : '战绩', versus ? 'num rating' : 'detail']]) {
      const cell = el('span', `sb-${className.split(' ')[0]} ${className}`, label); cell.setAttribute('role', 'columnheader'); head.appendChild(cell);
    }
    table.appendChild(head);
    if (!rows.length) { table.appendChild(el('p', 'scoreboard-empty', '暂无队员')); return table; }
    rows.forEach((row, index) => {
      const line = el('div', `scoreboard-row${row.slot === localSlot ? ' local' : ''}`); line.setAttribute('role', 'row');
      const rank = el('b', 'sb-rank', String(versus ? index + 1 : row.rank));
      const name = el('span', 'sb-name');
      const dot = el('i', 'sb-dot'); dot.style.background = row.color;
      const label = el('span', 'sb-label'); localizedText(label, row.name);
      name.append(dot, label);
      const title = el('span', 'sb-title');
      if (row.title) { title.classList.add(`tone-${TITLES[row.title].tone}`); localizedText(title, TITLES[row.title].name); }
      const work = el('span', 'sb-num work', String(row.points.contribution));
      const harm = el('span', 'sb-num harm', String(versus ? row.points.disruption : row.points.mischief));
      const last = versus ? el('span', 'sb-num rating', String(row.points.rating))
        : el('span', 'sb-detail', format('洗净 {0} · 充电 {1}s · 拍人 {2}', row.stats.stains, Math.round(row.stats.charge), row.stats.slaps));
      for (const cell of [rank, name, title, work, harm, last]) cell.setAttribute('role', 'cell');
      line.append(rank, name, title, work, harm, last);
      table.appendChild(line);
    });
    return table;
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true; this.root.getAnimations().forEach(animation => animation.cancel());
  }
  reset() { this.close(); this.signature = ''; this.wait = 0; }
  dispose() { this.reset(); this.root.remove(); }
}
