import { RULES, clamp, type Player, type Rng } from '@fnd/core';
import { fieldGoalDistance, fieldGoalRange } from '@fnd/football-ai';

/** Kicking plays are resolved from ratings, distance and a seeded roll (design: no kick meter). */

export interface KickoffResult {
  /** Receiving team's starting yard line, from its own goal. */
  startYard: number;
  kickYards: number;
  returnYards: number;
  touchback: boolean;
  touchdown: boolean;
}

export function resolveKickoff(rng: Rng, kicker: Player, returner: Player, from: number): KickoffResult {
  const kickYards = Math.round(38 + kicker.ratings.kicking * 0.22 + rng.range(-8, 8));
  const land = 100 - (from + kickYards);
  const returnRoll = rng.range(-9, 13);
  const houseCall = rng.chance(0.012);
  if (land <= 0) return { startYard: RULES.touchbackAt, kickYards, returnYards: 0, touchback: true, touchdown: false };
  const returnYards = Math.max(0, Math.round(14 + (returner.ratings.speed - 60) * 0.2 + returnRoll));
  if (houseCall || land + returnYards >= 100) return { startYard: 100, kickYards, returnYards: 100 - land, touchback: false, touchdown: true };
  return { startYard: land + returnYards, kickYards, returnYards, touchback: false, touchdown: false };
}

export interface PuntResult {
  startYard: number;
  grossYards: number;
  returnYards: number;
  touchback: boolean;
}

export function resolvePunt(rng: Rng, punter: Player, los: number): PuntResult {
  const grossYards = Math.round(26 + punter.ratings.kicking * 0.16 + rng.range(-9, 9));
  const fairCatch = rng.chance(0.45);
  const returnRoll = rng.range(-1, 12);
  const land = 100 - (los + grossYards);
  if (land <= 0) return { startYard: RULES.touchbackAt, grossYards: 100 - los, returnYards: 0, touchback: true };
  const returnYards = fairCatch ? 0 : Math.max(0, Math.round(returnRoll));
  return { startYard: clamp(land + returnYards, 1, 99), grossYards, returnYards, touchback: false };
}

export function fieldGoalChance(kicker: Player, los: number): number {
  const d = fieldGoalDistance(los);
  if (d > fieldGoalRange(kicker.ratings.kicking)) return 0.02;
  return clamp(0.97 - (d - 20) * 0.022 - (70 - kicker.ratings.kicking) * 0.004, 0.05, 0.97);
}

export const patChance = (kicker: Player): number => clamp(0.74 + kicker.ratings.kicking * 0.0025, 0.5, 0.98);
