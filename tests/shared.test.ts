import { describe, expect, it } from 'vitest';
import type { DefDecision, OffDecision } from '@fnd/core';
import { REGULAR_WEEKS } from '@fnd/league';
import { gameHash, replayGame } from '@fnd/match-sim';
import { MemoryStore, createApi, leagueTeams, type Career, type LeagueView, type RoomView } from '@fnd/online';

/** Dynasty with friends: a shared league where coaches run rival schools. */

type Reply = { ok: boolean; error?: { code: string; message: string }; room?: RoomView; league?: LeagueView; token?: string; career?: Career };
function world() {
  const store = new MemoryStore();
  let clock = 1_000_000;
  const api = createApi(store, () => clock);
  const call = async (body: Record<string, unknown>): Promise<Reply> => (await api(body)).data as Reply;
  const enter = async (name: string): Promise<string> => (await call({ action: 'enter', name, pin: '1234' })).token as string;
  return { store, call, enter, advance: (ms: number) => { clock += ms; } };
}
type World = ReturnType<typeof world>;

function callFor(v: RoomView): OffDecision | DefDecision {
  if (v.need.phase === 'kickoff') return { kind: 'kickoff', style: 'deep' };
  if (v.you !== v.need.offense) return { frontId: '43', callId: 'base' };
  if (v.need.phase === 'conversion') return { kind: 'patKick' };
  return { kind: 'play', playId: v.books[v.you][v.turn % 8] };
}

/** Plays a room to the end with whichever coaches are given, returning every public log entry. */
async function playOut(w: World, pin: string, tokens: string[]): Promise<{ view: RoomView; log: unknown[] }> {
  const log: unknown[] = [];
  let view = (await w.call({ action: 'game', token: tokens[0], pin, have: 0 })).room!;
  log.push(...view.log);
  for (let i = 0; i < 600 && view.state !== 'done'; i++) {
    for (const t of tokens) {
      const v = (await w.call({ action: 'game', token: t, pin, have: log.length })).room!;
      if (v.state === 'playing') await w.call({ action: 'call', token: t, pin, turn: v.turn, call: callFor(v) });
    }
    w.advance(1000);
    view = (await w.call({ action: 'game', token: tokens[0], pin, have: log.length })).room!;
    log.push(...view.log);
  }
  return { view, log };
}

/** A league with three coaches: A (school 0) and B (school 7) meet in week 1; C (school 1) plays an AI school. */
async function league(quarterMinutes = 4) {
  const w = world();
  const [a, b, c] = [await w.enter('COACH A'), await w.enter('COACH B'), await w.enter('COACH C')];
  const made = (await w.call({ action: 'leagueCreate', token: a, state: 'TX', setup: { quarterMinutes }, school: 0 })).league!;
  const code = made.code;
  expect((await w.call({ action: 'leagueClaim', token: b, code, school: 7 })).league!.you).toBe(7);
  expect((await w.call({ action: 'leagueClaim', token: c, code, school: 1 })).league!.you).toBe(1);
  return { w, a, b, c, code };
}
const poll = async (w: World, token: string, code: string, times = 1): Promise<LeagueView> => {
  let v!: LeagueView;
  for (let i = 0; i < times; i++) v = (await w.call({ action: 'league', token, code })).league!;
  return v;
};

describe('gathering a league', () => {
  it('makes a league with a five-letter code, eight schools and a commissioner', async () => {
    const w = world();
    const a = await w.enter('COACH A');
    const v = (await w.call({ action: 'leagueCreate', token: a, state: 'OH', setup: { quarterMinutes: 6 } })).league!;
    expect(v.code).toMatch(/^[A-Z]{5}$/);
    expect(v.schools.length).toBe(8);
    expect(v.state).toBe('lobby');
    expect(v.isCommissioner).toBe(true);
    expect(v.you).toBe(-1);
    expect(v.quarterMinutes).toBe(6);
    expect((await w.call({ action: 'leagueCreate', token: a, state: 'ZZ' })).error!.code).toBe('bad_request');
    expect((await w.call({ action: 'league', token: a, code: 'QQQQQ' })).error!.code).toBe('no_league');
    expect((await w.call({ action: 'league', token: 'nope', code: v.code })).error!.code).toBe('signed_out');
  });
  it('one coach per school; a coach can move before the season starts but not after', async () => {
    const { w, a, b, c, code } = await league();
    expect((await w.call({ action: 'leagueClaim', token: b, code, school: 0 })).error!.code).toBe('taken');
    const moved = (await w.call({ action: 'leagueClaim', token: c, code, school: 3 })).league!;
    expect(moved.schools[1].coach).toBeNull();
    expect(moved.schools[3].coach).toBe('COACH C');
    expect((await w.call({ action: 'leagueStart', token: b, code })).error!.code).toBe('not_host');
    expect((await w.call({ action: 'leagueStart', token: a, code })).league!.state).toBe('season');
    expect((await w.call({ action: 'leagueClaim', token: c, code, school: 4 })).error!.code).toBe('in_progress');
  });
});

describe('a week with coaches in it', () => {
  it('a game between two coaches starts only when both sit down, and its result goes in the league and both careers', async () => {
    const { w, a, b, code } = await league();
    await w.call({ action: 'leagueStart', token: a, code });
    const first = (await w.call({ action: 'leaguePlay', token: a, code })).room!;
    expect(first.state).toBe('lobby');
    expect(first.league!.home).toBe(0);
    expect(first.league!.away).toBe(7);
    expect(first.you).toBe(0);
    // Polling does not start it, and the league shows the game as open.
    w.advance(5000);
    expect((await w.call({ action: 'game', token: a, pin: first.pin })).room!.state).toBe('lobby');
    expect((await poll(w, b, code)).games.find((g) => g.home === 0)!.open).toBe(true);
    const second = (await w.call({ action: 'leaguePlay', token: b, code })).room!;
    expect(second.pin).toBe(first.pin);
    expect(second.state).toBe('playing');
    expect(second.you).toBe(1);
    expect(second.setup.quarterMinutes).toBe(4);

    const { view, log } = await playOut(w, first.pin, [a, b]);
    expect(view.state).toBe('done');
    // Each browser rebuilds the two schools from the league details in the room and lands on the server's result.
    const local = replayGame(view.seed, leagueTeams(view.league!), log as never, { books: view.books, setup: view.setup });
    expect(gameHash(local)).toBe(view.hash);
    expect(local.teams[0].name).toBe((await poll(w, a, code)).schools[0].name);

    const lv = await poll(w, a, code);
    expect(lv.games.find((g) => g.home === 0)!.score).toEqual(view.score);
    expect(lv.games.find((g) => g.home === 0)!.open).toBe(false);
    const ca = (await w.call({ action: 'profile', token: a })).career!;
    const cb = (await w.call({ action: 'profile', token: b })).career!;
    expect(ca.games).toBe(1);
    expect(cb.games).toBe(1);
    expect(ca.wins + cb.wins + ca.ties).toBe(1);
    // The game cannot be played twice.
    expect((await w.call({ action: 'leaguePlay', token: a, code })).error!.code).toBe('bad_request');
  });

  it('a game against an AI school starts at once, counts in the league, and stays out of the Hall of Fame', async () => {
    const { w, a, c, code } = await league();
    await w.call({ action: 'leagueStart', token: a, code });
    const room = (await w.call({ action: 'leaguePlay', token: c, code })).room!;
    expect(room.state).toBe('playing');
    expect(room.coaches.filter(Boolean).length).toBe(2);
    expect(room.coaches).toContain('AI coach');
    const { view } = await playOut(w, room.pin, [c]);
    expect(view.state).toBe('done');
    const lv = await poll(w, c, code);
    const mine = lv.games.find((g) => g.home === 1 || g.away === 1)!;
    expect(mine.score).toEqual(view.score);
    expect((await w.call({ action: 'profile', token: c })).career!.games).toBe(0);
    expect(lv.record[0] + lv.record[1] + lv.record[2]).toBe(1);
  });

  it('the week waits for coaches, the AI games are played a step at a time, and then the week moves on', async () => {
    const { w, a, b, c, code } = await league();
    await w.call({ action: 'leagueStart', token: a, code });
    // Two games have no coach in them: polling plays them, one per check-in, and then waits.
    const afterOne = await poll(w, a, code);
    expect(afterOne.games.filter((g) => g.score).length).toBe(1);
    const waiting = await poll(w, a, code, 6);
    expect(waiting.week).toBe(0);
    expect(waiting.games.filter((g) => g.score).length).toBe(2);
    expect(waiting.games.filter((g) => !g.score).every((g) => g.human[0] || g.human[1])).toBe(true);

    const ab = (await w.call({ action: 'leaguePlay', token: a, code })).room!;
    await w.call({ action: 'leaguePlay', token: b, code });
    await playOut(w, ab.pin, [a, b]);
    expect((await poll(w, a, code, 3)).week).toBe(0);
    const cr = (await w.call({ action: 'leaguePlay', token: c, code })).room!;
    await playOut(w, cr.pin, [c]);
    const moved = await poll(w, a, code, 2);
    expect(moved.week).toBe(1);
    expect(moved.lastWeek.length).toBe(4);
    // The next week's AI games may already have begun.
    expect(moved.standings.reduce((n, r) => n + r.wins + r.losses + r.ties, 0)).toBeGreaterThanOrEqual(8);
  });

  it('only the commissioner can move a stuck week on; the AI then plays the missing games', async () => {
    const { w, a, b, code } = await league();
    await w.call({ action: 'leagueStart', token: a, code });
    expect((await w.call({ action: 'leagueForce', token: b, code })).error!.code).toBe('not_host');
    expect((await w.call({ action: 'leagueForce', token: a, code })).league!.forced).toBe(true);
    const v = await poll(w, b, code, 6);
    expect(v.week).toBe(1);
    expect(v.forced).toBe(false);
    // Forced games were not played by the coaches, so no career changes.
    expect((await w.call({ action: 'profile', token: a })).career!.games).toBe(0);
  });

  it('someone outside the league cannot sit down to a game, and nobody can post a score', async () => {
    const { w, a, code } = await league();
    await w.call({ action: 'leagueStart', token: a, code });
    const d = await w.enter('COACH D');
    expect((await w.call({ action: 'leaguePlay', token: d, code })).error!.code).toBe('bad_request');
    const before = await poll(w, a, code, 4);
    await w.call({ action: 'league', token: a, code, score: [99, 0], results: [{ week: 0, home: 0, away: 7, score: [99, 0] }], week: 5 });
    const after = await poll(w, a, code);
    expect(after.week).toBe(before.week);
    expect(after.games.find((g) => g.home === 0)!.score).toBeNull();
  });
});

describe('a whole shared season', () => {
  it('runs seven weeks and a title game, credits a coach who wins it exactly once, and starts year two', { timeout: 300_000 }, async () => {
    const { w, a, b, c, code } = await league();
    await w.call({ action: 'leagueStart', token: a, code });
    let v = await poll(w, a, code);
    for (let week = 0; week <= REGULAR_WEEKS; week++) {
      expect(v.week).toBe(week);
      await w.call({ action: 'leagueForce', token: a, code });
      v = await poll(w, a, code, 7);
    }
    expect(v.over).toBe(true);
    expect(v.history.length).toBe(1);
    expect(v.games).toEqual([]);
    const champ = v.history[0].champion;
    // More polling by everyone must not credit the title again.
    for (const t of [a, b, c]) await poll(w, t, code, 3);
    const titles = await Promise.all([a, b, c].map(async (t) => (await w.call({ action: 'profile', token: t })).career!.championships));
    const holder = v.schools[champ].coach;
    expect(titles.reduce((x, y) => x + y, 0)).toBe(holder ? 1 : 0);
    if (holder) expect(titles[['COACH A', 'COACH B', 'COACH C'].indexOf(holder)]).toBe(1);
    expect((await w.call({ action: 'leagueNext', token: b, code })).error!.code).toBe('not_host');
    const y2 = (await w.call({ action: 'leagueNext', token: a, code })).league!;
    expect(y2.year).toBe(2);
    expect(y2.week).toBe(0);
    expect(y2.over).toBe(false);
    expect(y2.history.length).toBe(1);
    expect(y2.schools.map((s) => s.coach)).toEqual(v.schools.map((s) => s.coach));
  });
});
