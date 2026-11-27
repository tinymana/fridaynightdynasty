import { describe, expect, it } from 'vitest';
import { GROUPS, ROSTER_SIZE, overall } from '@fnd/core';
import { MAX_CALL_UPS, REGULAR_WEEKS, createDynasty, incomingOf, jvTeamFor, loadDynasty, nextSeason, playWeek, programOf, setCallUp, simulateJv, teamFor, type Dynasty } from '@fnd/league';

const fresh = (): Dynasty => createDynasty('OH', 31, 2);
function season(d: Dynasty): Dynasty {
  let x = d;
  while (x.week <= REGULAR_WEEKS) x = playWeek(x);
  return x;
}

describe('the program: four classes', () => {
  it('builds the same varsity and junior varsity every time', () => {
    const d = fresh();
    expect(JSON.stringify(teamFor(d, 2))).toBe(JSON.stringify(teamFor(fresh(), 2)));
    expect(JSON.stringify(jvTeamFor(d, 5))).toBe(JSON.stringify(jvTeamFor(fresh(), 5)));
  });

  it('has four classes of 22 plus a few walk-ons, a full varsity, and a junior varsity that can field a team', () => {
    const d = fresh();
    for (let school = 0; school < 8; school++) {
      const all = programOf(d, school);
      const classes = all.filter((p) => !p.origin);
      const extras = all.filter((p) => p.origin);
      // A class is 22 as it enrols. In a first season nobody has left yet, bar the very rare career-ending injury at camp.
      expect(classes.length).toBeGreaterThanOrEqual(87);
      expect(classes.length).toBeLessThanOrEqual(88);
      for (const y of [1, 2, 3, 4]) expect(classes.filter((p) => p.year === y).length).toBeLessThanOrEqual(22);
      expect(extras.length).toBeGreaterThanOrEqual(1);
      expect(extras.length).toBeLessThanOrEqual(4);
      expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
      const v = teamFor(d, school);
      const jv = jvTeamFor(d, school);
      const need: Record<string, number> = { QB: 1, RB: 2, WR: 4, TE: 2, OL: 5, DL: 5, LB: 4, CB: 3, S: 2, K: 1, P: 1 };
      for (const g of GROUPS) {
        expect(v.depth[g].length).toBeLessThanOrEqual(ROSTER_SIZE[g]);
        expect(v.depth[g].length).toBeGreaterThanOrEqual(need[g]);
        expect(jv.depth[g].length).toBeGreaterThanOrEqual(need[g]);
      }
      expect(v.roster.length).toBeGreaterThanOrEqual(38);
      expect(new Set(v.roster.map((p) => p.number)).size).toBe(v.roster.length);
      expect(new Set(jv.roster.map((p) => p.number)).size).toBe(jv.roster.length);
      // Everyone fit dresses for one squad or the other; nobody who is out dresses at all.
      const fit = all.filter((p) => !p.out);
      expect(v.roster.length + jv.roster.length).toBe(fit.length);
      for (const p of all.filter((x) => x.out)) expect([...v.roster, ...jv.roster].some((x) => x.id === p.id)).toBe(false);
    }
  });

  it('the varsity is mostly juniors and seniors, and better than the junior varsity', () => {
    const d = fresh();
    let upper = 0;
    let total = 0;
    for (let school = 0; school < 8; school++) {
      const all = programOf(d, school);
      const v = all.filter((p) => p.squad === 'varsity');
      const jv = all.filter((p) => p.squad === 'jv');
      upper += v.filter((p) => p.year >= 3).length;
      total += v.length;
      const avg = (l: typeof all): number => l.reduce((s, p) => s + overall(p), 0) / l.length;
      expect(avg(v)).toBeGreaterThan(avg(jv) + 3);
    }
    expect(upper / total).toBeGreaterThan(0.8);
  });

  it('players age a class a year, improve, and graduate; a new freshman class arrives', () => {
    const d = season(fresh());
    const before = programOf(d, 2);
    const coming = incomingOf(d, 2);
    const after = programOf(nextSeason(d), 2);
    for (const p of before) {
      const next = after.find((x) => x.id === p.id);
      if (p.year === 4) expect(next).toBeUndefined();
      else {
        expect(next!.name).toBe(p.name);
        expect(next!.pos).toBe(p.pos);
        expect(next!.year).toBe(p.year + 1);
        // Prestige can move a point or two between seasons; a year of growth outweighs it.
        expect(overall(next!)).toBeGreaterThanOrEqual(overall(p) - 3);
        expect(next!.ceiling).toBeGreaterThanOrEqual(p.ceiling - 5);
      }
    }
    const frosh = after.filter((p) => p.year === 1);
    expect(frosh.map((p) => p.id).sort()).toEqual(coming.map((p) => p.id).sort());
    expect(frosh.every((p) => !before.some((b) => b.id === p.id))).toBe(true);
    // On average a returning player is better a year on.
    const kept = before.filter((p) => p.year < 4);
    const gain = kept.reduce((s, p) => s + overall(after.find((x) => x.id === p.id)!) - overall(p), 0) / kept.length;
    expect(gain).toBeGreaterThan(1);
  });
});

describe('call-ups', () => {
  it('puts a junior varsity player on the varsity and sends the weakest at his position down', () => {
    const d = fresh();
    const base = programOf(d, 2);
    const kid = base.filter((p) => p.squad === 'jv' && p.pos === 'RB').sort((a, b) => b.ceiling - a.ceiling)[0];
    const called = setCallUp(d, kid.id, true);
    const now = programOf(called, 2);
    const k = now.find((p) => p.id === kid.id)!;
    expect(k.squad).toBe('varsity');
    expect(k.calledUp).toBe(true);
    expect(now.filter((p) => p.squad === 'varsity' && p.pos === 'RB').length).toBe(ROSTER_SIZE.RB);
    const down = base.filter((p) => p.squad === 'varsity' && p.pos === 'RB').filter((p) => now.find((x) => x.id === p.id)!.squad === 'jv');
    expect(down.length).toBe(1);
    expect(teamFor(called, 2).roster.some((p) => p.id === kid.id)).toBe(true);
    expect(jvTeamFor(called, 2).roster.some((p) => p.id === kid.id)).toBe(false);
    // Other schools are untouched, and sending him down puts everything back.
    expect(JSON.stringify(teamFor(called, 3))).toBe(JSON.stringify(teamFor(d, 3)));
    expect(JSON.stringify(programOf(setCallUp(called, kid.id, false), 2))).toBe(JSON.stringify(base));
  });

  it('allows six at most and ignores anyone who is not a junior varsity player of this school', () => {
    let d = fresh();
    const jv = programOf(d, 2).filter((p) => p.squad === 'jv');
    for (const p of jv.slice(0, MAX_CALL_UPS)) d = setCallUp(d, p.id, true);
    expect(d.callUps!.length).toBe(MAX_CALL_UPS);
    expect(() => setCallUp(d, jv[MAX_CALL_UPS].id, true)).toThrow(/no more than/);
    const other = programOf(d, 4).find((p) => p.squad === 'jv')!;
    const varsity = programOf(fresh(), 2).find((p) => p.squad === 'varsity')!;
    expect(setCallUp(fresh(), other.id, true).callUps).toEqual([]);
    expect(setCallUp(fresh(), varsity.id, true).callUps).toEqual([]);
    expect(setCallUp(fresh(), 'nobody', true).callUps).toEqual([]);
  });

  it('survives a save, and is dropped once the player graduates or earns his place', () => {
    let d = fresh();
    const senior = programOf(d, 2).find((p) => p.squad === 'jv' && p.year === 4)!;
    const frosh = programOf(d, 2).filter((p) => p.squad === 'jv' && p.year === 1).sort((a, b) => overall(a) - overall(b))[0];
    d = setCallUp(setCallUp(d, senior.id, true), frosh.id, true);
    const back = loadDynasty(JSON.parse(JSON.stringify({ ...d, callUps: [...d.callUps!, 'junk', 42] })))!;
    expect(back.callUps).toEqual(d.callUps);
    const next = nextSeason(season(d));
    expect(next.callUps).not.toContain(senior.id);
    expect(next.callUps).toContain(frosh.id);
  });
});

describe('junior varsity games', () => {
  it('are played every regular-season week and start again each year', () => {
    let d = playWeek(fresh());
    expect(d.jv!.length).toBe(4);
    expect(d.jv!.every((g) => g.week === 0)).toBe(true);
    expect(d.jv![0]).toEqual(simulateJv(fresh(), 0, d.jv![0].home, d.jv![0].away));
    d = season(d);
    expect(d.jv!.length).toBe(REGULAR_WEEKS * 4);
    expect(loadDynasty(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(nextSeason(d).jv).toEqual([]);
  });
});
