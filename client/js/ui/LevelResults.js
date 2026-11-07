import { localizedText, localizedAttr, format } from '../i18n/Localization.js';
/** Render an authority-issued outcome. No score/threshold arithmetic or save writes belong here. */
import { createRatingStars, ResultReveal } from './RatingStars.js';
export function resultTitle(result) {
  if (result.reason === 'tutorial_complete') return '教程结束！';
  return result.outcome === 'success' ? '作业完成！' : '再试一次吧！';
}

export function mountLevelResults(content, result, { canControl, onNext, onRetry, onHome, homeLabel = '回到主页', animated = false, onStar = () => {}, onError = () => {} }) {
  const tutorial = result.ratingMode === 'tutorial';
  const success = result.outcome === 'success';
  const summary = document.createElement('div'); summary.className = `level-result ${success ? 'success' : 'failure'}`;
  let reveal = null;
  if (!tutorial) {
    const stars = createRatingStars(result.stars, 'result-stars', animated);
    const label = document.createElement('p'); label.className = 'result-score-label'; localizedText(label, '本次得分');
    const score = document.createElement('strong'); score.className = 'result-score'; localizedAttr(score, 'aria-label', format("{0} 分", result.score));
    const value = document.createElement('b'); localizedText(value, animated ? '0' : result.score.toLocaleString('zh-CN'));
    const unit = document.createElement('small'); localizedText(unit, '分'); score.append(value, unit);
    const details = document.createElement('p'); details.className = 'result-details';
    localizedText(details, format("洗净 {0} 辆 · 错过 {1} 辆", result.completedOrders, result.missed));
    summary.append(stars, label, score, details);
    if (animated) reveal = new ResultReveal({ stars, score: value, value: result.score, onStar });
  } else {
    const seal = document.createElement('div'); seal.className = 'tutorial-complete-mark'; seal.setAttribute('aria-hidden', 'true');
    seal.innerHTML = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="39"/><path d="m29 51 14 14 29-30"/></svg>';
    const caption = document.createElement('p'); caption.className = 'level-result-caption'; localizedText(caption, '准备好去下一站了吗？');
    summary.append(seal, caption);
  }
  const actions = document.createElement('div'); actions.className = 'pause-actions result-actions';
  let pending = false;
  const buttons = new Map();
  const restore = () => { pending = false; actions.removeAttribute('aria-busy'); for (const [node, disabled] of buttons) node.disabled = disabled; };
  const button = (label, className, action, disabled = false) => {
    const node = document.createElement('button'); node.className = `menu-button ${className}`; localizedText(node, label); node.disabled = disabled;
    node.addEventListener('click', () => {
      if (node.disabled || pending) return;
      pending = true; actions.setAttribute('aria-busy', 'true');
      for (const item of buttons.keys()) item.disabled = true;
      try {
        const response = action();
        if (response === false) restore();
        else if (response?.then) response.catch(error => { restore(); onError(error); });
      } catch (error) { restore(); onError(error); }
    }); actions.appendChild(node);
    buttons.set(node, disabled);
  };
  if (success && result.nextLevelId) button('下一关', 'primary result-next', () => onNext(result.nextLevelId), !canControl);
  button(success ? '重玩这一关' : '重试', `${!success ? 'primary ' : ''}result-retry`, () => onRetry(result.levelId), !canControl);
  button(homeLabel, 'result-home', onHome);
  if (!canControl) {
    const note = document.createElement('p'); note.className = 'dialog-note'; localizedText(note, '由房主选择下一关或重玩'); summary.appendChild(note);
  }
  content.append(summary, actions);
  return reveal;
}
