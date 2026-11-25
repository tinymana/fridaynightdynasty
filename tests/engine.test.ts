import { describe, expect, it } from 'vitest';
import { DEFENSE_CALLS, OFFENSE_PLAYS, Rng, exhibitionTeams, playById, callById } from '@fnd/core';
import { Game, PlaySim, gameHash, replayGame, simulateGame, summarize } from '@fnd/match-sim';

describe('seeded randomness', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.u32()).toBe(b.u32());
  });
  it('gives independent named streams', () => {
    const a = Rng.stream(7, 'injuries');
    const b = Rng.stream(7, 'play:1');
    expect(a.u32()).not.toBe(b.u32());
  });
  it('matches a pinned value, so a change to the generator is noticed', () => {
    expect(new Rng(1).u32()).toBe(new Rng(1).u32());
    expect(Rng.stream(123, 'pin').int(0, 1_000_000)).toMatchInlineSnapshot(`81633`);
  });
});

describe('team generation', () => {
  it('is deterministic and assigns stable, unique player IDs', () => {
    const [a, b] = exhibitionTeams(5);
    const [a2] = exhibitionTeams(5);
    expect(a).toEqual(a2);
    const ids = [a, b].flatMap((t) => [...Object.values(t.offense), ...Object.values(t.defense), t.kicker, t.punter].map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('plr_000001');
  });
});

describe('play simulation', () => {
  it('every play against every call finishes with a result', () => {
    const [a, b] = exhibitionTeams(1);
    for (const play of OFFENSE_PLAYS) for (const call of DEFENSE_CALLS) for (const los of [1, 30, 97]) {
      const sim = new PlaySim({ offense: a, defense: b, play: playById(play.id), call: callById(call.id), los, rng: new Rng(los) });
      let guard = 0;
      while (!sim.done && guard++ < 2000) sim.step();
      expect(sim.done).toBe(true);
      expect(sim.result).not.toBeNull();
      for (const p of sim.players) {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      }
    }
  });
});

describe('full game', () => {
  const seed = 2026;
  const game = simulateGame(seed, exhibitionTeams(seed));

  it('reaches a final score through four quarters', () => {
    expect(game.state.phase).toBe('final');
    expect(game.state.quarter).toBe(4);
    const types = new Set(game.events.map((e) => e.type));
    for (const t of ['kickoff', 'run', 'pass']) expect(types.has(t as never)).toBe(true);
  });

  it('replays to the identical score and play list from seed plus decisions (M1 acceptance)', () => {
    const again = replayGame(seed, exhibitionTeams(seed), game.log);
    expect(again.state.score).toEqual(game.state.score);
    expect(again.events).toEqual(game.events);
    expect(gameHash(again)).toBe(gameHash(game));
  });

  it('is identical when simulated twice from the same seed', () => {
    expect(gameHash(simulateGame(seed, exhibitionTeams(seed)))).toBe(gameHash(game));
  });

  it('score equals the sum of scoring events, and yardage adds up', () => {
    for (let s = 1; s <= 25; s++) {
      const g = simulateGame(s, exhibitionTeams(s));
      const pts = [0, 0];
      for (const e of g.events) {
        pts[0] += e.points[0];
        pts[1] += e.points[1];
        expect(e.clock).toBeGreaterThanOrEqual(0);
        if (e.type === 'run' || e.type === 'pass') {
          expect(e.yardLine).toBeGreaterThanOrEqual(1);
          expect(e.yardLine).toBeLessThanOrEqual(99);
          expect(e.down).toBeGreaterThanOrEqual(1);
          expect(e.down).toBeLessThanOrEqual(4);
        }
      }
      expect(pts).toEqual(g.state.score);
      const [a, b] = summarize(g.events);
      for (const t of [a, b]) expect(t.totalYds).toBe(t.rushYds + t.passYds);
      expect(g.state.timeouts[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it('runs a whole game with no rendering in under 2 seconds (M1 acceptance)', () => {
    const t0 = performance.now();
    simulateGame(99, exhibitionTeams(99));
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('stays in a believable scoring and play-count range over 60 games', () => {
    let pts = 0;
    let plays = 0;
    for (let s = 100; s < 160; s++) {
      const g = simulateGame(s, exhibitionTeams(s));
      pts += g.state.score[0] + g.state.score[1];
      const [a, b] = summarize(g.events);
      plays += a.plays + b.plays;
    }
    expect(pts / 120).toBeGreaterThan(10);
    expect(pts / 120).toBeLessThan(35);
    expect(plays / 120).toBeGreaterThan(40);
    expect(plays / 120).toBeLessThan(70);
  });

  it('accepts human decisions, including timeouts, punts and field goals', () => {
    const g = new Game(3, exhibitionTeams(3));
    let guard = 0;
    while (g.state.phase !== 'final' && guard++ < 2000) {
      if (g.state.phase === 'kickoff') g.begin(null, null);
      else if (g.state.phase === 'conversion') g.begin({ kind: 'patKick' }, { callId: 'base' });
      else if (g.state.down === 4) g.begin(g.state.yardLine > 65 ? { kind: 'fieldGoal' } : { kind: 'punt' }, { callId: 'base' });
      else g.begin({ kind: 'play', playId: 'dive', timeout: true }, { callId: 'base' });
      while (!g.tick()) { /* step */ }
    }
    expect(g.state.phase).toBe('final');
  });
});
