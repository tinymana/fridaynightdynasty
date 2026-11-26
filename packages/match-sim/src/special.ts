import { RULES, clamp, type KickStyle, type Player, type Rng } from '@fnd/core';
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

/** An onside kick the receivers are ready for is recovered far less often than a surprise. */
export const ONSIDE_SURPRISE = 0.26;
export const ONSIDE_EXPECTED = 0.11;

export interface StyledKickoff extends KickoffResult {
  /** Onside only: the kicking team got the ball back. */
  recovered: boolean;
}

/**
 * A kickoff by style. The same random draws are made for every style, so one seeded stream gives one result per style.
 * `startYard` is from the goal of the team that ends up with the ball.
 */
export function resolveStyledKickoff(rng: Rng, kicker: Player, returner: Player, from: number, style: KickStyle, expected: boolean): StyledKickoff {
  const deep = resolveKickoff(rng, kicker, returner, from);
  const a = rng.range(0, 1);
  const b = rng.range(0, 1);
  if (style === 'deep') return { ...deep, recovered: false };
  if (style === 'squib') {
    const kickYards = Math.round(30 + a * 10);
    const returnYards = Math.round(2 + b * 8);
    return { startYard: clamp(100 - (from + kickYards) + returnYards, 1, 60), kickYards, returnYards, touchback: false, touchdown: false, recovered: false };
  }
  const kickYards = Math.round(10 + b * 4);
  const spot = Math.min(from + kickYards, 95);
  const recovered = a < (expected ? ONSIDE_EXPECTED : ONSIDE_SURPRISE);
  return { startYard: recovered ? spot : 100 - spot, kickYards, returnYards: 0, touchback: false, touchdown: false, recovered };
}

/** What going for the block does to a punt or field goal. One roll decides it. */
export const BLOCK_CHANCE = 0.06;
export const ROUGHING_CHANCE = 0.07;
export function blockOutcome(roll: number): 'blocked' | 'roughing' | 'none' {
  return roll < BLOCK_CHANCE ? 'blocked' : roll < BLOCK_CHANCE + ROUGHING_CHANCE ? 'roughing' : 'none';
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
