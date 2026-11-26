import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, draftFromFront, draftFromPlay, exhibitionTeams, playById, playFromDraft, validateDefPlay, validateOffPlay, type DefDecision, type OffDecision } from '@fnd/core';
import { gameHash, replayGame } from '@fnd/match-sim';
import { AWAY_MS, CALL_MS, KICK_MS, LOBBY_TIMEOUT_MS, MemoryStore, createApi, type RoomView } from '@fnd/online';

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
  // The opening kickoff is the kicking coach's call; kick it deep so tests start from scrimmage.
  const kicker = r.room!.you === r.room!.need.offense ? l.host : l.guest;
  expect(r.room!.need.phase).toBe('kickoff');
  expect((await l.w.call({ action: 'call', token: kicker, pin: l.pin, turn: r.room!.turn, call: { kind: 'kickoff', style: 'deep' } })).ok).toBe(true);
  return l;
}

const DEF: DefDecision = { frontId: '43', callId: 'base' };
/** A simple legal call for whichever sideline the view belongs to. */
function callFor(v: RoomView): OffDecision | DefDecision {
  if (v.need.phase === 'kickoff') return { kind: 'kickoff', style: 'deep' };
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
  it('the kickoff is the kicking coach\'s call alone, and the AI kicks if he does not', async () => {
    const l = await lobby(world());
    const v = (await l.w.call({ action: 'start', token: l.host, pin: l.pin })).room!;
    expect(v.need.phase).toBe('kickoff');
    expect(v.logSize).toBe(0);
    const kicker = v.you === v.need.offense ? l.host : l.guest;
    const receiver = kicker === l.host ? l.guest : l.host;
    expect((await l.w.call({ action: 'call', token: receiver, pin: l.pin, turn: v.turn, call: { kind: 'kickoff', style: 'onside' } })).error!.code).toBe('bad_call');
    expect((await l.w.call({ action: 'call', token: kicker, pin: l.pin, turn: v.turn, call: { kind: 'kickoff', style: 'sideways' } })).error!.code).toBe('bad_call');
    expect((await l.w.call({ action: 'call', token: kicker, pin: l.pin, turn: v.turn, call: { kind: 'play', playId: 'dive' } })).error!.code).toBe('bad_call');
    const done = (await l.w.call({ action: 'call', token: kicker, pin: l.pin, turn: v.turn, call: { kind: 'kickoff', style: 'onside' } })).room!;
    expect(done.logSize).toBe(1);
    expect((done.log[0] as { off: OffDecision }).off).toEqual({ kind: 'kickoff', style: 'onside' });
    expect(done.need.phase).toBe('scrimmage');
    // A second room where nobody kicks: the clock runs out and the AI kicks it.
    const m = await lobby(world());
    const mv = (await m.w.call({ action: 'start', token: m.host, pin: m.pin })).room!;
    m.w.advance(KICK_MS + 1);
    const after = (await m.w.call({ action: 'game', token: m.host, pin: m.pin })).room!;
    expect(after.turn).toBe(mv.turn + 1);
    expect((after.log[0] as { off: OffDecision }).off.kind).toBe('kickoff');
  });

  it('after the kickoff the server asks both sidelines for a call', async () => {
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
    const local = replayGame(hv.seed, exhibitionTeams(hv.seed), logs[0] as never, { books: hv.books, plays: hv.designs.plays, defenses: hv.designs.defenses });
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

describe('coach profile and Hall of Fame', () => {
  /** Plays a whole game between two signed-in coaches and returns the final view. */
  async function playOut(w: ReturnType<typeof world>, hostToken: string, guestToken: string): Promise<RoomView> {
    const pin = (await w.call({ action: 'host', token: hostToken, team: 0 })).room!.pin;
    await w.call({ action: 'join', token: guestToken, pin });
    await w.call({ action: 'start', token: hostToken, pin });
    let hv = (await w.call({ action: 'game', token: hostToken, pin })).room!;
    let gv = (await w.call({ action: 'game', token: guestToken, pin })).room!;
    for (let i = 0; i < 400 && hv.state === 'playing'; i++) {
      await w.call({ action: 'call', token: hostToken, pin, turn: hv.turn, call: callFor(hv) });
      await w.call({ action: 'call', token: guestToken, pin, turn: gv.turn, call: callFor(gv) });
      w.advance(1000);
      hv = (await w.call({ action: 'game', token: hostToken, pin })).room!;
      gv = (await w.call({ action: 'game', token: guestToken, pin })).room!;
    }
    // Both browsers keep polling after the whistle; the result must still count once.
    for (let i = 0; i < 5; i++) {
      await w.call({ action: 'game', token: hostToken, pin });
      await w.call({ action: 'game', token: guestToken, pin });
    }
    return hv;
  }
  type Career = { name: string; games: number; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; championships: number; streak: number; bestStreak: number };
  const careerOf = async (w: ReturnType<typeof world>, token: string): Promise<Career> => ((await w.call({ action: 'profile', token })) as unknown as { career: Career }).career;

  it('a new coach has an empty record, and nobody is in the Hall of Fame yet', async () => {
    const w = world();
    const a = await w.enter('ROOKIE');
    expect(await careerOf(w, a)).toEqual({ name: 'ROOKIE', games: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, championships: 0, streak: 0, bestStreak: 0 });
    expect(((await w.call({ action: 'hall' })) as unknown as { hall: Career[] }).hall).toEqual([]);
  });

  it('a finished game is added to both coaches\' records exactly once, from the server\'s own score', async () => {
    const w = world();
    const a = await w.enter('ALPHA');
    const b = await w.enter('BRAVO');
    const final = await playOut(w, a, b);
    expect(final.state).toBe('done');
    const ca = await careerOf(w, a);
    const cb = await careerOf(w, b);
    expect(ca.games).toBe(1);
    expect(cb.games).toBe(1);
    expect([ca.pointsFor, ca.pointsAgainst]).toEqual(final.score);
    expect([cb.pointsFor, cb.pointsAgainst]).toEqual([final.score[1], final.score[0]]);
    expect(ca.wins + ca.losses + ca.ties).toBe(1);
    expect(ca.wins).toBe(cb.losses);
    expect(ca.ties).toBe(cb.ties);
    expect(ca.streak).toBe(ca.wins);
  });

  it('a client cannot write a record: there is no such action, and extra fields are ignored', async () => {
    const w = world();
    const a = await w.enter('FAKER');
    expect((await w.call({ action: 'recordResult', token: a, wins: 99 })).error!.code).toBe('bad_action');
    await w.call({ action: 'profile', token: a, wins: 99, championships: 5 });
    expect((await careerOf(w, a)).wins).toBe(0);
    expect((await w.call({ action: 'profile', token: 'nope' })).error!.code).toBe('signed_out');
  });

  it('the Hall of Fame lists the best records, most wins first, at most ten', async () => {
    const w = world();
    const tokens: string[] = [];
    for (let i = 0; i < 12; i++) tokens.push(await w.enter(`COACH ${i}`));
    for (let i = 0; i < 12; i += 2) await playOut(w, tokens[i], tokens[i + 1]);
    await playOut(w, tokens[0], tokens[2]);
    const hall = ((await w.call({ action: 'hall' })) as unknown as { hall: Career[] }).hall;
    expect(hall.length).toBe(10);
    for (let i = 1; i < hall.length; i++) expect(hall[i - 1].wins).toBeGreaterThanOrEqual(hall[i].wins);
    expect(hall.every((c) => c.games > 0)).toBe(true);
    expect(new Set(hall.map((c) => c.name)).size).toBe(10);
  });
});

describe('designed plays online', () => {
  const design = () => {
    const r = validateOffPlay(playFromDraft(draftFromPlay(playById('curls'), 'c_onlineplay1', 'Online Special')));
    if (!r.ok) throw new Error(r.problems.join());
    const d = validateDefPlay(draftFromFront(DEFENSE_FRONTS[0], DEFENSE_SCHEMES[0], 'c_onlinedef01', 'Online D'));
    if (!d.ok) throw new Error(d.problems.join());
    return { play: r.value, def: d.value };
  };
  it('a coach brings his designs, the server validates them, and both browsers receive them', async () => {
    const w = world();
    const { play, def } = design();
    const host = await w.enter('DESIGNER');
    const guest = await w.enter('PLAIN');
    const book = [...DEFAULT_BOOK.slice(0, 7), play.id];
    const made = await w.call({ action: 'host', token: host, team: 0, book, plays: [play], defenses: [def] });
    expect(made.room!.books[0]).toEqual(book);
    const pin = made.room!.pin;
    const gv = (await w.call({ action: 'join', token: guest, pin })).room!;
    expect(gv.designs.plays[0][0].name).toBe('Online Special');
    expect(gv.designs.defenses[0][0].id).toBe(def.id);
    expect(gv.designs.plays[1]).toEqual([]);
  });
  it('refuses an illegal design, a book that names a design the coach did not bring, and too many designs', async () => {
    const w = world();
    const { play } = design();
    const host = await w.enter('CHEAT');
    const illegal = { ...play, slots: play.slots!.map((s, i) => (i === 1 ? { ...s, at: [9, 0] } : s)) };
    expect((await w.call({ action: 'host', token: host, team: 0, plays: [illegal] })).error!.code).toBe('bad_design');
    expect((await w.call({ action: 'host', token: host, team: 0, book: [...DEFAULT_BOOK.slice(0, 7), play.id] })).error!.code).toBe('bad_book');
    const many = Array.from({ length: 13 }, (_, i) => ({ ...play, id: `c_many${String(i).padStart(6, '0')}` }));
    expect((await w.call({ action: 'host', token: host, team: 0, plays: many })).error!.code).toBe('bad_design');
  });
  it('a designed defense can only be called by the coach who brought it', async () => {
    const w = world();
    const { def } = design();
    const host = await w.enter('HASDEF');
    const guest = await w.enter('NODEF');
    const pin = (await w.call({ action: 'host', token: host, team: 0, defenses: [def] })).room!.pin;
    await w.call({ action: 'join', token: guest, pin });
    const sv = (await w.call({ action: 'start', token: host, pin })).room!;
    await w.call({ action: 'call', token: sv.you === sv.need.offense ? host : guest, pin, turn: sv.turn, call: { kind: 'kickoff', style: 'deep' } });
    const hv = (await w.call({ action: 'game', token: host, pin })).room!;
    const call = { frontId: '@custom', callId: def.id };
    if (hv.you === hv.need.offense) {
      expect((await w.call({ action: 'call', token: guest, pin, turn: hv.turn, call })).error!.code).toBe('bad_call');
    } else {
      const r = (await w.call({ action: 'call', token: host, pin, turn: hv.turn, call })).room!;
      expect(r.mine).toEqual({ ...call, timeout: false });
    }
  });
});

describe('voice chat mailbox', () => {
  const sig = (n: number) => ({ data: { candidate: { n } } });
  it('passes connection messages between the two coaches once both are in voice, and nothing else', async () => {
    const { w, host, guest, pin } = await started();
    const hv = (await w.call({ action: 'game', token: host, pin })).room!;
    // Alone in voice: nobody to talk to, and messages are not queued for an absent coach.
    let a = (await w.call({ action: 'voice', token: host, pin, on: true, send: [sig(1)] })) as unknown as { peers: string[]; signals: { from: string; data: unknown }[] };
    expect(a.peers).toEqual([]);
    let b = (await w.call({ action: 'voice', token: guest, pin, on: true, send: [] })) as unknown as typeof a;
    expect(b.peers).toEqual([String(hv.you)]);
    expect(b.signals).toEqual([]);
    a = (await w.call({ action: 'voice', token: host, pin, on: true, send: [sig(2), sig(3)] })) as unknown as typeof a;
    expect(a.peers).toEqual([String(hv.you === 0 ? 1 : 0)]);
    b = (await w.call({ action: 'voice', token: guest, pin, on: true, send: [sig(9)] })) as unknown as typeof a;
    expect(b.signals).toEqual([{ from: String(hv.you), data: { candidate: { n: 2 } } }, { from: String(hv.you), data: { candidate: { n: 3 } } }]);
    // Each message is delivered once.
    b = (await w.call({ action: 'voice', token: guest, pin, on: true, send: [] })) as unknown as typeof a;
    expect(b.signals).toEqual([]);
    a = (await w.call({ action: 'voice', token: host, pin, on: true, send: [] })) as unknown as typeof a;
    expect(a.signals.map((x) => x.data)).toEqual([{ candidate: { n: 9 } }]);
    const view = (await w.call({ action: 'game', token: host, pin })).room!;
    expect(view.voice).toEqual([true, true]);
  });
  it('a coach who stops checking in or hangs up is no longer in voice', async () => {
    const { w, host, guest, pin } = await started();
    await w.call({ action: 'voice', token: host, pin, on: true, send: [] });
    await w.call({ action: 'voice', token: guest, pin, on: true, send: [] });
    w.advance(9000);
    let a = (await w.call({ action: 'voice', token: host, pin, on: true, send: [] })) as unknown as { peers: string[] };
    expect(a.peers).toEqual([]);
    await w.call({ action: 'voice', token: guest, pin, on: true, send: [] });
    await w.call({ action: 'voice', token: guest, pin, on: false });
    a = (await w.call({ action: 'voice', token: host, pin, on: true, send: [] })) as unknown as { peers: string[] };
    expect(a.peers).toEqual([]);
    expect((await w.call({ action: 'game', token: host, pin })).room!.voice.filter(Boolean).length).toBe(1);
  });
  it('refuses outsiders, oversized messages and floods', async () => {
    const { w, host, guest, pin } = await started();
    const spy = await w.enter('EAVESDROP');
    expect((await w.call({ action: 'voice', token: spy, pin, on: true, send: [] })).error!.code).toBe('not_member');
    await w.call({ action: 'voice', token: guest, pin, on: true, send: [] });
    const big = { data: { blob: 'x'.repeat(20000) } };
    const flood = Array.from({ length: 500 }, (_, i) => sig(i));
    await w.call({ action: 'voice', token: host, pin, on: true, send: [big, 'junk', null, ...flood] });
    const b = (await w.call({ action: 'voice', token: guest, pin, on: true, send: [] })) as unknown as { signals: { data: Record<string, unknown> }[] };
    expect(b.signals.length).toBeLessThanOrEqual(40);
    expect(b.signals.some((x) => 'blob' in x.data)).toBe(false);
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
    for (const playId of ['notAPlay', 'c_someoneelse']) {
      expect(DEFAULT_BOOK).not.toContain(playId);
      expect((await w.call({ action: 'call', token: offToken, pin, turn: hv.turn, call: { kind: 'play', playId } })).error!.code).toBe('bad_call');
    }
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
