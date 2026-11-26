import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOK, exhibitionTeams, type DefDecision, type OffDecision } from '@fnd/core';
import { gameHash, replayGame } from '@fnd/match-sim';
import { AWAY_MS, CALL_MS, LOBBY_TIMEOUT_MS, MemoryStore, createApi, type RoomView } from '@fnd/online';

/** Milestone 2b acceptance: online head-to-head with hidden calls, server-run plays, rejoin and tamper resistance. */

function world() {
  const store = new MemoryStore();
  let clock = 1_000_000;
  const api = createApi(store, () => clock);
  const call = async (body: Record<string, unknown>) => {
    const r = await api(body);
    return r.data as { ok: boolean; error?: { code: string; message: string }; room?: RoomView; token?: string; created?: boolean; coach?: { id: string; name: string } };
  };
  const enter = async (name: string, pin = '1234'): Promise<string> => (await call({ action: 'enter', name, pin })).token as string;
  return { store, api, call, enter, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

async function lobby(w = world(), hostTeam = 0) {
  const host = await w.enter('COACH A');
  const guest = await w.enter('COACH B');
  const pin = (await w.call({ action: 'host', token: host, team: hostTeam })).room!.pin;
  await w.call({ action: 'join', token: guest, pin });
  return { w, host, guest, pin };
}

async function started(hostTeam = 0) {
  const l = await lobby(world(), hostTeam);
  const r = await l.w.call({ action: 'start', token: l.host, pin: l.pin });
  expect(r.ok).toBe(true);
  return l;
}

const DEF: DefDecision = { frontId: '43', callId: 'base' };
/** A simple legal call for whichever sideline the view belongs to. */
function callFor(v: RoomView): OffDecision | DefDecision {
  if (v.you !== v.need.offense) return DEF;
  if (v.need.phase === 'conversion') return { kind: 'patKick' };
  return { kind: 'play', playId: v.books[v.you][v.turn % 8] };
}

describe('coach sign-in', () => {
  it('creates a coach, signs him in again with the same PIN, and rejects a wrong PIN', async () => {
    const w = world();
    const first = await w.call({ action: 'enter', name: 'coach taylor', pin: '4321' });
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    expect(first.coach!.name).toBe('COACH TAYLOR');
    expect((await w.call({ action: 'enter', name: 'Coach Taylor', pin: '4321' })).created).toBe(false);
    const wrong = await w.call({ action: 'enter', name: 'COACH TAYLOR', pin: '0000' });
    expect(wrong.error!.code).toBe('wrong_pin');
  });
  it('rejects bad names and PINs, and locks after repeated wrong PINs', async () => {
    const w = world();
    expect((await w.call({ action: 'enter', name: '!!!', pin: '1234' })).error!.code).toBe('bad_name');
    expect((await w.call({ action: 'enter', name: 'OK', pin: '12' })).error!.code).toBe('bad_pin');
    await w.enter('LOCKME', '1111');
    for (let i = 0; i < 5; i++) await w.call({ action: 'enter', name: 'LOCKME', pin: '9999' });
    expect((await w.call({ action: 'enter', name: 'LOCKME', pin: '1111' })).error!.code).toBe('locked');
  });
  it('rejects an unknown session token', async () => {
    const w = world();
    expect((await w.call({ action: 'host', token: 'nope' })).error!.code).toBe('signed_out');
  });
});

describe('lobby', () => {
  it('gives the host a five-digit game PIN and seats the guest on the other team', async () => {
    const { w, host, guest, pin } = await lobby(world(), 1);
    expect(pin).toMatch(/^[0-9]{5}$/);
    const hv = (await w.call({ action: 'game', token: host, pin })).room!;
    const gv = (await w.call({ action: 'game', token: guest, pin })).room!;
    expect(hv.you).toBe(1);
    expect(gv.you).toBe(0);
    expect(hv.coaches).toEqual(['COACH B', 'COACH A']);
    expect(hv.state).toBe('lobby');
  });
  it('only the host can start, and only once a guest has joined', async () => {
    const w = world();
    const host = await w.enter('SOLO');
    const pin = (await w.call({ action: 'host', token: host, team: 0 })).room!.pin;
    expect((await w.call({ action: 'start', token: host, pin })).error!.code).toBe('no_opponent');
    const guest = await w.enter('GUEST');
    await w.call({ action: 'join', token: guest, pin });
    expect((await w.call({ action: 'start', token: guest, pin })).error!.code).toBe('not_host');
    expect((await w.call({ action: 'start', token: host, pin })).room!.state).toBe('playing');
  });
  it('refuses a third coach and an unknown PIN', async () => {
    const { w, pin } = await lobby();
    const third = await w.enter('THIRD');
    expect((await w.call({ action: 'join', token: third, pin })).error!.code).toBe('full');
    expect((await w.call({ action: 'join', token: third, pin: '00000' })).error!.code).toBe('no_room');
    expect((await w.call({ action: 'game', token: third, pin })).error!.code).toBe('not_member');
  });
  it('frees the seat when a guest stops checking in', async () => {
    const { w, host, pin } = await lobby();
    w.advance(LOBBY_TIMEOUT_MS + 1);
    expect((await w.call({ action: 'game', token: host, pin })).room!.coaches).toEqual(['COACH A', null]);
  });
  it('uses a custom playbook and rejects an invalid one', async () => {
    const w = world();
    const host = await w.enter('BOOK');
    const book = ['iso', 'zone', 'draw', 'blast', 'mesh', 'smash', 'stick', 'post'];
    expect((await w.call({ action: 'host', token: host, team: 0, book })).room!.books[0]).toEqual(book);
    expect((await w.call({ action: 'host', token: host, team: 0, book: book.slice(1) })).error!.code).toBe('bad_book');
  });
  it('the server picks the seed; a seed sent by the client is ignored', async () => {
    const w = world();
    const host = await w.enter('SEEDY');
    const a = (await w.call({ action: 'host', token: host, team: 0, seed: 7 })).room!;
    const b = (await w.call({ action: 'host', token: host, team: 0, seed: 7 })).room!;
    expect(a.seed).not.toBe(7);
    expect(a.seed).not.toBe(b.seed);
  });
});

describe('playing a game', () => {
  it('runs the opening kickoff on the server and asks both sidelines for a call', async () => {
    const { w, host, pin } = await started();
    const v = (await w.call({ action: 'game', token: host, pin })).room!;
    expect(v.state).toBe('playing');
    expect(v.logSize).toBe(1);
    expect(v.need.phase).toBe('scrimmage');
    expect(v.submitted).toEqual({ off: false, def: false });
    expect(v.deadlineInMs).toBe(CALL_MS);
  });

  it('keeps a call hidden from the other coach until the snap', async () => {
    const { w, host, guest, pin } = await started();
    const hv = (await w.call({ action: 'game', token: host, pin })).room!;
    const offToken = hv.you === hv.need.offense ? host : guest;
    const defToken = offToken === host ? guest : host;
    const after = (await w.call({ action: 'call', token: offToken, pin, turn: hv.turn, call: { kind: 'play', playId: 'verticals', timeout: true } })).room!;
    expect(after.mine).toEqual({ kind: 'play', playId: 'verticals', timeout: true });
    const seen = await w.call({ action: 'game', token: defToken, pin });
    expect(seen.room!.submitted).toEqual({ off: true, def: false });
    expect(seen.room!.mine).toBeNull();
    expect(JSON.stringify(seen)).not.toContain('"timeout":true');
    expect(JSON.stringify(seen)).not.toContain('pending');
    expect(seen.room!.logSize).toBe(1);
  });

  it('runs the play when both calls are in, and reveals both in the log', async () => {
    const { w, host, guest, pin } = await started();
    const hv = (await w.call({ action: 'game', token: host, pin })).room!;
    const gv = (await w.call({ action: 'game', token: guest, pin })).room!;
    await w.call({ action: 'call', token: host, pin, turn: hv.turn, call: callFor(hv) });
    const done = (await w.call({ action: 'call', token: guest, pin, turn: gv.turn, call: callFor(gv), have: 1 })).room!;
    expect(done.turn).toBe(hv.turn + 1);
    expect(done.log.length).toBeGreaterThanOrEqual(1);
    const entry = done.log[0] as { off: OffDecision; def: DefDecision };
    expect(entry.off.kind).toBe('play');
    expect(entry.def.frontId).toBe('43');
    expect(done.submitted).toEqual({ off: false, def: false });
  });

  it('plays a whole game; both browsers and the server agree on every play', async () => {
    const { w, host, guest, pin } = await started(1);
    let hv = (await w.call({ action: 'game', token: host, pin })).room!;
    let gv = (await w.call({ action: 'game', token: guest, pin })).room!;
    const logs: [unknown[], unknown[]] = [[...hv.log], [...gv.log]];
    for (let i = 0; i < 400 && hv.state === 'playing'; i++) {
      await w.call({ action: 'call', token: host, pin, turn: hv.turn, call: callFor(hv) });
      await w.call({ action: 'call', token: guest, pin, turn: gv.turn, call: callFor(gv) });
      w.advance(1000);
      hv = (await w.call({ action: 'game', token: host, pin, have: logs[0].length })).room!;
      gv = (await w.call({ action: 'game', token: guest, pin, have: logs[1].length })).room!;
      logs[0].push(...hv.log);
      logs[1].push(...gv.log);
    }
    expect(hv.state).toBe('done');
    expect(logs[0]).toEqual(logs[1]);
    expect(logs[0].length).toBe(hv.logSize);
    // Each browser rebuilds the game from the seed and the public log, and must land on the server's result.
    const local = replayGame(hv.seed, exhibitionTeams(hv.seed), logs[0] as never, { books: hv.books });
    expect(local.state.phase).toBe('final');
    expect(local.state.score).toEqual(hv.score);
    expect(gameHash(local)).toBe(hv.hash);
    expect(gv.hash).toBe(hv.hash);
  });

  it('when the play clock expires, the AI coach makes the missing call', async () => {
    const { w, host, guest, pin } = await started();
    const hv = (await w.call({ action: 'game', token: host, pin })).room!;
    await w.call({ action: 'call', token: host, pin, turn: hv.turn, call: callFor(hv) });
    // The guest keeps checking in but never calls a play.
    for (let t = 5000; t < CALL_MS; t += 5000) {
      w.advance(5000);
      await w.call({ action: 'game', token: guest, pin });
      expect((await w.call({ action: 'game', token: host, pin })).room!.turn).toBe(hv.turn);
    }
    w.advance(6000);
    const after = (await w.call({ action: 'game', token: guest, pin })).room!;
    expect(after.turn).toBe(hv.turn + 1);
  });

  it('a coach who disconnects is covered by the AI at once, and can rejoin and resume', async () => {
    const { w, host, guest, pin } = await started();
    let hv = (await w.call({ action: 'game', token: host, pin })).room!;
    // The guest goes silent.
    w.advance(AWAY_MS + 1000);
    hv = (await w.call({ action: 'game', token: host, pin })).room!;
    expect(hv.away[hv.you === 0 ? 1 : 0]).toBe(true);
    const turn = hv.turn;
    hv = (await w.call({ action: 'call', token: host, pin, turn, call: callFor(hv) })).room!;
    expect(hv.turn).toBe(turn + 1);
    // He comes back on another device: signs in again and gets the whole game.
    const again = await w.enter('COACH B');
    const back = (await w.call({ action: 'join', token: again, pin, have: 0 })).room!;
    expect(back.state).toBe('playing');
    expect(back.log.length).toBe(back.logSize);
    const mine = (await w.call({ action: 'call', token: again, pin, turn: back.turn, call: callFor(back) })).room!;
    expect(mine.mine).not.toBeNull();
    void guest;
  });

  it('sideline changes go through the server and into the shared log', async () => {
    const { w, host, guest, pin } = await started();
    const hv = (await w.call({ action: 'game', token: host, pin })).room!;
    const teams = exhibitionTeams(hv.seed);
    const order = [...teams[hv.you].depth.QB].reverse();
    const r = (await w.call({ action: 'manage', token: host, pin, change: { kind: 'depth', team: hv.you === 0 ? 1 : 0, group: 'QB', order }, have: hv.logSize })).room!;
    expect(r.log).toEqual([{ manage: { kind: 'depth', team: hv.you, group: 'QB', order } }]);
    expect(r.turn).toBe(hv.turn);
    const gv = (await w.call({ action: 'game', token: guest, pin, have: hv.logSize })).room!;
    expect(gv.log).toEqual(r.log);
    const plan = (await w.call({ action: 'plan', token: host, pin, plan: { passBias: 9, aggression: -4 } })).room!;
    expect(plan.plan).toEqual({ passBias: 2, aggression: 0 });
  });
});

describe('tamper resistance', () => {
  const setup = async () => {
    const s = await started();
    const hv = (await s.w.call({ action: 'game', token: s.host, pin: s.pin })).room!;
    const offToken = hv.you === hv.need.offense ? s.host : s.guest;
    const defToken = offToken === s.host ? s.guest : s.host;
    return { ...s, hv, offToken, defToken };
  };
  it('a coach cannot call a play that is not in his book', async () => {
    const { w, pin, hv, offToken } = await setup();
    expect(DEFAULT_BOOK).not.toContain('mesh');
    expect((await w.call({ action: 'call', token: offToken, pin, turn: hv.turn, call: { kind: 'play', playId: 'mesh' } })).error!.code).toBe('bad_call');
  });
  it('a coach cannot make the other sideline\'s call: the role comes from who he is', async () => {
    const { w, pin, hv, offToken, defToken } = await setup();
    // The defense sends an offensive call, the offense a defensive one. Neither is accepted as the other's.
    expect((await w.call({ action: 'call', token: defToken, pin, turn: hv.turn, call: { kind: 'kneel' } })).error!.code).toBe('bad_call');
    expect((await w.call({ action: 'call', token: offToken, pin, turn: hv.turn, call: DEF })).error!.code).toBe('bad_call');
    const v = (await w.call({ action: 'game', token: offToken, pin })).room!;
    expect(v.submitted).toEqual({ off: false, def: false });
  });
  it('a call for a turn that has passed is refused', async () => {
    const { w, pin, hv, offToken } = await setup();
    expect((await w.call({ action: 'call', token: offToken, pin, turn: hv.turn - 1, call: callFor(hv) })).error!.code).toBe('stale');
    expect((await w.call({ action: 'call', token: offToken, pin, turn: hv.turn + 5, call: callFor(hv) })).error!.code).toBe('stale');
  });
  it('a call cannot be changed once made', async () => {
    const { w, pin, hv, offToken } = await setup();
    await w.call({ action: 'call', token: offToken, pin, turn: hv.turn, call: { kind: 'play', playId: 'dive' } });
    const again = (await w.call({ action: 'call', token: offToken, pin, turn: hv.turn, call: { kind: 'play', playId: 'verticals' } })).room!;
    expect(again.mine).toEqual({ kind: 'play', playId: 'dive', timeout: false });
  });
  it('a client cannot report a score, a result or a log', async () => {
    const { w, pin, hv, offToken } = await setup();
    const r = await w.call({ action: 'call', token: offToken, pin, turn: hv.turn, call: { kind: 'play', playId: 'dive' }, score: [99, 0], log: [{ fake: true }], hash: 'deadbeef', state: 'done' });
    expect(r.room!.score).toEqual(hv.score);
    expect(r.room!.state).toBe('playing');
    expect(r.room!.logSize).toBe(hv.logSize);
    expect((await w.call({ action: 'finish', token: offToken, pin, score: [99, 0] })).error!.code).toBe('bad_action');
  });
  it('an outsider cannot read, call or change anything in the game', async () => {
    const { w, pin, hv } = await setup();
    const spy = await w.enter('SPY');
    for (const body of [
      { action: 'game', token: spy, pin },
      { action: 'call', token: spy, pin, turn: hv.turn, call: DEF },
      { action: 'manage', token: spy, pin, change: { kind: 'threshold', value: 0 } },
      { action: 'plan', token: spy, pin, plan: { passBias: 2, aggression: 2 } },
    ]) expect((await w.call(body)).error!.code).toBe('not_member');
  });
  it('a depth chart change with another team\'s players is refused', async () => {
    const { w, pin, hv, host } = await setup();
    const teams = exhibitionTeams(hv.seed);
    const theirs = teams[hv.you === 0 ? 1 : 0].depth.QB;
    expect((await w.call({ action: 'manage', token: host, pin, change: { kind: 'depth', group: 'QB', order: theirs } })).error!.code).toBe('bad_request');
  });
});
