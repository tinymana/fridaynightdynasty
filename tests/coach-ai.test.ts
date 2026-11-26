import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, Rng, playById, type GamePlan, type OffDecision, type Situation } from '@fnd/core';
import { aiDefense, aiOffense, canKneelOut, choosePlay } from '@fnd/football-ai';
import { sit } from './helpers';

/** Milestone 2 acceptance: AI coach decisions are sensible in a scripted situation suite of at least 40 cases. */

const book = DEFAULT_BOOK.map(playById);
const NORMAL: GamePlan = { passBias: 0, aggression: 1 };
const SAFE: GamePlan = { passBias: 0, aggression: 0 };
const BOLD: GamePlan = { passBias: 0, aggression: 2 };

/** The decision kind, the same on every random draw (the test fails if the coach is inconsistent). */
function decide(s: Situation, plan = NORMAL): OffDecision['kind'] {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) kinds.add(aiOffense(s, book, new Rng(seed), plan).kind);
  expect([...kinds], JSON.stringify(s)).toHaveLength(1);
  return [...kinds][0] as OffDecision['kind'];
}
const fourth = (o: Partial<Situation>): Situation => sit({ down: 4, ...o });

describe('AI coach: fourth down', () => {
  const cases: [string, Situation, GamePlan, OffDecision['kind']][] = [
    ['4th and 8 at own 30: punt', fourth({ distance: 8, yardLine: 30 }), NORMAL, 'punt'],
    ['4th and 1 at own 20: punt', fourth({ distance: 1, yardLine: 20 }), NORMAL, 'punt'],
    ['4th and 1 at the opponent 40: go', fourth({ distance: 1, yardLine: 60 }), NORMAL, 'play'],
    ['4th and 2 at the opponent 44: go', fourth({ distance: 2, yardLine: 56 }), NORMAL, 'play'],
    ['4th and 3 at the opponent 44: punt', fourth({ distance: 3, yardLine: 56 }), NORMAL, 'punt'],
    ['4th and 5 at the opponent 20: field goal', fourth({ distance: 5, yardLine: 80 }), NORMAL, 'fieldGoal'],
    ['4th and 10, too far to kick and too close to punt: go', fourth({ distance: 10, yardLine: 68 }), NORMAL, 'play'],
    ['4th and goal at the 1: go', fourth({ distance: 1, yardLine: 99 }), NORMAL, 'play'],
    ['4th and goal at the 5: field goal', fourth({ distance: 5, yardLine: 95 }), NORMAL, 'fieldGoal'],
    ['conservative plan, 4th and 1 at midfield: punt', fourth({ distance: 1, yardLine: 50 }), SAFE, 'punt'],
    ['conservative plan, no-man\'s-land: punt', fourth({ distance: 10, yardLine: 68 }), SAFE, 'punt'],
    ['conservative plan, 4th and goal at the 1: field goal', fourth({ distance: 1, yardLine: 99 }), SAFE, 'fieldGoal'],
    ['aggressive plan, 4th and 3 at midfield: go', fourth({ distance: 3, yardLine: 50 }), BOLD, 'play'],
    ['aggressive plan, 4th and 2 in field goal range: go', fourth({ distance: 2, yardLine: 85 }), BOLD, 'play'],
    ['weak kicker, 42-yard attempt is out of range: go', fourth({ distance: 6, yardLine: 75, kicking: 30 }), NORMAL, 'play'],
    ['down 7 late, 4th and 12 at own 40: go', fourth({ distance: 12, yardLine: 40, quarter: 4, clock: 120, scoreDiff: -7 }), NORMAL, 'play'],
    ['down 2 late in field goal range: kick', fourth({ distance: 5, yardLine: 80, quarter: 4, clock: 120, scoreDiff: -2 }), NORMAL, 'fieldGoal'],
    ['down 10 late in field goal range: go, a field goal is not enough', fourth({ distance: 4, yardLine: 85, quarter: 4, clock: 240, scoreDiff: -10 }), NORMAL, 'play'],
    ['ten seconds before halftime in range: kick', fourth({ distance: 8, yardLine: 78, quarter: 2, clock: 10 }), NORMAL, 'fieldGoal'],
  ];
  for (const [name, s, plan, want] of cases) it(name, () => expect(decide(s, plan)).toBe(want));
});

describe('AI coach: kneel-downs', () => {
  const late = (o: Partial<Situation>): Situation => sit({ quarter: 4, scoreDiff: 3, yardLine: 50, ...o });
  it('leading with 1:00 left and no opponent timeouts: kneel', () => expect(decide(late({ clock: 60, oppTimeouts: 0 }))).toBe('kneel'));
  it('leading with 1:00 left but the opponent has three timeouts: keep playing', () => expect(decide(late({ clock: 60, oppTimeouts: 3 }))).toBe('play'));
  it('leading with 2:30 left: too early to kneel', () => expect(decide(late({ clock: 150, oppTimeouts: 0 }))).toBe('play'));
  it('trailing never kneels', () => expect(decide(late({ clock: 30, scoreDiff: -3, oppTimeouts: 0 }))).toBe('play'));
  it('leading on third down with 0:30 left: one kneel ends it', () => expect(decide(late({ clock: 30, down: 3, oppTimeouts: 0 }))).toBe('kneel'));
  it('never kneels on fourth down', () => expect(decide(late({ clock: 20, down: 4, distance: 9, yardLine: 30, oppTimeouts: 0 }))).not.toBe('kneel'));
  it('deep in its own half with ten seconds before halftime: kneel', () => expect(decide(sit({ quarter: 2, clock: 10, yardLine: 25, down: 2 }))).toBe('kneel'));
  it('the kneel-out arithmetic counts opponent timeouts', () => {
    expect(canKneelOut(late({ clock: 105, oppTimeouts: 0 }))).toBe(true);
    expect(canKneelOut(late({ clock: 106, oppTimeouts: 0 }))).toBe(false);
    expect(canKneelOut(late({ clock: 73, oppTimeouts: 1 }))).toBe(true);
    expect(canKneelOut(late({ clock: 74, oppTimeouts: 1 }))).toBe(false);
  });
});

describe('AI coach: tries after a touchdown', () => {
  const tryAt = (quarter: number, scoreDiff: number): Situation => sit({ phase: 'conversion', quarter, scoreDiff, yardLine: 97, distance: 3 });
  it('down 2 in the fourth quarter: go for two to tie', () => expect(decide(tryAt(4, -2))).toBe('play'));
  it('down 5 in the fourth quarter: go for two', () => expect(decide(tryAt(4, -5))).toBe('play'));
  it('up 1 in the fourth quarter: go for two to lead by a field goal', () => expect(decide(tryAt(4, 1))).toBe('play'));
  it('down 1 in the fourth quarter: kick to tie', () => expect(decide(tryAt(4, -1))).toBe('patKick'));
  it('up 7 in the second quarter: kick', () => expect(decide(tryAt(2, 7))).toBe('patKick'));
  it('down 2 in the first half: kick, it is too early to chase points', () => expect(decide(tryAt(2, -2))).toBe('patKick'));
});

describe('AI coach: timeouts', () => {
  const timeoutOf = (s: Situation): boolean => {
    const d = aiOffense(s, book, new Rng(1), NORMAL);
    return d.kind === 'play' || d.kind === 'punt' || d.kind === 'fieldGoal' ? !!d.timeout : false;
  };
  it('trailing late with the clock running: offense stops the clock', () => expect(timeoutOf(sit({ quarter: 4, clock: 90, scoreDiff: -4, clockRunning: true }))).toBe(true));
  it('leading late: offense lets the clock run', () => expect(timeoutOf(sit({ quarter: 4, clock: 400, scoreDiff: 4, clockRunning: true }))).toBe(false));
  it('no timeouts left: none called', () => expect(timeoutOf(sit({ quarter: 4, clock: 90, scoreDiff: -4, clockRunning: true, timeouts: 0 }))).toBe(false));
  it('trailing late on defense with the clock running: defense stops the clock', () => {
    const d = aiDefense(sit({ quarter: 4, clock: 120, scoreDiff: -3, clockRunning: true }), DEFENSE_FRONTS, DEFENSE_SCHEMES, new Rng(1));
    expect(d.timeout).toBe(true);
  });
  it('clock already stopped: no timeout wasted', () => expect(timeoutOf(sit({ quarter: 4, clock: 90, scoreDiff: -4, clockRunning: false }))).toBe(false));
});

describe('AI coach: play selection', () => {
  const sample = (s: Situation, plan = NORMAL) => {
    const picks = Array.from({ length: 600 }, (_, i) => choosePlay(s, book, new Rng(i + 1), plan));
    const share = (f: (p: (typeof picks)[number]) => boolean, of = picks): number => of.filter(f).length / Math.max(1, of.length);
    return { picks, share };
  };
  it('3rd and 15: throws, and throws downfield', () => {
    const { picks, share } = sample(sit({ down: 3, distance: 15 }));
    expect(share((p) => p.kind === 'pass')).toBeGreaterThan(0.75);
    const passes = picks.filter((p) => p.kind === 'pass');
    expect(share((p) => p.tags.includes('deep') || p.tags.includes('mid'), passes)).toBeGreaterThan(0.7);
  });
  it('3rd and 1: runs, and runs with power', () => {
    const { picks, share } = sample(sit({ down: 3, distance: 1 }));
    expect(share((p) => p.kind === 'run')).toBeGreaterThan(0.65);
    const runs = picks.filter((p) => p.kind === 'run');
    expect(share((p) => p.tags.includes('power'), runs)).toBeGreaterThan(0.6);
  });
  it('protecting a lead late: mostly runs', () => {
    const { share } = sample(sit({ quarter: 4, clock: 200, scoreDiff: 6, down: 2, distance: 8 }));
    expect(share((p) => p.kind === 'run')).toBeGreaterThan(0.6);
  });
  it('chasing the game late: mostly passes', () => {
    const { share } = sample(sit({ quarter: 4, clock: 200, scoreDiff: -6, down: 1, distance: 10 }));
    expect(share((p) => p.kind === 'pass')).toBeGreaterThan(0.6);
  });
  it('the game plan shifts the run-pass balance', () => {
    const s = sit({ down: 1, distance: 10 });
    const runHeavy = sample(s, { passBias: -2, aggression: 1 }).share((p) => p.kind === 'pass');
    const passHeavy = sample(s, { passBias: 2, aggression: 1 }).share((p) => p.kind === 'pass');
    expect(passHeavy - runHeavy).toBeGreaterThan(0.2);
  });
  it('inside the 15: stops calling deep shots there is no room for', () => {
    const { picks, share } = sample(sit({ down: 2, distance: 7, yardLine: 90 }));
    const passes = picks.filter((p) => p.kind === 'pass');
    expect(share((p) => p.tags.includes('deep'), passes)).toBeLessThan(0.1);
  });
});

describe('AI coach: defense', () => {
  const sample = (s: Situation) => {
    const picks = Array.from({ length: 600 }, (_, i) => aiDefense(s, DEFENSE_FRONTS, DEFENSE_SCHEMES, new Rng(i + 1)));
    return (f: (d: (typeof picks)[number]) => boolean): number => picks.filter(f).length / picks.length;
  };
  it('3rd and 12: plays the pass, mostly from nickel', () => {
    const share = sample(sit({ down: 3, distance: 12 }));
    expect(share((d) => d.callId === 'coverZone' || d.callId === 'blitz')).toBeGreaterThan(0.7);
    expect(share((d) => d.frontId === 'nickel')).toBeGreaterThan(0.55);
    expect(share((d) => d.callId === 'runStuff')).toBe(0);
  });
  it('3rd and 1: plays the run, mostly from the 5-2', () => {
    const share = sample(sit({ down: 3, distance: 1 }));
    expect(share((d) => d.callId === 'runStuff')).toBeGreaterThan(0.5);
    expect(share((d) => d.frontId === '52')).toBeGreaterThan(0.55);
    expect(share((d) => d.callId === 'coverZone')).toBe(0);
  });
  it('goal line: brings the heavy front', () => {
    const share = sample(sit({ down: 1, distance: 2, yardLine: 98 }));
    expect(share((d) => d.frontId === '52')).toBeGreaterThan(0.55);
  });
  it('protecting a lead in the last two minutes: prevent defense, no blitz', () => {
    const share = sample(sit({ quarter: 4, clock: 60, scoreDiff: 5, down: 2, distance: 10 }));
    expect(share((d) => d.callId === 'coverZone')).toBeGreaterThan(0.7);
    expect(share((d) => d.frontId === 'nickel')).toBeGreaterThan(0.8);
    expect(share((d) => d.callId === 'blitz')).toBe(0);
  });
  it('1st and 10: mixes calls so it cannot be read', () => {
    const share = sample(sit({ down: 1, distance: 10 }));
    for (const id of ['base', 'runStuff', 'blitz']) expect(share((d) => d.callId === id)).toBeGreaterThan(0.05);
    expect(share((d) => d.callId === 'base')).toBeLessThan(0.7);
  });
});
