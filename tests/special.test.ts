import { describe, expect, it } from 'vitest';
import { RULES, Rng, exhibitionTeams, type DefDecision, type OffDecision } from '@fnd/core';
import { aiKickoff } from '@fnd/football-ai';
import { BLOCK_CHANCE, Game, ONSIDE_EXPECTED, ONSIDE_SURPRISE, ROUGHING_CHANCE, blockOutcome, gameHash, replayGame, resolveStyledKickoff, simulateGame } from '@fnd/match-sim';

const teams = exhibitionTeams(3);
const K = teams[0].roster.find((p) => p.pos === 'K')!;
const WR = teams[1].roster.find((p) => p.pos === 'WR')!;
const kicks = (style: 'deep' | 'squib' | 'onside', expected = false) => Array.from({ length: 4000 }, (_, i) => resolveStyledKickoff(new Rng(i + 1), K, WR, RULES.kickoffFrom, style, expected));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('kickoff styles', () => {
  it('a deep kick gives the worst field position on average but can be run back', () => {
    const deep = kicks('deep');
    const squib = kicks('squib');
    expect(mean(deep.filter((k) => !k.touchdown).map((k) => k.startYard))).toBeLessThan(mean(squib.map((k) => k.startYard)) - 3);
    expect(deep.some((k) => k.touchdown)).toBe(true);
    expect(squib.some((k) => k.touchdown)).toBe(false);
    for (const k of squib) {
      expect(k.startYard).toBeGreaterThanOrEqual(20);
      expect(k.startYard).toBeLessThanOrEqual(45);
    }
  });
  it('a surprise onside kick is recovered about one time in four; an expected one about one in nine', () => {
    const surprise = kicks('onside').filter((k) => k.recovered).length / 4000;
    const expected = kicks('onside', true).filter((k) => k.recovered).length / 4000;
    expect(surprise).toBeGreaterThan(ONSIDE_SURPRISE - 0.03);
    expect(surprise).toBeLessThan(ONSIDE_SURPRISE + 0.03);
    expect(expected).toBeGreaterThan(ONSIDE_EXPECTED - 0.03);
    expect(expected).toBeLessThan(ONSIDE_EXPECTED + 0.03);
  });
  it('a failed onside kick hands over the ball near midfield', () => {
    for (const k of kicks('onside')) {
      // Kicking team recovers past its own 50; otherwise the receivers start just inside the kicker's half.
      if (k.recovered) expect(k.startYard).toBeGreaterThanOrEqual(50);
      else expect(k.startYard).toBeGreaterThanOrEqual(45);
      expect(k.startYard).toBeLessThanOrEqual(55);
    }
  });
  it('in a game, an onside kick either keeps the ball or gives it up at midfield', () => {
    let kept = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const g = new Game(seed, exhibitionTeams(seed));
      const kicking = g.state.kicking;
      g.begin({ kind: 'kickoff', style: 'onside' }, null);
      while (!g.tick()) { /* step */ }
      expect(g.state.phase).toBe('scrimmage');
      expect(g.lastEvent!.flags.onside).toBe(true);
      if (g.state.possession === kicking) {
        kept++;
        expect(g.lastEvent!.flags.recovered).toBe(true);
        expect(g.state.yardLine).toBeGreaterThanOrEqual(50);
      } else expect(g.state.yardLine).toBeGreaterThanOrEqual(45);
    }
    expect(kept).toBeGreaterThan(30);
    expect(kept).toBeLessThan(75);
  });
  it('the old null kickoff decision still means a deep kick, so old game logs replay the same', () => {
    const a = new Game(9, exhibitionTeams(9));
    const b = new Game(9, exhibitionTeams(9));
    a.begin(null, null);
    b.begin({ kind: 'kickoff', style: 'deep' }, null);
    while (!a.tick()) { /* step */ }
    while (!b.tick()) { /* step */ }
    expect(a.state).toEqual(b.state);
  });
  it('the AI kicks onside only when behind late, and squibs to end a half', () => {
    expect(aiKickoff(1, 600, 0)).toBe('deep');
    expect(aiKickoff(4, 600, -7)).toBe('deep');
    expect(aiKickoff(4, 120, -3)).toBe('onside');
    expect(aiKickoff(4, 280, -14)).toBe('onside');
    expect(aiKickoff(4, 120, 3)).toBe('deep');
    expect(aiKickoff(2, 10, 0)).toBe('squib');
    expect(aiKickoff(4, 10, 3)).toBe('squib');
  });
});

/** Plays AI football until the offense faces fourth down, then returns the game ready for that snap. */
function fourthDown(seed: number, want: (g: Game) => boolean = () => true): Game | null {
  const g = simulateUntil(seed, (x) => x.state.phase === 'scrimmage' && x.state.down === 4 && want(x));
  return g;
}
function simulateUntil(seed: number, stop: (g: Game) => boolean): Game | null {
  const done = simulateGame(seed, exhibitionTeams(seed));
  const g = new Game(seed, exhibitionTeams(seed));
  for (const d of done.log) {
    if (stop(g)) return g;
    if ('manage' in d) continue;
    g.begin(d.off, d.def);
    while (!g.tick()) { /* step */ }
  }
  return null;
}
const BASE: DefDecision = { frontId: '43', callId: 'base' };
const RUSH: DefDecision = { frontId: '43', callId: 'base', block: true };

describe('going for the block', () => {
  it('one roll decides it: blocked, a flag, or nothing', () => {
    expect(blockOutcome(0)).toBe('blocked');
    expect(blockOutcome(BLOCK_CHANCE + 0.001)).toBe('roughing');
    expect(blockOutcome(BLOCK_CHANCE + ROUGHING_CHANCE + 0.001)).toBe('none');
  });
  it('against a punt: sometimes a block, sometimes a flag, never a return; without it, never a block', () => {
    let blocked = 0, flags = 0, n = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const g = fourthDown(seed, (x) => x.state.yardLine < 55);
      if (!g) continue;
      const calm = replayGame(seed, exhibitionTeams(seed), g.log);
      const off = g.state.possession;
      const spot = g.state.yardLine;
      g.begin({ kind: 'punt' }, RUSH);
      while (!g.tick()) { /* step */ }
      calm.begin({ kind: 'punt' }, BASE);
      while (!calm.tick()) { /* step */ }
      // The quarter can end on the run-off before the snap; then there was no punt.
      if (!g.lastEvent || !calm.lastEvent) continue;
      expect(calm.lastEvent!.flags.blocked).toBeUndefined();
      expect(calm.lastEvent!.flags.roughing).toBeUndefined();
      n++;
      const e = g.lastEvent!;
      if (e.flags.blocked) {
        blocked++;
        expect(g.state.possession).not.toBe(off);
        expect(g.state.yardLine).toBe(Math.min(99, 100 - (spot - 6)));
      } else if (e.flags.roughing) {
        flags++;
        expect(g.state.possession).toBe(off);
        expect(g.state.down).toBe(1);
        expect(g.state.yardLine).toBe(spot + 15);
      } else {
        expect(e.text).not.toMatch(/returned/);
        // Field position is never better for the rushing team's opponent than the calm punt minus its return.
        expect(g.state.yardLine).toBeLessThanOrEqual(calm.state.yardLine);
      }
    }
    expect(n).toBeGreaterThan(300);
    expect(blocked / n).toBeGreaterThan(0.02);
    expect(blocked / n).toBeLessThan(0.11);
    expect(flags / n).toBeGreaterThan(0.03);
    expect(flags / n).toBeLessThan(0.12);
  });
  it('against a field goal: a block takes the points off the board', () => {
    let blocked = 0, n = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const g = fourthDown(seed, (x) => x.state.yardLine >= 70);
      if (!g) continue;
      const off = g.state.possession;
      const before = g.state.score[off];
      g.begin({ kind: 'fieldGoal' }, RUSH);
      while (!g.tick()) { /* step */ }
      if (!g.lastEvent) continue;
      n++;
      if (g.lastEvent!.flags.blocked) {
        blocked++;
        expect(g.state.score[off]).toBe(before);
        expect(g.state.possession).not.toBe(off);
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(blocked).toBeGreaterThan(0);
    expect(blocked / n).toBeLessThan(0.13);
  });
  it('a real play against the block rush gains more than against the same defense playing it straight', () => {
    let rushYards = 0, baseYards = 0, n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const g = fourthDown(seed, (x) => x.state.yardLine < 80);
      if (!g) continue;
      const calm = replayGame(seed, exhibitionTeams(seed), g.log);
      const call: OffDecision = { kind: 'play', playId: 'slants' };
      const y0 = g.state.yardLine;
      g.begin(call, RUSH);
      calm.begin(call, BASE);
      const snapped = g.live !== null;
      if (snapped) expect(g.caughtBlocking).toBe(true);
      expect(calm.caughtBlocking).toBe(false);
      while (!g.tick()) { /* step */ }
      while (!calm.tick()) { /* step */ }
      if (!snapped) continue;
      rushYards += g.lastEvent!.yards;
      baseYards += calm.lastEvent!.yards;
      n++;
      void y0;
    }
    expect(n).toBeGreaterThan(250);
    expect(rushYards / n).toBeGreaterThan(baseYards / n + 0.5);
  });
  it('the block call does nothing before fourth down', () => {
    const g = simulateUntil(5, (x) => x.state.phase === 'scrimmage' && x.state.down === 1)!;
    const twin = replayGame(5, exhibitionTeams(5), g.log);
    g.begin({ kind: 'play', playId: 'dive' }, RUSH);
    twin.begin({ kind: 'play', playId: 'dive' }, BASE);
    while (!g.tick()) { /* step */ }
    while (!twin.tick()) { /* step */ }
    expect(g.lastEvent!.yards).toBe(twin.lastEvent!.yards);
  });
  it('games with special teams calls replay to the same fingerprint', () => {
    const a = simulateGame(77, exhibitionTeams(77));
    const b = replayGame(77, exhibitionTeams(77), a.log);
    expect(gameHash(b)).toBe(gameHash(a));
    expect(a.log.some((d) => !('manage' in d) && d.off?.kind === 'kickoff')).toBe(true);
  });
});

describe('returns are recorded for the field to show', () => {
  it('kickoffs and punts carry their return yards; touchbacks and fair catches carry none', () => {
    let kickReturns = 0, puntReturns = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const g = simulateGame(seed, exhibitionTeams(seed));
      for (const e of g.events) {
        if (e.type !== 'kickoff' && e.type !== 'punt') continue;
        if (e.flags.onside || e.flags.blocked || e.flags.roughing) continue;
        expect(e.returnYards).toBeGreaterThanOrEqual(0);
        if (e.flags.touchback) expect(e.returnYards).toBe(0);
        if (/returns it|returned/.test(e.text)) {
          expect(e.returnYards).toBeGreaterThan(0);
          expect(e.text).toContain(`${e.returnYards} yard`);
          if (e.type === 'kickoff') kickReturns++;
          else puntReturns++;
        } else if (!e.flags.touchdown) expect(e.returnYards).toBe(0);
      }
    }
    expect(kickReturns).toBeGreaterThan(40);
    expect(puntReturns).toBeGreaterThan(20);
  });
});
