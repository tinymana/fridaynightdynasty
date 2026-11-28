import { describe, expect, it } from 'vitest';
import { exhibitionTeams, type Team } from '@fnd/core';
import { gameHash, simulateGame } from '@fnd/match-sim';
import { REGULAR_WEEKS, createDynasty, incidentsOf, matchTeams, playWeek, replayResult, schedule } from '@fnd/league';

/** Injuries during a game: a player the league has down to be hurt this week goes down on a play and does not come back. */

describe('a player hurt during a game', () => {
  const base = exhibitionTeams(7);
  const starter = (t: Team, group: 'RB' | 'WR' | 'LB'): string => t.depth[group][0];

  it('is helped off on the first run or pass at or after his play and takes no further part', () => {
    for (const group of ['RB', 'WR', 'LB'] as const) {
      const id = starter(base[0], group);
      const teams: [Team, Team] = [{ ...base[0], hurt: [{ id, play: 12 }] }, base[1]];
      const g = simulateGame(7, teams);
      const at = g.events.findIndex((e) => e.injured);
      expect(at).toBeGreaterThanOrEqual(11);
      const e = g.events[at];
      expect(e.injured).toEqual({ team: 0, id });
      expect(e.seq).toBeGreaterThanOrEqual(12);
      expect(['run', 'pass']).toContain(e.type);
      expect(e.text).toContain('is hurt on the play and is helped off');
      expect(g.events.filter((x) => x.injured).length).toBe(1);
      // From the next snap on he does not carry, catch, throw or tackle.
      for (const later of g.events.slice(at + 1)) if (later.type === 'run' || later.type === 'pass') expect([later.rusher, later.receiver, later.passer, later.tackler]).not.toContain(id);
      // The same game twice is the same game, and it is not the game without the injury.
      expect(gameHash(simulateGame(7, teams))).toBe(gameHash(g));
      expect(gameHash(g)).not.toBe(gameHash(simulateGame(7, base)));
    }
  });

  it('plays on when taking him off would leave the position short, and a game with nobody down is untouched', () => {
    const te = base[0].depth.TE[0];
    const k = base[0].depth.K[0];
    const g = simulateGame(7, [{ ...base[0], hurt: [{ id: te, play: 5 }, { id: k, play: 5 }, { id: 'nobody', play: 5 }] }, base[1]]);
    expect(g.events.some((e) => e.injured)).toBe(false);
    expect(gameHash(g)).toBe(gameHash(simulateGame(7, base)));
    expect(gameHash(simulateGame(7, [{ ...base[0], hurt: [] }, base[1]]))).toBe(gameHash(simulateGame(7, base)));
  });

  it('in a league, the injuries down for a week happen in that week\'s games, to players who dressed', { timeout: 240_000 }, () => {
    let d = createDynasty('OH', 77, 0, { quarterMinutes: 8 });
    let seen = 0, due = 0;
    for (let w = 0; w < REGULAR_WEEKS; w++) {
      for (const [h, a] of schedule()[w]) {
        const teams = matchTeams(d, h, a, w);
        [h, a].forEach((school, side) => {
          const list = incidentsOf(d.league.seed, d.league.schools[school].id, d.year).filter((i) => i.kind === 'injury' && i.week === w);
          const dressed = list.filter((i) => teams[side].roster.some((p) => p.id === i.id));
          expect((teams[side].hurt ?? []).map((x) => x.id).sort()).toEqual(dressed.map((i) => i.id).sort());
          for (const x of teams[side].hurt ?? []) {
            due++;
            expect(x.play).toBeGreaterThanOrEqual(30);
            expect(x.play).toBeLessThan(110);
          }
        });
      }
      d = playWeek(d);
      for (const g of d.results.filter((r) => r.week === w && r.home !== 0 && r.away !== 0)) {
        const book = replayResult(d, g)!;
        expect(book).not.toBeNull();
        for (const e of book.events.filter((x) => x.injured)) {
          seen++;
          const school = e.injured!.team === 0 ? g.home : g.away;
          expect(incidentsOf(d.league.seed, d.league.schools[school].id, d.year).some((i) => i.id === e.injured!.id && i.week === w && i.kind === 'injury')).toBe(true);
        }
      }
    }
    expect(due).toBeGreaterThan(2);
    expect(seen).toBeGreaterThan(0);
  });
});
