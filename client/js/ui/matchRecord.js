/** Presentation helpers for the per-player match record (Tab board, "+N" chip, versus results). Read-only: numbers and
 * titles come from shared/sim/PlayerStats.js over the applied snapshot, names from each page's roster. */
import { format, literal } from '../i18n/Localization.js';
import { animalInfo, AVATAR_COLORS } from '../../../shared/avatar.js';
import { rankPlayers } from '../../../shared/sim/PlayerStats.js';

/** Title name and the one-line reason shown under it. `tone` picks the badge color. */
export const TITLES = Object.freeze({
  mvp: { name: '全场MVP', reason: '评分最高', tone: 'gold' },
  villain: { name: '大恶人', reason: '干扰对手最多', tone: 'villain' },
  worker: { name: '劳模', reason: '干活最多', tone: 'work' },
  smearer: { name: '抹脏大师', reason: '抹脏、冲回对面最多', tone: 'villain' },
  bouncer: { name: '踢下车专家', reason: '把人弄下车最多', tone: 'villain' },
  smacker: { name: '拍拍狂魔', reason: '拍中别人最多', tone: 'villain' },
  battery: { name: '充电宝', reason: '充电最久', tone: 'work' },
  traitor: { name: '内鬼', reason: '拍、推、吞队友最多', tone: 'odd' },
  punchbag: { name: '人肉沙包', reason: '挨拍、掉车最多', tone: 'odd' },
  slacker: { name: '摸鱼王', reason: '评分最低', tone: 'odd' },
  prankster: { name: '捣蛋鬼', reason: '捣蛋最多', tone: 'villain' },
  laundry: { name: '洗衣工', reason: '洗毛巾最多', tone: 'work' },
});

/** A slot's shown name: the roster or bot name as literal text, else "玩家 n". */
export const playerName = (player, slot) => player?.displayName ? literal(player.displayName) : format('玩家 {0}', slot + 1);

/** Occupied slots of the applied world, ranked and titled. `winner` only matters for the versus MVP. */
export function liveRecord(game, players, winner = null) {
  const mode = game.mode === 'versus' ? 'versus' : 'coop';
  const entries = (players || []).flatMap((player, slot) => player && player.occupied !== false && player.sceneReady !== false
    ? [{ slot, team: mode === 'versus' ? player.team : null, stats: game.stats?.[slot] || {} }] : []);
  return decorate(rankPlayers(entries, { mode, winner }), players);
}

/** The frozen roster of a versus result (`result.roster`), ranked and titled with the final winner. */
export function resultRecord(result, players, statKeys) {
  const entries = (result.roster || []).map(entry => ({ slot: entry.slot, team: entry.team,
    stats: Object.fromEntries(statKeys.map((key, i) => [key, entry.stats?.[i] || 0])), animal: entry.animal, bot: entry.bot }));
  const ranked = rankPlayers(entries, { mode: 'versus', winner: result.winner });
  ranked.forEach(row => { const entry = entries.find(item => item.slot === row.slot); row.animal = entry.animal; row.bot = entry.bot; });
  return decorate(ranked, players);
}

function decorate(rows, players) {
  return rows.map(row => {
    const player = players?.[row.slot];
    return { ...row, name: playerName(player, row.slot), bot: row.bot ?? !!player?.isBot,
      animal: animalInfo(row.animal || player?.appearance?.animal)?.name || '',
      color: AVATAR_COLORS[player?.appearance?.color] || '#9aa59b' };
  });
}
