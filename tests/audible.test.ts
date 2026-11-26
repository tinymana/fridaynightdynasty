import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOK, OFFENSE_PLAYS, RULES, Rng, exhibitionTeams, type OffDecision } from '@fnd/core';
import { AUDIBLE_RATE, aiAudible } from '@fnd/football-ai';
import { AutoCoach, Game, gameHash, replayGame, simulateGame } from '@fnd/match-sim';
import { LINE_MS, createRoom, joinRoom, startRoom, submitCall, tickRoom, viewRoom, type Room } from '@fnd/online';

const teams = exhibitionTeams(2026);
const play = (id: string) => OFFENSE_PLAYS.find((p) => p.id === id)!;
const DEF = { frontId: '43', callId: 'base' };

/** Advances a fresh game to its first scrimmage snap. */
function atScrimmage(seed: number): Game {
  const game = new Game(seed, teams);
  const coach = new AutoCoach(seed);
  while (game.state.phase !== 'scrimmage') {
    game.begin(coach.offense(game), coach.defense(game));
    while (!game.tick()) { /* step */ }
  }
  return game;
}

describe('audibles in the engine', () => {
  const runs = OFFENSE_PLAYS.filter((p) => p.formation === 'iform' && p.kind === 'run');
  const passes = OFFENSE_PLAYS.filter((p) => p.formation === 'iform' && p.kind === 'pass');

  it('runs the play checked to, not the play called, and marks the event', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40 && seen < 5; seed++) {
      const game = atScrimmage(seed);
      game.begin({ kind: 'play', playId: runs[0].id, audible: passes[0].id }, DEF);
      while (!game.tick()) { /* step */ }
      const e = game.lastEvent!;
      if (e.type === 'penalty') continue;
      expect(e.offCall).toBe(passes[0].id);
      expect(e.flags.audible).toBe(true);
      seen++;
    }
    expect(seen).toBe(5);
  });

  it('refuses an audible outside the book or to another formation', () => {
    const game = atScrimmage(3);
    const gun = OFFENSE_PLAYS.find((p) => p.formation === 'gun')!;
    expect(() => game.begin({ kind: 'play', playId: runs[0].id, audible: gun.id }, DEF)).toThrow(/formation/);
    const book = DEFAULT_BOOK.filter((id) => id !== runs[1].id);
    const short = new Game(3, teams, { books: [book, book] });
    const coach = new AutoCoach(3);
    while (short.state.phase !== 'scrimmage') {
      short.begin(coach.offense(short), coach.defense(short));
      while (!short.tick()) { /* step */ }
    }
    expect(() => short.begin({ kind: 'play', playId: runs[0].id, audible: runs[1].id }, DEF)).toThrow(/playbook/);
  });

  it('an audible to the play already called changes nothing', () => {
    const a = atScrimmage(9);
    const b = atScrimmage(9);
    a.begin({ kind: 'play', playId: runs[0].id }, DEF);
    b.begin({ kind: 'play', playId: runs[0].id, audible: runs[0].id }, DEF);
    while (!a.tick()) { /* step */ }
    while (!b.tick()) { /* step */ }
    expect(JSON.stringify(b.lastEvent)).toBe(JSON.stringify(a.lastEvent));
  });

  it('changing the play at the line draws more false starts', () => {
    let plain = 0;
    let checked = 0;
    const N = 1500;
    for (let seed = 1; seed <= N; seed++) {
      const a = atScrimmage(seed);
      a.begin({ kind: 'play', playId: runs[0].id }, DEF);
      if (a.lastEvent?.flags.foul === 'falseStart') plain++;
      const b = atScrimmage(seed);
      b.begin({ kind: 'play', playId: runs[0].id, audible: runs[1].id }, DEF);
      if (b.lastEvent?.flags.foul === 'falseStart') checked++;
    }
    expect(checked).toBeGreaterThan(plain);
    expect(checked / N).toBeGreaterThan(RULES.falseStartChance + RULES.audibleFalseStart * 0.4);
    expect(checked / N).toBeLessThan(RULES.falseStartChance + RULES.audibleFalseStart * 1.8);
  });

  it('a game with audibles replays to the same result from its log', () => {
    let checked = 0;
    for (let seed = 70; seed < 80; seed++) {
      const game = simulateGame(seed, teams);
      const used = game.log.filter((d) => !('manage' in d) && d.off?.kind === 'play' && d.off.audible).length;
      if (!used) continue;
      checked++;
      expect(gameHash(replayGame(seed, teams, game.log))).toBe(gameHash(game));
    }
    expect(checked).toBeGreaterThan(2);
  });
});

describe('the AI quarterback at the line', () => {
  const book = OFFENSE_PLAYS;
  const sit = { down: 1, distance: 10, yardLine: 40, quarter: 2, clock: 300, scoreDiff: 0 } as Parameters<typeof aiAudible>[0];

  it('checks out of a run into a loaded box, to a quick or short pass from the same formation', () => {
    const rng = Rng.stream(1, 't');
    const called = play(OFFENSE_PLAYS.find((p) => p.formation === 'iform' && p.kind === 'run')!.id);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const to = aiAudible(sit, called, '52', book, rng);
      if (!to) continue;
      n++;
      const p = play(to);
      expect(p.formation).toBe(called.formation);
      expect(p.kind).toBe('pass');
    }
    expect(n).toBeGreaterThan(400 * AUDIBLE_RATE * 0.6);
    expect(n).toBeLessThan(400 * AUDIBLE_RATE * 1.5);
  });

  it('leaves the call alone against an ordinary front, and on short yardage', () => {
    const rng = Rng.stream(2, 't');
    const called = OFFENSE_PLAYS.find((p) => p.formation === 'iform' && p.kind === 'run')!;
    for (let i = 0; i < 200; i++) {
      expect(aiAudible(sit, called, '43', book, rng)).toBeNull();
      expect(aiAudible({ ...sit, distance: 1 }, called, '52', book, rng)).toBeNull();
    }
  });

  it('checks a pass to a run against a light box, but not when it has to throw', () => {
    const rng = Rng.stream(3, 't');
    const called = OFFENSE_PLAYS.find((p) => p.formation === 'gun' && p.kind === 'pass')!;
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const to = aiAudible({ ...sit, distance: 4 }, called, 'nickel', book, rng);
      if (to) { n++; expect(play(to).kind).toBe('run'); }
      expect(aiAudible({ ...sit, distance: 12 }, called, 'nickel', book, rng)).toBeNull();
    }
    expect(n).toBeGreaterThan(300 * AUDIBLE_RATE * 0.5);
  });

  it('is used a few times a game, not on every snap', () => {
    let audibles = 0;
    let snaps = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const game = simulateGame(seed, teams);
      for (const e of game.events) {
        if (e.type !== 'run' && e.type !== 'pass') continue;
        snaps++;
        if (e.flags.audible) audibles++;
      }
    }
    const rate = audibles / snaps;
    expect(rate).toBeGreaterThan(0.005);
    expect(rate).toBeLessThan(0.08);
  });
});

describe('the line in an online game', () => {
  const host = { id: 'h', name: 'Host' };
  const guest = { id: 'g', name: 'Guest' };
  function room(): { room: Room; off: string; def: string; now: number } {
    let now = 1000;
    const r = createRoom('12345', host, 0, {}, 4242, now);
    joinRoom(r, guest, {}, now);
    startRoom(r, host.id, now);
    for (let i = 0; i < 6 && r.need.phase !== 'scrimmage'; i++) {
      now += 100;
      const kicker = viewRoom(r, host.id, 0, now).you === r.need.offense ? host.id : guest.id;
      const other = kicker === host.id ? guest.id : host.id;
      if (r.need.phase === 'kickoff') submitCall(r, kicker, r.turn, { kind: 'kickoff', style: 'deep' }, now);
      else { submitCall(r, kicker, r.turn, { kind: 'patKick' }, now); submitCall(r, other, r.turn, DEF, now); }
    }
    expect(r.need.phase).toBe('scrimmage');
    const off = viewRoom(r, host.id, 0, now).you === r.need.offense ? host.id : guest.id;
    return { room: r, off, def: off === host.id ? guest.id : host.id, now };
  }
  const iform = OFFENSE_PLAYS.filter((p) => p.formation === 'iform');

  it('a call without a look is snapped as soon as both calls are in', () => {
    const { room: r, off, def, now } = room();
    const turn = r.turn;
    submitCall(r, off, turn, { kind: 'play', playId: iform[0].id }, now);
    submitCall(r, def, turn, DEF, now);
    expect(r.turn).toBe(turn + 1);
  });

  it('shows the front to the offense only, then runs the audible', () => {
    const { room: r, off, def, now } = room();
    const turn = r.turn;
    submitCall(r, off, turn, { kind: 'play', playId: iform[0].id, look: true }, now);
    submitCall(r, def, turn, { frontId: '52', callId: 'blitz' }, now);
    expect(r.turn).toBe(turn);
    const mine = viewRoom(r, off, 0, now);
    const theirs = viewRoom(r, def, 0, now);
    expect(mine.line).toEqual({ front: '52', msLeft: LINE_MS });
    expect(theirs.line!.front).toBeNull();
    expect(JSON.stringify(mine)).not.toContain('blitz');
    expect(theirs.mine).toMatchObject({ frontId: '52', callId: 'blitz' });
    // The defense cannot change its mind once the offense is at the line.
    submitCall(r, def, turn, { frontId: 'nickel', callId: 'prevent' }, now + 500);
    expect(r.pending.def).toMatchObject({ frontId: '52', callId: 'blitz' });
    expect(() => submitCall(r, off, turn, { kind: 'audible', playId: OFFENSE_PLAYS.find((p) => p.formation === 'gun')!.id }, now + 600)).toThrow(/formation/);
    expect(() => submitCall(r, off, turn, { kind: 'audible', playId: 'nope' }, now + 600)).toThrow(/playbook/);
    submitCall(r, off, turn, { kind: 'audible', playId: iform[3].id }, now + 700);
    expect(r.turn).toBe(turn + 1);
    const logged = r.log[r.log.length - 1] as { off: OffDecision; def: unknown };
    expect(logged.off).toMatchObject({ kind: 'play', playId: iform[0].id, audible: iform[3].id });
    expect(logged.def).toMatchObject({ frontId: '52', callId: 'blitz' });
    expect(viewRoom(r, off, 0, now + 800).line).toBeNull();
  });

  it('snaps the call when asked, and by itself when the look runs out', () => {
    const a = room();
    submitCall(a.room, a.off, a.room.turn, { kind: 'play', playId: iform[0].id, look: true }, a.now);
    submitCall(a.room, a.def, a.room.turn, DEF, a.now);
    const turn = a.room.turn;
    submitCall(a.room, a.off, turn, { kind: 'snap' }, a.now + 300);
    expect(a.room.turn).toBe(turn + 1);
    expect((a.room.log[a.room.log.length - 1] as { off: OffDecision }).off).toEqual({ kind: 'play', playId: iform[0].id, timeout: false });

    const b = room();
    const t2 = b.room.turn;
    submitCall(b.room, b.off, t2, { kind: 'play', playId: iform[0].id, look: true }, b.now);
    submitCall(b.room, b.def, t2, DEF, b.now);
    tickRoom(b.room, b.now + LINE_MS - 1);
    expect(b.room.turn).toBe(t2);
    tickRoom(b.room, b.now + LINE_MS);
    expect(b.room.turn).toBe(t2 + 1);
  });
});
