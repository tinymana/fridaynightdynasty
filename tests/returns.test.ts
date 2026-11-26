import { describe, expect, it } from 'vitest';
import { FIELD_W, Rng, U, exhibitionTeams, yd } from '@fnd/core';
import { Game, ReturnSim, gameHash, kickoffReturnSetup, puntReturnSetup, replayGame, runReturn, simulateGame } from '@fnd/match-sim';

/** Returns are played out on the field: kickoffs, punts, interceptions and fumble recoveries. */

const teams = exhibitionTeams(11);
const wr = teams[1].roster.find((p) => p.pos === 'WR')!;
const lb = teams[0].roster.find((p) => p.pos === 'LB')!;
const CY = FIELD_W >> 1;

describe('the return simulation', () => {
  it('a returner with nobody chasing him scores', () => {
    const r = runReturn({ carrier: { player: wr, x: yd(60), y: CY }, blockers: [], chasers: [], rng: new Rng(1) });
    expect(r.touchdown).toBe(true);
    expect(r.yards).toBe(60);
    expect(r.endYard).toBe(0);
  });
  it('a returner with a tackler on top of him goes nowhere much', () => {
    const ys = Array.from({ length: 300 }, (_, i) => runReturn({ carrier: { player: wr, x: yd(60), y: CY }, blockers: [], chasers: [{ player: lb, x: yd(59), y: CY }, { player: lb, x: yd(58), y: CY + yd(1) }, { player: lb, x: yd(58), y: CY - yd(1) }], rng: new Rng(i + 1) }).yards);
    ys.sort((a, b) => a - b);
    expect(ys[150]).toBeLessThanOrEqual(3);
  });
  it('blockers pick up the coverage: on most kickoffs somebody is locked up with a blocker', () => {
    let blocked = 0;
    for (let i = 0; i < 100; i++) {
      const sim = new ReturnSim(kickoffReturnSetup(teams[0], teams[1], wr, 40, 90, 0.6, new Rng(i + 1)));
      let seen = false;
      while (!sim.done) {
        sim.step();
        if (sim.players.some((p) => p.side === 1 && p.engaged >= 0)) seen = true;
      }
      if (seen) blocked++;
    }
    expect(blocked).toBeGreaterThan(60);
  });
  it('is the same every time for the same seed, stays on the field and always ends', () => {
    for (let i = 0; i < 60; i++) {
      const make = () => new ReturnSim(kickoffReturnSetup(teams[0], teams[1], wr, 40, 90, 0.6, new Rng(i + 5)));
      const a = make();
      const b = make();
      while (!a.done) {
        a.step();
        b.step();
        for (const p of a.players) {
          expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(FIELD_W);
        }
      }
      expect(b.result).toEqual(a.result);
      expect(a.tick).toBeLessThanOrEqual(900);
      expect(a.players.length).toBe(21);
    }
    void U;
  });
  it('kickoff and punt returns look like football', () => {
    const stat = (make: (rng: Rng) => ReturnType<typeof kickoffReturnSetup>) => {
      const ys: number[] = [];
      let td = 0;
      for (let i = 0; i < 800; i++) {
        const r = runReturn(make(new Rng(i * 3 + 1)));
        ys.push(r.yards);
        if (r.touchdown) td++;
      }
      return { mean: ys.reduce((a, b) => a + b, 0) / ys.length, td: td / ys.length };
    };
    const kick = stat((r) => kickoffReturnSetup(teams[0], teams[1], wr, 40, 92, 0.6, r));
    const squib = stat((r) => kickoffReturnSetup(teams[0], teams[1], wr, 40, 72, 0.8, r, true));
    const punt = stat((r) => puntReturnSetup(teams[0], teams[1], wr, 30, 68, r));
    expect(kick.mean).toBeGreaterThan(12);
    expect(kick.mean).toBeLessThan(24);
    expect(kick.td).toBeLessThan(0.03);
    expect(squib.mean).toBeLessThan(kick.mean - 4);
    expect(punt.mean).toBeGreaterThan(5);
    expect(punt.mean).toBeLessThan(14);
    expect(punt.td).toBeLessThan(0.04);
  });
});

describe('returns in a game', () => {
  const games = Array.from({ length: 80 }, (_, i) => simulateGame(i + 1, exhibitionTeams(i + 1)));
  it('interceptions and fumbles are run back, and a score goes to the defense', () => {
    let picks = 0, fumbles = 0, scores = 0, turnovers = 0;
    for (const g of games) {
      g.events.forEach((e, i) => {
        if (!e.flags.interception && !e.flags.fumbleLost) return;
        turnovers++;
        if (e.returnYards !== undefined) {
          expect(e.returnYards).toBeGreaterThanOrEqual(0);
          if (e.flags.interception) picks++;
          else fumbles++;
        }
        const def = e.offense === 0 ? 1 : 0;
        if (e.flags.defensiveTouchdown) {
          scores++;
          expect(e.points[def]).toBe(6);
          expect(e.points[e.offense]).toBe(0);
          expect(e.text).toMatch(/for a TOUCHDOWN/);
          // The scoring defense takes the try.
          const next = g.events[i + 1];
          if (next && (next.type === 'pat' || next.type === 'twoPoint')) expect(next.offense).toBe(def);
        } else {
          expect(e.points).toEqual([0, 0]);
          const next = g.events[i + 1];
          if (next && next.quarter === e.quarter && (next.type === 'run' || next.type === 'pass')) expect(next.offense).toBe(def);
        }
      });
    }
    expect(picks).toBeGreaterThan(60);
    expect(fumbles).toBeGreaterThan(40);
    // A few are taken to the house, most are not.
    expect(scores).toBeGreaterThan(2);
    expect(scores / turnovers).toBeLessThan(0.15);
  });
  it('the return shown is the return that counted', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const done = simulateGame(seed, exhibitionTeams(seed));
      const g = new Game(seed, exhibitionTeams(seed));
      for (const d of done.log) {
        if ('manage' in d) continue;
        g.begin(d.off, d.def);
        while (!g.tick()) { /* step */ }
        const e = g.lastEvent;
        if (!g.lastReturn || !e) continue;
        const sim = g.lastReturn.make();
        while (!sim.done) sim.step();
        expect(Math.max(0, sim.result!.yards)).toBe(e.returnYards);
        expect(sim.result!.touchdown).toBe(!!e.flags.touchdown || !!e.flags.defensiveTouchdown);
        checked++;
      }
      expect(gameHash(g)).toBe(gameHash(done));
    }
    expect(checked).toBeGreaterThan(80);
  });
  it('games with returns replay to the same fingerprint', () => {
    for (const g of games.slice(0, 6)) expect(gameHash(replayGame(g.seed, exhibitionTeams(g.seed), g.log))).toBe(gameHash(g));
  });
});
