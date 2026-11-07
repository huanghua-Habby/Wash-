/** Per-airtime animal abilities, refilled on landing: the pelican's and goose's glide (hold Space while falling) and the
 * goose's mid-air wing flap (a fresh Space). Values live in washConfig.js. No browser APIs. */
import { WASH_CONFIG as C } from './washConfig.js';

/** Glide seconds, glide sink speed and flaps per airtime for each animal that has them. */
const AIR = Object.freeze({
  pelican: Object.freeze({ glideSeconds: C.pelicanGlideSeconds, glideFallSpeed: C.pelicanGlideFallSpeed, flaps: 0 }),
  goose: Object.freeze({ glideSeconds: C.gooseGlideSeconds, glideFallSpeed: C.gooseGlideFallSpeed, flaps: C.gooseFlaps }),
});
const NONE = Object.freeze({ glideSeconds: C.pelicanGlideSeconds, glideFallSpeed: 0, flaps: 0 });
const airOf = (player) => AIR[player.animal] || NONE;

/** Refill the per-airtime abilities on touching down (or spawning, or changing animal). */
export function refillAir(player) {
  const air = airOf(player);
  player.glideRemaining = air.glideSeconds; player.flapsRemaining = air.flaps;
}

/** Space held while falling: a goose, or a pelican with an empty pouch, sinks at its glide speed until the time runs out. */
export function glide(player, input, stunned, dt) {
  const air = AIR[player.animal];
  const able = !!air && !(player.animal === 'pelican' && player.swallowed) && !stunned && player.vel.y <= 0 &&
    player.glideRemaining > 0 && input.down('Space');
  if (!able) return false;
  player.gliding = true;
  player.glideRemaining = Math.max(0, player.glideRemaining - dt);
  player.vel.y = Math.max(player.vel.y, -air.glideFallSpeed);
  return true;
}

/** Goose: a fresh Space in mid-air beats the wings once, lifting it a little (climb speed at least gooseFlapSpeed). */
export function flap(player, input, stunned) {
  if (stunned || !(player.flapsRemaining > 0) || !input.hit('Space')) return false;
  player.vel.y = Math.max(player.vel.y, C.gooseFlapSpeed); player.flapsRemaining--; player.flapSerial = (player.flapSerial || 0) + 1;
  player.jumpBuf = 0; player.sqV += 3;
  player.emit('flap'); return true;
}
