/** Emotes: eight wheel directions, one id each. Presentation only; the host applies them by link slot (docs/domains/wash/EMOTES.md). */
/** Clockwise from up (W), matching the wheel: W, W+A, A, A+S, S, S+D, D, D+W. */
export const EMOTES = Object.freeze(['nice', 'hi', 'help', 'here', 'sad', 'laugh', 'angry', 'wow']);
export const EMOTE_SECONDS = 2.5;
export const EMOTE_COOLDOWN_SECONDS = 1;

/** Wheel slot for a stick/key direction (x right, y toward the camera), or -1 for no direction. */
export function emoteDirection(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 0.5) return -1;
  // W is up (y < 0); the list runs counter-clockwise on screen: up, up-left, left, ...
  const angle = Math.atan2(-y, x);                           // 0 right, π/2 up
  const index = Math.round((angle - Math.PI / 2) / (Math.PI / 4));
  return ((index % 8) + 8) % 8;
}

/** Guest → host control message. No client-supplied slot is trusted. */
export function validEmote(frame) {
  return !!frame && frame.type === 'emote' && Number.isSafeInteger(frame.epoch) && EMOTES.includes(frame.id);
}
