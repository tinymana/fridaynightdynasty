import { describe, expect, it } from 'vitest';
import { exhibitionTeams, type Player } from '@fnd/core';
import { Game, moveFor, simulateGame, type CarrierMove } from '@fnd/match-sim';

/** Ball-carrier moves: named broken tackles and dives. They describe the play; they never change it. */

const man = (power: number, agility: number): Player => ({ ...exhibitionTeams(1)[0].roster[0], ratings: { ...exhibitionTeams(1)[0].roster[0].ratings, power, agility } });

describe('ball-carrier moves', () => {
  it('strong runners go through tacklers, quick ones go round them', () => {
    expect(moveFor(man(80, 55), true, 10)).toBe('truck');
    expect(moveFor(man(80, 55), false, 10)).toBe('stiffArm');
    expect(['juke', 'spin']).toContain(moveFor(man(50, 85), true, 10));
    expect(moveFor(man(50, 85), true, 10)).not.toBe(moveFor(man(50, 85), true, 11));
    // An all-round back does a bit of everything.
    const kinds = new Set([moveFor(man(70, 70), true, 2), moveFor(man(70, 70), true, 3), moveFor(man(70, 70), false, 2), moveFor(man(70, 70), false, 3)]);
    expect(kinds.size).toBe(4);
  });
  it('every broken tackle and long dive in a game is named, for runners and for receivers after the catch', () => {
    const kinds = new Map<string, number>();
    let byReceiver = 0, onReturns = 0, plays = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const done = simulateGame(seed, exhibitionTeams(seed));
      const g = new Game(seed, exhibitionTeams(seed));
      for (const d of done.log) {
        if ('manage' in d) continue;
        g.begin(d.off, d.def);
        const sim = g.live;
        while (!g.tick()) { /* step */ }
        const moves: CarrierMove[] = [...(sim?.moves ?? [])];
        if (sim) plays++;
        const e = g.lastEvent;
        for (const m of moves) {
          kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
          expect(m.carrier.id).not.toBe(m.defender?.id);
          if (e && e.receiver === m.carrier.id && e.flags.complete) byReceiver++;
        }
        if (g.lastReturn) {
          const r = g.lastReturn.make();
          while (!r.done) r.step();
          onReturns += r.moves.length;
        }
      }
    }
    for (const k of ['stiffArm', 'truck', 'juke', 'spin', 'dive']) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(5);
    const total = [...kinds.values()].reduce((a, b) => a + b, 0);
    // A few a game, not one every play.
    expect(total / plays).toBeGreaterThan(0.15);
    expect(total / plays).toBeLessThan(1.2);
    expect(byReceiver).toBeGreaterThan(10);
    expect(onReturns).toBeGreaterThan(10);
  });
});
