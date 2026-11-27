import { describe, expect, it } from 'vitest';
import { exhibitionTeams } from '@fnd/core';
import { simulateGame, summarize } from '@fnd/match-sim';
import { boxScore, createDynasty, driveChart, gameTotals, periodScores, playWeek, replayResult, scoringPlays, situation } from '@fnd/league';

/** The game book has to agree with the scoreboard and with itself, for every game. */

describe('the game book', () => {
  const games = Array.from({ length: 40 }, (_, i) => simulateGame(500 + i, exhibitionTeams(500 + i), { setup: { quarterMinutes: i % 2 ? 6 : 12, weather: 'clear' } }));

  it('points by period add up to the final score', () => {
    for (const g of games) {
      const [a, b] = periodScores(g.events);
      expect(a.length).toBeGreaterThanOrEqual(4);
      expect(a.reduce((x, y) => x + y, 0)).toBe(g.state.score[0]);
      expect(b.reduce((x, y) => x + y, 0)).toBe(g.state.score[1]);
    }
  });

  it('the scoring plays end on the final score and never go backwards', () => {
    for (const g of games) {
      const plays = scoringPlays(g.events);
      let last: [number, number] = [0, 0];
      for (const p of plays) {
        expect(p.scoreAfter[p.team]).toBeGreaterThan(last[p.team]);
        expect(p.scoreAfter[1 - p.team]).toBe(last[1 - p.team]);
        last = p.scoreAfter;
      }
      expect(last).toEqual([g.state.score[0], g.state.score[1]]);
    }
  });

  it('team totals agree with the box score and the old summary', () => {
    for (const g of games) {
      const totals = gameTotals(g.events);
      const old = summarize(g.events);
      const box = boxScore(g.events);
      for (const t of [0, 1] as const) {
        expect(totals[t].passComp).toBe(old[t].passComp);
        expect(totals[t].passYds).toBe(old[t].passYds);
        expect(totals[t].firstDowns).toBeGreaterThanOrEqual(old[t].firstDowns);
        const lines = Object.values(box.players[t]);
        expect(totals[t].passYds).toBe(lines.reduce((n, l) => n + l.passYds, 0));
        expect(totals[t].rushYds).toBe(lines.reduce((n, l) => n + l.rushYds, 0));
        expect(totals[t].yards).toBe(box.teams[t].yards);
        expect(totals[t].thirdDowns[0]).toBeLessThanOrEqual(totals[t].thirdDowns[1]);
        expect(totals[t].possession).toBeGreaterThan(0);
      }
      // The two sides' time with the ball is the game: every second of regulation, give or take the kicks.
      const regulation = g.setup.quarterMinutes * 60 * 4;
      expect(totals[0].possession + totals[1].possession).toBeLessThanOrEqual(regulation + 1);
      if (!g.overtime) expect(totals[0].possession + totals[1].possession).toBeGreaterThan(regulation * 0.8);
    }
  });

  it('every snap belongs to exactly one drive, and drives account for the touchdowns and field goals', () => {
    for (const g of games) {
      const drives = driveChart(g.events);
      const inDrive = new Set<number>();
      for (const d of drives) {
        expect(d.plays).toBeGreaterThanOrEqual(0);
        for (let i = d.first; i <= d.last; i++) {
          const e = g.events[i];
          if (e.type === 'kickoff' || e.type === 'pat' || e.type === 'twoPoint') continue;
          expect(inDrive.has(i)).toBe(false);
          inDrive.add(i);
          expect(e.offense).toBe(d.team);
        }
      }
      g.events.forEach((e, i) => { if (e.type !== 'kickoff' && e.type !== 'pat' && e.type !== 'twoPoint') expect(inDrive.has(i)).toBe(true); });
      const offensiveTds = g.events.filter((e) => e.flags.touchdown && (e.type === 'run' || e.type === 'pass')).length;
      expect(drives.filter((d) => d.result === 'Touchdown').length).toBe(offensiveTds);
      expect(drives.filter((d) => d.result === 'Field goal').length).toBe(g.events.filter((e) => e.type === 'fieldGoal' && e.flags.good).length);
      expect(drives.filter((d) => d.result === 'Punt').length).toBe(g.events.filter((e) => e.type === 'punt').length);
    }
  });

  it('writes down and distance the way a scorer does', () => {
    const abbr = ['HOM', 'VIS'] as const;
    const g = games[0];
    const base = g.events.find((e) => e.type === 'run')!;
    expect(situation({ ...base, offense: 0, down: 3, distance: 4, yardLine: 38 }, abbr)).toBe('3rd & 4 at HOM 38');
    expect(situation({ ...base, offense: 1, down: 1, distance: 10, yardLine: 65 }, abbr)).toBe('1st & 10 at HOM 35');
    expect(situation({ ...base, offense: 0, down: 2, distance: 5, yardLine: 95 }, abbr)).toBe('2nd & goal at VIS 5');
    expect(situation({ ...base, offense: 0, down: 1, distance: 10, yardLine: 50 }, abbr)).toBe('1st & 10 at the 50');
    expect(situation({ ...base, type: 'kickoff' }, abbr)).toBe('Kickoff');
  });

  it('any league game between two other schools can be opened again and is the same game', { timeout: 120_000 }, () => {
    let d = createDynasty('OH', 12, 3, { quarterMinutes: 4 });
    for (let w = 0; w < 4; w++) d = playWeek(d);
    let opened = 0;
    for (const g of d.results) {
      const book = replayResult(d, g);
      if (g.home === 3 || g.away === 3) {
        expect(book).toBeNull();
        continue;
      }
      expect(book).not.toBeNull();
      const [a, b] = periodScores(book!.events);
      expect([a.reduce((x, y) => x + y, 0), b.reduce((x, y) => x + y, 0)]).toEqual(g.score);
      expect(book!.teams[0].name).toBe(d.league.schools[g.home].name);
      opened++;
    }
    expect(opened).toBe(12);
  });
});
