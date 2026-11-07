/** Shared charging, stun and blast tuning; optional completion rewards live in ChargingRewards. */
export const CHARGING = Object.freeze({
  seconds: 6, portRange: 1.2, maxLength: 9,
  bend: 0.12,
  // Live water stuns instead of killing: a slow, twitching 2 s shuffle, then a short grace to walk out of the puddle.
  stunSeconds: 2, stunSpeed: 0.25, // Shock stun length and shuffle speed; the get-up guard after it is WOBBLE.guardSeconds.
  // Water reaching a plugged-in connector shorts the port: everyone near is blasted up and away, the connector flies off.
  blastRadius: 3.2, blastLift: 8.5, blastPush: 13, plugLaunch: [5, 9.5, 3.5],
});

/** Ports live on the frontmost standing roof, so every vehicle has a reachable front socket. */
export function chargingPortLocal(truck) {
  const front = truck.platforms.reduce((a, b) => a.x1 > b.x1 ? a : b);
  return [front.x1 - 0.3, truck.topLocal + 0.16, 0];
}
