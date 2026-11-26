import { FIELD_W, U, clamp, dist, type DefRole, type Group } from '@fnd/core';

/** On-field decisions. Pure functions over positions, so they can be tested without the engine. */

export interface FieldDefender {
  x: number;
  y: number;
  engaged: boolean;
  /** Stunned or otherwise out of the play. */
  out: boolean;
}
export interface FieldPoint {
  x: number;
  y: number;
}

/** Where a ball carrier should head: upfield, drifting away from defenders in front of him. */
export function carrierTarget(c: FieldPoint, defs: readonly FieldDefender[]): FieldPoint {
  let lat = 0;
  for (const d of defs) {
    if (d.out) continue;
    const dx = d.x - c.x;
    const dy = d.y - c.y;
    const ady = dy < 0 ? -dy : dy;
    if (dx > -U && dx < 9 * U && ady < 7 * U) {
      let w = (9 * U - dx) * (7 * U - ady);
      if (d.engaged) w = Math.trunc(w / 3);
      const pushUp = dy > 0 || (dy === 0 && c.y > FIELD_W / 2);
      lat += pushUp ? -w : w;
    }
  }
  const shift = clamp(Math.trunc((lat * 5) / (63 * U)), -6 * U, 6 * U);
  return { x: c.x + 6 * U, y: clamp(c.y + shift, U, FIELD_W - U) };
}

export interface ReadReceiver {
  idx: number;
  x: number;
  y: number;
  /** True when the receiver has stopped or is working back to the ball, so a defender behind him is out of position. */
  settled: boolean;
}

/** Extra separation credited when the defender is deeper than a receiver who is not running away from him. */
export const TRAIL_BONUS = Math.round(1.2 * U);

export function contestDistance(d: number, defenderDeeperBy: number, settled: boolean): number {
  // A settled receiver shields a defender who is behind him; a receiver running deep has a step on a defender who trails.
  const beaten = settled ? defenderDeeperBy > 0.6 * U : defenderDeeperBy < -0.6 * U;
  return beaten ? d + TRAIL_BONUS : d;
}

/** Distance from a receiver to the nearest defender who can affect the catch. */
export function openness(r: FieldPoint, defs: readonly FieldDefender[], settled = false): number {
  let best = 99 * U;
  for (const d of defs) {
    if (d.out || d.engaged) continue;
    const dd = contestDistance(dist(r.x, r.y, d.x, d.y), d.x - r.x, settled);
    if (dd < best) best = dd;
  }
  return best;
}

/**
 * Quarterback read. Returns a receiver index to throw to, -1 to keep waiting, or -2 to throw the ball away.
 * `elapsed` is ticks since the first read; the quarterback gets less picky the longer he holds the ball.
 */
export function qbRead(
  qb: FieldPoint,
  receivers: readonly ReadReceiver[],
  defs: readonly FieldDefender[],
  los: number,
  elapsed: number,
  forced: boolean,
  maxThrow = 45,
): number {
  const need = Math.max(1.2, 2.6 - elapsed / 45);
  let best = -1;
  let bestValue = -1e9;
  let fallback = -1;
  let fallbackOpen = 0;
  for (const r of receivers) {
    if (r.x < los - 4 * U) continue;
    const throwDist = dist(qb.x, qb.y, r.x, r.y) / U;
    if (throwDist > maxThrow) continue;
    const open = openness(r, defs, r.settled) / U;
    const depth = (r.x - los) / U;
    if (open > fallbackOpen) {
      fallbackOpen = open;
      fallback = r.idx;
    }
    // Checkdowns short of three yards are only taken late in the read or under pressure.
    if (open < need || (depth < 3 && elapsed < 40 && !forced)) continue;
    const value = Math.min(depth, 30) + Math.min(open, 4) * 3 - Math.max(0, throwDist - 22) * 1.5;
    if (value > bestValue) {
      bestValue = value;
      best = r.idx;
    }
  }
  if (best >= 0) return best;
  if (forced) return fallback >= 0 && fallbackOpen >= 0.7 ? fallback : -2;
  return -1;
}

// --------------------------------------------------------------- coverage

export interface CoverReceiver {
  idx: number;
  x: number;
  y: number;
  group: Group;
}
export interface CoverDefender {
  idx: number;
  x: number;
  y: number;
  role: DefRole;
}

/** How badly a defender's position suits covering a receiver's position, in yards of extra cost. */
const MISMATCH: Record<DefRole, Partial<Record<Group, number>>> = {
  CB: { WR: 0, TE: 6, RB: 10 },
  NB: { WR: 0, TE: 2, RB: 6 },
  S: { WR: 5, TE: 0, RB: 3 },
  LB: { WR: 8, TE: 2, RB: 0 },
  DL: {},
};

/**
 * Man-coverage matchups at the snap. Wide receivers are claimed first, widest first, then tight ends,
 * then backs. Each takes the nearest defender whose position suits him. Returns defender index to receiver index.
 */
export function matchCoverage(receivers: readonly CoverReceiver[], defenders: readonly CoverDefender[]): Map<number, number> {
  const mid = FIELD_W / 2;
  const rank = (g: Group): number => (g === 'WR' ? 0 : g === 'TE' ? 1 : 2);
  const order = [...receivers].sort((a, b) => rank(a.group) - rank(b.group) || Math.abs(b.y - mid) - Math.abs(a.y - mid) || a.idx - b.idx);
  const taken = new Set<number>();
  const out = new Map<number, number>();
  for (const r of order) {
    let best = -1;
    let bestCost = 1e9;
    for (const d of defenders) {
      if (taken.has(d.idx)) continue;
      const cost = Math.abs(d.y - r.y) / U + (MISMATCH[d.role][r.group] ?? 20);
      if (cost < bestCost) {
        bestCost = cost;
        best = d.idx;
      }
    }
    if (best < 0) break;
    taken.add(best);
    out.set(best, r.idx);
  }
  return out;
}
