/** Frozen integration contract for the five-level framework (protocol 16, save 0.5).
 * UI consumes these authority fields; it never infers completion or issues reward commands. */
export type ClockState = { mode: 'unlimited' | 'countdown'; duration: number; remaining: number };
export type PartyBalanceState = { playerCount: number; stainMultiplier: number; patienceMultiplier: number; scoreMultiplier: number };
export type RatingProgressState = { score: number; stars: number; thresholds: number[]; ratio: number } | null;
export type SavedLevelStats = { finishedRuns: number; bestScore: number; bestScorePlayers: number;
  bestCompletedOrders: number; bestStars: number; tutorialCompleted: boolean };
export type TutorialDot = { id: string; slot: number | null; active: boolean; complete: boolean };
export type TutorialState = { stepId: string; hintId: string; text: string; revision: number;
  dots: { kind: 'players' | 'stains' | 'none'; entries: TutorialDot[] } } | null;
export type LevelResult = { reason: 'time_up' | 'tutorial_complete'; outcome: 'success' | 'failure';
  ratingMode: 'score' | 'tutorial'; score: number; completedOrders: number; missed: number;
  stars: number | null; thresholds: number[]; nextLevelId: string | null; partyBalance: PartyBalanceState };
export type GuideState = { id: string | null; pageIndex: number; pageCount: number;
  participants: number; ready: number; closeTime: number };
export type OrderDefinition = { id: string; at?: number; side: -1 | 1; type: string;
  stains: { id: string; kind: 'dust' | 'mud' | 'grease'; position: [number, number] }[];
  behavior: string; patience: { mode: 'unlimited' | 'steps'; multiplier?: number };
  onComplete: 'hold' | 'leave'; playerCountStains?: boolean;
  cargo?: { id: string; kind: 'wood-crate' | 'wood-pile'; position: [number, number]; size: [number, number]; height: number; yaw?: number }[] };
export type OrderViewFields = { id: string; serial: number; vehicleSlot: number; generation: number;
  side: -1 | 1; behaviorId: string; initialPatience: number | null; remaining: number | null;
  chargeRequired: false; chargeProgress: number; charged: boolean; rewardMultiplier: number };
export type ScriptCondition = { type: 'moved'; distance: number } | { type: 'clean' | 'reclaimed'; orderId: string }
  | { type: 'emptyHands' | 'home' } | { type: 'elapsed'; seconds: number };
export type ScriptAction = { type: 'equipment'; keys: string[] } | { type: 'spawn' | 'leave'; orderId: string }
  | { type: 'behavior'; orderId: string; behavior: string } | { type: 'event' | 'stopEvent'; eventId: string } | { type: 'finish' };
export type ScriptStep = { id: string; text: string; praise?: string; condition: ScriptCondition;
  hold?: number; minimumSeconds?: number; enter?: ScriptAction[]; exit?: ScriptAction[] };
/** at begins the rule, not its eventual collision. roadSign includes 2s warning + .8s sweep; no at means step-triggered. */
export type ScriptEvent = { id: string; type: string; at?: number; duration: number; params: Record<string, unknown> };
export type ScriptDefinition = { orders: OrderDefinition[]; steps: ScriptStep[]; events: ScriptEvent[] };

/** Existing authoritative lifecycle API, not DOM button click handlers:
 * connection.send('start', {levelId}) starts from home.
 * connection.send('load', {levelId}) restarts or advances an ended/in-progress round.
 * connection.send('home') returns the whole room. These are host-only operations.
 * connection.confirmGuide(guideId, pageIndex) confirms the current pre-round page.
 * game.clock / game.tutorial / game.result / game.partyBalance / game.ratingProgress are snapshot-fed UI state.
 * game.guide has pageIndex/pageCount; game.orders retain their normal stains/remaining fields.
 * No UI command exists for completing tutorial steps, awarding stars or charging rewards.
 */
