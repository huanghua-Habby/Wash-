/** Emote art: text-free colored-pencil kitten stickers cut from output/imagegen/wash-emotes-v1.png
 * (scripts/cut-emote-sheet.py → 256px transparent WebP), so no per-language images are needed.
 * All eight decode before startup reveal (`emoteIconsReady`); showing an emote never fetches. */
const IDS = ['nice', 'hi', 'help', 'here', 'sad', 'laugh', 'angry', 'wow'];
const URLS = Object.freeze({
  nice: new URL('../../assets/emotes/nice.webp', import.meta.url).href,
  hi: new URL('../../assets/emotes/hi.webp', import.meta.url).href,
  help: new URL('../../assets/emotes/help.webp', import.meta.url).href,
  here: new URL('../../assets/emotes/here.webp', import.meta.url).href,
  sad: new URL('../../assets/emotes/sad.webp', import.meta.url).href,
  laugh: new URL('../../assets/emotes/laugh.webp', import.meta.url).href,
  angry: new URL('../../assets/emotes/angry.webp', import.meta.url).href,
  wow: new URL('../../assets/emotes/wow.webp', import.meta.url).href,
});

/** Localization source names per id (Chinese source; English in the word list). */
export const EMOTE_NAMES = Object.freeze({ nice: '好耶', hi: '你好', help: '帮帮我', here: '来这里', sad: '难过', laugh: '哈哈', angry: '生气', wow: '哇！' });

let ready = null;
/** One decode of every emote image; UIManager hands the promise to SceneReadiness. */
export function emoteIconsReady() {
  ready ??= Promise.all(IDS.map(id => { const image = new Image(); image.src = URLS[id]; return image.decode(); }));
  return ready;
}

/** A fresh decorative image for one emote id; the caller supplies the accessible name. */
export function emoteIcon(id) {
  const image = document.createElement('img');
  for (const [key, value] of [['alt', ''], ['draggable', 'false'], ['decoding', 'sync'], ['aria-hidden', 'true'], ['class', `emote-icon emote-${id}`]]) image.setAttribute(key, value);
  if (URLS[id]) image.setAttribute('src', URLS[id]);
  return image;
}

/** Soft rounded paper card with the tail a third in from the left; the tail tip sits at x = 88/3 on the
 * bottom edge of the 88×92 view box. CSS shifts the art so that tip lands on the node's bottom-centre,
 * which WorldHudPositioner pins to the world anchor above the player's head. */
const NS = 'http://www.w3.org/2000/svg', INK = '#4b4541';
const BUBBLE = 'M26 2H62A24 24 0 0186 26V52A24 24 0 0162 76H38.5L29.33 90 22.5 76H26A24 24 0 012 52V26A24 24 0 0126 2Z';
export function emoteBubbleFrame() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 88 92'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'emote-frame');
  for (const attributes of [
    { d: BUBBLE, fill: '#fbf4e4', stroke: INK, 'stroke-width': 2.6, 'stroke-linejoin': 'round' },
    { d: 'M14 24q2-9 11-11', fill: 'none', stroke: '#fffdf7', 'stroke-width': 3.2, 'stroke-linecap': 'round' },
  ]) {
    const path = document.createElementNS(NS, 'path');
    for (const [key, value] of Object.entries(attributes)) path.setAttribute(key, String(value));
    svg.appendChild(path);
  }
  return svg;
}
