import { localizedAttr, format } from '../i18n/Localization.js';
import { createRatingStars } from './RatingStars.js';

/** Read-only authority progress. Three shared star silhouettes, no visible text or local award logic. */
export class ScoreRatingHud {
  constructor(parent) {
    this.root = document.createElement('div'); this.root.className = 'score-rating'; this.root.hidden = true;
    this.track = document.createElement('div'); this.track.className = 'score-rating-track';
    this.track.setAttribute('role', 'progressbar'); localizedAttr(this.track, 'aria-label', '星级进度'); this.track.setAttribute('aria-valuemin', '0');
    this.fill = document.createElement('i'); this.track.appendChild(this.fill);
    this.stars = createRatingStars(0, 'score-rating-stars');
    this.root.append(this.track, this.stars); parent.appendChild(this.root);
  }
  update(state, visible) {
    this.root.hidden = !visible || !state;
    if (this.root.hidden) return;
    const top = state.thresholds[2];
    this.track.setAttribute('aria-valuemax', String(top)); this.track.setAttribute('aria-valuenow', String(Math.min(top, state.score)));
    this.fill.style.width = `${state.ratio * 100}%`;
    localizedAttr(this.stars, 'aria-label', format("{0} 星，共 3 星", state.stars));
    [...this.stars.children].forEach((star, i) => {
      star.classList.toggle('earned', i < state.stars);
      star.style.left = `${state.thresholds[i] / top * 100}%`;
    });
  }
  reset() { this.root.hidden = true; }
  dispose() { this.root.remove(); }
}
