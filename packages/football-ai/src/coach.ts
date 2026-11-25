import type { DefCall, DefDecision, OffDecision, OffPlay, Rng, Situation } from '@fnd/core';

/** Coach AI: play calls, fourth-down choices, conversions and timeouts. Depends only on the game situation. */

export const fieldGoalDistance = (yardLine: number): number => 100 - yardLine + 17;
export const fieldGoalRange = (kicking: number): number => 28 + kicking * 0.27;

function passChance(s: Situation): number {
  let p: number;
  if (s.down === 1) p = 0.42;
  else if (s.down === 2) p = s.distance >= 7 ? 0.56 : s.distance <= 3 ? 0.3 : 0.45;
  else p = s.distance >= 6 ? 0.84 : s.distance >= 3 ? 0.6 : 0.25;
  if (s.quarter === 4 && s.clock < 300) p += s.scoreDiff < 0 ? 0.25 : s.scoreDiff > 0 ? -0.25 : 0;
  if (s.quarter === 2 && s.clock < 45) p += 0.3;
  return p < 0.05 ? 0.05 : p > 0.95 ? 0.95 : p;
}

function wantsTimeout(s: Situation, onOffense: boolean): boolean {
  if (!s.clockRunning || s.timeouts <= 0) return false;
  if (s.quarter === 4 && s.scoreDiff < 0 && s.clock < 180) return true;
  if (onOffense && s.quarter === 2 && s.clock < 60 && s.yardLine > 45) return true;
  return false;
}

export function aiOffense(s: Situation, plays: readonly OffPlay[], rng: Rng): OffDecision {
  const pass = rng.chance(passChance(s));
  const pool = plays.filter((p) => p.kind === (pass ? 'pass' : 'run'));
  const play = rng.pick(pool.length ? pool : plays);

  if (s.phase === 'conversion') {
    const chase = s.quarter === 4 && (s.scoreDiff === -2 || s.scoreDiff === -5 || s.scoreDiff === -10 || s.scoreDiff === 1);
    return chase ? { kind: 'play', playId: play.id } : { kind: 'patKick' };
  }

  const timeout = wantsTimeout(s, true);
  if (s.down === 4) {
    const fgDist = fieldGoalDistance(s.yardLine);
    const inRange = fgDist <= fieldGoalRange(s.kicking);
    const desperate = s.quarter === 4 && s.clock < 300 && s.scoreDiff < 0;
    if (desperate && (s.scoreDiff < -3 || !inRange)) return { kind: 'play', playId: play.id, timeout };
    if (inRange && !(s.distance <= 1 && s.yardLine >= 95)) return { kind: 'fieldGoal', timeout };
    if (s.yardLine >= 55 && s.distance <= 2) return { kind: 'play', playId: play.id, timeout };
    if (s.yardLine >= 65) return { kind: 'play', playId: play.id, timeout };
    return { kind: 'punt', timeout };
  }
  return { kind: 'play', playId: play.id, timeout };
}

export function aiDefense(s: Situation, calls: readonly DefCall[], rng: Rng): DefDecision {
  const p = passChance(s);
  let w: Record<DefCall['kind'], number>;
  if (s.distance <= 2 && s.down >= 3) w = { run: 0.6, balanced: 0.25, blitz: 0.15, pass: 0 };
  else if (p > 0.7) w = { pass: 0.5, blitz: 0.25, balanced: 0.25, run: 0 };
  else if (p < 0.4) w = { run: 0.4, balanced: 0.45, blitz: 0.15, pass: 0 };
  else w = { balanced: 0.4, run: 0.2, pass: 0.25, blitz: 0.15 };
  let roll = rng.float();
  let chosen = calls[0];
  for (const c of calls) {
    roll -= w[c.kind];
    if (roll < 0) {
      chosen = c;
      break;
    }
  }
  return { callId: chosen.id, timeout: wantsTimeout(s, false) };
}
