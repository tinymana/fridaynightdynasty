import type { DefDecision, DefFront, DefScheme, GamePlan, KickStyle, OffDecision, OffPlay, PlayTag, Rng, SchemeKind, Situation } from '@fnd/core';

/** Coach AI: play calls, fourth-down choices, tries, kneel-downs and timeouts. Depends only on the game situation. */

export const DEFAULT_PLAN: GamePlan = { passBias: 0, aggression: 1 };
/** Seconds run off between snaps while the clock runs, and the length of a kneel-down. Mirrors the rules constants. */
const RUNOFF = 32;
const KNEEL_SECONDS = 3;

export const fieldGoalDistance = (yardLine: number): number => 100 - yardLine + 17;
export const fieldGoalRange = (kicking: number): number => 28 + kicking * 0.27;

export function passChance(s: Situation, plan: GamePlan = DEFAULT_PLAN): number {
  let p: number;
  if (s.down === 1) p = 0.42;
  else if (s.down === 2) p = s.distance >= 7 ? 0.56 : s.distance <= 3 ? 0.3 : 0.45;
  else p = s.distance >= 6 ? 0.84 : s.distance >= 3 ? 0.6 : 0.22;
  if (s.quarter === 4 && s.clock < 300) p += s.scoreDiff < 0 ? 0.25 : s.scoreDiff > 0 ? -0.3 : 0;
  if (s.quarter === 2 && s.clock < 45) p += 0.3;
  if (s.yardLine >= 97) p -= 0.15;
  p += plan.passBias * 0.08;
  return p < 0.05 ? 0.05 : p > 0.95 ? 0.95 : p;
}

/** True when the offense can end the game (or half) by kneeling on every remaining down. */
export function canKneelOut(s: Situation): boolean {
  const kneels = 4 - s.down;
  if (kneels <= 0) return false;
  const burn = kneels * KNEEL_SECONDS + Math.max(0, kneels - s.oppTimeouts) * RUNOFF;
  return s.clock <= burn;
}

function wantsTimeout(s: Situation, onOffense: boolean): boolean {
  if (!s.clockRunning || s.timeouts <= 0) return false;
  if (s.quarter === 4 && s.scoreDiff < 0 && s.clock < 180) return true;
  if (onOffense && s.quarter === 2 && s.clock < 60 && s.yardLine > 45) return true;
  return false;
}

function weightedPick<T>(items: readonly T[], weight: (t: T) => number, rng: Rng): T {
  let total = 0;
  for (const it of items) total += weight(it);
  let roll = rng.float() * total;
  for (const it of items) {
    roll -= weight(it);
    if (roll < 0) return it;
  }
  return items[items.length - 1];
}

function playWeight(p: OffPlay, s: Situation, desperate: boolean): number {
  const has = (t: PlayTag): boolean => p.tags.includes(t);
  let w = 1;
  if (p.kind === 'run') {
    if (s.distance <= 2 || s.yardLine >= 95) w *= has('power') ? 3 : has('outside') ? 0.6 : 1.2;
    else if (has('power') && s.distance >= 8) w *= 0.6;
    if (has('outside') && s.down === 1) w *= 1.2;
  } else {
    const long = s.distance >= 12 || desperate;
    if (long) w *= has('deep') ? 2.5 : has('mid') ? 2 : has('quick') ? 0.35 : 0.6;
    else if (s.distance <= 4) w *= has('quick') ? 2.5 : has('short') ? 2 : has('deep') ? 0.4 : 1;
    else w *= has('mid') ? 1.6 : 1;
    if (s.yardLine >= 85 && has('deep')) w *= 0.2;
  }
  return w;
}

/** Picks a play from the book for the situation, honouring the run-pass lean of the game plan. */
export function choosePlay(s: Situation, book: readonly OffPlay[], rng: Rng, plan: GamePlan = DEFAULT_PLAN): OffPlay {
  const desperate = s.quarter === 4 && s.clock < 300 && s.scoreDiff < 0;
  const wantPass = rng.chance(passChance(s, plan));
  const pool = book.filter((p) => p.kind === (wantPass ? 'pass' : 'run'));
  return weightedPick(pool.length ? pool : book, (p) => playWeight(p, s, desperate), rng);
}

function goForIt(s: Situation, plan: GamePlan): boolean {
  const a = plan.aggression;
  if (a <= 0) return s.distance <= 1 && s.yardLine >= 60;
  if (a === 1) return (s.distance <= 2 && s.yardLine >= 55) || (s.distance <= 1 && s.yardLine >= 45);
  return (s.distance <= 3 && s.yardLine >= 45) || (s.distance <= 1 && s.yardLine >= 30);
}

export function aiOffense(s: Situation, book: readonly OffPlay[], rng: Rng, plan: GamePlan = DEFAULT_PLAN): OffDecision {
  const play = choosePlay(s, book, rng, plan);

  if (s.phase === 'conversion') {
    // scoreDiff already includes the touchdown.
    const late = s.quarter === 4;
    const chart = s.scoreDiff === -2 || s.scoreDiff === -5 || s.scoreDiff === -10 || s.scoreDiff === 1 || s.scoreDiff === 5;
    const chase = (late && chart) || (plan.aggression >= 2 && s.quarter >= 3 && (s.scoreDiff === -2 || s.scoreDiff === 1));
    return chase ? { kind: 'play', playId: play.id } : { kind: 'patKick' };
  }

  if (s.scoreDiff > 0 && s.quarter === 4 && canKneelOut(s)) return { kind: 'kneel' };
  const fgDist = fieldGoalDistance(s.yardLine);
  const inRange = fgDist <= fieldGoalRange(s.kicking);
  if (s.quarter === 2 && s.clock <= 15 && !inRange && s.yardLine < 50 && s.down < 4) return { kind: 'kneel' };

  const timeout = wantsTimeout(s, true);
  if (s.down === 4) {
    const desperate = s.quarter === 4 && s.clock < 300 && s.scoreDiff < 0;
    if (desperate && (s.scoreDiff < -3 || !inRange)) return { kind: 'play', playId: play.id, timeout };
    if (s.quarter === 2 && s.clock < 20 && inRange) return { kind: 'fieldGoal', timeout };
    const go = goForIt(s, plan);
    if (inRange) {
      const shortGoal = s.distance <= 1 && s.yardLine >= 95 && plan.aggression >= 1;
      if (shortGoal || (go && plan.aggression >= 2 && s.distance <= 2)) return { kind: 'play', playId: play.id, timeout };
      return { kind: 'fieldGoal', timeout };
    }
    if (go) return { kind: 'play', playId: play.id, timeout };
    // Too far to kick, too close to punt.
    if (s.yardLine >= 65 && plan.aggression >= 1) return { kind: 'play', playId: play.id, timeout };
    return { kind: 'punt', timeout };
  }
  return { kind: 'play', playId: play.id, timeout };
}

/** Kickoff call: onside when behind late, a squib to kill the last seconds of a half, deep otherwise. */
export function aiKickoff(quarter: number, clock: number, lead: number): KickStyle {
  if (quarter >= 4 && lead < 0 && (clock <= 150 || (clock <= 300 && lead <= -9))) return 'onside';
  if ((quarter === 2 || quarter >= 4) && clock <= 15 && lead >= 0) return 'squib';
  return 'deep';
}

export function aiDefense(s: Situation, fronts: readonly DefFront[], schemes: readonly DefScheme[], rng: Rng): DefDecision {
  // The defense sees the same situation from the other sideline: scoreDiff is its own.
  const offenseView: Situation = { ...s, scoreDiff: -s.scoreDiff };
  const p = passChance(offenseView);
  const short = s.distance <= 2 && s.down >= 3;
  const goalLine = s.yardLine >= 96;
  const prevent = s.quarter === 4 && s.scoreDiff > 0 && s.clock < 120 && s.distance >= 8;

  let w: Record<SchemeKind, number>;
  if (prevent) w = { pass: 0.8, balanced: 0.2, blitz: 0, run: 0 };
  else if (short || goalLine) w = { run: 0.6, balanced: 0.25, blitz: 0.15, pass: 0 };
  else if (p > 0.7) w = { pass: 0.5, blitz: 0.25, balanced: 0.25, run: 0 };
  else if (p < 0.4) w = { run: 0.4, balanced: 0.45, blitz: 0.15, pass: 0 };
  else w = { balanced: 0.4, run: 0.2, pass: 0.25, blitz: 0.15 };
  // Prevent is for protecting a late lead and almost nothing else.
  // The lean is by kind of call, shared among the calls of that kind, so a bigger call sheet does not change the mix.
  const ofKind = (k: SchemeKind): number => schemes.reduce((n, c) => n + (c.kind === k ? (c.id === 'prevent' ? (prevent ? 3 : 0.05) : 1) : 0), 0);
  const scheme = weightedPick(schemes, (c) => (w[c.kind] * (c.id === 'prevent' ? (prevent ? 3 : 0.05) : 1)) / ofKind(c.kind), rng);

  let fw: Record<string, number>;
  if (prevent) fw = { nickel: 0.9, '43': 0.1 };
  else if (short || goalLine) fw = { '52': 0.6, '44': 0.25, '43': 0.15 };
  else if (p > 0.7) fw = { nickel: 0.7, '43': 0.2, '34': 0.1 };
  else if (p < 0.4) fw = { '43': 0.35, '52': 0.25, '44': 0.2, '34': 0.2 };
  else fw = { '43': 0.4, '34': 0.25, nickel: 0.15, '44': 0.1, '52': 0.1 };
  const front = weightedPick(fronts, (f) => fw[f.id] ?? 0.0001, rng);

  // Fourth and long outside scoring range is a punt almost every time: now and then, come after it.
  const block = s.down === 4 && s.distance >= 5 && s.yardLine < 60 && rng.chance(0.1);
  return block ? { frontId: front.id, callId: scheme.id, timeout: wantsTimeout(s, false), block: true } : { frontId: front.id, callId: scheme.id, timeout: wantsTimeout(s, false) };
}
