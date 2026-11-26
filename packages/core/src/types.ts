export type RatingKey =
  | 'speed' | 'power' | 'agility' | 'hands' | 'throwPower' | 'throwAccuracy'
  | 'runBlock' | 'passBlock' | 'tackling' | 'coverage' | 'kicking' | 'awareness';

export type Ratings = Record<RatingKey, number> & { stamina: number };

/** Position groups. A depth chart is an ordered list of players per group. */
export const GROUPS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'] as const;
export type Group = (typeof GROUPS)[number];

export interface Player {
  id: string;
  name: string;
  number: number;
  pos: Group;
  ratings: Ratings;
  /** Class year in a dynasty: 1 freshman to 4 senior. Absent on exhibition teams. */
  year?: number;
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
  roster: Player[];
  /** Player IDs per group, best first. */
  depth: Record<Group, string[]>;
}

/** A point in yards: [downfield, lateral]. Downfield is toward the opponent's goal. */
export type Pt = readonly [number, number];

/** One of the eleven places in a formation. `rank` 1 means the first player on the depth chart for that group. */
export interface Slot {
  id: string;
  group: Group;
  rank: number;
  /** Alignment relative to the ball spot. */
  at: Pt;
}

export interface OffFormation {
  id: string;
  name: string;
  slots: readonly Slot[];
}

export type OffAssign =
  | { t: 'qb' }
  | { t: 'block' }
  /** Lead blocker: follow the path (relative to the ball spot) until a defender shows, then block him. */
  | { t: 'lead'; pts: readonly Pt[] }
  /** Waypoints relative to the player's own alignment. `go` keeps running past the last point. */
  | { t: 'route'; pts: readonly Pt[]; go?: boolean }
  /** Ball-carrier path, relative to the ball spot. */
  | { t: 'carry'; pts: readonly Pt[] };

export type PlayTag = 'power' | 'inside' | 'outside' | 'quick' | 'short' | 'mid' | 'deep';

/** A play is pure data: a formation plus one assignment per slot. Unlisted slots block. */
export interface OffPlay {
  id: string;
  name: string;
  kind: 'run' | 'pass';
  desc: string;
  formation: string;
  /** A coach-designed play carries its own alignment instead of a library formation. */
  slots?: readonly Slot[];
  assign: Record<string, OffAssign>;
  tags: readonly PlayTag[];
  handoffTick?: number;
  dropDepth?: number;
  readStart?: number;
}

export type DefRole = 'DL' | 'LB' | 'CB' | 'NB' | 'S';

export interface DefSlot extends Slot {
  role: DefRole;
  /** Where this defender drops in zone coverage. */
  zone: Pt;
  /** Rushes in the base call (the fourth rusher of a three-man line). */
  rushBase?: boolean;
  /** Crashes the line in Run Stuff. */
  stuff?: boolean;
  /** Rushes in a Blitz. */
  blitz?: boolean;
  /** Plays man coverage in man calls; otherwise reads the play. */
  cover?: boolean;
  /** The deep safety in man calls. */
  deep?: boolean;
  /** A coach-designed defense gives each defender his job directly. */
  assign?: DefAssign;
}

export interface DefFront {
  id: string;
  name: string;
  desc: string;
  slots: readonly DefSlot[];
}

export type DefAssign =
  | { t: 'rush' }
  /** Man coverage. The receiver is matched at the snap from the offense's formation. */
  | { t: 'man'; cushion: number }
  | { t: 'zone'; at: Pt }
  | { t: 'read' };

export type SchemeKind = 'run' | 'pass' | 'blitz' | 'balanced';

export interface DefScheme {
  id: string;
  name: string;
  kind: SchemeKind;
  desc: string;
}

export type OffDecision =
  /** `audible`: the play changed to at the line, after seeing the defensive front. Same formation as the play called. */
  | { kind: 'play'; playId: string; timeout?: boolean; audible?: string }
  | { kind: 'punt'; timeout?: boolean }
  | { kind: 'fieldGoal'; timeout?: boolean }
  | { kind: 'kneel' }
  | { kind: 'patKick' }
  | { kind: 'kickoff'; style: KickStyle };

/** Deep: a normal kickoff. Squib: low and short, no big return. Onside: try to get the ball back. */
export type KickStyle = 'deep' | 'squib' | 'onside';
export const KICK_STYLES: readonly KickStyle[] = ['deep', 'squib', 'onside'];

/** A library front plus a call, or a coach-designed defense (`frontId` "@custom", its id in `callId`). */
export interface DefDecision {
  frontId: string;
  callId: string;
  timeout?: boolean;
  /** Fourth down only: sell out to block a punt or field goal. A real play against it catches the defense out of position. */
  block?: boolean;
}

/** How a coach wants the AI to call the game on his behalf. */
export interface GamePlan {
  /** -2 run heavy to +2 pass heavy. */
  passBias: number;
  /** 0 conservative, 1 normal, 2 aggressive on fourth down and tries. */
  aggression: number;
}

/** Between-play management. Logged with play calls so a game replays exactly. */
export type ManageAction =
  | { kind: 'depth'; team: 0 | 1; group: Group; order: string[] }
  | { kind: 'threshold'; team: 0 | 1; value: number };

export type PlayType = 'run' | 'pass' | 'punt' | 'fieldGoal' | 'kickoff' | 'pat' | 'twoPoint' | 'kneel' | 'penalty';

/** The fouls the officials call. */
export type PenaltyKind = 'falseStart' | 'offside' | 'holding' | 'interference';

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
  /** Special teams. */
  onside?: boolean;
  recovered?: boolean;
  blocked?: boolean;
  roughing?: boolean;
  /** An interception or fumble run back for a score. The points go to the defense. */
  defensiveTouchdown?: boolean;
  /** The offense changed the play at the line. */
  audible?: boolean;
  /** Set on a penalty event: which foul it was. */
  foul?: PenaltyKind;
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
  defFront?: string;
  defCall?: string;
  yards: number;
  flags: PlayFlags;
  passer?: string;
  rusher?: string;
  receiver?: string;
  tackler?: string;
  kicker?: string;
  /** Kickoffs and punts: how far the ball was run back. Absent or 0 for a touchback, fair catch or no return. */
  returnYards?: number;
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
  /** Yards from the offense's own goal line. */
  yardLine: number;
  /** Own score minus opponent score. */
  scoreDiff: number;
  timeouts: number;
  oppTimeouts: number;
  clockRunning: boolean;
  /** Kicking rating of this team's kicker. */
  kicking: number;
}
