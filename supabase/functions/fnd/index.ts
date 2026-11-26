/**
 * Friday Night Dynasty online API: one Supabase Edge Function, called with
 * POST { action, ... }.
 *
 * Integrity rule: a browser never reports a score, a result or a play. It
 * submits its own sideline's call; this function holds the seed, runs the
 * same simulation the game runs, and stores what the simulation says.
 *
 * Source of truth for this file is the repository. It is bundled with the
 * game's own packages before deployment:
 *   npm run bundle:function
 */
// @ts-expect-error Deno resolves npm: specifiers at runtime.
import postgres from 'npm:postgres@3.4.5';
import { AI_COACH, RoomError, createApi, type Career, type Coach, type GameResult, type Room, type SharedLeague, type Store } from '../../../packages/online/src/index';

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response> | Response): void };

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') as string, { prepare: false, max: 2, idle_timeout: 20 });

const PIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Row = Record<string, any>;

const store: Store = {
  async signIn(name: string, pin: string) {
    let created = false;
    let rows: Row[] = await sql`
      select id, name, pin_hash = extensions.crypt(${pin}, pin_hash) as ok,
             coalesce(locked_until > now(), false) as locked
      from fnd.coaches where name = ${name}`;
    if (rows.length === 0) {
      rows = await sql`
        insert into fnd.coaches (name, pin_hash)
        values (${name}, extensions.crypt(${pin}, extensions.gen_salt('bf', 10)))
        on conflict (name) do nothing
        returning id, name, true as ok, false as locked`;
      // Lost a race with another sign-up for the same name: treat it as someone else's name.
      if (rows.length === 0) return { error: 'wrong_pin' as const };
      created = true;
    }
    const coach = rows[0] as Row;
    if (coach.locked) return { error: 'locked' as const };
    if (!coach.ok) {
      await sql`
        update fnd.coaches
        set failed_attempts = failed_attempts + 1,
            locked_until = case when failed_attempts + 1 >= ${PIN_ATTEMPTS} then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
        where id = ${coach.id}`;
      return { error: 'wrong_pin' as const };
    }
    if (!created) await sql`update fnd.coaches set failed_attempts = 0, locked_until = null where id = ${coach.id}`;
    return { coach: { id: coach.id as string, name: coach.name as string }, created };
  },

  async addSession(tokenHash: string, coachId: string) {
    await sql`insert into fnd.sessions (token_hash, coach_id) values (${tokenHash}, ${coachId})`;
    // Old sessions are dropped so the table does not grow without bound.
    await sql`delete from fnd.sessions where coach_id = ${coachId} and last_seen < now() - interval '30 days'`;
  },

  async coachForSession(tokenHash: string): Promise<Coach | null> {
    const rows: Row[] = await sql`
      update fnd.sessions s set last_seen = now()
      from fnd.coaches c
      where s.token_hash = ${tokenHash} and c.id = s.coach_id
      returning c.id, c.name`;
    return rows.length ? { id: rows[0].id as string, name: rows[0].name as string } : null;
  },

  async createRoom(room: Room) {
    const made: Row[] = await sql`
      insert into fnd.rooms (pin, host_id, state, data) values (${room.pin}, ${room.host.id}, ${room.state}, ${sql.json(room as never)})
      on conflict (pin) do nothing returning pin`;
    return made.length > 0;
  },

  async withRoom<T>(pin: string, fn: (room: Room) => T): Promise<T> {
    // One row lock per request: two coaches calling at the same moment are handled one after the other.
    return (await sql.begin(async (tx: any) => {
      const rows: Row[] = await tx`select data from fnd.rooms where pin = ${pin} for update`;
      if (rows.length === 0) throw new RoomError('no_room', 'No game has that PIN.', 404);
      const raw = rows[0].data;
      const room = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Room;
      const out = fn(room);
      await tx`
        update fnd.rooms set data = ${tx.json(room as never)}, state = ${room.state}, guest_id = ${room.guest && room.guest.id !== AI_COACH.id ? room.guest.id : null}, updated_at = now()
        where pin = ${pin}`;
      return out;
    })) as T;
  },

  async createLeague(league: SharedLeague) {
    const made: Row[] = await sql`
      insert into fnd.leagues (code, commissioner_id, data) values (${league.code}, ${league.commissioner.id}, ${sql.json(league as never)})
      on conflict (code) do nothing returning code`;
    return made.length > 0;
  },

  async withLeague<T>(code: string, fn: (league: SharedLeague) => T): Promise<T> {
    return (await sql.begin(async (tx: any) => {
      const rows: Row[] = await tx`select data from fnd.leagues where code = ${code} for update`;
      if (rows.length === 0) throw new RoomError('no_league', 'No league has that code.', 404);
      const raw = rows[0].data;
      const league = (typeof raw === 'string' ? JSON.parse(raw) : raw) as SharedLeague;
      const out = fn(league);
      await tx`update fnd.leagues set data = ${tx.json(league as never)}, updated_at = now() where code = ${code}`;
      return out;
    })) as T;
  },

  async addChampionship(coachId: string) {
    await sql`update fnd.coaches set championships = championships + 1 where id = ${coachId}`;
  },

  async dropRoomsOf(coachId: string, olderThan: number) {
    await sql`delete from fnd.rooms where host_id = ${coachId} or updated_at < to_timestamp(${olderThan / 1000})`;
  },

  async recordResult(r: GameResult) {
    for (const t of [0, 1] as const) {
      const mine = r.score[t];
      const theirs = r.score[t === 0 ? 1 : 0];
      const win = mine > theirs ? 1 : 0;
      const loss = mine < theirs ? 1 : 0;
      await sql`
        update fnd.coaches set
          games = games + 1, wins = wins + ${win}, losses = losses + ${loss}, ties = ties + ${1 - win - loss},
          points_for = points_for + ${mine}, points_against = points_against + ${theirs},
          streak = case when ${win} = 1 then streak + 1 else 0 end,
          best_streak = greatest(best_streak, case when ${win} = 1 then streak + 1 else 0 end)
        where id = ${r.coaches[t]}`;
    }
  },

  async careerOf(coachId: string) {
    const rows: Row[] = await sql`
      select name, games, wins, losses, ties, points_for, points_against, championships, streak, best_streak
      from fnd.coaches where id = ${coachId}`;
    return rows.length ? career(rows[0] as Row) : null;
  },

  async hallOfFame(limit: number) {
    const rows: Row[] = await sql`
      select name, games, wins, losses, ties, points_for, points_against, championships, streak, best_streak
      from fnd.coaches where games > 0
      order by wins desc, wins::float / games desc, points_for - points_against desc, name
      limit ${limit}`;
    return rows.map(career);
  },
};

function career(r: Row): Career {
  return {
    name: r.name as string, games: Number(r.games), wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties),
    pointsFor: Number(r.points_for), pointsAgainst: Number(r.points_against), championships: Number(r.championships),
    streak: Number(r.streak), bestStreak: Number(r.best_streak),
  };
}

const api = createApi(store);

function reply(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { ok: false, error: { code: 'method', message: 'Use POST.' } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { ok: false, error: { code: 'bad_request', message: 'Send JSON.' } });
  }
  const r = await api(body);
  return reply(r.status, r.data);
});
