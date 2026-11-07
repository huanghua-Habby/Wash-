import { localizedText, localizedAttr, format } from '../i18n/Localization.js';
const NS = 'http://www.w3.org/2000/svg';
// One rounded silhouette shared by the score receipt and the level cards.
const SHAPE = 'M28.7 8.2Q32 1.6 35.3 8.2L41.4 20.5 55 22.5Q62.3 23.6 57 28.8L47.2 38.4 49.5 52Q50.7 59.3 44.2 55.9L32 49.5 19.8 55.9Q13.3 59.3 14.5 52L16.8 38.4 7 28.8Q1.7 23.6 9 22.5L22.6 20.5Z';

function starImage(className) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 66'); svg.setAttribute('class', className); svg.setAttribute('aria-hidden', 'true');
  for (const [name, attributes] of [
    ['depth', { transform: 'translate(0 4)' }], ['face', {}],
    ['shine', { d: 'M25.4 24.4 32 11.2 38.6 24.4 52.8 26.5', fill: 'none' }],
  ]) {
    const path = document.createElementNS(NS, 'path');
    for (const [key, value] of Object.entries({ d: SHAPE, class: `star-${name}`, ...attributes })) path.setAttribute(key, value);
    svg.appendChild(path);
  }
  return svg;
}

export function createRatingStars(count, className = '', waiting = false) {
  const root = document.createElement('div'); root.className = `rating-stars ${className}`;
  root.setAttribute('role', 'img'); localizedAttr(root, 'aria-label', format("{0} 星，共 3 星", count));
  for (let index = 0; index < 3; index++) {
    const star = document.createElement('span'); star.className = 'rating-star';
    star.classList.toggle('earned', index < count); star.classList.toggle('waiting', waiting && index < count);
    star.setAttribute('aria-hidden', 'true');
    star.append(starImage('star-empty'), starImage('star-gold'));
    const glint = document.createElement('i'); glint.className = 'star-glint'; star.appendChild(glint);
    root.appendChild(star);
  }
  return root;
}

export async function prepareRatingStars() {
  const sample = createRatingStars(2, 'rating-stars-prewarm'); sample.setAttribute('aria-hidden', 'true');
  document.body.appendChild(sample);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  sample.remove();
}

/** Presentation time only; the star count always comes from the authority receipt. */
export class ResultReveal {
  constructor({ stars, score, value, onStar = () => {} }) {
    Object.assign(this, { stars, score, value, onStar });
    this.earned = [...stars.querySelectorAll('.earned')];
    this.elapsed = 0; this.lit = 0; this.finished = false;
  }
  update(dt, visible, motionAllowed) {
    if (this.finished || !visible) return;
    if (!motionAllowed) { this.finish(); return; }
    this.elapsed += Math.max(0, Math.min(.1, dt));
    const progress = Math.min(1, this.elapsed / .65);
    localizedText(this.score, Math.round(this.value * (1 - (1 - progress) ** 3)).toLocaleString('zh-CN'));
    const earned = this.earned;
    for (let index = this.lit; index < earned.length && this.elapsed >= .85 + index * .42; index++) {
      earned[index].classList.remove('waiting'); earned[index].classList.add('star-pop');
      this.lit++; this.onStar(index);
    }
    if (this.elapsed >= .85 + Math.max(0, earned.length - 1) * .42 + .6) this.finish();
  }
  finish() {
    this.finished = true; localizedText(this.score, this.value.toLocaleString('zh-CN'));
    for (const star of this.stars.children) star.classList.remove('waiting', 'star-pop');
  }
  dispose() { this.finish(); this.onStar = () => {}; }
}
