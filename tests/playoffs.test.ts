import { describe, expect, it } from 'vitest';
import { FINAL_WEEK, REGULAR_WEEKS, career, createDynasty, lastWeek, loadDynasty, nextSeason, playWeek, recordOf, seasonOver, standings, weekGames, winnerOf, type Dynasty } from '@fnd/league';

/** The four-team bracket, and what happens to a dynasty saved before there was one. */

const old = (seed: number): Dynasty => {
  // A dynasty as it was saved before brackets: no `bracket` field at all.
  const d = createDynasty('OH', seed, 1, { quarterMinutes: 4 });
  delete d.bracket;
  return d;
};

describe('the bracket', () => {
  it('a new dynasty has one, and a playoff loss or win counts in the record', { timeout: 240_000 }, () => {
    let d = createDynasty('OH', 61, 1, { quarterMinutes: 4 });
    expect(d.bracket).toBe(true);
    expect(lastWeek(d)).toBe(FINAL_WEEK);
    while (!seasonOver(d)) d = playWeek(d);
    expect(d.results.length).toBe(REGULAR_WEEKS * 4 + 3);
    const table = standings(d.results);
    const semis = d.results.filter((g) => g.week === REGULAR_WEEKS);
    const final = d.results.filter((g) => g.week === FINAL_WEEK);
    expect(final.length).toBe(1);
    const champion = winnerOf(final[0]);
    expect(d.history[0].champion).toBe(champion);
    expect(d.history[0].runnerUp).toBe(champion === final[0].home ? final[0].away : final[0].home);
    // Only the top four played on, and the champion won twice more than his regular-season wins.
    const top4 = table.slice(0, 4).map((r) => r.school);
    for (const g of [...semis, ...final]) expect(top4).toContain(g.home), expect(top4).toContain(g.away);
    expect(recordOf(d.results, champion)[0]).toBe(table.find((r) => r.school === champion)!.wins + 2);
    const out = table[7].school;
    expect(recordOf(d.results, out)).toEqual([table[7].wins, table[7].losses, table[7].ties]);
    // It survives a save at every stage, and a broken one is refused.
    expect(loadDynasty(JSON.parse(JSON.stringify(d)))!.results.length).toBe(d.results.length);
    expect(loadDynasty({ ...JSON.parse(JSON.stringify(d)), results: d.results.slice(0, -1) })).toBeNull();
    expect(loadDynasty({ ...JSON.parse(JSON.stringify(d)), bracket: 'yes' })).toBeNull();
    const next = nextSeason(d);
    expect(next.bracket).toBe(true);
    expect(career(next).seasons).toBe(1);
  });

  it('a dynasty saved before brackets finishes its season the old way, then gets a bracket', { timeout: 240_000 }, () => {
    for (const stopAt of [0, 3, REGULAR_WEEKS, REGULAR_WEEKS + 1]) {
      let d = old(62);
      while (d.week < stopAt) d = playWeek(d);
      // Saved and loaded at this point, as it would be from a browser or the server.
      const loaded = loadDynasty(JSON.parse(JSON.stringify(d)))!;
      expect(loaded).not.toBeNull();
      expect(loaded.bracket).toBeUndefined();
      expect(loaded.week).toBe(stopAt);
      expect(loaded.results.length).toBe(d.results.length);
      d = loaded;
      if (stopAt <= REGULAR_WEEKS) {
        while (d.week < REGULAR_WEEKS) d = playWeek(d);
        const t = standings(d.results);
        expect(weekGames(d)).toEqual([[t[0].school, t[1].school]]);
        d = playWeek(d);
      }
      expect(seasonOver(d)).toBe(true);
      expect(d.week).toBe(REGULAR_WEEKS + 1);
      expect(d.results.length).toBe(REGULAR_WEEKS * 4 + 1);
      expect(d.history.length).toBe(1);
      const next = nextSeason(d);
      expect(next.bracket).toBe(true);
      expect(next.week).toBe(0);
      expect(next.history).toEqual(d.history);
    }
  });

  it('a league that has said no to a bracket keeps the old ending, season after season', { timeout: 240_000 }, () => {
    let d: Dynasty = { ...createDynasty('OH', 63, 1, { quarterMinutes: 4 }), bracket: false };
    for (let y = 0; y < 2; y++) {
      while (!seasonOver(d)) d = playWeek(d);
      expect(d.week).toBe(REGULAR_WEEKS + 1);
      expect(d.results.length).toBe(REGULAR_WEEKS * 4 + 1);
      d = nextSeason(d);
      expect(d.bracket).toBe(false);
    }
  });
});
