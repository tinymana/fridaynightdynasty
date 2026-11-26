/**
 * Client for the Friday Night Dynasty online API (a Supabase Edge Function).
 *
 * Nothing here can report a score or a result. A coach sends his own sideline's
 * call; the server runs the play and both browsers replay it from the shared log.
 */
import type { DefDecision, DefPlay, GamePlan, GameSetup, OffDecision, OffPlay } from '@fnd/core';
import type { Career, LeagueView, RoomView } from '@fnd/online';

const DEFAULT_URL = 'https://epvpekylasvxoipxyvku.supabase.co/functions/v1/fnd';
/** Tests point the game at a local mock server by setting window.__fndOnlineUrl before the page loads. */
export const onlineUrl = (): string => (window as unknown as { __fndOnlineUrl?: string }).__fndOnlineUrl ?? DEFAULT_URL;

export class OnlineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(onlineUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new OnlineError('offline', 'The online server cannot be reached from here. Online play works on the game’s website.');
  }
  let data: { ok?: boolean; error?: { code: string; message: string } } & Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new OnlineError('server', 'The online server sent an unreadable reply.');
  }
  if (!data.ok) throw new OnlineError(data.error?.code ?? 'server', data.error?.message ?? 'Something went wrong.');
  return data as T;
}

/** A WebRTC connection message for the other coach. */
export interface VoiceSignal {
  to: string;
  data: Record<string, unknown>;
}

export interface Signed {
  token: string;
  created: boolean;
  coach: { id: string; name: string };
}

export const online = {
  enter: (name: string, pin: string) => post<Signed>({ action: 'enter', name, pin }),
  /** A coach brings his eight-play book and his own designs. The server checks every design again before seating him. */
  host: (token: string, team: 0 | 1, book: string[], plays: OffPlay[] = [], defenses: DefPlay[] = [], setup?: GameSetup) => post<{ room: RoomView }>({ action: 'host', token, team, book, plays, defenses, setup }),
  join: (token: string, pin: string, book: string[], plays: OffPlay[] = [], defenses: DefPlay[] = [], have = 0) => post<{ room: RoomView }>({ action: 'join', token, pin, book, plays, defenses, have }),
  profile: (token: string) => post<{ career: Career | null }>({ action: 'profile', token }),
  hall: () => post<{ hall: Career[] }>({ action: 'hall' }),
  // Dynasty with friends.
  leagueCreate: (token: string, state: string, setup: GameSetup) => post<{ league: LeagueView }>({ action: 'leagueCreate', token, state, setup }),
  league: (token: string, code: string) => post<{ league: LeagueView }>({ action: 'league', token, code }),
  leagueClaim: (token: string, code: string, school: number) => post<{ league: LeagueView }>({ action: 'leagueClaim', token, code, school }),
  leagueStart: (token: string, code: string) => post<{ league: LeagueView }>({ action: 'leagueStart', token, code }),
  leagueForce: (token: string, code: string) => post<{ league: LeagueView }>({ action: 'leagueForce', token, code }),
  leagueNext: (token: string, code: string) => post<{ league: LeagueView }>({ action: 'leagueNext', token, code }),
  leaguePlay: (token: string, code: string, book: string[], plays: OffPlay[], defenses: DefPlay[]) => post<{ room: RoomView }>({ action: 'leaguePlay', token, code, book, plays, defenses }),
  leave: (token: string, pin: string) => post<object>({ action: 'leave', token, pin }),
  start: (token: string, pin: string) => post<{ room: RoomView }>({ action: 'start', token, pin }),
  game: (token: string, pin: string, have: number) => post<{ room: RoomView }>({ action: 'game', token, pin, have }),
  call: (token: string, pin: string, turn: number, call: OffDecision | DefDecision, have: number) => post<{ room: RoomView }>({ action: 'call', token, pin, turn, call, have }),
  manage: (token: string, pin: string, change: Record<string, unknown>, have: number) => post<{ room: RoomView }>({ action: 'manage', token, pin, change, have }),
  voice: (token: string, pin: string, on: boolean, send: VoiceSignal[]) => post<{ peers: string[]; signals: { from: string; data: Record<string, unknown> }[] }>({ action: 'voice', token, pin, on, send }),
  plan: (token: string, pin: string, plan: GamePlan, have: number) => post<{ room: RoomView }>({ action: 'plan', token, pin, plan, have }),
};
