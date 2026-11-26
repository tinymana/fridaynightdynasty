import { describe, expect, it } from 'vitest';
import { RULES, exhibitionTeams } from '@fnd/core';
import { Game, gameHash, replayGame, simulateGame } from '@fnd/match-sim';

/** High school overtime: each team gets a series from the ten; repeat while level, up to four periods. */

const N = 160;
const games = Array.from({ length: N }, (_, i) => simulateGame(i + 1, exhibitionTeams(i + 1), { setup: { quarterMinutes: 4 } }));
const ot = games.filter((g) => g.overtime > 0);

describe('overtime', () => {
  it('games decided in regulation are untouched', () => {
    // Fingerprints recorded before overtime existed, for full-length games that did not end level.
    const before: Record<number, string> = { 1: 'b48e08ff', 2: '6addf43d', 3: '9c20e7fa', 4: '7abdfb9e', 5: '73b4dd14' };
    let checked = 0;
    for (const [seed, hash] of Object.entries(before)) {
      const g = simulateGame(Number(seed), exhibitionTeams(Number(seed)));
      if (g.overtime) continue;
      expect(gameHash(g), `seed ${seed}`).toBe(hash);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('a game level after four quarters goes to overtime, and almost always gets a winner', () => {
    expect(ot.length).toBeGreaterThan(10);
    for (const g of games) {
      expect(g.state.phase).toBe('final');
      const level = g.state.score[0] === g.state.score[1];
      // The only way to finish level is to run out of overtime periods.
      if (level) expect(g.overtime).toBe(RULES.overtimePeriods);
      if (!g.overtime) expect(level).toBe(false);
    }
    const ties = games.filter((g) => g.state.score[0] === g.state.score[1]).length;
    console.log(`${ot.length} of ${N} short games went to overtime; ${ties} still ended level; periods: ${ot.map((g) => g.overtime).join(' ')}`);
    expect(ties / N).toBeLessThan(0.04);
  });

  it('each team gets the ball at the ten, first and goal, with no clock, kickoffs or punts', () => {
    for (const g of ot) {
      const plays = g.events.filter((e) => e.quarter > RULES.quarters);
      expect(plays.length).toBeGreaterThan(1);
      for (const e of plays) {
        expect(e.clock).toBe(0);
        expect(e.type).not.toBe('kickoff');
        expect(e.type).not.toBe('punt');
        expect(e.type).not.toBe('kneel');
      }
      for (let period = 1; period <= g.overtime; period++) {
        const inPeriod = plays.filter((e) => e.quarter === RULES.quarters + period);
        const teams = new Set(inPeriod.map((e) => e.offense));
        expect(teams.size, `seed ${g.seed} period ${period}`).toBe(2);
        // The first snap of each series is first and goal from the ten.
        const first = inPeriod[0];
        expect(first.yardLine).toBe(RULES.overtimeFrom);
        expect(first.down).toBe(1);
        expect(first.distance).toBe(10);
        const second = inPeriod.find((e) => e.offense !== first.offense)!;
        expect(second.yardLine).toBe(RULES.overtimeFrom);
        expect(second.down).toBe(1);
        // Once the second team has the ball the first never gets it back in that period.
        const switchAt = inPeriod.indexOf(second);
        expect(inPeriod.slice(switchAt).every((e) => e.offense === second.offense)).toBe(true);
      }
    }
  });

  it('the team that went second in one period goes first in the next', () => {
    const long = ot.filter((g) => g.overtime >= 2);
    expect(long.length).toBeGreaterThan(0);
    for (const g of long) {
      const firstOf = (period: number): number => g.events.find((e) => e.quarter === RULES.quarters + period)!.offense;
      expect(firstOf(2)).not.toBe(firstOf(1));
    }
  });

  it('an overtime game replays to the same fingerprint', () => {
    const g = ot[0];
    const again = replayGame(g.seed, exhibitionTeams(g.seed), g.log, { setup: { quarterMinutes: 4 } });
    expect(gameHash(again)).toBe(gameHash(g));
    expect(again.overtime).toBe(g.overtime);
  });

  it('a call made as regulation runs out is not run by the wrong team in overtime', () => {
    // Replay an overtime game up to the last snap of regulation, then make any call: if the run-off ends the game level,
    // overtime starts cleanly and nothing has been snapped.
    const g = ot.find((x) => x.events.some((e) => e.quarter > 4))!;
    const fresh = new Game(g.seed, exhibitionTeams(g.seed), { setup: { quarterMinutes: 4 } });
    for (const d of g.log) {
      if ('manage' in d) continue;
      const wasOt = fresh.overtime;
      fresh.begin(d.off, d.def);
      if (!wasOt && fresh.overtime) {
        expect(fresh.live).toBeNull();
        expect(fresh.state.yardLine).toBe(RULES.overtimeFrom);
        expect(fresh.state.down).toBe(1);
      }
      while (!fresh.tick()) { /* step */ }
    }
    expect(gameHash(fresh)).toBe(gameHash(g));
  });
});
