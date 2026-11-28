import {
  CUSTOM_FRONT, DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, KICK_STYLES, MAX_CUSTOM_DEFENSES, MAX_CUSTOM_PLAYS, clamp, cleanSetup, exhibitionTeams, validateBook, validateDefPlay, validateOffPlay,
  type DefDecision, type DefPlay, type GamePlan, type GameSetup, type KickStyle, type ManageAction, type OffDecision, type OffPlay,
} from '@fnd/core';
import { DEFAULT_PLAN } from '@fnd/football-ai';
import { AutoCoach, Game, gameHash, replayGame, type LoggedDecision } from '@fnd/match-sim';
import { boxScore, type BoxScore } from '@fnd/league';
import { leagueTeams, type RoomLeague } from './shared';

/**
 * A head-to-head game room. Pure state transitions: no clock, no storage, no network.
 * The server owns the seed and runs every play; a coach can only submit his own sideline's call.
 */

/** How long a coach has to call a play once the previous one is resolved (includes time to watch it). */
export const CALL_MS = 45000;
/** A kickoff call is one of three buttons: it gets less time. */
export const KICK_MS = 20000;
/** A coach not heard from for this long is away: the AI calls his plays so the other coach is not kept waiting. */
export const AWAY_MS = 12000;
/** How long the offense has at the line to look at the front and change the play. */
export const LINE_MS = 8000;
/** A guest who stops checking in to the lobby for this long has left. */
export const LOBBY_TIMEOUT_MS = 20000;
/** Both coaches of a league game must have checked in this recently for it to start. */
export const LEAGUE_HERE_MS = 8000;

export interface Coach {
  id: string;
  name: string;
}

/** The seat of a school no coach runs. It is always "away", so the AI makes its calls at once. */
export const AI_COACH: Coach = { id: '@ai', name: 'AI coach' };

export interface Room {
  pin: string;
  state: 'lobby' | 'playing' | 'done';
  seed: number;
  host: Coach;
  guest: Coach | null;
  /** The team (0 home, 1 visitors) the host coaches. The guest takes the other. */
  hostTeam: 0 | 1;
  books: [string[], string[]];
  /** Each coach's own designed plays and defenses, validated when he sat down. */
  designs?: Designs;
  plans: [GamePlan, GamePlan];
  /** Every resolved decision, in order. Public: both browsers replay it to draw the game. */
  log: LoggedDecision[];
  /** Number of resolved plays (log entries that are not depth-chart changes). A call names the turn it is for. */
  turn: number;
  /** Calls made for the current turn. Never sent to the other coach before the snap. */
  pending: { off?: OffDecision; def?: DefDecision };
  /** Both calls are in and the offense is at the line: it sees the front and may change the play until `until`. */
  line?: { until: number; snap?: boolean };
  /** The offense asked to go to the line with its call (`look: true`). A browser that does not know the line never asks. */
  look?: boolean;
  /** On a kickoff, `offense` is the kicking team and only that coach has a call to make. */
  need: { phase: 'scrimmage' | 'conversion' | 'kickoff' | 'none'; offense: 0 | 1 };
  /** Quarter length and weather, chosen by the host. Absent in rooms made before this existed. */
  setup?: GameSetup;
  deadline: number;
  /** When each team's coach last checked in, by team index. */
  seen: [number, number];
  score: [number, number];
  hash: string;
  createdAt: number;
  updatedAt: number;
  /** Voice chat mailbox. Audio never passes through the server, only these short connection messages. */
  voice?: VoiceBox;
  /** Set once the final score has been written to both coaches' career records. */
  recorded?: boolean;
  /** Present when this is a dynasty league game: which league, week and schools. Team 0 is the home school. */
  league?: RoomLeague;
}

/** A finished game, ready to be added to the two coaches' career records. */
export interface GameResult {
  /** Coach ids by team index. */
  coaches: [string, string];
  score: [number, number];
  /** The league game this was, if it was one. */
  league?: RoomLeague;
  /** A league game's box score, for the league's statistics and record books. */
  box?: BoxScore;
}

/** Hands over the result of a finished game exactly once. */
export function takeResult(room: Room): GameResult | null {
  if (room.state !== 'done' || room.recorded || !room.guest) return null;
  room.recorded = true;
  const coaches: [string, string] = ['', ''];
  coaches[room.hostTeam] = room.host.id;
  coaches[room.hostTeam === 0 ? 1 : 0] = room.guest.id;
  return room.league ? { coaches, score: [room.score[0], room.score[1]], league: room.league, box: boxScore(buildGame(room).events) } : { coaches, score: [room.score[0], room.score[1]] };
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

export interface Designs {
  plays: [OffPlay[], OffPlay[]];
  defenses: [DefPlay[], DefPlay[]];
}

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

function cleanBook(book: unknown, designed: readonly OffPlay[]): string[] {
  if (!Array.isArray(book) || book.some((x) => typeof x !== 'string')) return [...DEFAULT_BOOK];
  const problem = validateBook(book as string[], designed);
  if (problem) throw new RoomError('bad_book', problem);
  return [...(book as string[])];
}

/** Validates the designs a coach brings. The server never takes a design on trust. */
function cleanDesigns(rawPlays: unknown, rawDefenses: unknown): { plays: OffPlay[]; defenses: DefPlay[] } {
  const take = <T extends { id: string }>(raw: unknown, max: number, check: (x: unknown) => { ok: true; value: T } | { ok: false; problems: string[] }, what: string): T[] => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > max) throw new RoomError('bad_design', `Bring at most ${max} designed ${what}.`);
    const out = raw.map((x) => {
      const r = check(x);
      if (!r.ok) throw new RoomError('bad_design', `A designed ${what.slice(0, -1)} is not legal: ${r.problems[0]}`);
      return r.value;
    });
    if (new Set(out.map((x) => x.id)).size !== out.length) throw new RoomError('bad_design', 'Two designs share an id.');
    return out;
  };
  return { plays: take(rawPlays, MAX_CUSTOM_PLAYS, validateOffPlay, 'plays'), defenses: take(rawDefenses, MAX_CUSTOM_DEFENSES, validateDefPlay, 'defenses') };
}

export interface Bringing {
  /** Host only: quarter length and weather. */
  setup?: unknown;
  book?: unknown;
  plays?: unknown;
  defenses?: unknown;
}

function seat(room: Room, team: 0 | 1, bring: Bringing): void {
  const d = cleanDesigns(bring.plays, bring.defenses);
  const designs = (room.designs ??= { plays: [[], []], defenses: [[], []] });
  designs.plays[team] = d.plays;
  designs.defenses[team] = d.defenses;
  room.books[team] = cleanBook(bring.book, d.plays);
}

export function createRoom(pin: string, host: Coach, team: 0 | 1, bring: Bringing, seed: number, now: number): Room {
  const room: Room = {
    pin, state: 'lobby', seed: seed >>> 0, host, guest: null, hostTeam: team, books: [[...DEFAULT_BOOK], [...DEFAULT_BOOK]],
    designs: { plays: [[], []], defenses: [[], []] },
    plans: [{ ...DEFAULT_PLAN }, { ...DEFAULT_PLAN }], log: [], turn: 0, pending: {},
    need: { phase: 'none', offense: 0 }, deadline: 0, seen: [now, now], score: [0, 0], hash: '', createdAt: now, updatedAt: now,
  };
  seat(room, team, bring);
  room.setup = cleanSetup(bring.setup);
  return room;
}

/**
 * A room for a dynasty league game. The home school is team 0. With `vsAi` the other school has no coach:
 * the game starts at once and the AI makes that side's calls.
 */
export function createLeagueRoom(pin: string, host: Coach, team: 0 | 1, bring: Bringing, seed: number, league: RoomLeague, setup: GameSetup, vsAi: boolean, now: number): Room {
  const room = createRoom(pin, host, team, bring, seed, now);
  room.league = league;
  room.setup = setup;
  if (vsAi) {
    room.guest = AI_COACH;
    room.state = 'playing';
    room.seen = [now, now];
    room.seen[other(team)] = 0;
    settle(room, buildGame(room), now);
  }
  return room;
}

/** A coach sits down to a league game. It starts once both coaches are in the room at the same time. */
export function joinLeagueRoom(room: Room, guest: Coach, bring: Bringing, now: number): void {
  joinRoom(room, guest, bring, now);
  startWhenBothHere(room, now);
}

/** A league game has no start button: it kicks off when both coaches have checked in within the last few seconds. */
function startWhenBothHere(room: Room, now: number): void {
  if (!room.league || room.state !== 'lobby' || !room.guest) return;
  if (now - room.seen[0] > LEAGUE_HERE_MS || now - room.seen[1] > LEAGUE_HERE_MS) return;
  room.state = 'playing';
  room.log = [];
  settle(room, buildGame(room), now);
}

export function joinRoom(room: Room, guest: Coach, bring: Bringing, now: number): void {
  if (room.host.id === guest.id || room.guest?.id === guest.id) {
    touch(room, guest.id, now);
    return;
  }
  if (room.state !== 'lobby') throw new RoomError('in_progress', 'That game has already started.');
  if (room.guest) throw new RoomError('full', 'That game already has two coaches.');
  const team = other(room.hostTeam);
  seat(room, team, bring);
  room.guest = guest;
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
  return replayGame(room.seed, room.league ? leagueTeams(room.league) : exhibitionTeams(room.seed), room.log, { books: room.books, plays: room.designs?.plays, defenses: room.designs?.defenses, setup: room.setup });
}

/** Records what the next decision is. */
function settle(room: Room, game: Game, now: number): void {
  room.log = game.log.map((d) => JSON.parse(JSON.stringify(d)) as LoggedDecision);
  room.turn = room.log.filter((d) => !('manage' in d)).length;
  room.score = [game.state.score[0], game.state.score[1]];
  room.hash = gameHash(game);
  room.pending = {};
  delete room.line;
  delete room.look;
  if (game.state.phase === 'final') {
    room.state = 'done';
    room.need = { phase: 'none', offense: 0 };
  } else {
    const kick = game.state.phase === 'kickoff';
    room.need = kick ? { phase: 'kickoff', offense: game.state.kicking } : { phase: game.state.phase === 'conversion' ? 'conversion' : 'scrimmage', offense: game.state.possession };
    room.deadline = now + (kick ? KICK_MS : CALL_MS);
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
  if (room.need.phase === 'kickoff') {
    if (c['kind'] === 'kickoff' && KICK_STYLES.includes(c['style'] as KickStyle)) return { kind: 'kickoff', style: c['style'] as KickStyle };
    throw new RoomError('bad_call', 'Choose how to kick off.');
  }
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

function cleanDefense(room: Room, team: 0 | 1, raw: unknown): DefDecision {
  const c = (raw ?? {}) as Record<string, unknown>;
  if (c['frontId'] === CUSTOM_FRONT) {
    // A designed defense must be one of this coach's own.
    if (typeof c['callId'] !== 'string' || !room.designs?.defenses[team].some((d) => d.id === c['callId'])) throw new RoomError('bad_call', 'That defense is not one of your designs.');
    const own: DefDecision = { frontId: CUSTOM_FRONT, callId: c['callId'], timeout: c['timeout'] === true };
    if (c['block'] === true) own.block = true;
    return own;
  }
  if (!DEFENSE_FRONTS.some((f) => f.id === c['frontId']) || !DEFENSE_SCHEMES.some((s) => s.id === c['callId'])) throw new RoomError('bad_call', 'Unknown defensive call.');
  const lib: DefDecision = { frontId: c['frontId'] as string, callId: c['callId'] as string, timeout: c['timeout'] === true };
  if (c['block'] === true) lib.block = true;
  return lib;
}

/** Records a coach's call for the current turn. Which sideline it is for comes from who he is, never from the request. */
export function submitCall(room: Room, coachId: string, turn: number, call: unknown, now: number): void {
  if (room.state !== 'playing') throw new RoomError('not_playing', 'The game is not being played.');
  const team = teamOf(room, coachId);
  if (turn !== room.turn) throw new RoomError('stale', 'That play has already been run.', 409);
  room.seen[team] = now;
  if (room.line) {
    // At the line only the offense has anything left to say: snap it, or change the play.
    const c = (call ?? {}) as Record<string, unknown>;
    const off = room.pending.off;
    if (team === room.need.offense && !room.line.snap && off?.kind === 'play') {
      if (c['kind'] === 'audible') {
        const to = c['playId'];
        if (typeof to !== 'string' || !room.books[team].includes(to)) throw new RoomError('bad_call', 'That play is not in your playbook.');
        const game = buildGame(room);
        if (game.playOf(team, to).formation !== game.playOf(team, off.playId).formation) throw new RoomError('bad_call', 'An audible keeps the formation that lined up.');
        if (to !== off.playId) off.audible = to;
        room.line.snap = true;
      } else if (c['kind'] === 'snap') room.line.snap = true;
    }
    resolveIfReady(room, now);
    return;
  }
  if (team === room.need.offense) {
    if (!room.pending.off) {
      room.pending.off = cleanOffense(room, team, call);
      if (room.pending.off.kind === 'play' && (call as Record<string, unknown> | null)?.['look'] === true) room.look = true;
    }
  } else if (room.need.phase === 'kickoff') throw new RoomError('bad_call', 'The kicking team makes this call.');
  else if (!room.pending.def) room.pending.def = cleanDefense(room, team, call);
  resolveIfReady(room, now);
}

/** Runs the play once both calls are in, the clock has expired, or the only missing coach is away. */
export function resolveIfReady(room: Room, now: number): boolean {
  if (room.state !== 'playing') return false;
  const off = room.need.offense;
  const offAway = now - room.seen[off] > AWAY_MS;
  const defAway = now - room.seen[other(off)] > AWAY_MS;
  const kick = room.need.phase === 'kickoff';
  const ready = kick ? (room.pending.off || offAway || now >= room.deadline)
    : (room.pending.off && room.pending.def) || now >= room.deadline || (room.pending.off && defAway) || (room.pending.def && offAway);
  if (!ready) return false;
  const game = buildGame(room);
  const ai = new AutoCoach((room.seed + room.log.length) >>> 0, room.plans);
  let defCall = kick ? null : room.pending.def ?? ai.defense(game)!;
  // A coach who called a play and is still here walks his offense to the line first.
  if (!kick && room.look && room.pending.off?.kind === 'play' && !offAway && defCall) {
    if (!room.line) {
      room.pending.def = defCall;
      room.line = { until: now + LINE_MS };
      room.updatedAt = now;
      return false;
    }
    if (!room.line.snap && now < room.line.until) return false;
  }
  let offCall = room.pending.off ?? ai.audible(game, ai.offense(game), defCall)!;
  try {
    game.begin(offCall, defCall);
  } catch {
    // A call that became illegal (it cannot, but the server never trusts that): the AI calls the play instead.
    const fresh = buildGame(room);
    offCall = ai.offense(fresh)!;
    defCall = ai.defense(fresh);
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
  startWhenBothHere(room, now);
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
  /** Both coaches' designs. Each browser needs them to redraw the game. */
  designs: Designs;
  setup: GameSetup;
  /** Set for a dynasty league game: the browser builds the two schools from it. */
  league: RoomLeague | null;
  turn: number;
  logSize: number;
  /** Log entries from the index the client asked for. */
  log: LoggedDecision[];
  need: Room['need'];
  /** Whether each sideline has made its call. The calls themselves stay hidden until the snap. */
  submitted: { off: boolean; def: boolean };
  /** Your own call for this turn, if made. */
  mine: OffDecision | DefDecision | null;
  /** The offense is at the line. Only the offense is shown the front. */
  line: { front: string | null; msLeft: number } | null;
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
    pin: room.pin, state: room.state, you, isHost: room.host.id === coachId, coaches, seed: room.seed, books: room.books, designs: room.designs ?? { plays: [[], []], defenses: [[], []] }, setup: cleanSetup(room.setup), league: room.league ?? null,
    turn: room.turn, logSize: room.log.length, log: room.log.slice(clamp(Math.trunc(have) || 0, 0, room.log.length)),
    need: room.need, submitted: { off: !!room.pending.off, def: !!room.pending.def },
    mine: (iAmOffense ? room.pending.off : room.pending.def) ?? null,
    line: room.line && room.state === 'playing' ? { front: iAmOffense ? room.pending.def?.frontId ?? null : null, msLeft: Math.max(0, room.line.until - now) } : null,
    deadlineInMs: room.state === 'playing' ? (room.line ? Math.max(0, room.line.until - now) : room.deadline - now) : 0,
    away: [room.state === 'playing' && now - room.seen[0] > AWAY_MS, room.state === 'playing' && now - room.seen[1] > AWAY_MS],
    score: room.score, hash: room.hash, plan: room.plans[you],
    voice: [inVoice(room, 0, now), inVoice(room, 1, now)],
  };
}
