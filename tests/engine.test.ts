import { describe, expect, it } from 'vitest';
import { BOOK_SIZE, DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, FORMATIONS, GROUPS, OFFENSE_PLAYS, ROSTER_SIZE, Rng, exhibitionTeams, formationById, validateBook } from '@fnd/core';
import { Game, PlaySim, gameHash, replayGame, simulateGame, summarize } from '@fnd/match-sim';
import { makeSim } from './helpers';

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
    const ids = [a, b].flatMap((t) => t.roster.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('plr_000001');
  });
  it('fills every position group and orders each depth chart', () => {
    const [a] = exhibitionTeams(9);
    for (const g of GROUPS) {
      expect(a.depth[g].length).toBe(ROSTER_SIZE[g]);
      expect(new Set(a.depth[g]).size).toBe(ROSTER_SIZE[g]);
    }
    expect(a.roster.length).toBe(39);
  });
});

describe('play library (M2 acceptance)', () => {
  it('has at least 4 formations, 24 plays, 4 fronts and 4 calls, all as data', () => {
    expect(FORMATIONS.length).toBeGreaterThanOrEqual(4);
    expect(OFFENSE_PLAYS.length).toBeGreaterThanOrEqual(24);
    expect(DEFENSE_FRONTS.length).toBeGreaterThanOrEqual(4);
    expect(DEFENSE_SCHEMES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(OFFENSE_PLAYS.map((p) => p.id)).size).toBe(OFFENSE_PLAYS.length);
  });
  it('every formation and front fields eleven players the roster can supply', () => {
    for (const f of [...FORMATIONS, ...DEFENSE_FRONTS]) {
      expect(f.slots.length).toBe(11);
      expect(new Set(f.slots.map((x) => x.id)).size).toBe(11);
      const perGroup: Record<string, number[]> = {};
      for (const sl of f.slots) (perGroup[sl.group] ??= []).push(sl.rank);
      for (const [g, ranks] of Object.entries(perGroup)) {
        expect(new Set(ranks).size).toBe(ranks.length);
        expect(Math.max(...ranks)).toBeLessThanOrEqual(ROSTER_SIZE[g as keyof typeof ROSTER_SIZE]);
      }
    }
  });
  it('every play only assigns slots its formation has, with exactly one quarterback and a legal line', () => {
    for (const p of OFFENSE_PLAYS) {
      const f = formationById(p.formation);
      const ids = f.slots.map((x) => x.id);
      for (const slot of Object.keys(p.assign)) expect(ids, `${p.id} assigns ${slot}`).toContain(slot);
      expect(ids.filter((x) => x === 'QB').length).toBe(1);
      expect(f.slots.filter((x) => x.group === 'OL').length).toBe(5);
      const carries = Object.values(p.assign).filter((a) => a.t === 'carry').length;
      expect(carries).toBe(p.kind === 'run' ? 1 : 0);
      if (p.kind === 'pass') expect(Object.values(p.assign).some((a) => a.t === 'route')).toBe(true);
    }
  });
  it('validates playbooks', () => {
    expect(validateBook(DEFAULT_BOOK)).toBeNull();
    expect(DEFAULT_BOOK.length).toBe(BOOK_SIZE);
    expect(validateBook(DEFAULT_BOOK.slice(0, 7))).not.toBeNull();
    expect(validateBook([...DEFAULT_BOOK.slice(0, 7), DEFAULT_BOOK[0]])).not.toBeNull();
    expect(validateBook(OFFENSE_PLAYS.filter((p) => p.kind === 'run').slice(0, 8).map((p) => p.id))).not.toBeNull();
    expect(validateBook([...DEFAULT_BOOK.slice(0, 7), 'nope'])).not.toBeNull();
  });
});

describe('play simulation', () => {
  it('every play against every front and call finishes with a result', () => {
    for (const play of OFFENSE_PLAYS) for (const front of DEFENSE_FRONTS) for (const scheme of DEFENSE_SCHEMES) for (const los of [1, 30, 97]) {
      const sim = makeSim(play.id, front.id, scheme.id, los, los);
      let guard = 0;
      while (!sim.done && guard++ < 2000) sim.step();
      expect(sim.done, `${play.id} vs ${front.id} ${scheme.id}`).toBe(true);
      expect(sim.result).not.toBeNull();
      for (const p of sim.players) {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      }
    }
  });
  it('is identical for the same seed', () => {
    const run = (): unknown => {
      const sim = makeSim('flood', 'nickel', 'blitz', 40, 77);
      while (!sim.done) sim.step();
      return [sim.result, sim.players.map((p) => [p.x, p.y])];
    };
    expect(run()).toEqual(run());
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

  it('replays to the identical score and play list from seed plus decisions', () => {
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
      for (const v of Object.values(g.energy)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('runs a whole game with no rendering in under 2 seconds', () => {
    const t0 = performance.now();
    simulateGame(99, exhibitionTeams(99));
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('accepts human decisions, including timeouts, punts, field goals and kneel-downs', () => {
    const g = new Game(3, exhibitionTeams(3));
    const def = { frontId: '43', callId: 'base' };
    let guard = 0;
    let kneels = 0;
    while (g.state.phase !== 'final' && guard++ < 2000) {
      if (g.state.phase === 'kickoff') g.begin(null, null);
      else if (g.state.phase === 'conversion') g.begin({ kind: 'patKick' }, def);
      else if (g.state.down === 4) g.begin(g.state.yardLine > 65 ? { kind: 'fieldGoal' } : { kind: 'punt' }, def);
      else if (g.state.quarter === 4 && g.state.clock < 60 && g.state.down < 4) {
        kneels++;
        g.begin({ kind: 'kneel' }, def);
      } else g.begin({ kind: 'play', playId: 'dive', timeout: true }, def);
      while (!g.tick()) { /* step */ }
    }
    expect(g.state.phase).toBe('final');
    expect(kneels).toBeGreaterThan(0);
    expect(g.events.some((e) => e.type === 'kneel' && e.yards === -1)).toBe(true);
  });
});

describe('playbooks, depth charts and fatigue (M2 acceptance)', () => {
  it('only allows plays from the team playbook', () => {
    const g = new Game(4, exhibitionTeams(4));
    g.begin(null, null);
    g.tick();
    expect(() => g.begin({ kind: 'play', playId: 'mesh' }, { frontId: '43', callId: 'base' })).toThrow(/playbook/);
  });
  it('uses a custom playbook and rejects an invalid one', () => {
    const book = ['iso', 'zone', 'draw', 'blast', 'mesh', 'smash', 'stick', 'post'];
    const g = simulateGame(11, exhibitionTeams(11), { books: [book, DEFAULT_BOOK] });
    const home = new Set(g.events.filter((e) => e.offense === 0 && e.offCall).map((e) => e.offCall));
    for (const id of home) expect(book).toContain(id);
    expect(() => new Game(1, exhibitionTeams(1), { books: [book.slice(1), DEFAULT_BOOK] })).toThrow();
  });
  it('depth chart changes put a different player on the field and replay exactly', () => {
    const teams = exhibitionTeams(21);
    const g = new Game(21, teams);
    const before = g.starter(0, 'QB').id;
    const order = [...g.depth[0].QB].reverse();
    g.manage({ kind: 'depth', team: 0, group: 'QB', order });
    expect(g.starter(0, 'QB').id).not.toBe(before);
    expect(() => g.manage({ kind: 'depth', team: 0, group: 'QB', order: [before, before] })).toThrow();
    const def = { frontId: '43', callId: 'base' };
    for (let i = 0; i < 40 && g.state.phase !== 'final'; i++) {
      if (g.state.phase === 'kickoff') g.begin(null, null);
      else if (g.state.phase === 'conversion') g.begin({ kind: 'patKick' }, def);
      else if (g.state.down === 4) g.begin({ kind: 'punt' }, def);
      else g.begin({ kind: 'play', playId: 'slants' }, def);
      while (!g.tick()) { /* step */ }
    }
    const passers = new Set(g.events.filter((e) => e.offense === 0 && e.passer).map((e) => e.passer));
    expect(passers.has(order[0])).toBe(true);
    expect(passers.has(before)).toBe(false);
    const again = replayGame(21, exhibitionTeams(21), g.log);
    expect(gameHash(again)).toBe(gameHash(g));
  });
  it('rests a tired starter and brings him back after he recovers', () => {
    const g = new Game(8, exhibitionTeams(8));
    const f = formationById('single');
    const rb = g.starter(0, 'RB');
    const backup = g.starter(0, 'RB', 2);
    g.energy[rb.id] = 30;
    const notices: never[] = [];
    let line = g.lineup(0, f.slots, notices);
    expect(line.find((p) => p.pos === 'RB')!.id).toBe(backup.id);
    expect(notices.length).toBe(1);
    g.energy[rb.id] = 60;
    line = g.lineup(0, f.slots);
    expect(line.find((p) => p.pos === 'RB')!.id).toBe(backup.id);
    g.energy[rb.id] = 80;
    line = g.lineup(0, f.slots);
    expect(line.find((p) => p.pos === 'RB')!.id).toBe(rb.id);
  });
  it('a lower threshold keeps starters in longer, and fatigue changes who plays over a game', () => {
    const g = simulateGame(31, exhibitionTeams(31));
    expect(Math.min(...Object.values(g.energy))).toBeLessThan(100);
    const h = new Game(31, exhibitionTeams(31));
    h.manage({ kind: 'threshold', team: 0, value: 0 });
    const rb = h.starter(0, 'RB');
    h.energy[rb.id] = 5;
    expect(h.lineup(0, formationById('single').slots).find((p) => p.pos === 'RB')!.id).toBe(rb.id);
  });
});
