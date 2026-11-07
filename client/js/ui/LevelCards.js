import { localizedText, localizedAttr, localizedNode, format } from '../i18n/Localization.js';
import { createRatingStars } from './RatingStars.js';

/** Current levels stay open. Disabled is supplied by existing host/availability gates. */
export function createLevelCard(level, stats, { playable, onSelect }) {
  const tutorial = level.rating?.mode === 'tutorial';
  const mastered = tutorial ? stats?.tutorialCompleted === true : stats?.bestStars === 3;
  const state = !playable ? 'unavailable' : mastered ? 'mastered' : 'available';
  const card = document.createElement('button'); card.type = 'button'; card.className = `level-card ${state}`;
  card.dataset.levelId = level.id; card.dataset.status = state; card.disabled = !playable;
  const number = document.createElement('span'); number.className = 'level-number'; localizedText(number, level.number);
  const copy = document.createElement('span'); copy.className = 'level-copy';
  const title = document.createElement('strong'); title.className = 'level-title'; localizedText(title, level.name);
  copy.appendChild(title);
  if (tutorial) {
    const status = document.createElement('span'); status.className = 'level-tutorial-status';
    localizedText(status, stats?.tutorialCompleted ? '教程完成！' : '未完成'); copy.appendChild(status);
  } else {
    copy.appendChild(createRatingStars(stats?.bestStars || 0, 'level-stars'));
    const record = document.createElement('span'); record.className = 'level-record'; record.append(localizedNode('最高分 '));
    const value = document.createElement('b'); localizedText(value, (stats?.bestScore || 0).toLocaleString('zh-CN')); record.appendChild(value);
    if (stats?.finishedRuns && Number.isInteger(stats.bestScorePlayers)) {
      const players = document.createElement('small'); players.className = 'level-record-players';
      localizedText(players, format("{0}人", stats.bestScorePlayers)); localizedAttr(players, 'aria-label', format("{0}人游玩时的最高分", stats.bestScorePlayers));
      record.appendChild(players);
    }
    copy.appendChild(record);
  }
  const ribbon = document.createElement('span'); ribbon.className = 'level-ribbon'; ribbon.setAttribute('aria-hidden', 'true');
  const mark = document.createElement('span'); localizedText(mark, !playable ? '待开启' : mastered ? tutorial ? '已完成' : '满星' : '已解锁');
  ribbon.appendChild(mark); card.append(number, copy, ribbon);
  card.addEventListener('click', () => { if (!card.disabled) onSelect(level.id); });
  return card;
}

/** Versus map card in the same paper style: name and description, the host's current pick ribbon-marked. Picking a map
 * only chooses it; the match starts from the main button. */
export function createMapCard(level, { selected, playable, onSelect }) {
  const state = !playable ? 'unavailable' : selected ? 'mastered' : 'available';
  const card = document.createElement('button'); card.type = 'button'; card.className = `level-card map-card ${state}`;
  card.dataset.levelId = level.id; card.dataset.status = state; card.disabled = !playable; card.setAttribute('aria-pressed', String(selected));
  const number = document.createElement('span'); number.className = 'level-number'; localizedText(number, level.number);
  const copy = document.createElement('span'); copy.className = 'level-copy';
  const title = document.createElement('strong'); title.className = 'level-title'; localizedText(title, level.name);
  const description = document.createElement('span'); description.className = 'level-record'; localizedText(description, level.description);
  copy.append(title, description);
  const ribbon = document.createElement('span'); ribbon.className = 'level-ribbon'; ribbon.setAttribute('aria-hidden', 'true');
  const mark = document.createElement('span'); localizedText(mark, selected ? '当前地图' : '选择'); ribbon.appendChild(mark);
  card.append(number, copy, ribbon);
  card.addEventListener('click', () => { if (!card.disabled) onSelect(level.id); });
  return card;
}

