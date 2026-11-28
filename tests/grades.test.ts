import { describe, expect, it } from 'vitest';
import { GRADES, GRADE_ATTRS, GROUPS, exhibitionTeams, gradeOf, gradeStep, overall, reportCard } from '@fnd/core';

describe('letter grades', () => {
  it('runs A+ to F- in fifteen steps and never goes backwards', () => {
    expect(GRADES).toHaveLength(15);
    expect(gradeOf(99)).toBe('A+');
    expect(gradeOf(80)).toBe('A+');
    expect(gradeOf(79)).toBe('A');
    expect(gradeOf(57)).toBe('C+');
    expect(gradeOf(0)).toBe('F-');
    let last = 0;
    const seen = new Set<string>();
    for (let r = 99; r >= 0; r--) {
      expect(gradeStep(r)).toBeGreaterThanOrEqual(last);
      last = gradeStep(r);
      seen.add(gradeOf(r));
    }
    expect(seen.size).toBe(15);
  });

  it('gives every position a short report card', () => {
    for (const g of GROUPS) {
      expect(GRADE_ATTRS[g].length).toBeGreaterThan(0);
      expect(GRADE_ATTRS[g].length).toBeLessThanOrEqual(4);
    }
    for (const p of exhibitionTeams(9)[0].roster) {
      const card = reportCard(p);
      expect(card.overall).toBe(gradeOf(overall(p)));
      for (const a of card.attrs) expect(a.grade).toBe(gradeOf(a.rating));
    }
  });
});

describe('kickers', () => {
  it('are graded on leg power, leg accuracy and speed, and accuracy is its own rating', async () => {
    const { kickAccuracy } = await import('@fnd/core');
    const { fieldGoalChance, patChance } = await import('../packages/match-sim/src/special');
    const k = exhibitionTeams(3)[0].roster.find((p) => p.pos === 'K')!;
    expect(reportCard(k).attrs.map((a) => a.label)).toEqual(['Leg power', 'Leg accuracy', 'Speed']);
    const wild = { ...k, ratings: { ...k.ratings, awareness: 20 } };
    const sure = { ...k, ratings: { ...k.ratings, awareness: 65 } };
    expect(kickAccuracy(sure)).toBeGreaterThan(kickAccuracy(wild));
    expect(fieldGoalChance(sure, 80)).toBeGreaterThan(fieldGoalChance(wild, 80));
    expect(patChance(sure)).toBeGreaterThan(patChance(wild));
    // The same leg reaches the same distance however straight it is.
    expect(fieldGoalChance(sure, 40)).toBe(fieldGoalChance(wild, 40));
    let power = 0, acc = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) for (const t of exhibitionTeams(seed)) { const p = t.roster.find((x) => x.pos === 'K')!; power += p.ratings.kicking; acc += kickAccuracy(p); n++; }
    expect(Math.abs(power / n - acc / n)).toBeLessThan(3);
  });
});
