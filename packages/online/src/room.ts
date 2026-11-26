import {
  DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, clamp, exhibitionTeams, validateBook,
  type DefDecision, type GamePlan, type ManageAction, type OffDecision,
} from '@fnd/core';
import { DEFAULT_PLAN } from '@fnd/football-ai';
import { AutoCoach, Game, gameHash, replayGame, type LoggedDecision } from '@fnd/match-sim';

/**
 * A head-to-head game room. Pure state transitions: no clock, no storage, no network.
 * The server owns the seed and runs every play; a coach can only submit his own sideline's call.
 */

/** How long a coach has to call a play once the previous one is resolved (includes time to watch it). */
export const CALL_MS = 45000;
/** A coach not heard from for this long is away: the AI calls his plays so the other coach is not kept waiting. */
export const AWAY_MS = 12000;
/** A guest who stops checking in to the lobby for this long has left. */
export const LOBBY_TIMEOUT_MS = 20000;

export interface Coach {
  id: string;
  name: string;
}

export interface Room {
  pin: string;
  state: 'lobby' | 'playing' | 'done';
  seed: number;
  host: Coach;
  guest: Coach | null;
  /** The team (0 home, 1 visitors) the host coaches. The guest takes the other. */
  hostTeam: 0 | 1;
  books: [string[], string[]];
  plans: [GamePlan, GamePlan];
  /** Every resolved decision, in order. Public: both browsers replay it to draw the game. */
  log: LoggedDecision[];
  /** Number of resolved plays (log entries that are not depth-chart changes). A call names the turn it is for. */
  turn: number;
  /** Calls made for the current turn. Never sent to the other coach before the snap. */
  pending: { off?: OffDecision; def?: DefDecision };
  need: { phase: 'scrimmage' | 'conversion' | 'none'; offense: 0 | 1 };
  deadline: number;
  /** When each team's coach last checked in, by team index. */
  seen: [number, number];
  score: [number, number];
  hash: string;
  createdAt: number;
  updatedAt: number;
  /** Voice chat mailbox. Audio never passes through the server, only these short connection messages. */
  voice?: VoiceBox;
}

export interface VoiceSignal {
  at: number;
  data: Record<string, unknown>;
}
export interface VoiceBox {
  /** When each team's coach last checked in to voice; 0 when not in voice. */
  at: [number, number];
  /** Messages waiting for each team's coach. */
  inbox: [VoiceSignal[], VoiceSignal[]];
}

/** A coach who has not checked in to voice for this long has hung up. */
export const VOICE_PRESENT_MS = 8000;
export const VOICE_SIGNALS_MAX = 40;
export const VOICE_SIGNAL_BYTES = 16000;
const VOICE_SIGNAL_TTL_MS = 60000;

export class RoomError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

const other = (t: 0 | 1): 0 | 1 => (t === 0 ? 1 : 0);

export function teamOf(room: Room, coachId: string): 0 | 1 {
  if (room.host.id === coachId) return room.hostTeam;
  if (room.guest?.id === coachId) return other(room.hostTeam);
  throw new RoomError('not_member', 'You are not in that game.', 403);
}

function cleanBook(book: unknown): string[] {
  if (!Array.isArray(book) || book.some((x) => typeof x !== 'string')) return [...DEFAULT_BOOK];
  const problem = validateBook(book as string[]);
  if (problem) throw new RoomError('bad_book', problem);
  return [...(book as string[])];
}

export function createRoom(pin: string, host: Coach, team: 0 | 1, book: unknown, seed: number, now: number): Room {
  const books: [string[], string[]] = [[...DEFAULT_BOOK], [...DEFAULT_BOOK]];
  books[team] = cleanBook(book);
  return {
    pin, state: 'lobby', seed: seed >>> 0, host, guest: null, hostTeam: team, books,
    plans: [{ ...DEFAULT_PLAN }, { ...DEFAULT_PLAN }], log: [], turn: 0, pending: {},
    need: { phase: 'none', offense: 0 }, deadline: 0, seen: [now, now], score: [0, 0], hash: '', createdAt: now, updatedAt: now,
  };
}

export function joinRoom(room: Room, guest: Coach, book: unknown, now: number): void {
  if (room.host.id === guest.id || room.guest?.id === guest.id) {
    touch(room, guest.id, now);
    return;
  }
  if (room.state !== 'lobby') throw new RoomError('in_progress', 'That game has already started.');
  if (room.guest) throw new RoomError('full', 'That game already has two coaches.');
  room.guest = guest;
  const team = other(room.hostTeam);
  room.books[team] = cleanBook(book);
  room.seen[team] = now;
  room.updatedAt = now;
}

export function leaveRoom(room: Room, coachId: string, now: number): void {
  if (room.state === 'lobby' && room.guest?.id === coachId) {
    room.guest = null;
    room.updatedAt = now;
  }
}

export function touch(room: Room, coachId: string, now: number): void {
  room.seen[teamOf(room, coachId)] = now;
}

function buildGame(room: Room): Game {
  return replayGame(room.seed, exhibitionTeams(room.seed), room.log, { books: room.books });
}

/** Runs kickoffs (which need no decision), then records what the next decision is. */
function settle(room: Room, game: Game, now: number): void {
  while (game.state.phase === 'kickoff') {
    game.begin(null, null);
    while (!game.tick()) { /* step */ }
  }
  room.log = game.log.map((d) => JSON.parse(JSON.stringify(d)) as LoggedDecision);
  room.turn = room.log.filter((d) => !('manage' in d)).length;
  room.score = [game.state.score[0], game.state.score[1]];
  room.hash = gameHash(game);
  room.pending = {};
  if (game.state.phase === 'final') {
    room.state = 'done';
    room.need = { phase: 'none', offense: 0 };
  } else {
    room.need = { phase: game.state.phase === 'conversion' ? 'conversion' : 'scrimmage', offense: game.state.possession };
    room.deadline = now + CALL_MS;
  }
  room.updatedAt = now;
}

export function startRoom(room: Room, coachId: string, now: number): void {
  if (room.host.id !== coachId) throw new RoomError('not_host', 'Only the host can start the game.', 403);
  if (room.state !== 'lobby') throw new RoomError('in_progress', 'The game has already started.');
  if (!room.guest) throw new RoomError('no_opponent', 'Wait for another coach to join.');
  room.state = 'playing';
  room.log = [];
  room.seen = [now, now];
  settle(room, buildGame(room), now);
}

function cleanOffense(room: Room, team: 0 | 1, raw: unknown): OffDecision {
  const c = (raw ?? {}) as Record<string, unknown>;
  const timeout = c['timeout'] === true;
  if (room.need.phase === 'conversion') {
    if (c['kind'] === 'patKick') return { kind: 'patKick' };
    if (c['kind'] === 'play' && typeof c['playId'] === 'string' && room.books[team].includes(c['playId'])) return { kind: 'play', playId: c['playId'] };
    throw new RoomError('bad_call', 'Choose the kick or a play from your book.');
  }
  switch (c['kind']) {
    case 'play':
      if (typeof c['playId'] !== 'string' || !room.books[team].includes(c['playId'])) throw new RoomError('bad_call', 'That play is not in your playbook.');
      return { kind: 'play', playId: c['playId'], timeout };
    case 'punt': return { kind: 'punt', timeout };
    case 'fieldGoal': return { kind: 'fieldGoal', timeout };
    case 'kneel': return { kind: 'kneel' };
    default: throw new RoomError('bad_call', 'Unknown offensive call.');
  }
}

function cleanDefense(raw: unknown): DefDecision {
  const c = (raw ?? {}) as Record<string, unknown>;
  if (!DEFENSE_FRONTS.some((f) => f.id === c['frontId']) || !DEFENSE_SCHEMES.some((s) => s.id === c['callId'])) throw new RoomError('bad_call', 'Unknown defensive call.');
  return { frontId: c['frontId'] as string, callId: c['callId'] as string, timeout: c['timeout'] === true };
}

/** Records a coach's call for the current turn. Which sideline it is for comes from who he is, never from the request. */
export function submitCall(room: Room, coachId: string, turn: number, call: unknown, now: number): void {
  if (room.state !== 'playing') throw new RoomError('not_playing', 'The game is not being played.');
  const team = teamOf(room, coachId);
  if (turn !== room.turn) throw new RoomError('stale', 'That play has already been run.', 409);
  room.seen[team] = now;
  if (team === room.need.offense) {
    if (!room.pending.off) room.pending.off = cleanOffense(room, team, call);
  } else if (!room.pending.def) room.pending.def = cleanDefense(call);
  resolveIfReady(room, now);
}

/** Runs the play once both calls are in, the clock has expired, or the only missing coach is away. */
export function resolveIfReady(room: Room, now: number): boolean {
  if (room.state !== 'playing') return false;
  const off = room.need.offense;
  const offAway = now - room.seen[off] > AWAY_MS;
  const defAway = now - room.seen[other(off)] > AWAY_MS;
  const ready = (room.pending.off && room.pending.def) || now >= room.deadline
    || (room.pending.off && defAway) || (room.pending.def && offAway);
  if (!ready) return false;
  const game = buildGame(room);
  const ai = new AutoCoach((room.seed + room.log.length) >>> 0, room.plans);
  let offCall = room.pending.off ?? ai.offense(game)!;
  let defCall = room.pending.def ?? ai.defense(game)!;
  try {
    game.begin(offCall, defCall);
  } catch {
    // A call that became illegal (it cannot, but the server never trusts that): the AI calls the play instead.
    const fresh = buildGame(room);
    offCall = ai.offense(fresh)!;
    defCall = ai.defense(fresh)!;
    fresh.begin(offCall, defCall);
    while (!fresh.tick()) { /* step */ }
    settle(room, fresh, now);
    return true;
  }
  while (!game.tick()) { /* step */ }
  settle(room, game, now);
  return true;
}

/** Called on every check-in: drops a guest who left the lobby, and resolves an overdue play. */
export function tickRoom(room: Room, now: number): void {
  if (room.state === 'lobby' && room.guest && now - room.seen[other(room.hostTeam)] > LOBBY_TIMEOUT_MS) {
    room.guest = null;
    room.updatedAt = now;
  }
  resolveIfReady(room, now);
}

export function manageRoom(room: Room, coachId: string, raw: unknown, now: number): void {
  if (room.state !== 'playing') throw new RoomError('not_playing', 'The game is not being played.');
  const team = teamOf(room, coachId);
  const a = (raw ?? {}) as Record<string, unknown>;
  let action: ManageAction;
  if (a['kind'] === 'threshold' && typeof a['value'] === 'number') action = { kind: 'threshold', team, value: a['value'] };
  else if (a['kind'] === 'depth' && typeof a['group'] === 'string' && Array.isArray(a['order']) && a['order'].every((x) => typeof x === 'string')) {
    action = { kind: 'depth', team, group: a['group'] as never, order: a['order'] as string[] };
  } else throw new RoomError('bad_request', 'Unknown sideline change.');
  const game = buildGame(room);
  try {
    game.manage(action);
  } catch (e) {
    throw new RoomError('bad_request', e instanceof Error ? e.message : 'That change is not allowed.');
  }
  room.log = [...room.log, { manage: action }];
  room.seen[team] = now;
  room.updatedAt = now;
}

export function setPlan(room: Room, coachId: string, raw: unknown): void {
  const team = teamOf(room, coachId);
  const p = (raw ?? {}) as Record<string, unknown>;
  room.plans[team] = {
    passBias: clamp(Math.round(Number(p['passBias']) || 0), -2, 2),
    aggression: clamp(Math.round(Number(p['aggression'] ?? 1) || 0), 0, 2),
  };
}

/**
 * Voice mailbox: a coach in voice calls this about once a second. It marks him present, drops off
 * connection messages for the other coach and picks up the ones addressed to him.
 */
export function voiceExchange(room: Room, coachId: string, on: boolean, send: unknown, now: number): { peers: string[]; signals: { from: string; data: Record<string, unknown> }[] } {
  const team = teamOf(room, coachId);
  const them = other(team);
  const box = (room.voice ??= { at: [0, 0], inbox: [[], []] });
  if (!on) {
    box.at[team] = 0;
    box.inbox[team] = [];
    box.inbox[them] = [];
    return { peers: [], signals: [] };
  }
  box.at[team] = now;
  const themPresent = now - box.at[them] <= VOICE_PRESENT_MS && box.at[them] > 0;
  if (Array.isArray(send) && themPresent) {
    for (const item of send.slice(0, VOICE_SIGNALS_MAX)) {
      const data = (item as { data?: unknown } | null)?.data;
      if (typeof data !== 'object' || data === null) continue;
      if (JSON.stringify(data).length > VOICE_SIGNAL_BYTES) continue;
      if (box.inbox[them].length >= VOICE_SIGNALS_MAX * 2) break;
      box.inbox[them].push({ at: now, data: data as Record<string, unknown> });
    }
  }
  const got = box.inbox[team].filter((m) => now - m.at <= VOICE_SIGNAL_TTL_MS);
  box.inbox[team] = [];
  box.inbox[them] = box.inbox[them].filter((m) => now - m.at <= VOICE_SIGNAL_TTL_MS);
  return { peers: themPresent ? [String(them)] : [], signals: got.map((m) => ({ from: String(them), data: m.data })) };
}

export interface RoomView {
  pin: string;
  state: Room['state'];
  /** Your team index. */
  you: 0 | 1;
  isHost: boolean;
  /** Coach names by team index; null while the seat is empty. */
  coaches: [string | null, string | null];
  seed: number;
  books: [string[], string[]];
  turn: number;
  logSize: number;
  /** Log entries from the index the client asked for. */
  log: LoggedDecision[];
  need: Room['need'];
  /** Whether each sideline has made its call. The calls themselves stay hidden until the snap. */
  submitted: { off: boolean; def: boolean };
  /** Your own call for this turn, if made. */
  mine: OffDecision | DefDecision | null;
  deadlineInMs: number;
  away: [boolean, boolean];
  score: [number, number];
  hash: string;
  plan: GamePlan;
  /** Whether each team's coach is in voice chat. */
  voice: [boolean, boolean];
}

const inVoice = (room: Room, team: 0 | 1, now: number): boolean => !!room.voice && room.voice.at[team] > 0 && now - room.voice.at[team] <= VOICE_PRESENT_MS;

/** What one coach is allowed to see. Built per coach so the opponent's pending call can never leak. */
export function viewRoom(room: Room, coachId: string, have: number, now: number): RoomView {
  const you = teamOf(room, coachId);
  const coaches: [string | null, string | null] = [null, null];
  coaches[room.hostTeam] = room.host.name;
  coaches[other(room.hostTeam)] = room.guest?.name ?? null;
  const iAmOffense = you === room.need.offense;
  return {
    pin: room.pin, state: room.state, you, isHost: room.host.id === coachId, coaches, seed: room.seed, books: room.books,
    turn: room.turn, logSize: room.log.length, log: room.log.slice(clamp(Math.trunc(have) || 0, 0, room.log.length)),
    need: room.need, submitted: { off: !!room.pending.off, def: !!room.pending.def },
    mine: (iAmOffense ? room.pending.off : room.pending.def) ?? null,
    deadlineInMs: room.state === 'playing' ? room.deadline - now : 0,
    away: [room.state === 'playing' && now - room.seen[0] > AWAY_MS, room.state === 'playing' && now - room.seen[1] > AWAY_MS],
    score: room.score, hash: room.hash, plan: room.plans[you],
    voice: [inVoice(room, 0, now), inVoice(room, 1, now)],
  };
}
