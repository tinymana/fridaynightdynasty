import { describe, expect, it } from 'vitest';
import {
  FINAL_WEEK, LEAGUE_SIZE, PRESTIGE_MAX, PRESTIGE_MIN, REGULAR_WEEKS, seasonOver, STATES, career, createDynasty, createLeague, editSchool, loadDynasty, nextSeason, playWeek, schedule, standings, teamFor, userGame, weekGames, winnerOf,
  type Dynasty,
} from '@fnd/league';

describe('league generator', () => {
  it('covers all fifty states', () => {
    expect(STATES.length).toBe(50);
    expect(new Set(STATES.map((s) => s.code)).size).toBe(50);
  });
  it('makes eight distinct schools for every state, the same every time', () => {
    for (const s of STATES) {
      const a = createLeague(s.code, 7);
      expect(a.schools.length).toBe(LEAGUE_SIZE);
      expect(new Set(a.schools.map((x) => x.name)).size, s.code).toBe(LEAGUE_SIZE);
      expect(new Set(a.schools.map((x) => x.abbr)).size, s.code).toBe(LEAGUE_SIZE);
      expect(new Set(a.schools.map((x) => x.mascot)).size, s.code).toBe(LEAGUE_SIZE);
      expect(new Set(a.schools.map((x) => x.colors)).size, s.code).toBe(LEAGUE_SIZE);
      for (const x of a.schools) {
        expect(x.abbr).toMatch(/^[A-Z]{3}$/);
        expect(x.prestige).toBeGreaterThanOrEqual(PRESTIGE_MIN);
        expect(x.prestige).toBeLessThanOrEqual(PRESTIGE_MAX);
      }
      expect(createLeague(s.code, 7)).toEqual(a);
    }
    expect(createLeague('TX', 1).schools.map((x) => x.name)).not.toEqual(createLeague('TX', 2).schools.map((x) => x.name));
    expect(createLeague('TX', 1).schools.map((x) => x.name)).not.toEqual(createLeague('ME', 1).schools.map((x) => x.name));
  });
  it('schedules a full round robin: everyone plays everyone once, one game a week', () => {
    const weeks = schedule();
    expect(weeks.length).toBe(REGULAR_WEEKS);
    const met = new Set<string>();
    const home = Array(LEAGUE_SIZE).fill(0);
    for (const w of weeks) {
      expect(w.length).toBe(LEAGUE_SIZE / 2);
      expect(new Set(w.flat()).size).toBe(LEAGUE_SIZE);
      for (const [h, a] of w) {
        met.add([h, a].sort().join('-'));
        home[h]++;
      }
    }
    expect(met.size).toBe((LEAGUE_SIZE * (LEAGUE_SIZE - 1)) / 2);
    for (const n of home) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(4);
    }
  });
  it('gives each school a full, different roster each year', () => {
    const d = createDynasty('OH', 3, 0);
    const a = teamFor(d, 0);
    const b = teamFor({ ...d, year: 2 }, 0);
    expect(a.roster.length).toBe(39);
    expect(a.name).toBe(d.league.schools[0].name);
    expect(a.roster.map((p) => p.name)).not.toEqual(b.roster.map((p) => p.name));
    expect(teamFor(d, 0)).toEqual(a);
  });
});

describe('a season', () => {
  const fast = { quarterMinutes: 4 as const };
  it('plays seven weeks, semifinals for the top four and a final', () => {
    let d = createDynasty('GA', 11, 2, fast);
    for (let w = 0; w < REGULAR_WEEKS; w++) {
      expect(weekGames(d).length).toBe(4);
      expect(userGame(d)).not.toBeNull();
      d = playWeek(d);
    }
    const table = standings(d.results);
    expect(table.reduce((n, r) => n + r.wins + r.losses + r.ties, 0)).toBe(REGULAR_WEEKS * LEAGUE_SIZE);
    expect(table.reduce((n, r) => n + r.wins, 0)).toBe(table.reduce((n, r) => n + r.losses, 0));
    for (let i = 1; i < table.length; i++) expect(table[i - 1].wins).toBeGreaterThanOrEqual(table[i].wins);
    // Semifinals: first hosts fourth, second hosts third.
    expect(weekGames(d)).toEqual([[table[0].school, table[3].school], [table[1].school, table[2].school]]);
    d = playWeek(d);
    expect(d.week).toBe(FINAL_WEEK);
    expect(d.history.length).toBe(0);
    expect(seasonOver(d)).toBe(false);
    const semis = d.results.filter((g) => g.week === REGULAR_WEEKS);
    expect(semis.length).toBe(2);
    // The final: the two winners, at the home of the higher finisher. The regular-season table does not move.
    expect(standings(d.results)).toEqual(table);
    const through = semis.map(winnerOf).sort((a, b) => table.findIndex((r) => r.school === a) - table.findIndex((r) => r.school === b));
    expect(weekGames(d)).toEqual([[through[0], through[1]]]);
    d = playWeek(d);
    expect(d.week).toBe(FINAL_WEEK + 1);
    expect(seasonOver(d)).toBe(true);
    expect(weekGames(d)).toEqual([]);
    expect(() => playWeek(d)).toThrow();
    expect(d.history.length).toBe(1);
    const final = d.results[d.results.length - 1];
    expect(d.history[0].champion).toBe(winnerOf(final));
    expect(table.slice(0, 4).map((r) => r.school)).toContain(d.history[0].champion);
    expect(() => playWeek(d)).toThrow();
  });
  it('uses the coach\'s own result for his game and refuses a result for the wrong game', () => {
    const d = createDynasty('GA', 11, 2, fast);
    const [h, a] = userGame(d)!;
    const mine = { week: 0, home: h, away: a, score: [41, 3] as [number, number] };
    const after = playWeek(d, mine);
    expect(after.results.find((g) => g.home === h && g.away === a)!.score).toEqual([41, 3]);
    expect(after.results.length).toBe(4);
    expect(() => playWeek(d, { ...mine, home: a, away: h })).toThrow();
    expect(() => playWeek(d, { ...mine, week: 3 })).toThrow();
    // The same week with the AI coaching gives the same other three games.
    const ai = playWeek(d);
    expect(ai.results.filter((g) => g.home !== h)).toEqual(after.results.filter((g) => g.home !== h));
  });
  it('a saved dynasty loads back the same, and a tampered one is refused or repaired', () => {
    let d = createDynasty('WA', 5, 1, fast);
    d = playWeek(playWeek(d));
    expect(loadDynasty(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(loadDynasty(null)).toBeNull();
    expect(loadDynasty({ ...d, v: 2 })).toBeNull();
    expect(loadDynasty({ ...d, week: 5 })).toBeNull();
    expect(loadDynasty({ ...d, results: [{ week: 0, home: 0, away: 0, score: [9, 9] }, ...d.results.slice(1)] })).toBeNull();
    const boosted = JSON.parse(JSON.stringify(d)) as Dynasty;
    boosted.league.schools[1].prestige = 99;
    boosted.league.schools[1].name = 'Cheaters';
    const fixed = loadDynasty(boosted)!;
    expect(fixed.league.schools[1].prestige).toBe(PRESTIGE_MAX);
    // A school may be renamed, so the name stays; its strength may not be raised.
    expect(fixed.league.schools[1].name).toBe('Cheaters');
  });
});

describe('30 seasons of one league', () => {
  it('stays sound and competitive: no dynasty runs away, no school is hopeless', { timeout: 600_000 }, () => {
    let d = createDynasty('TX', 2026, 0, { quarterMinutes: 6 });
    const titles = Array(LEAGUE_SIZE).fill(0);
    const wins = Array(LEAGUE_SIZE).fill(0);
    let ties = 0, games = 0, points = 0;
    for (let year = 1; year <= 30; year++) {
      expect(d.year).toBe(year);
      while (!seasonOver(d)) d = playWeek(d);
      expect(d.results.length).toBe(REGULAR_WEEKS * 4 + 3);
      for (const r of standings(d.results)) wins[r.school] += r.wins;
      for (const g of d.results) {
        games++;
        points += g.score[0] + g.score[1];
        if (g.score[0] === g.score[1]) ties++;
      }
      titles[d.history[year - 1].champion]++;
      for (const s of d.league.schools) {
        expect(s.prestige).toBeGreaterThanOrEqual(PRESTIGE_MIN);
        expect(s.prestige).toBeLessThanOrEqual(PRESTIGE_MAX);
      }
      d = nextSeason(d);
    }
    const c = career(d);
    console.log('titles', titles.join(' '), '| regular-season wins', wins.join(' '), '| ties', ties, 'of', games, '| points a team a game', (points / games / 2).toFixed(1), '| coach', JSON.stringify(c));
    expect(d.history.length).toBe(30);
    expect(c.seasons).toBe(30);
    expect(c.wins + c.losses + c.ties).toBeGreaterThanOrEqual(30 * REGULAR_WEEKS);
    expect(c.championships).toBe(titles[0]);
    expect(Math.max(...titles)).toBeLessThanOrEqual(12);
    expect(titles.filter((t) => t > 0).length).toBeGreaterThanOrEqual(5);
    // Every school wins at least a quarter of its games over 30 years and none wins three quarters.
    for (const w of wins) {
      expect(w).toBeGreaterThan(30 * REGULAR_WEEKS * 0.25);
      expect(w).toBeLessThan(30 * REGULAR_WEEKS * 0.75);
    }
  });
});

describe('renaming a school in a solo dynasty', () => {
  it('keeps a valid new name and colours through a save, and drops an invalid one', () => {
    const d = createDynasty('OR', 9, 3, { quarterMinutes: 4 });
    const identity = { name: 'Tiny Mana Prep', mascot: 'Wizards', abbr: 'TMP', colors: { jersey: 0x112233, helmet: 0xffffff, pants: 0, trim: 0xff8800 } };
    const edited = { ...d, league: editSchool(d.league, 3, identity) };
    expect(edited.league.schools[3].name).toBe('Tiny Mana Prep');
    expect(edited.league.schools[3].prestige).toBe(d.league.schools[3].prestige);
    expect(teamFor(edited, 3).roster.map((p) => p.name)).toEqual(teamFor(d, 3).roster.map((p) => p.name));
    expect(loadDynasty(JSON.parse(JSON.stringify(edited)))).toEqual(edited);
    expect(() => editSchool(d.league, 3, { ...identity, name: d.league.schools[0].name })).toThrow(/Another school/);
    expect(() => editSchool(d.league, 3, { ...identity, abbr: 'toolong' })).toThrow();
    const bad = JSON.parse(JSON.stringify(edited)) as Dynasty;
    bad.league.schools[3].name = '<b>x</b>';
    expect(loadDynasty(bad)!.league.schools[3].name).toBe(d.league.schools[3].name);
  });
});

describe('head coaching jobs', () => {
  it('lists the same five schools for the same league, strongest first, with a believable last season', async () => {
    const { OPENINGS, openings } = await import('@fnd/league');
    for (let seed = 1; seed <= 25; seed++) {
      const league = createLeague('GA', seed);
      const jobs = openings(league);
      expect(jobs).toEqual(openings(createLeague('GA', seed)));
      expect(jobs.length).toBe(OPENINGS);
      expect(new Set(jobs.map((j) => j.school)).size).toBe(OPENINGS);
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        expect(j.lastRecord[0] + j.lastRecord[1]).toBe(7);
        expect(j.reason.length).toBeGreaterThan(10);
        if (i) expect(league.schools[j.school].prestige).toBeLessThanOrEqual(league.schools[jobs[i - 1].school].prestige);
        // A powerhouse is not hiring after a winless year, and a rebuilding school is not hiring after a perfect one.
        if (league.schools[j.school].prestige >= 61) expect(j.lastRecord[0]).toBeGreaterThanOrEqual(4);
        if (league.schools[j.school].prestige <= 55) expect(j.lastRecord[0]).toBeLessThanOrEqual(3);
      }
    }
  });
});
