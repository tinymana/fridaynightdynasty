import { describe, expect, it } from 'vitest';
import { LEAGUE_SIZE, REGULAR_WEEKS, RIVALRY_WEEK, createDynasty, isRivalryGame, loadDynasty, nextSeason, playWeek, rivalOf, rivalries, schedule, weeklyPaper } from '@fnd/league';

/** Rivalries and the weekly paper. */

describe('rivalries', () => {
  it('every school has exactly one rival, and they meet in the last week of the regular season', () => {
    for (let i = 0; i < LEAGUE_SIZE; i++) {
      const r = rivalOf(i);
      expect(r).not.toBe(i);
      expect(rivalOf(r)).toBe(i);
      expect(schedule()[RIVALRY_WEEK].some(([a, b]) => (a === i && b === r) || (a === r && b === i))).toBe(true);
      expect(isRivalryGame(RIVALRY_WEEK, i, r)).toBe(true);
      expect(isRivalryGame(0, i, r)).toBe(false);
    }
  });

  it('each has a trophy and a long series behind it that is never far from level', () => {
    const d = createDynasty('PA', 404, 0, { quarterMinutes: 4 });
    const list = rivalries(d);
    expect(list.length).toBe(4);
    for (const r of list) {
      expect(r.trophy).toMatch(/^the [A-Z]/);
      const played = r.series[0] + r.series[1] + r.series[2];
      expect(played).toBeGreaterThanOrEqual(38);
      expect(played).toBeLessThanOrEqual(61);
      expect(Math.abs(r.series[0] - r.series[1])).toBeLessThan(played * 0.3);
      expect([r.a, r.b]).toContain(r.holder);
    }
    expect(JSON.stringify(rivalries(createDynasty('PA', 404, 3)))).toBe(JSON.stringify(list));
  });

  it('the series and the trophy follow the games, through a save and into the next season', { timeout: 240_000 }, () => {
    let d = createDynasty('PA', 404, 2, { quarterMinutes: 4 });
    const before = rivalries(d);
    while (d.week <= REGULAR_WEEKS) d = playWeek(d);
    const after = rivalries(d);
    after.forEach((r, k) => {
      const g = d.results.find((x) => x.week === RIVALRY_WEEK && [x.home, x.away].includes(r.a) && [x.home, x.away].includes(r.b))!;
      const a = g.home === r.a ? g.score[0] : g.score[1];
      const b = g.home === r.a ? g.score[1] : g.score[0];
      const add = a > b ? [1, 0, 0] : a < b ? [0, 1, 0] : [0, 0, 1];
      expect(r.series).toEqual(before[k].series.map((n, i) => n + add[i]));
      if (a !== b) expect(r.holder).toBe(a > b ? r.a : r.b);
      else expect(r.holder).toBe(before[k].holder);
    });
    const loaded = loadDynasty(JSON.parse(JSON.stringify(d)))!;
    expect(rivalries(loaded)).toEqual(after);
    expect(rivalries(nextSeason(d))).toEqual(after);
    // A save with nonsense in it starts the logs again rather than breaking.
    const bad = loadDynasty({ ...JSON.parse(JSON.stringify(d)), rivals: [{ w: ['x', -3, 1e9] }, 7, null] })!;
    expect(bad.rivals!.length).toBe(4);
    expect(bad.rivals![0].w).toEqual([0, 0, 0]);
  });
});

describe('the weekly paper', () => {
  it('prints every week of a season, says the same thing twice, and gets the facts right', { timeout: 240_000 }, () => {
    let d = createDynasty('GA', 88, 5, { quarterMinutes: 4 });
    expect(weeklyPaper(d)).toBeNull();
    const s = d.league.schools;
    for (let w = 0; w <= REGULAR_WEEKS; w++) {
      d = playWeek(d);
      const paper = weeklyPaper(d)!;
      expect(paper).not.toBeNull();
      expect(JSON.stringify(weeklyPaper(d))).toBe(JSON.stringify(paper));
      expect(paper.name).toBe('The Georgia Prep Ledger');
      const games = d.results.filter((g) => g.week === w);
      expect(1 + paper.stories.length).toBe(games.length);
      for (const g of games) {
        const story = [paper.lead, ...paper.stories].find((x) => x.headline.includes(s[g.home].name) || x.headline.includes(s[g.away].name));
        expect(story).toBeDefined();
        if (w < REGULAR_WEEKS && g.score[0] !== g.score[1]) {
          const win = g.score[0] > g.score[1] ? g.home : g.away;
          expect(story!.headline.startsWith(s[win].name)).toBe(true);
          expect(story!.headline).toContain(`${Math.max(...g.score)}-${Math.min(...g.score)}`);
        }
      }
      // The coach's own game leads the page whenever he played.
      const mine = games.find((g) => g.home === 5 || g.away === 5);
      if (mine) expect(paper.lead.headline).toContain(s[5].name);
      expect(paper.table.length).toBe(LEAGUE_SIZE);
      if (w === RIVALRY_WEEK) {
        const trophies = rivalries(d).map((r) => r.trophy.replace(/^the /, 'The '));
        const text = JSON.stringify(paper);
        for (const t of trophies) expect(text).toContain(t);
      }
      if (w === RIVALRY_WEEK - 1) expect(paper.next).toContain('rivalry week');
      if (w === REGULAR_WEEKS) {
        expect(paper.edition).toContain('Championship edition');
        expect(paper.lead.headline + paper.stories.map((x) => x.headline).join()).toContain('champions');
        expect(paper.next).toBeNull();
        expect(paper.notes.some((n) => n.startsWith('Player of the year'))).toBe(true);
      } else expect(paper.next).not.toBeNull();
    }
    // Other schools' stories name the night's best player.
    expect(weeklyPaper(d, false)!.stories.every((x) => x.body.length >= 1)).toBe(true);
  });
});
