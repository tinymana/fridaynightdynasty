import { describe, expect, it } from 'vitest';
import { FIELD_W, U, exhibitionTeams } from '@fnd/core';
import { TRAIL_BONUS, carrierTarget, contestDistance, matchCoverage, openness, qbRead, type FieldDefender } from '@fnd/football-ai';
import { speedOf } from '@fnd/match-sim';
import { averageYards, makeSim } from './helpers';

/** Milestone 2 acceptance: on-field player AI passes a scripted suite of at least 30 cases. */

const Y = FIELD_W >> 1;
const def = (x: number, y: number, o: Partial<FieldDefender> = {}): FieldDefender => ({ x: x * U, y: Y + y * U, engaged: false, out: false, ...o });
const at = (x: number, y: number) => ({ x: x * U, y: Y + y * U });
const rec = (idx: number, x: number, y: number, settled = false) => ({ idx, x: x * U, y: Y + y * U, settled });
const LOS = 30 * U;

describe('ball carrier', () => {
  const c = at(30, 0);
  it('1. runs straight upfield with nobody in front', () => expect(carrierTarget(c, [])).toEqual({ x: c.x + 6 * U, y: c.y }));
  it('2. cuts left away from a defender ahead on the right', () => expect(carrierTarget(c, [def(34, 2)]).y).toBeLessThan(c.y));
  it('3. cuts right away from a defender ahead on the left', () => expect(carrierTarget(c, [def(34, -2)]).y).toBeGreaterThan(c.y));
  it('4. ignores a defender chasing from behind', () => expect(carrierTarget(c, [def(27, 1)]).y).toBe(c.y));
  it('5. ignores a defender who has just missed a tackle', () => expect(carrierTarget(c, [def(34, 2, { out: true })]).y).toBe(c.y));
  it('6. worries less about a defender who is being blocked', () => {
    const free = c.y - carrierTarget(c, [def(34, 2)]).y;
    const blocked = c.y - carrierTarget(c, [def(34, 2, { engaged: true })]).y;
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(free);
  });
  it('7. stays in bounds when squeezed to the sideline', () => {
    const edge = { x: 30 * U, y: FIELD_W - U };
    const t = carrierTarget(edge, [{ x: 34 * U, y: FIELD_W - 4 * U, engaged: false, out: false }]);
    expect(t.y).toBeLessThanOrEqual(FIELD_W - U);
  });
  it('8. splits two defenders by moving away from the nearer one', () => expect(carrierTarget(c, [def(33, 1), def(36, -5)]).y).toBeLessThan(c.y));
});

describe('reading coverage', () => {
  it('9. openness is the distance to the nearest free defender', () => expect(openness(at(40, 0), [def(43, 4), def(50, 0)])).toBe(5 * U));
  it('10. a blocked defender does not count against a receiver', () => expect(openness(at(40, 0), [def(41, 0, { engaged: true }), def(46, 0)])).toBe(6 * U));
  it('11. a settled receiver shields a defender who is behind him', () => expect(contestDistance(2 * U, U, true)).toBe(2 * U + TRAIL_BONUS));
  it('12. a settled receiver gets no credit when the defender is underneath him', () => expect(contestDistance(2 * U, -U, true)).toBe(2 * U));
  it('13. a receiver running deep has a step on a defender who trails', () => expect(contestDistance(2 * U, -U, false)).toBe(2 * U + TRAIL_BONUS));
  it('14. a deep defender stays on top of a receiver running at him', () => expect(contestDistance(2 * U, 2 * U, false)).toBe(2 * U));
});

describe('quarterback', () => {
  const qb = at(25, 0);
  it('15. throws to the open receiver, not the covered one', () => {
    expect(qbRead(qb, [rec(3, 38, -10), rec(4, 38, 10)], [def(38.5, -10)], LOS, 0, false)).toBe(4);
  });
  it('16. holds the ball when nobody is open yet', () => {
    expect(qbRead(qb, [rec(3, 38, -10)], [def(38.5, -10)], LOS, 0, false)).toBe(-1);
  });
  it('17. prefers the deeper of two open receivers', () => {
    expect(qbRead(qb, [rec(3, 36, -10), rec(4, 44, 10)], [], LOS, 0, false)).toBe(4);
  });
  it('18. passes up a checkdown early in the read', () => {
    expect(qbRead(qb, [rec(5, 31, 8)], [def(45, 0)], LOS, 10, false)).toBe(-1);
  });
  it('19. takes the checkdown once the read runs long', () => {
    expect(qbRead(qb, [rec(5, 31, 8)], [def(45, 0)], LOS, 45, false)).toBe(5);
  });
  it('20. throws the ball away under pressure with everyone covered', () => {
    expect(qbRead(qb, [rec(3, 38, -10)], [def(38.2, -10)], LOS, 0, true)).toBe(-2);
  });
  it('21. under pressure, takes a receiver with a little room', () => {
    expect(qbRead(qb, [rec(3, 38, -10)], [def(39, -10)], LOS, 0, true)).toBe(3);
  });
  it('22. does not try a throw beyond his arm', () => {
    expect(qbRead(qb, [rec(3, 80, 0), rec(4, 36, 5)], [], LOS, 0, false, 45)).toBe(4);
  });
  it('23. gets less picky the longer he holds it', () => {
    const recs = [rec(3, 38, -10)];
    const defs = [def(39.5, -10)];
    expect(qbRead(qb, recs, defs, LOS, 0, false)).toBe(-1);
    expect(qbRead(qb, recs, defs, LOS, 60, false)).toBe(3);
  });
  it('24. sees a settled receiver as open when the defender is behind him', () => {
    const defs = [def(39.5, -10)];
    expect(qbRead(qb, [rec(3, 38, -10, false)], defs, LOS, 0, false)).toBe(-1);
    expect(qbRead(qb, [rec(3, 38, -10, true)], defs, LOS, 0, false)).toBe(3);
  });
});

describe('man coverage matchups', () => {
  const r = (idx: number, lateral: number, group: 'WR' | 'TE' | 'RB', x = 29.4) => ({ idx, x: x * U, y: Y + lateral * U, group });
  const d = (idx: number, lateral: number, role: 'CB' | 'NB' | 'S' | 'LB', x = 36) => ({ idx, x: x * U, y: Y + lateral * U, role });
  it('25. each cornerback takes the wide receiver on his own side', () => {
    const m = matchCoverage([r(1, -19, 'WR'), r(2, 19, 'WR')], [d(11, -19, 'CB'), d(12, 19, 'CB')]);
    expect(m.get(11)).toBe(1);
    expect(m.get(12)).toBe(2);
  });
  it('26. a linebacker takes the back and leaves receivers to the corners', () => {
    const m = matchCoverage([r(1, -19, 'WR'), r(2, 19, 'WR'), r(3, 0, 'RB', 24)], [d(11, -19, 'CB'), d(12, 19, 'CB'), d(13, 2, 'LB', 34)]);
    expect(m.get(13)).toBe(3);
  });
  it('27. a safety takes the tight end ahead of a linebacker', () => {
    const m = matchCoverage([r(4, 4.6, 'TE')], [d(13, 4, 'LB', 34), d(14, 6, 'S', 40)]);
    expect(m.get(14)).toBe(4);
    expect(m.has(13)).toBe(false);
  });
  it('28. the nickel back takes the slot receiver in a three-receiver set', () => {
    const m = matchCoverage([r(1, -19, 'WR'), r(2, 19, 'WR'), r(3, -11, 'WR')], [d(11, -19, 'CB'), d(12, 19, 'CB'), d(15, -11, 'NB')]);
    expect(m.get(15)).toBe(3);
    expect(m.get(11)).toBe(1);
  });
  it('29. with more coverage men than receivers, the spare is left free to read the play', () => {
    const m = matchCoverage([r(1, -19, 'WR')], [d(11, -19, 'CB'), d(13, 0, 'LB')]);
    expect(m.size).toBe(1);
  });
  it('30. with more receivers than coverage men, the backs are the ones left open', () => {
    const m = matchCoverage([r(1, -19, 'WR'), r(2, 19, 'WR'), r(3, 0, 'RB', 24)], [d(11, -19, 'CB'), d(12, 19, 'CB')]);
    expect([...m.values()].sort()).toEqual([1, 2]);
  });
});

describe('on the field', () => {
  const runTo = (sim: ReturnType<typeof makeSim>, tick: number): void => { while (!sim.done && sim.tick < tick) sim.step(); };
  it('31. cornerbacks line up across from the receiver they are covering', () => {
    const sim = makeSim('smash', 'nickel', 'base', 30, 1);
    const cbs = sim.players.filter((p) => p.side === 1 && p.mode === 'man' && (p.pos.startsWith('CB') || p.pos === 'NB'));
    expect(cbs.length).toBe(3);
    for (const cb of cbs) expect(cb.y).toBe(sim.players[cb.manIdx].y);
  });
  it('32. the offensive line picks up the defensive line on a run', () => {
    const sim = makeSim('dive', '43', 'base', 30, 1);
    runTo(sim, 30);
    expect(sim.players.filter((p) => p.side === 1 && p.pos.startsWith('D') && p.engaged >= 0).length).toBeGreaterThanOrEqual(3);
  });
  it('33. in pass protection, blockers only take on rushers', () => {
    const sim = makeSim('curls', '43', 'base', 30, 2);
    runTo(sim, 40);
    for (const p of sim.players) if (p.side === 1 && p.engaged >= 0) expect(p.mode).toBe('rush');
  });
  it('34. a blitz sends more rushers than the base call', () => {
    const rushers = (scheme: string): number => makeSim('curls', '43', scheme, 30, 1).players.filter((p) => p.side === 1 && p.mode === 'rush').length;
    expect(rushers('base')).toBe(4);
    expect(rushers('blitz')).toBe(6);
  });
  it('35. the lead blocker gets out in front of the runner on Iso', () => {
    let led = 0;
    for (let s = 1; s <= 30; s++) {
      const sim = makeSim('iso', '43', 'base', 30, s);
      runTo(sim, 55);
      const fb = sim.players.find((p) => p.pos === 'FB')!;
      const rb = sim.players.find((p) => p.pos === 'RB')!;
      if (fb.engaged >= 0 || fb.x > rb.x) led++;
    }
    expect(led).toBeGreaterThanOrEqual(24);
  });
  it('36. the quarterback keeps the ball on a sneak', () => {
    const sim = makeSim('sneak', '52', 'runStuff', 30, 3);
    runTo(sim, 2000);
    expect(sim.result!.rusher!.pos).toBe('QB');
  });
  it('37. guessing run holds a run to fewer yards than guessing pass', () => {
    expect(averageYards('dive', '43', 'runStuff', 150)).toBeLessThan(averageYards('dive', '43', 'coverZone', 150) - 2);
  });
  it('38. guessing pass holds a pass to fewer yards than guessing run', () => {
    expect(averageYards('flood', '43', 'coverZone', 150)).toBeLessThan(averageYards('flood', '43', 'runStuff', 150) - 2);
  });
  it('39. the heavy front stops inside runs better than the nickel', () => {
    expect(averageYards('dive', '52', 'base', 150)).toBeLessThan(averageYards('dive', 'nickel', 'base', 150));
  });
  it('40. a tired player is slower than a fresh one', () => {
    const p = exhibitionTeams(1)[0].roster[0];
    expect(speedOf(p, 0)).toBeLessThan(speedOf(p, 100));
    expect(speedOf(p, 50)).toBeLessThanOrEqual(speedOf(p, 100));
  });
});
