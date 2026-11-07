/** Versus bot seats: which empty character slots the host hands to bots at match start, and how each bot looks.
 * Pure data; the host's RoomSimulation places them and every page reads the result from `game.bots`. */
import { TEAMS, TEAM_CAPACITY } from '../../protocol.js';
import { AVATAR_COLORS, CAT_BREEDS, DOG_BREEDS, PELICAN_BREEDS, ELEPHANT_BREEDS } from '../../avatar.js';

/** v1 bots use the four basic animals and no active skills. @type {{ animal: string, breeds: readonly { id: string }[] }[]} */
const BOT_ANIMALS = [{ animal: 'cat', breeds: CAT_BREEDS }, { animal: 'dog', breeds: DOG_BREEDS }, { animal: 'pelican', breeds: PELICAN_BREEDS }, { animal: 'elephant', breeds: ELEPHANT_BREEDS }];

/**
 * `members`: the human roster ({ slot, team }), `slotCount`: the world's character slots, `aiFill`: off | balance | fill.
 * balance tops the smaller team up to the larger (at least one each); fill brings both teams to TEAM_CAPACITY.
 * Free slots are used in ascending order; humans keep their own slots.
 */
export function planBotSeats(members, slotCount, aiFill) {
  if (aiFill !== 'balance' && aiFill !== 'fill') return [];
  const taken = new Set(members.map((member) => member.slot));
  const free = Array.from({ length: slotCount }, (_, slot) => slot).filter((slot) => !taken.has(slot));
  const humans = TEAMS.map((team) => members.filter((member) => member.team === team).length);
  const target = aiFill === 'fill' ? TEAM_CAPACITY : Math.max(1, ...humans);
  const seats = [];
  for (const team of TEAMS) for (let n = humans[team]; n < target && free.length; n++) seats.push({ slot: free.shift(), team });
  return seats.sort((a, b) => a.slot - b.slot);
}

/** Name and appearance for the bot with index `index` (0-based, in slot order); colors avoid those already in use. */
export function botLook(index, usedColors = new Set()) {
  const { animal, breeds } = BOT_ANIMALS[index % BOT_ANIMALS.length];
  let color = 0;
  for (let k = 0; k < AVATAR_COLORS.length; k++) {
    const candidate = (4 + index * 3 + k) % AVATAR_COLORS.length;
    if (!usedColors.has(candidate)) { color = candidate; break; }
  }
  usedColors.add(color);
  return { name: `AI ${index + 1}`, appearance: { animal, breed: breeds[index % breeds.length].id, color } };
}
