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
