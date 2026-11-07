export const WASH_CONFIG = {
  respawnSeconds: 5,
  catRespawnReduction: 0.6,
  dogWorkSpeedBonus: 0.6,   // Dogs wipe and soap stains this much faster (2026-10-21 user: 50% → 60%).
  swallowRange: 1.2,        // Pelican L reach, measured from the beak to a teammate's chest or a loose tool.
  swallowSeconds: 3,        // A swallowed player breaks free (is spat out) after this long.
  swallowStruggleSeconds: 0.2, // Each accepted struggle press by the victim shortens the stay this much.
  swallowStrugglesPerSecond: 5, // Struggle presses accepted within any rolling one-second window.
  swallowCooldownSeconds: 5, // After a swallowed player leaves the pouch, the pelican cannot swallow a player again; tools are exempt.
  pelicanGlideSeconds: 1.25, // Holding Space while falling with an empty pouch; refills on landing.
  pelicanGlideFallSpeed: 1.6 * 0.8, // Maximum descent speed while gliding (× character scale 0.8).
  // Squirrel: runs faster and, while airborne, clings to any vertical face it touches (WallCling.js).
  squirrelSpeedBonus: 0.25,  // Walking, jumping and air steering this much faster.
  squirrelGripSeconds: 3,    // Total clinging time before the paws give out; refills on landing.
  squirrelSlide: [0.25 * 0.8, 0.45 * 0.8, 0.6 * 0.8], // Slide speed (m/s) = a + b·t + c·t², t = clinging time since the last landing (× character scale 0.8).
  squirrelWallWalk: 2.6 * 0.8, // Sideways scurry speed along a face (× character scale 0.8).
  ladderClimbSpeed: 2.4 * 0.8, // Vehicle ladders (× character scale 0.8) (any animal, squirrel-cling pose): W/S climb speed, no sideways.
  squirrelWallJumpUp: 9.5 * 0.8, // Space on a wall: kick off upward… (× character scale 0.8, with gravity)
  squirrelWallJumpOut: 4.2 * 0.8, // …and away from the face.
  // Canadian goose: a short-tempered fast slapper (Slap.js ANIMAL_SLAP) that can flap once in the air, then glide.
  gooseFlaps: 1,             // Space in mid-air: wing beats per airtime; refills on landing.
  gooseFlapSpeed: 7.5 * 0.8, // A flap sets the climb speed to at least this (a jump starts at 10 × 0.8), so it lifts a little (× character scale 0.8).
  gooseGlideSeconds: 1.8,    // Holding Space while falling; refills on landing.
  gooseGlideFallSpeed: 1.3 * 0.8, // Maximum descent speed while gliding (the pelican sinks at 1.6; × character scale 0.8).
  // Kangaroo: big legs. Jump height grows with the square of the take-off speed.
  kangarooJumpScale: Math.sqrt(1.5), // Take-off speed ×√1.5 ≈ 1.22 → 50% higher jumps (height grows with speed²; 2026-10-20, was 1.3 / +69%).
  spitSpeed: 6,             // Horizontal L spit speed; falling off only drops contents.
  spitLift: 7,              // Vertical lift unchanged; only horizontal propulsion is reduced.
  spitJumpBoost: .18,       // Match the player airborne carry boost to 60% of the former .3.
  // Elephant L: a trunk jet with its own refilling tank. Seconds are for a full tank.
  trunkDrainSeconds: 2.6,   // Continuous spraying empties a full tank in this long.
  trunkRefillSeconds: 3.4 / 0.75, // An idle trunk refills from empty in this long (≈4.53 s), after trunkRefillDelay. 2026-10-21 user: refill speed nerfed to 75% (was 3.4 s).
  trunkRefillDelay: 0.45,
  trunkRestart: 0.3,        // An emptied trunk sputters until it has refilled this much.
  trunkSpeed: 8.8,          // Shorter horizontal reach, with the same flight time so weak jets still reach roofs.
  trunkRange: 3.84,
  trunkLift: 1.4,
  trunkSprayRadius: 0.23,
  trunkStainRadius: 1.15,   // Wider nearby rinse coverage, independent of the hand-held gun.
  trunkJetScale: 1.9,
  trunkPushSpeed: 4.2,      // Heavier than the toy gun's shove; the target's own mass still divides it.
  trunkRinseRate: 1.15,     // Rinse speed relative to the water gun.
  trunkRecoilSpeed: 1.5,    // Sustained backward drift while the elephant sprays.
  trunkKickSpeed: 4.2,      // One heavy shove back in the tick the jet opens.
  roundSeconds: 180,
  firstOrderDelay: 3,
  nextOrderDelay: 3,
  // Each order first opens an off-screen merge lane ahead; the vehicle flies in once the
  // player's vehicle reaches it. Distances are in world units along the road.
  laneLead: 45,             // Lane spawns this far beyond the point where its vehicle appears.
  laneLength: 100,          // Merge length; arrival time is laneLength / road speed.
  laneSideOffset: 22,       // Off-screen side road distance from the order cruising line.
  laneHeight: 6.5,          // The side road flies over roadside scenery before descending.
  laneExpireBehind: 60,     // Release the lane after its junction is this far behind.
  orderGap: 0.75,           // Hull-edge gap between the player vehicle and a docked order.
  roofWobble: 0.12,         // Continuous roof-height drift around the player's roof level.
  altitudeRate: 1.8,        // Exponential rate for settling at the player's roof height.
  arrivalZoomOut: 0.8,
  orderFocusWeight: 0.3, // The player's vehicle remains the visual anchor.
  unlimitedOrderWait: true, // Demo: the car waits until all stains are clean.
  orderSeconds: 45,         // Used when unlimitedOrderWait is false.
  wipeSeconds: 1.15,
  washSeconds: 1.4,
  towelDurability: 2,       // Continuous work budget: two full stain wipes.
  useRange: 1.35,
  pickupRange: 1.25,
  catchRange: 1.1,
  catchSeconds: 0.25,
  itemOwnerGrace: 0.25,
  soapDurability: 1,
  maxSoapEntities: 10,      // Reuse retired slots; a full pool cannot create another live bar.
  soapSeconds: 1,
  soapStepRadius: 0.38,
  soapSlipCooldown: 0.35,
  throwHoldSeconds: 0.2,    // Short K taps place/release; longer holds throw.
  throwChargeSeconds: 1,
  maximumThrowDistance: 5,
  spraySeconds: 1.2,
  sprayRange: 4.2,
  spraySpeed: 10,
  sprayGravity: 18,
  sprayLift: 1.64,         // Slight upward arc from the cat-height nozzle; keeps the 3.45 roof landing of the old 0.78 m nozzle.
  sprayStainRadius: 0.9,  // Dirt-only splash tolerance; player capsules and jet radius are unchanged.
  sprayRadius: 0.18,
  sprayPushSpeed: 2.75,    // Half of ordinary player speed (5.5).
  // Jet pressure (gun and trunk): a press opens at pressureMin and builds to full; releasing tapers it off.
  pressureMin: 0.1,
  pressureRampSeconds: 0.9, // pressureMin → full while held.
  pressureFallSeconds: 0.35, // full → 0 after release; the jet stops once under pressureCutoff.
  pressureCutoff: 0.2,
  // At zero pressure each quantity is this fraction of the full jet; it rises linearly to 1 at full pressure.
  pressureRangeMin: 0, // Speed and range scale together: a fresh press lands nearby instead of expiring above the roof.
  pressureLiftMin: 0.7,
  pressureForceMin: 0.4,
  pressureRinseMin: 0.5,
  hoseNodes: 7,
  hoseLength: 6.5,
  hoseRadius: 0.065,
  hosePlayerRadius: 0.38,
  hosePushSpeed: 4.5,
  hoseTautOn: 0.96,
  hoseTautOff: 0.9,
  completionPoints: 20,
  comboTip: 5,
  maximumMultiplier: 4,
};
