import { describe, expect, it } from 'vitest';
import { exhibitionTeams, type PlayEvent } from '@fnd/core';
import { Game, gameHash, replayGame, simulateGame } from '@fnd/match-sim';

/** Penalties: false start and offside before the snap, holding and pass interference on the play. */

const games = Array.from({ length: 60 }, (_, i) => simulateGame(i + 1, exhibitionTeams(i + 1)));
/** Each flag with the event that followed it, when that was the same drive's next snap. */
const flags: { e: PlayEvent; next: PlayEvent | null; prev: PlayEvent | null }[] = [];
for (const g of games) {
  g.events.forEach((e, i) => {
    if (e.type !== 'penalty') return;
    const n = g.events[i + 1];
    const sameDrive = n && n.quarter === e.quarter && n.offense === e.offense && n.type !== 'kickoff' && n.quarter <= 4;
    flags.push({ e, next: sameDrive ? n : null, prev: g.events[i - 1] ?? null });
  });
}
const of = (kind: string) => flags.filter((f) => f.e.flags.foul === kind);

describe('penalties', () => {
  it('all four fouls are called, and a flag never changes the score', () => {
    for (const kind of ['falseStart', 'offside', 'holding', 'interference']) expect(of(kind).length, kind).toBeGreaterThan(15);
    for (const { e, prev } of flags) {
      expect(e.points).toEqual([0, 0]);
      if (prev) expect(e.scoreAfter).toEqual(prev.scoreAfter);
    }
  });
  it('false start: five yards back (or half the distance), same down', () => {
    for (const { e, next } of of('falseStart')) {
      // On his own one-yard line there is nowhere to go back to.
      if (e.yardLine > 1) expect(e.yards).toBeLessThan(0);
      expect(e.yards).toBeGreaterThanOrEqual(-5);
      if (e.yardLine > 10) expect(e.yards).toBe(-5);
      else expect(-e.yards).toBeLessThanOrEqual(Math.max(1, Math.trunc(e.yardLine / 2)));
      if (!next) continue;
      expect(next.down).toBe(e.down);
      expect(next.yardLine).toBe(e.yardLine + e.yards);
      expect(next.distance).toBe(e.distance - e.yards);
    }
  });
  it('offside: five yards forward; a first down only if that covers the distance', () => {
    for (const { e, next } of of('offside')) {
      if (e.yardLine < 99) expect(e.yards).toBeGreaterThan(0);
      expect(e.yards).toBeLessThanOrEqual(5);
      expect(!!e.flags.firstDown).toBe(e.yards >= e.distance);
      if (!next) continue;
      expect(next.yardLine).toBe(e.yardLine + e.yards);
      if (e.flags.firstDown) expect(next.down).toBe(1);
      else {
        expect(next.down).toBe(e.down);
        expect(next.distance).toBe(e.distance - e.yards);
      }
    }
  });
  it('holding: the gain comes back, ten yards from the line of scrimmage, same down', () => {
    for (const { e, next } of of('holding')) {
      if (e.yardLine > 1) expect(e.yards).toBeLessThan(0);
      expect(e.yards).toBeGreaterThanOrEqual(-10);
      expect(e.text).toMatch(/comes back/);
      if (!next) continue;
      expect(next.down).toBe(e.down);
      expect(next.yardLine).toBe(e.yardLine + e.yards);
    }
    // A touchdown called back puts no points on the board.
    const calledBack = of('holding').filter((f) => /touchdown comes back/.test(f.e.text));
    for (const { e, prev } of calledBack) if (prev) expect(e.scoreAfter).toEqual(prev.scoreAfter);
  });
  it('pass interference: fifteen yards (or half the distance) and always a first down', () => {
    for (const { e, next } of of('interference')) {
      expect(e.flags.firstDown).toBe(true);
      expect(e.yards).toBeGreaterThan(0);
      expect(e.yards).toBeLessThanOrEqual(15);
      if (e.yardLine <= 70) expect(e.yards).toBe(15);
      if (!next) continue;
      expect(next.down).toBe(1);
      expect(next.yardLine).toBe(e.yardLine + e.yards);
    }
  });
  it('the ball never leaves the field of play on a penalty', () => {
    for (const g of games) for (const e of g.events) {
      expect(e.yardLine).toBeGreaterThanOrEqual(1);
      expect(e.yardLine).toBeLessThanOrEqual(99);
    }
  });
  it('games with penalties replay to the same fingerprint, even with sideline changes logged mid-game', () => {
    const g = games[3];
    expect(gameHash(replayGame(g.seed, exhibitionTeams(g.seed), g.log))).toBe(gameHash(g));
    // A sideline change made while a play is live is logged mid-game; replaying that log must draw the same flags.
    const live = new Game(9, exhibitionTeams(9));
    const done = simulateGame(9, exhibitionTeams(9));
    let n = 0;
    for (const d of done.log) {
      if ('manage' in d || live.state.phase === 'final') continue;
      n++;
      try {
        live.begin(d.off, d.def);
      } catch {
        // After the change the two games part ways, so a recorded call can stop fitting. A refused call is not part of the game.
        (live.log as unknown[]).pop();
        break;
      }
      if (n === 10 || n === 40) live.manage({ kind: 'threshold', team: 0, value: 30 + n });
      while (!live.tick()) { /* step */ }
    }
    expect(live.events.some((e) => e.type === 'penalty')).toBe(true);
    const again = replayGame(9, exhibitionTeams(9), live.log);
    expect(again.events.length).toBe(live.events.length);
    expect(gameHash(again)).toBe(gameHash(live));
  });
  it('an illegal call is still refused on a snap where a flag would have been thrown', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = new Game(seed, exhibitionTeams(seed), { books: [['dive', 'power', 'toss', 'counter', 'slants', 'curls', 'flood', 'verticals'], ['dive', 'power', 'toss', 'counter', 'slants', 'curls', 'flood', 'verticals']] });
      g.begin(null, null);
      while (!g.tick()) { /* step */ }
      expect(() => g.begin({ kind: 'play', playId: 'mesh' }, { frontId: '43', callId: 'base' })).toThrow();
    }
  });
});
