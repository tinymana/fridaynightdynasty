import { describe, expect, it } from 'vitest';
import { GROUPS } from '@fnd/core';
import { OUT_FOR_GOOD, OUT_FOR_SEASON, REGULAR_WEEKS, createDynasty, incidentsOf, jvTeamFor, leagueNews, nextSeason, playWeek, programOf, teamFor, type Dynasty } from '@fnd/league';

/** Injuries, ineligibility, suspensions, players who leave, walk-ons, transfers and phenoms. Nothing is stored: it all comes from the league seed. */

const NEED: Record<string, number> = { QB: 1, RB: 2, WR: 4, TE: 2, OL: 5, DL: 5, LB: 4, CB: 3, S: 2, K: 1, P: 1 };
const at = (d: Dynasty, year: number, week: number): Dynasty => ({ ...d, year, week });

describe('incidents', () => {
  const d = createDynasty('OH', 77, 0, { quarterMinutes: 4 });
  const ids = d.league.schools.map((s) => s.id);

  it('are the same every time they are asked for', () => {
    expect(incidentsOf(77, ids[3], 5)).toEqual(incidentsOf(77, ids[3], 5));
    expect(JSON.stringify(leagueNews(at(d, 4, 5)))).toBe(JSON.stringify(leagueNews(at(createDynasty('OH', 77, 0), 4, 5))));
  });

  it('come at a believable rate: a few injuries a school a season, most of them short', () => {
    let injuries = 0, short = 0, season = 0, career = 0, grades = 0, suspensions = 0, moved = 0, schoolSeasons = 0;
    for (const id of ids) for (let y = 1; y <= 60; y++) {
      schoolSeasons++;
      for (const i of incidentsOf(77, id, y)) {
        if (i.kind === 'injury') {
          injuries++;
          if (i.back === OUT_FOR_GOOD) career++;
          else if (i.back === OUT_FOR_SEASON) season++;
          else if (i.back - i.week - 1 <= 2) short++;
        } else if (i.kind === 'grades') grades++;
        else if (i.kind === 'suspension') suspensions++;
        else moved++;
      }
    }
    const per = injuries / schoolSeasons;
    expect(per).toBeGreaterThan(3);
    expect(per).toBeLessThan(6);
    expect(short / injuries).toBeGreaterThan(0.6);
    expect(season / injuries).toBeGreaterThan(0.08);
    expect(season / injuries).toBeLessThan(0.2);
    // Career-ending injuries are very rare: across eight schools, fewer than one a season, but they do happen.
    expect(career).toBeGreaterThan(0);
    expect(career / schoolSeasons).toBeLessThan(0.06);
    expect(grades / schoolSeasons).toBeGreaterThan(0.3);
    expect(suspensions / schoolSeasons).toBeGreaterThan(0.1);
    expect(moved / schoolSeasons).toBeLessThan(0.2);
  });

  it('a hurt player does not dress until he is back, and someone moves up in his place', () => {
    let checked = 0;
    for (let school = 0; school < 8 && checked < 12; school++) {
      for (const inc of incidentsOf(77, ids[school], 3)) {
        if (inc.kind !== 'injury' || inc.back >= OUT_FOR_SEASON || inc.week < 0) continue;
        const before = programOf(at(d, 3, inc.week), school).find((p) => p.id === inc.id);
        if (!before || before.out || before.squad !== 'varsity') continue;
        const during = at(d, 3, inc.week + 1);
        const p = programOf(during, school).find((x) => x.id === inc.id)!;
        expect(p.out?.what).toBe(inc.what);
        expect(p.squad).toBe('varsity');
        const team = teamFor(during, school);
        expect(team.roster.some((x) => x.id === inc.id)).toBe(false);
        // The varsity is still full at his position: a junior varsity player dresses.
        expect(team.depth[before.pos].length).toBe(teamFor(at(d, 3, inc.week), school).depth[before.pos].length);
        if (inc.back <= REGULAR_WEEKS) {
          const after = programOf(at(d, 3, inc.back), school).find((x) => x.id === inc.id)!;
          expect(after.out === undefined || after.out.what !== inc.what || after.out.week !== inc.week).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('a career-ending injury or a move takes a player out of the program for good', () => {
    let found = 0;
    for (const id of ids) for (let y = 1; y <= 40 && found < 6; y++) {
      const school = ids.indexOf(id);
      for (const inc of incidentsOf(77, id, y)) {
        if (inc.back !== OUT_FOR_GOOD) continue;
        const was = programOf(at(d, y, Math.max(0, inc.week)), school).some((p) => p.id === inc.id);
        if (!was || inc.week < 0) continue;
        expect(programOf(at(d, y, inc.week + 1), school).some((p) => p.id === inc.id)).toBe(false);
        expect(programOf(at(d, y + 1, 0), school).some((p) => p.id === inc.id)).toBe(false);
        expect(leagueNews(at(d, y, inc.week + 1)).some((n) => n.id === inc.id && n.school === school)).toBe(true);
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('every squad can still field every position in every week of ten seasons', () => {
    for (let y = 1; y <= 10; y++) for (let w = 0; w <= REGULAR_WEEKS; w++) for (let school = 0; school < 8; school++) {
      const now = at(d, y, w);
      for (const t of [teamFor(now, school), jvTeamFor(now, school)]) {
        for (const g of GROUPS) expect(t.depth[g].length).toBeGreaterThanOrEqual(NEED[g]);
        expect(new Set(t.roster.map((p) => p.id)).size).toBe(t.roster.length);
      }
    }
  });
});

describe('who comes and goes', () => {
  const d = createDynasty('TX', 9, 2, { quarterMinutes: 4 });

  it('walk-ons turn up at fall camp, stay until their class graduates, and are mostly depth', () => {
    let walkOns = 0, onVarsity = 0;
    for (let school = 0; school < 8; school++) {
      const y1 = programOf(at(d, 1, 0), school).filter((p) => p.origin === 'walkon');
      expect(y1.length).toBeGreaterThanOrEqual(1);
      expect(y1.length).toBeLessThanOrEqual(3);
      for (const p of y1) {
        walkOns++;
        if (p.squad === 'varsity') onVarsity++;
        for (let y = 2; y <= 5; y++) {
          const later = programOf(at(d, y, 0), school).find((x) => x.id === p.id);
          if (p.year + (y - 1) <= 4) expect(later?.year).toBe(p.year + (y - 1));
          else expect(later).toBeUndefined();
        }
      }
    }
    expect(onVarsity / walkOns).toBeLessThan(0.5);
    const news = leagueNews(at(d, 1, 1));
    expect(news.filter((n) => n.kind === 'walkon').length).toBe(walkOns);
  });

  it('players who leave over the summer are not there in the autumn, and the news says so', () => {
    let left = 0;
    for (let y = 2; y <= 12; y++) for (const n of leagueNews(at(d, y, 0)).filter((x) => x.kind === 'left')) {
      left++;
      expect(programOf(at(d, y - 1, 0), n.school).some((p) => p.id === n.id)).toBe(true);
      expect(programOf(at(d, y, 0), n.school).some((p) => p.id === n.id)).toBe(false);
    }
    expect(left).toBeGreaterThan(10);
  });

  it('a phenom is rare, is flagged, and is good enough to matter as a freshman', () => {
    let phenoms = 0, classes = 0, lead = 0;
    for (let y = 1; y <= 40; y++) for (let school = 0; school < 8; school++) {
      classes++;
      const frosh = programOf(at(d, y, 0), school).filter((p) => p.year === 1 && !p.origin);
      const stars = frosh.filter((p) => p.phenom);
      expect(stars.length).toBeLessThanOrEqual(1);
      if (stars.length) {
        phenoms++;
        const best = Math.max(...frosh.filter((p) => !p.phenom && p.pos === stars[0].pos).map((p) => p.ceiling), 0);
        lead += stars[0].ceiling - best;
      }
    }
    expect(phenoms / classes).toBeGreaterThan(0.06);
    expect(phenoms / classes).toBeLessThan(0.2);
    expect(lead / phenoms).toBeGreaterThan(2);
  });
});

describe('a season with injuries', () => {
  it('plays through, keeps every name on its statistics, and carries on into the next year', { timeout: 240_000 }, () => {
    let d = createDynasty('GA', 31, 1, { quarterMinutes: 4 });
    for (let y = 0; y < 2; y++) {
      while (d.week <= REGULAR_WEEKS) d = playWeek(d);
      const news = leagueNews(d);
      expect(news.some((n) => n.kind === 'injury')).toBe(true);
      // Newest first, and nothing from a week that has not been played.
      for (let i = 1; i < news.length; i++) expect(news[i - 1].week).toBeGreaterThanOrEqual(news[i].week);
      const lines = Object.keys(d.stats!.season);
      expect(lines.length).toBeGreaterThan(100);
      expect(JSON.stringify(d.stats!.books)).not.toContain('Unknown');
      if (y === 0) d = nextSeason(d);
    }
    expect(d.year).toBe(2);
  });
});
