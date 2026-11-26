import { Rng } from '@fnd/core';
import {
  AI_COACH, RoomError, createLeagueRoom, createRoom, joinLeagueRoom, joinRoom, leaveRoom, manageRoom, setPlan, startRoom, submitCall, takeResult, tickRoom, touch, viewRoom, voiceExchange,
  type Coach, type GameResult, type Room,
} from './room';
import {
  LEAGUE_CODE, claimSchool, createShared, editLeagueSchool, forceWeek, gameOf, nextSharedSeason, recordGame, roomKey, roomLeague, startSeason, stepLeague, viewLeague,
  type SharedLeague,
} from './shared';

/**
 * The online API: one endpoint, called with POST { action, ... }. Storage is behind the `Store` interface,
 * so the same code runs in the Supabase Edge Function, in tests and in the local mock server.
 */

export interface Store {
  /** Signs in with a name and PIN, creating the coach if the name is new. */
  signIn(name: string, pin: string): Promise<{ coach: Coach; created: boolean } | { error: 'wrong_pin' | 'locked' }>;
  addSession(tokenHash: string, coachId: string): Promise<void>;
  coachForSession(tokenHash: string): Promise<Coach | null>;
  /** Returns false if the PIN is already in use. */
  createRoom(room: Room): Promise<boolean>;
  /** Runs `fn` with exclusive access to the room and saves it afterwards. Rejects with no_room if it does not exist. */
  withRoom<T>(pin: string, fn: (room: Room) => T): Promise<T>;
  /** One open room per host; stale rooms are cleared at the same time. */
  dropRoomsOf(coachId: string, olderThan: number): Promise<void>;
  /** Adds a finished game to both coaches' career records. */
  recordResult(result: GameResult): Promise<void>;
  careerOf(coachId: string): Promise<Career | null>;
  /** The best records among all coaches: most wins first, then win rate, then point difference. */
  hallOfFame(limit: number): Promise<Career[]>;
  /** Returns false if the league code is already in use. */
  createLeague(league: SharedLeague): Promise<boolean>;
  /** Runs `fn` with exclusive access to the league and saves it afterwards. Rejects with no_league if it does not exist. */
  withLeague<T>(code: string, fn: (league: SharedLeague) => T): Promise<T>;
  /** Adds one dynasty championship to a coach's career record. */
  addChampionship(coachId: string): Promise<void>;
}

/** A coach's career record in online games. Championships arrive with dynasty seasons. */
export interface Career {
  name: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  championships: number;
  streak: number;
  bestStreak: number;
}

type Body = Record<string, unknown>;
export interface ApiReply {
  status: number;
  data: Record<string, unknown>;
}

const STALE_ROOM_MS = 6 * 60 * 60 * 1000;

function str(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== 'string') throw new RoomError('bad_request', `"${key}" is required.`);
  return v;
}

export function normalizeName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12).trim();
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const randomU32 = (): number => crypto.getRandomValues(new Uint32Array(1))[0] as number;

export function createApi(store: Store, now: () => number = Date.now): (body: unknown) => Promise<ApiReply> {
  const auth = async (body: Body): Promise<Coach> => {
    const coach = await store.coachForSession(await sha256(str(body, 'token')));
    if (!coach) throw new RoomError('signed_out', 'Sign in again.', 401);
    return coach;
  };
  const pinOf = (body: Body): string => {
    const pin = str(body, 'pin');
    if (!/^[0-9]{5}$/.test(pin)) throw new RoomError('no_room', 'A game PIN is five digits.', 404);
    return pin;
  };
  const have = (body: Body): number => (typeof body['have'] === 'number' ? body['have'] : 0);
  /** Runs a room action and, if it ended the game, writes the result to both coaches' records (once). */
  const inRoom = async <T>(pin: string, fn: (room: Room) => T): Promise<T> => {
    const { out, result } = await store.withRoom(pin, (room) => {
      const o = fn(room);
      return { out: o, result: takeResult(room) };
    });
    if (result) {
      // Career records are for games between two coaches; a league game against an AI school counts only in the league.
      if (!result.coaches.includes(AI_COACH.id)) await store.recordResult(result);
      if (result.league) {
        const lg = result.league;
        await store.withLeague(lg.code, (l) => recordGame(l, lg, result.score, now())).catch(() => false);
      }
    }
    return out;
  };
  const codeOf = (body: Body): string => {
    const code = str(body, 'code').toUpperCase();
    if (!LEAGUE_CODE.test(code)) throw new RoomError('no_league', 'A league code is five letters.', 404);
    return code;
  };
  const bringing = (body: Body) => ({ book: body['book'], plays: body['plays'], defenses: body['defenses'] });

  const actions: Record<string, (body: Body) => Promise<Record<string, unknown>>> = {
    async enter(body) {
      const name = normalizeName(str(body, 'name'));
      const pin = str(body, 'pin');
      if (!name) throw new RoomError('bad_name', 'A coach name is required.');
      if (!/^[0-9]{4}$/.test(pin)) throw new RoomError('bad_pin', 'Your PIN must be four digits.');
      const r = await store.signIn(name, pin);
      if ('error' in r) {
        if (r.error === 'locked') throw new RoomError('locked', 'Too many wrong PINs. Try again in 15 minutes.', 429);
        throw new RoomError('wrong_pin', 'That coach name is taken and the PIN does not match.', 401);
      }
      const token = randomHex(32);
      await store.addSession(await sha256(token), r.coach.id);
      return { token, created: r.created, coach: r.coach };
    },

    async host(body) {
      const me = await auth(body);
      const team = body['team'] === 1 ? 1 : 0;
      await store.dropRoomsOf(me.id, now() - STALE_ROOM_MS);
      for (let attempt = 0; attempt < 12; attempt++) {
        const pin = String(10000 + (randomU32() % 90000));
        // The server picks the seed. Neither coach can choose or predict it.
        const room = createRoom(pin, me, team, { book: body['book'], plays: body['plays'], defenses: body['defenses'], setup: body['setup'] }, Rng.stream(randomU32(), pin).u32(), now());
        if (await store.createRoom(room)) return { room: viewRoom(room, me.id, 0, now()) };
      }
      throw new RoomError('busy', 'Could not open a game. Try again.', 503);
    },

    async join(body) {
      const me = await auth(body);
      return inRoom(pinOf(body), (room) => {
        tickRoom(room, now());
        joinRoom(room, me, { book: body['book'], plays: body['plays'], defenses: body['defenses'] }, now());
        return { room: viewRoom(room, me.id, have(body), now()) };
      });
    },

    async leave(body) {
      const me = await auth(body);
      return inRoom(pinOf(body), (room) => {
        leaveRoom(room, me.id, now());
        return {};
      });
    },

    async start(body) {
      const me = await auth(body);
      return inRoom(pinOf(body), (room) => {
        tickRoom(room, now());
        startRoom(room, me.id, now());
        return { room: viewRoom(room, me.id, have(body), now()) };
      });
    },

    /** Polled by both coaches about once a second; doubles as the "still here" signal. */
    async game(body) {
      const me = await auth(body);
      return inRoom(pinOf(body), (room) => {
        touch(room, me.id, now());
        tickRoom(room, now());
        return { room: viewRoom(room, me.id, have(body), now()) };
      });
    },

    async call(body) {
      const me = await auth(body);
      const turn = body['turn'];
      if (typeof turn !== 'number') throw new RoomError('bad_request', '"turn" is required.');
      return inRoom(pinOf(body), (room) => {
        tickRoom(room, now());
        submitCall(room, me.id, turn, body['call'], now());
        return { room: viewRoom(room, me.id, have(body), now()) };
      });
    },

    async manage(body) {
      const me = await auth(body);
      return inRoom(pinOf(body), (room) => {
        manageRoom(room, me.id, body['change'], now());
        return { room: viewRoom(room, me.id, have(body), now()) };
      });
    },

    // ---- dynasty leagues shared by friends

    async leagueCreate(body) {
      const me = await auth(body);
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      for (let attempt = 0; attempt < 12; attempt++) {
        let code = '';
        for (let i = 0; i < 5; i++) code += letters[randomU32() % letters.length];
        const league = createShared(code, me, body['state'], randomU32(), body['setup'], now());
        if (typeof body['school'] === 'number') claimSchool(league, me, body['school'], now());
        if (await store.createLeague(league)) return { league: viewLeague(league, me.id) };
      }
      throw new RoomError('busy', 'Could not start a league. Try again.', 503);
    },

    /** Polled by every coach in the league. Each call also moves the league one small step along. */
    async league(body) {
      const me = await auth(body);
      const { view, champion } = await store.withLeague(codeOf(body), (l) => {
        const step = stepLeague(l, now());
        return { view: viewLeague(l, me.id), champion: step.champion };
      });
      if (champion) await store.addChampionship(champion.id);
      return { league: view };
    },

    async leagueClaim(body) {
      const me = await auth(body);
      return store.withLeague(codeOf(body), (l) => {
        claimSchool(l, me, body['school'], now());
        return { league: viewLeague(l, me.id) };
      });
    },

    /** Commissioner only: rename a school or change its colours. */
    async leagueEdit(body) {
      const me = await auth(body);
      return store.withLeague(codeOf(body), (l) => {
        editLeagueSchool(l, me.id, body['school'], body['identity'], now());
        return { league: viewLeague(l, me.id) };
      });
    },

    async leagueStart(body) {
      const me = await auth(body);
      return store.withLeague(codeOf(body), (l) => {
        startSeason(l, me.id, now());
        return { league: viewLeague(l, me.id) };
      });
    },

    /** Commissioner only: the AI plays this week's unfinished games so the league can move on. */
    async leagueForce(body) {
      const me = await auth(body);
      return store.withLeague(codeOf(body), (l) => {
        forceWeek(l, me.id, now());
        return { league: viewLeague(l, me.id) };
      });
    },

    async leagueNext(body) {
      const me = await auth(body);
      return store.withLeague(codeOf(body), (l) => {
        nextSharedSeason(l, me.id, now());
        return { league: viewLeague(l, me.id) };
      });
    },

    /**
     * Sit down to this week's game. Against an AI school it starts at once. Against another coach the first
     * to arrive waits in the room, and the game starts when the second sits down: both have to be there.
     */
    async leaguePlay(body) {
      const me = await auth(body);
      const code = codeOf(body);
      for (let attempt = 0; attempt < 3; attempt++) {
        const plan = await store.withLeague(code, (l) => {
          const g = gameOf(l, me.id);
          if (!g) throw new RoomError('bad_request', 'You have no game this week.');
          if (g.done) throw new RoomError('bad_request', 'Your game this week has been played.');
          const mine = l.coaches[g.home]?.id === me.id ? 0 : 1;
          return { g, team: mine as 0 | 1, vsAi: l.coaches[mine === 0 ? g.away : g.home] === null, pin: l.rooms[roomKey(g.home, g.away)] ?? null, info: roomLeague(l, g.home, g.away) };
        });
        if (plan.pin) {
          try {
            return await inRoom(plan.pin, (room) => {
              tickRoom(room, now());
              joinLeagueRoom(room, me, bringing(body), now());
              return { room: viewRoom(room, me.id, 0, now()) };
            });
          } catch (e) {
            // The room has gone (it was cleared as stale): forget it and open a fresh one.
            if (!(e instanceof RoomError) || e.code !== 'no_room') throw e;
            await store.withLeague(code, (l) => { if (l.rooms[roomKey(plan.g.home, plan.g.away)] === plan.pin) delete l.rooms[roomKey(plan.g.home, plan.g.away)]; });
            continue;
          }
        }
        const pin = String(10000 + (randomU32() % 90000));
        const room = createLeagueRoom(pin, me, plan.team, bringing(body), plan.info.seed, plan.info.league, plan.info.setup, plan.vsAi, now());
        if (!(await store.createRoom(room))) continue;
        // If the other coach opened a room in the same instant, his stands and this one is simply never used.
        const kept = await store.withLeague(code, (l) => (l.rooms[roomKey(plan.g.home, plan.g.away)] ??= pin));
        if (kept === pin) return { room: viewRoom(room, me.id, 0, now()) };
      }
      throw new RoomError('busy', 'Could not open the game. Try again.', 503);
    },

    /** The signed-in coach's career record. */
    async profile(body) {
      const me = await auth(body);
      return { career: await store.careerOf(me.id) };
    },

    /** The Hall of Fame: the ten best records among all coaches. Public; no sign-in needed. */
    async hall() {
      return { hall: await store.hallOfFame(10) };
    },

    /** Voice chat mailbox, polled by a coach who has voice on. No audio passes here. */
    async voice(body) {
      const me = await auth(body);
      return inRoom(pinOf(body), (room) => voiceExchange(room, me.id, body['on'] !== false, body['send'], now()));
    },

    async plan(body) {
      const me = await auth(body);
      return inRoom(pinOf(body), (room) => {
        setPlan(room, me.id, body['plan']);
        return { room: viewRoom(room, me.id, have(body), now()) };
      });
    },
  };

  return async (raw: unknown): Promise<ApiReply> => {
    try {
      const body = (raw && typeof raw === 'object' ? raw : {}) as Body;
      const action = Object.prototype.hasOwnProperty.call(actions, String(body['action'])) ? actions[String(body['action'])] : undefined;
      if (!action) throw new RoomError('bad_action', 'Unknown action.');
      return { status: 200, data: { ok: true, ...(await action(body)) } };
    } catch (e) {
      if (e instanceof RoomError) return { status: e.status, data: { ok: false, error: { code: e.code, message: e.message } } };
      console.error('fnd online error', e);
      return { status: 500, data: { ok: false, error: { code: 'server', message: 'Something went wrong on the server.' } } };
    }
  };
}
