import { FIELD_W, U, clamp, dist, yd, type Player, type Rng } from '@fnd/core';
import { carrierTarget } from '@fnd/football-ai';
import { moveFor, speedOf, type CarrierMove } from './play';

/**
 * A return: one man with the ball, his blockers, and the other team chasing him down.
 * Used for kickoffs, punts, interceptions and fumble recoveries. Fixed 60 Hz step, integer positions.
 * x is measured exactly as on the play that produced the return (the kicking team or the offense attacks
 * toward larger x), so the returner runs toward x = 0.
 */

export interface ReturnMan {
  player: Player;
  x: number;
  y: number;
}

export interface ReturnSetup {
  carrier: ReturnMan;
  blockers: readonly ReturnMan[];
  chasers: readonly ReturnMan[];
  rng: Rng;
  /** Ticks before the carrier can move: scooping up a fumble, securing a catch. */
  delay?: number;
  /** Added to every tackle chance. A defender running back a turnover is not a return man in the open field. */
  tackleBonus?: number;
}

export interface ReturnResult {
  /** Where it ended, in whole yards on the play's x axis (0 is the goal line the returner was running at). */
  endYard: number;
  /** Yards gained toward that goal line. Can be negative. */
  yards: number;
  touchdown: boolean;
  outOfBounds: boolean;
  tackler?: Player;
  ticks: number;
}

export interface ReturnPlayer {
  idx: number;
  /** 0 for the returning team, 1 for the team chasing. */
  side: 0 | 1;
  player: Player;
  x: number;
  y: number;
  px: number;
  py: number;
  spd: number;
  /** Index of the man this one is locked up with, or -1. */
  engaged: number;
  stunUntil: number;
  tackleCd: number;
}

const MAX_TICKS = 900;

export class ReturnSim {
  readonly players: ReturnPlayer[] = [];
  readonly startX: number;
  tick = 0;
  done = false;
  result: ReturnResult | null = null;
  private readonly rng: Rng;
  private readonly delay: number;
  private readonly tackleBonus: number;
  private stumbleUntil = 0;
  /** Broken tackles on this return, for the broadcast. */
  readonly moves: CarrierMove[] = [];

  constructor(setup: ReturnSetup) {
    this.rng = setup.rng;
    this.delay = setup.delay ?? 0;
    this.tackleBonus = setup.tackleBonus ?? 0;
    const add = (m: ReturnMan, side: 0 | 1): void => {
      const x = clamp(Math.trunc(m.x), yd(-9), yd(109));
      const y = clamp(Math.trunc(m.y), U, FIELD_W - U);
      this.players.push({ idx: this.players.length, side, player: m.player, x, y, px: x, py: y, spd: speedOf(m.player), engaged: -1, stunUntil: 0, tackleCd: 0 });
    };
    add(setup.carrier, 0);
    for (const b of setup.blockers) add(b, 0);
    for (const c of setup.chasers) add(c, 1);
    this.startX = this.players[0].x;
  }

  get carrier(): ReturnPlayer {
    return this.players[0];
  }

  private move(p: ReturnPlayer, tx: number, ty: number, spd: number): void {
    const d = dist(tx, ty, p.x, p.y);
    if (d <= spd) {
      p.x = tx;
      p.y = ty;
      return;
    }
    p.x += Math.trunc(((tx - p.x) * spd) / d);
    p.y += Math.trunc(((ty - p.y) * spd) / d);
  }

  step(): void {
    if (this.done) return;
    this.tick++;
    const P = this.players;
    const c = P[0];
    for (const p of P) {
      p.px = p.x;
      p.py = p.y;
    }
    const chasers = P.filter((p) => p.side === 1);

    // The carrier heads for the goal line, drifting away from whoever is in front of him.
    if (this.tick > this.delay) {
      // carrierTarget steers a runner going toward larger x, so the field is mirrored for it and mirrored back.
      const flip = (x: number): number => yd(100) - x;
      const t = carrierTarget({ x: flip(c.x), y: c.y }, chasers.map((d) => ({ x: flip(d.x), y: d.y, engaged: d.engaged >= 0, out: this.tick < d.stunUntil })));
      const spd = this.tick < this.stumbleUntil ? Math.trunc((c.spd * 55) / 100) : Math.trunc((c.spd * 96) / 100);
      this.move(c, flip(t.x), t.y, spd);
    }

    // Blockers pick up the nearest free chaser between them and the pursuit.
    for (const b of P) {
      if (b.side !== 0 || b.idx === 0) continue;
      if (b.engaged >= 0) {
        if (this.tick >= P[b.engaged].stunUntil) {
          P[b.engaged].engaged = -1;
          b.engaged = -1;
          // One block a man: after it he trails the play.
          b.tackleCd = 1;
        }
        continue;
      }
      if (b.tackleCd) {
        this.move(b, c.x + yd(3), c.y, Math.trunc((b.spd * 70) / 100));
        continue;
      }
      let best: ReturnPlayer | null = null;
      let bd = yd(9);
      for (const d of chasers) {
        if (d.engaged >= 0 || this.tick < d.stunUntil) continue;
        const dd = dist(b.x, b.y, d.x, d.y);
        if (dd < bd) {
          bd = dd;
          best = d;
        }
      }
      if (!best) {
        // Nobody to hit: stay ahead of the runner.
        this.move(b, c.x - yd(4), b.y + Math.trunc((c.y - b.y) / 8), Math.trunc((b.spd * 85) / 100));
        continue;
      }
      this.move(b, best.x, best.y, b.spd);
      if (dist(b.x, b.y, best.x, best.y) <= yd(1)) {
        // Locked up. How long the block holds depends on the two players.
        const edge = b.player.ratings.runBlock - (best.player.ratings.tackling + best.player.ratings.power) / 2;
        const hold = Math.round(clamp(28 + edge * 0.6 + this.rng.range(-14, 34), 8, 80));
        best.stunUntil = this.tick + hold;
        best.engaged = b.idx;
        b.engaged = best.idx;
      }
    }

    // Chasers take an angle to where the runner is going.
    for (const d of chasers) {
      if (d.engaged >= 0 || this.tick < d.stunUntil) continue;
      const lead = clamp(Math.trunc(dist(d.x, d.y, c.x, c.y) / 3), 0, yd(6));
      this.move(d, c.x - lead, c.y, d.spd);
    }

    // Tackles.
    if (this.tick > this.delay) {
      for (const d of chasers) {
        if (d.engaged >= 0 || this.tick < d.stunUntil || this.tick < d.tackleCd) continue;
        if (dist(c.x, c.y, d.x, d.y) > yd(1.3)) continue;
        d.tackleCd = this.tick + 30;
        const dr = d.player.ratings;
        const cr = c.player.ratings;
        const p = clamp(0.52 + this.tackleBonus + ((dr.tackling - (cr.power + cr.agility) / 2) / 100) * 0.55, 0.15, 0.95);
        if (this.rng.chance(p)) return this.end(d, false);
        d.stunUntil = this.tick + 36;
        this.stumbleUntil = this.tick + 12;
        // The returner runs toward smaller x, so a chaser at a smaller x is in front of him.
        this.moves.push({ tick: this.tick, kind: moveFor(c.player, d.x <= c.x, this.tick), carrier: c.player, defender: d.player });
        // A missed tackle in traffic gets in the way of the men right behind it.
        for (const o of chasers) {
          if (o !== d && o.engaged < 0 && this.tick >= o.stunUntil && dist(o.x, o.y, d.x, d.y) < yd(4) && this.rng.chance(0.5)) o.stunUntil = this.tick + 24;
        }
      }
    }

    if (c.x <= 0) return this.end(null, false, true);
    if (c.y <= 0 || c.y >= FIELD_W) return this.end(null, true);
    if (this.tick >= MAX_TICKS) this.end(null, false);
  }

  private end(tackler: ReturnPlayer | null, outOfBounds: boolean, touchdown = false): void {
    const c = this.players[0];
    const endYard = touchdown ? 0 : clamp(Math.ceil(c.x / U), 1, 109);
    this.done = true;
    this.result = { endYard, yards: Math.round(this.startX / U) - endYard, touchdown, outOfBounds, tackler: tackler?.player, ticks: this.tick };
  }
}

/** Runs a return to its end without drawing it. */
export function runReturn(setup: ReturnSetup): ReturnResult {
  const sim = new ReturnSim(setup);
  while (!sim.done) sim.step();
  return sim.result!;
}

// ------------------------------------------------------------------ line-ups for kicks

import type { Group, Team } from '@fnd/core';

const CY = FIELD_W >> 1;

/** The first `n` players from the given groups' depth charts, in order. */
function pick(team: Team, groups: readonly Group[], n: number, skip: ReadonlySet<string> = new Set()): Player[] {
  const out: Player[] = [];
  for (let rank = 0; out.length < n && rank < 6; rank++) {
    for (const g of groups) {
      const id = team.depth[g][rank];
      if (!id || skip.has(id)) continue;
      const p = team.roster.find((x) => x.id === id);
      if (p && out.length < n) out.push(p);
    }
  }
  return out;
}

const lanes = (n: number, i: number): number => Math.trunc((FIELD_W * (i + 1)) / (n + 1));

/**
 * Where everyone is when a kickoff comes down. `landYard` is on the kicking team's x axis.
 * `cover` is how far downfield the coverage has run as a share of the kick: a low squib gives them less time.
 */
export function kickoffReturnSetup(kicking: Team, receiving: Team, returner: Player, fromYard: number, landYard: number, cover: number, rng: Rng, squib = false): ReturnSetup {
  const land = yd(landYard);
  const carrier: ReturnMan = { player: returner, x: land, y: CY + yd(Math.round(rng.range(-9, 9))) };
  const coverMen = pick(kicking, ['LB', 'S', 'CB', 'WR', 'RB'], 10);
  // Some kicks are covered well and some are not: hang time, a slip, a missed lane.
  cover += rng.range(-0.2, 0.06);
  // The coverage does not arrive in a line: some men are quicker downfield than others.
  const chasers = coverMen.map((player, i) => ({ player, x: yd(fromYard) + Math.trunc((land - yd(fromYard)) * (i === 3 ? 0.3 - rng.range(0, 0.14) : i === 6 ? 0.18 - rng.range(0, 0.1) : squib && (i === 1 || i === 8) ? 0.45 - rng.range(0, 0.1) : cover - rng.range(0, 0.16))), y: lanes(coverMen.length, i) }));
  // Two men (lanes 4 and 7) hang back as the last line: a returner who breaks the first wave still has to beat them.
  const front = pick(receiving, ['TE', 'LB', 'RB', 'OL', 'S'], 10, new Set([returner.id]));
  const blockers = front.map((player, i) => ({ player, x: land - yd(i < 5 ? 14 : 24) - yd(Math.round(rng.range(0, 4))), y: lanes(5, i % 5) }));
  return { carrier, blockers, chasers, rng };
}

/** A punt that is being returned: the coverage is closer than on a kickoff and the returner has fewer blockers. */
export function puntReturnSetup(punting: Team, receiving: Team, returner: Player, losYard: number, landYard: number, rng: Rng): ReturnSetup {
  const land = yd(landYard);
  const carrier: ReturnMan = { player: returner, x: land, y: CY + yd(Math.round(rng.range(-10, 10))) };
  const coverMen = pick(punting, ['WR', 'CB', 'S', 'LB', 'TE'], 10);
  const gap = land - yd(losYard);
  // Two gunners get there first; the punter and one more stay back as the last line.
  const chasers = coverMen.map((player, i) => ({ player, x: yd(losYard) + Math.trunc(gap * (i < 2 ? 0.9 : i === 4 ? 0.3 : i === 6 ? 0.12 : 0.72)) + yd(Math.round(rng.range(-3, 3))), y: lanes(coverMen.length, i) }));
  const front = pick(receiving, ['CB', 'S', 'LB', 'WR'], 6, new Set([returner.id]));
  const blockers = front.map((player, i) => ({ player, x: land - yd(8) - yd(Math.round(rng.range(0, 6))), y: lanes(front.length, i) }));
  return { carrier, blockers, chasers, rng };
}
