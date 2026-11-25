export type RatingKey =
  | 'speed' | 'power' | 'agility' | 'hands' | 'throwPower' | 'throwAccuracy'
  | 'runBlock' | 'passBlock' | 'tackling' | 'coverage' | 'kicking' | 'awareness';

export type Ratings = Record<RatingKey, number> & { stamina: number };

export const OFF_POS = ['QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3', 'LT', 'LG', 'C', 'RG', 'RT'] as const;
export const DEF_POS = ['DE1', 'DT1', 'DT2', 'DE2', 'OLB1', 'MLB', 'OLB2', 'CB1', 'CB2', 'FS', 'SS'] as const;
export type OffPos = (typeof OFF_POS)[number];
export type DefPos = (typeof DEF_POS)[number];

export interface Player {
  id: string;
  name: string;
  number: number;
  pos: string;
  ratings: Ratings;
}

export interface TeamColors {
  jersey: number;
  helmet: number;
  pants: number;
  trim: number;
}

export interface Team {
  id: string;
  name: string;
  mascot: string;
  abbr: string;
  colors: TeamColors;
  offense: Record<OffPos, Player>;
  defense: Record<DefPos, Player>;
  kicker: Player;
  punter: Player;
}

/** A point in yards: [downfield, lateral]. Downfield is toward the opponent's goal. */
export type Pt = readonly [number, number];

export type OffAssign =
  | { t: 'qb' }
  | { t: 'block' }
  /** Waypoints relative to the player's own alignment. `go` keeps running past the last point. */
  | { t: 'route'; pts: readonly Pt[]; go?: boolean }
  /** Ball-carrier path, relative to the ball spot. */
  | { t: 'carry'; pts: readonly Pt[] };

export interface OffPlay {
  id: string;
  name: string;
  kind: 'run' | 'pass';
  desc: string;
  /** Alignment relative to the ball spot. */
  formation: Record<OffPos, Pt>;
  assign: Record<OffPos, OffAssign>;
  handoffTick?: number;
  dropDepth?: number;
  readStart?: number;
}

export type DefAssign =
  | { t: 'rush' }
  | { t: 'man'; target: OffPos; cushion: number }
  | { t: 'zone'; at: Pt }
  | { t: 'read' };

export interface DefCall {
  id: string;
  name: string;
  kind: 'run' | 'pass' | 'blitz' | 'balanced';
  desc: string;
  formation: Record<DefPos, Pt>;
  assign: Record<DefPos, DefAssign>;
}

export type OffDecision =
  | { kind: 'play'; playId: string; timeout?: boolean }
  | { kind: 'punt'; timeout?: boolean }
  | { kind: 'fieldGoal'; timeout?: boolean }
  | { kind: 'patKick' };

export interface DefDecision {
  callId: string;
  timeout?: boolean;
}

export type PlayType = 'run' | 'pass' | 'punt' | 'fieldGoal' | 'kickoff' | 'pat' | 'twoPoint';

export interface PlayFlags {
  touchdown?: boolean;
  firstDown?: boolean;
  safety?: boolean;
  complete?: boolean;
  incomplete?: boolean;
  interception?: boolean;
  fumbleLost?: boolean;
  sack?: boolean;
  outOfBounds?: boolean;
  touchback?: boolean;
  good?: boolean;
  turnoverOnDowns?: boolean;
}

/** One record per snap or kick. Every statistic is derived from these. */
export interface PlayEvent {
  seq: number;
  quarter: number;
  clock: number;
  /** Team index (0 home, 1 visitors) with the ball, or kicking on a kickoff. */
  offense: 0 | 1;
  down: number;
  distance: number;
  /** Yards from the offense's own goal line. */
  yardLine: number;
  type: PlayType;
  offCall?: string;
  defCall?: string;
  yards: number;
  flags: PlayFlags;
  passer?: string;
  rusher?: string;
  receiver?: string;
  tackler?: string;
  kicker?: string;
  points: [number, number];
  scoreAfter: [number, number];
  seconds: number;
  text: string;
}

export interface Situation {
  phase: 'scrimmage' | 'conversion';
  quarter: number;
  clock: number;
  down: number;
  distance: number;
  yardLine: number;
  /** Own score minus opponent score. */
  scoreDiff: number;
  timeouts: number;
  clockRunning: boolean;
  kicking: number;
}
