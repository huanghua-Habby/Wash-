/** Versus end-of-match screen: a WIN / FAILED / DRAW banner in this page's colors, the final score, the awards (MVP,
 * 大恶人 …) and every player's contribution, disruption and rating per team. Presentation only: the record and the
 * winner come from the authority's frozen result. */
import { localizedText, localizedAttr, format } from '../i18n/Localization.js';
import { STAT_KEYS } from '../../../shared/sim/PlayerStats.js';
import { versusOutcomeCue } from './RoundCues.js';
import { TITLES, resultRecord } from './matchRecord.js';

const TEAM = ['红队', '蓝队'];
/** An equal final score is a draw (`winner: null`). */
export function versusResultTitle(result) { return result.winner === 0 ? '红队获胜！' : result.winner === 1 ? '蓝队获胜！' : '平局！'; }

const BANNER = {
  win: ['胜利', 'VICTORY'], lose: ['失败', 'DEFEAT'], draw: ['平局', 'DRAW'], red: ['红队胜', 'RED WINS'], blue: ['蓝队胜', 'BLUE WINS'],
};

const el = (tag, className, text) => {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) localizedText(node, text);
  return node;
};

/** The awards strip: one card per title, MVP first. */
function awards(rows) {
  const strip = el('div', 'vr-awards');
  const titled = rows.filter(row => row.title).sort((a, b) => Object.keys(TITLES).indexOf(a.title) - Object.keys(TITLES).indexOf(b.title));
  if (!titled.length) { strip.appendChild(el('p', 'vr-awards-empty', '这局大家都很低调，没有评出称号')); return strip; }
  for (const row of titled) {
    const title = TITLES[row.title];
    const card = el('article', `vr-award tone-${title.tone}${Number.isInteger(row.team) ? ` team-${row.team}` : ''}`);
    const badge = el('strong', 'vr-award-title', title.name);
    const name = el('span', 'vr-award-name'); localizedText(name, row.name);
    // The reason is a hover / focus tooltip, styled like the room-card seat tips on the versus home page.
    const tip = el('span', 'vr-award-tip', title.reason); tip.setAttribute('role', 'tooltip');
    card.tabIndex = 0; localizedAttr(card, 'aria-label', format('{0}：{1}（{2}）', title.name, row.name, title.reason));
    card.append(badge, name, tip);
    strip.appendChild(card);
  }
  return strip;
}

function teamTable(team, rows, result, localSlot) {
  const block = el('section', `vr-team team-${team}${result.winner === team ? ' winner' : ''}`);
  // Line 1: team name, team score and the small washed / cleaned / reworked totals on the same line.
  const head = el('header', 'vr-team-head');
  const name = el('strong', 'vr-team-name', TEAM[team]);
  const score = el('b', 'vr-team-score', String(result.teamScores[team]));
  const totals = el('small', 'vr-team-totals', format('洗完 {0} 辆 · 洗净 {1} 块 · 被返工 {2} 块', result.teamCompleted[team], result.teamCleaned?.[team] ?? 0, result.teamUndone?.[team] ?? 0));
  head.append(name, score, totals);
  const table = el('div', 'vr-table'); table.setAttribute('role', 'table');
  const header = el('div', 'vr-row vr-row-head'); header.setAttribute('role', 'row');
  for (const label of ['玩家', '贡献', '干扰', '评分']) { const cell = el('span', '', label); cell.setAttribute('role', 'columnheader'); header.appendChild(cell); }
  table.appendChild(header);
  rows.forEach(row => {
    const line = el('div', `vr-row${row.slot === localSlot ? ' local' : ''}`); line.setAttribute('role', 'row');
    const who = el('span', 'vr-who');
    const dot = el('i', 'vr-dot'); dot.style.background = row.color;
    const label = el('span', 'vr-name'); localizedText(label, row.name);
    who.append(dot, label);
    // Only the MVP carries a badge in the table (all titles still show as cards above); its rating is boxed too.
    const mvp = row.title === 'mvp';
    if (mvp) who.appendChild(el('em', 'vr-title tone-gold', TITLES.mvp.name));
    const cells = [who, el('span', 'vr-num', String(row.points.contribution)), el('span', 'vr-num', String(row.points.disruption)), el('b', `vr-num vr-rating${mvp ? ' mvp' : ''}`, String(row.points.rating))];
    for (const cell of cells) cell.setAttribute('role', 'cell');
    line.append(...cells);
    table.appendChild(line);
  });
  if (!rows.length) table.appendChild(el('p', 'vr-empty', '暂无队员'));
  block.append(head, table);
  return block;
}

export function mountVersusResults(content, result, { localTeam, localSlot = null, players = [], animated = false, canControl, homeLabel, onRetry, onHome, onError = () => {} }) {
  const outcome = versusOutcomeCue(result, localTeam);
  const summary = el('div', 'level-result versus-result');
  summary.dataset.winner = result.winner === 0 || result.winner === 1 ? String(result.winner) : 'draw';
  summary.dataset.outcome = outcome;
  // Banner: the big colored word for this page's side.
  const banner = el('div', 'vr-banner');
  const [word, english] = BANNER[outcome];
  banner.append(el('strong', 'vr-banner-word', word), el('span', 'vr-banner-sub', english));
  // Final score in team colors: 红 267 : 174 蓝.
  const score = el('strong', 'versus-result-score');
  const red = el('span', 'vr-score-red', format('红 {0}', result.teamScores[0])), blue = el('span', 'vr-score-blue', format('{0} 蓝', result.teamScores[1]));
  score.append(red, el('span', 'vr-score-colon', ':'), blue);
  const rows = resultRecord(result, players, STAT_KEYS);
  const record = el('div', 'vr-record');
  record.append(...[0, 1].map(team => teamTable(team, rows.filter(row => row.team === team), result, localSlot)));
  summary.append(banner, score, awards(rows), record);
  const actions = el('div', 'pause-actions result-actions');
  const button = (label, className, action, disabled = false) => {
    const node = el('button', `menu-button ${className}`, label); node.disabled = disabled;
    node.addEventListener('click', () => {
      if (node.disabled) return;
      for (const item of actions.querySelectorAll('button')) item.disabled = true;
      try { if (action() === false) for (const item of actions.querySelectorAll('button')) item.disabled = false; }
      catch (error) { onError(error); }
    });
    actions.appendChild(node);
  };
  button('再来一局', 'primary result-retry', () => onRetry(result.levelId), !canControl);
  button(homeLabel, 'result-home', onHome);
  if (!canControl) summary.appendChild(el('p', 'dialog-note', '由房主选择再来一局'));
  content.append(summary, actions);
  if (!animated) return null;
  // Staged reveal: banner slams in, then the awards pop one by one, then the tables slide up.
  const plays = [];
  plays.push(banner.animate(outcome === 'lose'
    ? [{ opacity: 0, transform: 'translateY(-40px) scale(1.2)' }, { opacity: 1, transform: 'translateY(4px) scale(1) rotate(-1.5deg)', offset: .6 }, { opacity: 1, transform: 'rotate(-1.5deg)' }]
    : [{ opacity: 0, transform: 'scale(.4) rotate(-6deg)' }, { opacity: 1, transform: 'scale(1.12) rotate(2deg)', offset: .6 }, { opacity: 1, transform: 'rotate(-1.5deg)' }],
  { duration: 520, easing: 'ease-out', fill: 'backwards' }));
  [...summary.querySelectorAll('.vr-award')].forEach((card, i) => plays.push(card.animate([
    { opacity: 0, transform: 'translateY(16px) scale(.7) rotate(-4deg)' }, { opacity: 1, transform: 'translateY(-3px) scale(1.06)', offset: .7 }, { opacity: 1, transform: 'none' },
  ], { duration: 360, delay: 420 + i * 130, easing: 'ease-out', fill: 'backwards' })));
  [...summary.querySelectorAll('.vr-team')].forEach((block, i) => plays.push(block.animate([
    { opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' },
  ], { duration: 320, delay: 380 + i * 90, easing: 'ease-out', fill: 'backwards' })));
  // Same contract as ResultReveal: MainMenu ticks it each frame; turning motion off mid-reveal shows the final layout.
  return { update: (_dt, _visible, motionAllowed) => { if (!motionAllowed) plays.forEach(play => play.finish()); },
    dispose: () => plays.forEach(play => play.cancel()) };
}
