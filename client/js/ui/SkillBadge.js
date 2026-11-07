import { localizedText, localizedAttr } from '../i18n/Localization.js';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { ANIMAL_DESCRIPTIONS } from './animalDescriptions.js';

/** How long the "ready again" pop lasts. */
const READY = 0.32;
// Pelican and elephant reuse the CooldownHint art; the other five are placeholders until the art team draws them.
const ICONS = Object.freeze({
  pelican: 'M3 10.5c4-4 11-5 18-1.5-2 2.6-5.5 4-9 4.2l-1 3.3-2.4-3.3C6 13 4.2 12 3 10.5z',
  elephant: 'M12 2.5C9 7 5.5 10.6 5.5 14.6a6.5 6.5 0 0013 0C18.5 10.6 15 7 12 2.5z',
  cat: 'M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z',
  dog: 'M8.5 9a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM17 3.5a3 3 0 110 6 3 3 0 010-6zM18 14a2.2 2.2 0 110 4.4 2.2 2.2 0 010-4.4z',
  squirrel: 'M5 10.5a7 4.2 0 0114 0zM6 11.5h12c-.3 5.6-3 8.8-6 9.8-3-1-5.7-4.2-6-9.8zM11 2.5h2v4h-2z',
  goose: 'M2 15.5c6-.5 10.5-4.5 12.5-11 1.4 3.6.6 7-1.6 9.2 3-.6 6.2-.2 9.1 1.3-4.6 3.6-12.4 5-20 .5z',
  kangaroo: 'M7.5 3.5h6.5a5 5 0 015 5v5.5a4 4 0 01-4 4H10l-1.6 3H5.5v-5.2A5 5 0 014 12.4V7a3.5 3.5 0 013.5-3.5z',
});
const L_KEY = new Set(['pelican', 'elephant']);

const out = player => player.stunRemaining > 0 || player.downRemaining > 0 || player.state === 'swallowed';

/** What the badge shows for the local player's own shared state: `look` is on (in effect), idle (half see-through),
 * cool (recharging, grey sweep) or off (cannot act); `left` is the grey share of the ring (0 none … 1 all). */
export function skillBadgeState(player) {
  const animal = player.animal;
  if (animal === 'cat' && player.state === 'fallen') {
    const wait = C.respawnSeconds * (1 - C.catRespawnReduction);
    return { look: 'on', left: Math.min(1, Math.max(0, (player.fallTimer || 0) / wait)) };
  }
  if (player.state === 'fallen' || out(player)) return { look: 'off', left: 0 };
  switch (animal) {
    case 'dog': return { look: ['soap', 'wash', 'wipe'].includes(player.useAction) ? 'on' : 'idle', left: 0 };
    case 'pelican': {
      const left = Math.min(1, (player.swallowCooldown || 0) / C.swallowCooldownSeconds);
      return { look: left > 0 ? 'cool' : 'on', left };
    }
    case 'elephant': {
      const trunk = player.trunk;
      const left = trunk ? Math.min(1, Math.max(0, 1 - trunk.water)) : 0;
      return { look: trunk?.empty ? 'cool' : 'on', left };
    }
    case 'squirrel': {
      const left = Math.min(1, (player.wallTime || 0) / C.squirrelGripSeconds);
      if (player.state !== 'air') return { look: 'idle', left: 0 };
      if (player.wall && !(player.wall.ladder >= 0)) return { look: 'on', left };
      return left >= 1 ? { look: 'cool', left: 1 } : { look: 'idle', left: 0 };
    }
    case 'goose': {
      if (player.state !== 'air') return { look: 'on', left: 0 };
      const glide = player.glideRemaining ?? C.gooseGlideSeconds;
      const left = Math.min(1, Math.max(0, 1 - glide / C.gooseGlideSeconds));
      return { look: glide > 0 ? 'on' : 'idle', left };
    }
    case 'kangaroo': return { look: 'on', left: 0 };
    default: return { look: 'idle', left: 0 };
  }
}

/** Versus only: a big always-there skill icon at the bottom left, so players know their animal has a skill and when it
 * works. Presentation only; it reads the local player's applied shared state and the host still decides everything. */
export class SkillBadge {
  constructor(motionAllowed = () => true) {
    this.motionAllowed = motionAllowed;
    this.root = document.createElement('section'); this.root.className = 'skill-badge'; this.root.hidden = true;
    this.ring = document.createElement('div'); this.ring.className = 'skill-badge-ring';
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    this.icon = document.createElementNS(ns, 'path'); svg.appendChild(this.icon);
    this.key = document.createElement('kbd'); this.key.className = 'skill-badge-key'; this.key.textContent = 'L';
    this.ring.append(svg, this.key);
    this.name = document.createElement('span'); this.name.className = 'skill-badge-name';
    this.root.append(this.ring, this.name);
    document.getElementById('game-controls').appendChild(this.root);
    this.animal = ''; this.look = ''; this.ready = 0; this.left = -1;
  }

  /** Once per frame before the input is sampled: a refused L shakes the badge (CooldownHint plays the sound). */
  handle(localInput, player, allowed) {
    if (!allowed || this.root.hidden || !player || !L_KEY.has(player.animal) || !localInput?.hit('KeyL')) return;
    if (skillBadgeState(player).look !== 'cool' || !this.motionAllowed()) return;
    this.root.classList.remove('nope'); void this.root.offsetWidth; this.root.classList.add('nope');
  }

  update(dt, visible, player) {
    if (!visible || !player || player.occupied === false) { this.hide(); return; }
    if (player.animal !== this.animal) this.setAnimal(player.animal);
    const { look, left } = skillBadgeState(player);
    if (look !== this.look) {
      if (this.look === 'cool' && look === 'on' && this.motionAllowed()) { this.ready = READY; this.root.classList.add('ready'); }
      this.look = look; this.root.dataset.look = look;
    }
    if (this.ready) { this.ready = Math.max(0, this.ready - dt); if (!this.ready) this.root.classList.remove('ready'); }
    const rounded = Math.round(left * 100) / 100;
    if (rounded !== this.left) { this.left = rounded; this.ring.style.setProperty('--left', String(rounded)); }
    this.root.hidden = false;
  }

  setAnimal(animal) {
    this.animal = animal; this.look = ''; this.left = -1;
    this.icon.setAttribute('d', ICONS[animal] || ICONS.cat);
    this.root.dataset.animal = animal; this.key.hidden = !L_KEY.has(animal);
    const tag = ANIMAL_DESCRIPTIONS[animal]?.tag || '';
    localizedText(this.name, tag); localizedAttr(this.root, 'aria-label', tag);
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true; this.ready = 0; this.root.classList.remove('ready', 'nope');
  }
  dispose() { this.root.remove(); }
}
