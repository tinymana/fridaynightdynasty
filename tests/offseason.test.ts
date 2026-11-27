import { describe, expect, it } from 'vitest';
import { overall } from '@fnd/core';
import {
  CALL_UP_COST_MAX, FOCUSES, REGULAR_WEEKS, campNews, career, createDynasty, jobOffers, loadDynasty, nextSeason, playWeek, programOf, setCallUp, signings, takeJob, teamFor, teamHonors,
  type Dynasty,
} from '@fnd/league';

/** The off-season: banquet, signing day, the coaching carousel, spring practice, the cost of a call-up, fall camp. */

const season = (d: Dynasty): Dynasty => {
  while (d.week <= REGULAR_WEEKS) d = playWeek(d);
  return d;
};

describe('the off-season', () => {
  it('signing day sends a few seniors on, the best of them furthest, and almost nobody to the top level', () => {
    const d = { ...createDynasty('TX', 51, 0, { quarterMinutes: 4 }) };
    let signed = 0, top = 0, schoolYears = 0;
    for (let year = 1; year <= 12; year++) for (let school = 0; school < 8; school++) {
      const now = { ...d, year, week: REGULAR_WEEKS + 1 };
      const list = signings(now, school);
      schoolYears++;
      signed += list.length;
      top += list.filter((x) => x.level === 'Division I').length;
      const seniors = programOf(now, school).filter((p) => p.year === 4);
      for (const x of list) {
        expect(seniors.some((p) => p.id === x.id)).toBe(true);
        expect(x.college.length).toBeGreaterThan(8);
      }
      expect(JSON.stringify(signings(now, school))).toBe(JSON.stringify(list));
      // The players going furthest are the best ones.
      const levels = ['Division I', 'Division II', 'Division III', 'Junior college'];
      for (let i = 1; i < list.length; i++) expect(levels.indexOf(list[i].level)).toBeGreaterThanOrEqual(levels.indexOf(list[i - 1].level));
    }
    console.log(`signings: ${(signed / schoolYears).toFixed(2)} a school a year, Division I ${(top / schoolYears).toFixed(2)}`);
    expect(signed / schoolYears).toBeGreaterThan(0.8);
    expect(signed / schoolYears).toBeLessThan(6);
    expect(top / schoolYears).toBeLessThan(0.6);
    expect(top).toBeGreaterThan(0);
  });

  it('spring practice lifts the ratings it works on for returning players, and only those', () => {
    let d = createDynasty('OH', 14, 3, { quarterMinutes: 4 });
    d = { ...d, week: REGULAR_WEEKS + 1, history: [{ year: 1, champion: 0, runnerUp: 1, record: [4, 4, 0], place: 4 }] };
    const plain = nextSeason(d);
    for (const f of FOCUSES) {
      const worked = nextSeason(d, f.id);
      expect(worked.focus).toBe(f.id);
      const a = programOf(plain, 3);
      const b = programOf(worked, 3);
      for (const p of b) {
        const q = a.find((x) => x.id === p.id)!;
        for (const key of Object.keys(p.ratings) as (keyof typeof p.ratings)[]) {
          const lifted = p.year >= 2 && (f.keys as readonly string[]).includes(key);
          expect(p.ratings[key] - q.ratings[key]).toBe(lifted && q.ratings[key] < 99 ? 1 : 0);
        }
      }
      // Other schools are not touched by my choice.
      expect(JSON.stringify(teamFor(worked, 5))).toBe(JSON.stringify(teamFor(plain, 5)));
    }
    expect(nextSeason(d, 'nonsense' as never).focus).toBeUndefined();
    expect(loadDynasty(JSON.parse(JSON.stringify(nextSeason(d, 'speed'))))!.focus).toBe('speed');
  });

  it('a player who ends the year still called up comes back a point short, up to a limit, and it survives a save', () => {
    let d = createDynasty('OH', 14, 3, { quarterMinutes: 4 });
    const kid = programOf(d, 3).filter((p) => p.squad === 'jv' && p.year === 1 && !p.out && p.pos === 'WR')[0];
    d = setCallUp(d, kid.id, true);
    expect(programOf(d, 3).find((p) => p.id === kid.id)!.calledUp).toBe(true);
    d = { ...d, week: REGULAR_WEEKS + 1, history: [{ year: 1, champion: 0, runnerUp: 1, record: [4, 4, 0], place: 4 }] };
    const without = nextSeason({ ...d, callUps: [] });
    const withCall = nextSeason(d);
    expect(withCall.dev).toEqual({ [kid.id]: -1 });
    const a = programOf(without, 3).find((p) => p.id === kid.id)!;
    const b = programOf(withCall, 3).find((p) => p.id === kid.id)!;
    expect(overall(b)).toBe(overall(a) - 1);
    expect(b.ceiling).toBe(a.ceiling - 1);
    expect(loadDynasty(JSON.parse(JSON.stringify(withCall)))!.dev).toEqual({ [kid.id]: -1 });
    // Year after year it adds up, but only so far.
    let again = withCall;
    for (let y = 0; y < 3; y++) {
      again = { ...again, callUps: [kid.id], week: REGULAR_WEEKS + 1, history: [...again.history, { year: again.year, champion: 0, runnerUp: 1, record: [4, 4, 0], place: 4 }] };
      again = nextSeason(again);
    }
    expect(again.dev?.[kid.id] ?? 0).toBeGreaterThanOrEqual(-CALL_UP_COST_MAX);
    // A save with nonsense in it is cleaned.
    expect(loadDynasty({ ...JSON.parse(JSON.stringify(withCall)), dev: { [kid.id]: -50, nobody: -1, [`${kid.id}x`]: 'a' } })!.dev).toBeUndefined();
  });

  it('a full season leads to a banquet, a carousel that only calls a winner, and a camp report', { timeout: 300_000 }, () => {
    let calls = 0, winners = 0;
    for (const seed of [3, 4, 5]) {
      let d = season(createDynasty('GA', seed, 2, { quarterMinutes: 4 }));
      const honors = teamHonors(d);
      expect(honors.offense).not.toBeNull();
      expect(honors.defense).not.toBeNull();
      expect(honors.offense!.school).toBe(2);
      expect(honors.seniors).toBeGreaterThan(15);
      const h = d.history[0];
      const won = h.champion === 2 || h.record[0] > h.record[1];
      const offers = jobOffers(d);
      if (!won) expect(offers.length).toBe(0);
      else winners++;
      expect(offers.length).toBeLessThanOrEqual(2);
      for (const o of offers) {
        calls++;
        expect(o.school).not.toBe(2);
        expect(o.pitch).toContain(d.league.schools[o.school].name);
        const moved = takeJob(d, o.school);
        expect(moved.user).toBe(o.school);
        expect(career(moved)).toEqual(career(d));
        const next = nextSeason(moved, 'strength');
        expect(next.user).toBe(o.school);
        expect(next.year).toBe(2);
        // The title he won at the old school is still his.
        expect(career(season(next)).championships).toBeGreaterThanOrEqual(career(d).championships);
      }
      expect(() => takeJob(d, 2)).toThrow();
      const camp = campNews(d);
      expect(camp.some((n) => n.kind === 'walkon')).toBe(true);
      expect(camp.every((n) => n.week < 0)).toBe(true);
      d = nextSeason(d, 'passing');
      expect(d.focus).toBe('passing');
    }
    console.log(`carousel: ${winners} winning seasons of 3, ${calls} calls`);
  });
});
