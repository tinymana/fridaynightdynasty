import type { PlayEvent } from '@fnd/core';

/**
 * The game book: what a scorer's table hands out after the final whistle. Points by quarter, the scoring plays,
 * each team's totals and every drive, all worked out from the play-by-play and nothing else.
 */

/** A quarter's label: Q1 to Q4, then OT, 2OT and so on. */
export const periodName = (quarter: number): string => (quarter <= 4 ? `Q${quarter}` : quarter === 5 ? 'OT' : `${quarter - 4}OT`);
export const clockText = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Points by period for each team. Always at least four periods; overtime periods follow. */
export function periodScores(events: readonly PlayEvent[]): [number[], number[]] {
  const periods = Math.max(4, ...events.map((e) => e.quarter));
  const out: [number[], number[]] = [Array<number>(periods).fill(0), Array<number>(periods).fill(0)];
  for (const e of events) {
    out[0][e.quarter - 1] += e.points[0];
    out[1][e.quarter - 1] += e.points[1];
  }
  return out;
}

export interface ScoringPlay {
  quarter: number;
  clock: number;
  /** The team that scored. */
  team: 0 | 1;
  text: string;
  scoreAfter: [number, number];
}

/** Every play that put points on the board, in order. */
export function scoringPlays(events: readonly PlayEvent[]): ScoringPlay[] {
  return events.filter((e) => e.points[0] + e.points[1] > 0).map((e) => ({ quarter: e.quarter, clock: e.clock, team: e.points[0] > 0 ? 0 : 1, text: e.text, scoreAfter: [e.scoreAfter[0], e.scoreAfter[1]] }));
}

/**
 * Game-clock seconds each play took off, snap to next snap: the play itself and the clock that ran after it.
 * Overtime is untimed, so its plays take nothing.
 */
export function elapsed(events: readonly PlayEvent[]): number[] {
  return events.map((e, i) => {
    if (e.quarter > 4) return 0;
    const next = events[i + 1];
    return Math.max(0, next && next.quarter === e.quarter ? e.clock - next.clock : e.clock);
  });
}

export interface GameTotals {
  plays: number;
  yards: number;
  firstDowns: number;
  rushAtt: number;
  rushYds: number;
  passAtt: number;
  passComp: number;
  passYds: number;
  sacked: number;
  interceptions: number;
  fumblesLost: number;
  thirdDowns: [made: number, tried: number];
  fourthDowns: [made: number, tried: number];
  penalties: number;
  penaltyYds: number;
  punts: number;
  puntYds: number;
  /** Seconds with the ball. */
  possession: number;
}

/** Each team's totals, the way a high school scorer counts them: sack yardage comes off the rushing. */
export function gameTotals(events: readonly PlayEvent[]): [GameTotals, GameTotals] {
  const mk = (): GameTotals => ({ plays: 0, yards: 0, firstDowns: 0, rushAtt: 0, rushYds: 0, passAtt: 0, passComp: 0, passYds: 0, sacked: 0, interceptions: 0, fumblesLost: 0, thirdDowns: [0, 0], fourthDowns: [0, 0], penalties: 0, penaltyYds: 0, punts: 0, puntYds: 0, possession: 0 });
  const out: [GameTotals, GameTotals] = [mk(), mk()];
  const took = elapsed(events);
  for (const [i, e] of events.entries()) {
    const t = out[e.offense];
    const f = e.flags;
    if (e.type !== 'kickoff' && e.type !== 'pat' && e.type !== 'twoPoint') t.possession += took[i] as number;
    if (e.type === 'penalty') {
      // Yards are from the offense's side: a loss is a foul on the offense, a gain is one on the defense.
      const on = out[e.yards < 0 ? e.offense : ((1 - e.offense) as 0 | 1)];
      on.penalties++;
      on.penaltyYds += Math.abs(e.yards);
      continue;
    }
    if (e.type === 'punt') {
      t.punts++;
      if (!f.blocked) t.puntYds += e.yards;
      continue;
    }
    if (e.type !== 'run' && e.type !== 'pass' && e.type !== 'kneel') continue;
    t.plays++;
    if (f.firstDown) t.firstDowns++;
    if (f.interception) t.interceptions++;
    if (f.fumbleLost) t.fumblesLost++;
    if (e.type !== 'kneel' && (e.down === 3 || e.down === 4)) {
      const d = e.down === 3 ? t.thirdDowns : t.fourthDowns;
      d[1]++;
      if (f.firstDown || f.touchdown) d[0]++;
    }
    if (e.type === 'pass' && !f.sack) {
      t.passAtt++;
      if (f.complete) {
        t.passComp++;
        t.passYds += e.yards;
      }
    } else {
      t.rushAtt++;
      t.rushYds += e.yards;
      if (f.sack) t.sacked++;
    }
    t.yards = t.rushYds + t.passYds;
  }
  return out;
}

export type DriveResult = 'Touchdown' | 'Field goal' | 'Missed field goal' | 'Punt' | 'Interception' | 'Fumble' | 'Downs' | 'Safety' | 'End of half' | 'End of game';

export interface Drive {
  team: 0 | 1;
  quarter: number;
  clock: number;
  /** Where it started, in yards from the team's own goal line. */
  from: number;
  plays: number;
  yards: number;
  seconds: number;
  result: DriveResult;
  /** Index of the drive's first and last event in the play-by-play. */
  first: number;
  last: number;
}

/** Every possession: where it started, how long it lasted and how it ended. Tries and kickoffs belong to no drive. */
export function driveChart(events: readonly PlayEvent[]): Drive[] {
  const out: Drive[] = [];
  let cur: Drive | null = null;
  const took = elapsed(events);
  const close = (result: DriveResult): void => {
    if (cur) out.push({ ...cur, result });
    cur = null;
  };
  events.forEach((e, i) => {
    if (e.type === 'kickoff' || e.type === 'pat' || e.type === 'twoPoint') {
      // A kick with a drive still open: time ran out on it.
      if (cur) close('End of half');
      return;
    }
    // The other side has the ball, a new half has started or overtime has: the last drive ran out of time.
    const c = cur as Drive | null;
    if (c && (c.team !== e.offense || (c.quarter <= 2 && e.quarter >= 3) || (c.quarter <= 4 && e.quarter >= 5) || (c.quarter >= 5 && e.quarter !== c.quarter))) close('End of half');
    cur ??= { team: e.offense, quarter: e.quarter, clock: e.clock, from: e.yardLine, plays: 0, yards: 0, seconds: 0, result: 'End of game', first: i, last: i };
    cur.last = i;
    cur.seconds += took[i] as number;
    const f = e.flags;
    if (e.type === 'run' || e.type === 'pass' || e.type === 'kneel') {
      cur.plays++;
      cur.yards += e.yards;
    }
    if (f.interception) close('Interception');
    else if (f.fumbleLost) close('Fumble');
    else if (f.safety) close('Safety');
    else if (f.touchdown) close('Touchdown');
    else if (e.type === 'fieldGoal') close(f.good ? 'Field goal' : 'Missed field goal');
    else if (e.type === 'punt') close('Punt');
    else if (f.turnoverOnDowns) close('Downs');
  });
  if (cur) close('End of game');
  return out;
}

/** Down, distance and spot in the scorer's shorthand: "3rd & 4 at MCW 38". */
export function situation(e: PlayEvent, abbr: readonly [string, string]): string {
  if (e.type === 'kickoff') return 'Kickoff';
  if (e.type === 'pat' || e.type === 'twoPoint') return 'Try';
  const spot = e.yardLine === 50 ? 'the 50' : e.yardLine < 50 ? `${abbr[e.offense]} ${e.yardLine}` : `${abbr[1 - e.offense]} ${100 - e.yardLine}`;
  const down = ['1st', '2nd', '3rd', '4th'][e.down - 1] ?? `${e.down}th`;
  const togo = e.yardLine + e.distance >= 100 ? 'goal' : String(e.distance);
  return `${down} & ${togo} at ${spot}`;
}
