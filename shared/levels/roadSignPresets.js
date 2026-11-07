/** First-level playtest: six alternating signs across the existing three-minute round. */
export const TUTORIAL_ROAD_SIGNS = Object.freeze([
  { id: 'sign-01', atMinutes: .30, side: -1 },
  { id: 'sign-02', atMinutes: .75, side: 1 },
  { id: 'sign-03', atMinutes: 1.20, side: -1 },
  { id: 'sign-04', atMinutes: 1.65, side: 1 },
  { id: 'sign-05', atMinutes: 2.10, side: -1 },
  { id: 'sign-06', atMinutes: 2.55, side: 1 },
].map(entry => Object.freeze(entry)));
