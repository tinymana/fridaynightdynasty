import { cleanSetup, type GameSetup, type Team, type TeamColors } from '@fnd/core';
import {
  LEAGUE_SIZE, REGULAR_WEEKS, STATES, addResult, closeWeek, createDynasty, createLeague, editSchool, gameSeed, gameSetup, nextSeason, recordOf, simulate, standings, matchTeams, weekComplete, weekGames,
  type Dynasty, type SchoolIdentity, type SeasonRecord, type Standing,
} from '@fnd/league';
import { RoomError, type Coach } from './room';

/**
 * A dynasty shared by friends. Pure state transitions, like the game room: no clock, no storage.
 * Each coach runs one school. A game between two coaches is played in a game room with both of them
 * present; a game against an AI school is played in a room against the AI; games between two AI
 * schools are simulated here, one per check-in so no single request does much work.
 */

export const LEAGUE_CODE = /^[A-Z]{5}$/;

export interface SharedLeague {
  code: string;
  state: 'lobby' | 'season';
  dynasty: Dynasty;
  commissioner: Coach;
  /** The coach of each school, by school index; null means the AI runs it. */
  coaches: (Coach | null)[];
  /** Open game rooms for this week's games, keyed "home-away". */
  rooms: Record<string, string>;
  /** Set by the commissioner: the AI finishes this week's unplayed games. */
  forced?: boolean;
  /** Coach ids already credited with a championship, as "year:coach", so a title counts once. */
  credited?: string[];
  createdAt: number;
  updatedAt: number;
}

/** What the game room needs to rebuild the two teams of a league game. */
export interface RoomLeague {
  code: string;
  state: string;
  seed: number;
  year: number;
  week: number;
  home: number;
  away: number;
  prestige: [number, number];
  /** Names and colours of the two schools, when the commissioner has changed them. */
  identity?: [SchoolIdentity, SchoolIdentity];
}

export function leagueTeams(l: RoomLeague): [Team, Team] {
  const league = createLeague(l.state, l.seed);
  league.schools[l.home] = { ...league.schools[l.home], ...l.identity?.[0], prestige: l.prestige[0] };
  league.schools[l.away] = { ...league.schools[l.away], ...l.identity?.[1], prestige: l.prestige[1] };
  const d = { league, year: l.year };
  return matchTeams(d, l.home, l.away);
}

export function createShared(code: string, coach: Coach, stateCode: unknown, seed: number, setup: unknown, now: number): SharedLeague {
  if (!STATES.some((s) => s.code === stateCode)) throw new RoomError('bad_request', 'Choose a state.');
  return {
    code, state: 'lobby', dynasty: { ...createDynasty(stateCode as string, seed, 0, { quarterMinutes: cleanSetup(setup).quarterMinutes }), bracket: false },
    commissioner: coach, coaches: Array<Coach | null>(LEAGUE_SIZE).fill(null), rooms: {}, createdAt: now, updatedAt: now,
  };
}

const identityOf = (s: SchoolIdentity): SchoolIdentity => ({ name: s.name, mascot: s.mascot, abbr: s.abbr, colors: { ...s.colors } });

/** Commissioner only: rename a school or change its colours, at any time. Players, strength and results stay as they are. */
export function editLeagueSchool(l: SharedLeague, coachId: string, school: unknown, identity: unknown, now: number): void {
  if (l.commissioner.id !== coachId) throw new RoomError('not_host', 'Only the commissioner can rename schools.', 403);
  try {
    l.dynasty = { ...l.dynasty, league: editSchool(l.dynasty.league, typeof school === 'number' ? school : -1, identity) };
  } catch (e) {
    throw new RoomError('bad_request', e instanceof Error ? e.message : 'That change is not allowed.');
  }
  l.updatedAt = now;
}

export const schoolOf = (l: SharedLeague, coachId: string): number => l.coaches.findIndex((c) => c?.id === coachId);

/** Takes a school, or moves to another one, while the league is still gathering. */
export function claimSchool(l: SharedLeague, coach: Coach, school: unknown, now: number): void {
  if (l.state !== 'lobby') throw new RoomError('in_progress', 'The season has started. Schools are set.');
  if (typeof school !== 'number' || !Number.isInteger(school) || school < 0 || school >= LEAGUE_SIZE) throw new RoomError('bad_request', 'Choose a school.');
  if (l.coaches[school] && l.coaches[school]!.id !== coach.id) throw new RoomError('taken', 'Another coach already has that school.');
  const had = schoolOf(l, coach.id);
  if (had >= 0) l.coaches[had] = null;
  l.coaches[school] = coach;
  l.updatedAt = now;
}

export function startSeason(l: SharedLeague, coachId: string, now: number): void {
  if (l.commissioner.id !== coachId) throw new RoomError('not_host', 'Only the commissioner can start the season.', 403);
  if (l.state !== 'lobby') throw new RoomError('in_progress', 'The season has already started.');
  if (!l.coaches.some((c) => c !== null)) throw new RoomError('no_opponent', 'At least one coach must take a school.');
  l.state = 'season';
  l.updatedAt = now;
}

const key = (home: number, away: number): string => `${home}-${away}`;
const played = (l: SharedLeague, home: number, away: number): boolean => l.dynasty.results.some((g) => g.week === l.dynasty.week && g.home === home && g.away === away);

/** The game a coach has this week, if any, and whether it is still to be played. */
export function gameOf(l: SharedLeague, coachId: string): { home: number; away: number; done: boolean } | null {
  const school = schoolOf(l, coachId);
  if (school < 0 || l.state !== 'season') return null;
  const g = weekGames(l.dynasty).find(([h, a]) => h === school || a === school);
  return g ? { home: g[0], away: g[1], done: played(l, g[0], g[1]) } : null;
}

/** Everything a game room needs for one of this week's games. */
export function roomLeague(l: SharedLeague, home: number, away: number): { league: RoomLeague; seed: number; setup: GameSetup } {
  const d = l.dynasty;
  return {
    league: {
      code: l.code, state: d.league.state, seed: d.league.seed, year: d.year, week: d.week, home, away, prestige: [d.league.schools[home].prestige, d.league.schools[away].prestige],
      identity: [identityOf(d.league.schools[home]), identityOf(d.league.schools[away])],
    },
    seed: gameSeed(d, d.week, home, away), setup: gameSetup(d, d.week, home, away),
  };
}

/** Records a finished room game. A result for a week that has moved on, or a game already in, is ignored. */
export function recordGame(l: SharedLeague, r: RoomLeague, score: readonly [number, number], now: number): boolean {
  if (l.state !== 'season' || r.year !== l.dynasty.year || r.week !== l.dynasty.week || played(l, r.home, r.away)) return false;
  l.dynasty = addResult(l.dynasty, { week: r.week, home: r.home, away: r.away, score: [score[0], score[1]] });
  delete l.rooms[key(r.home, r.away)];
  l.updatedAt = now;
  return true;
}

/**
 * Moves the league along by one small step: simulates one game that no coach will play, or closes a finished week.
 * Returns the coach who has just won a championship, if this step decided one.
 */
export function stepLeague(l: SharedLeague, now: number): { champion: Coach | null; changed: boolean } {
  if (l.state !== 'season' || l.dynasty.week > REGULAR_WEEKS) return { champion: null, changed: false };
  for (const [h, a] of weekGames(l.dynasty)) {
    if (played(l, h, a)) continue;
    const human = l.coaches[h] !== null || l.coaches[a] !== null;
    // A game with a coach in it waits for him, unless the commissioner has moved the week on.
    if (human && !l.forced) continue;
    if (human && l.rooms[key(h, a)]) delete l.rooms[key(h, a)];
    l.dynasty = addResult(l.dynasty, simulate(l.dynasty, l.dynasty.week, h, a));
    l.updatedAt = now;
    return { champion: null, changed: true };
  }
  if (!weekComplete(l.dynasty)) return { champion: null, changed: false };
  const wasFinal = l.dynasty.week === REGULAR_WEEKS;
  l.dynasty = closeWeek(l.dynasty);
  l.rooms = {};
  l.forced = false;
  l.updatedAt = now;
  if (!wasFinal) return { champion: null, changed: true };
  const h = l.dynasty.history[l.dynasty.history.length - 1];
  const coach = l.coaches[h.champion];
  const tag = coach ? `${h.year}:${coach.id}` : '';
  if (!coach || l.credited?.includes(tag)) return { champion: null, changed: true };
  l.credited = [...(l.credited ?? []), tag];
  return { champion: coach, changed: true };
}

export function forceWeek(l: SharedLeague, coachId: string, now: number): void {
  if (l.commissioner.id !== coachId) throw new RoomError('not_host', 'Only the commissioner can move the week on.', 403);
  if (l.state !== 'season' || l.dynasty.week > REGULAR_WEEKS) throw new RoomError('bad_request', 'There is no week in progress.');
  l.forced = true;
  l.updatedAt = now;
}

export function nextSharedSeason(l: SharedLeague, coachId: string, now: number): void {
  if (l.commissioner.id !== coachId) throw new RoomError('not_host', 'Only the commissioner can start the next season.', 403);
  if (l.state !== 'season' || l.dynasty.week <= REGULAR_WEEKS) throw new RoomError('bad_request', 'The season is not over.');
  // A league with friends still ends with first against second; the bracket is for solo dynasties for now.
  l.dynasty = nextSeason({ ...l.dynasty, bracket: false });
  l.rooms = {};
  l.forced = false;
  l.updatedAt = now;
}

export interface LeagueGameView {
  home: number;
  away: number;
  score: [number, number] | null;
  /** True for each side run by a coach rather than the AI. */
  human: [boolean, boolean];
  /** A room is open for this game: someone is in it or waiting. */
  open: boolean;
  weather: string;
}

export interface LeagueView {
  code: string;
  state: SharedLeague['state'];
  stateCode: string;
  seed: number;
  year: number;
  week: number;
  over: boolean;
  quarterMinutes: number;
  schools: { name: string; mascot: string; abbr: string; colors: TeamColors; prestige: number; coach: string | null }[];
  /** Your school, or -1 if you have not taken one. */
  you: number;
  isCommissioner: boolean;
  commissioner: string;
  standings: Standing[];
  games: LeagueGameView[];
  lastWeek: { home: number; away: number; score: [number, number] }[];
  history: SeasonRecord[];
  /** Your own record this season. */
  record: [number, number, number];
  forced: boolean;
}

export function viewLeague(l: SharedLeague, coachId: string): LeagueView {
  const d = l.dynasty;
  const over = d.week > REGULAR_WEEKS;
  const you = schoolOf(l, coachId);
  const games: LeagueGameView[] = l.state === 'season' && !over ? weekGames(d).map(([h, a]) => {
    const r = d.results.find((g) => g.week === d.week && g.home === h && g.away === a);
    return { home: h, away: a, score: r ? [r.score[0], r.score[1]] : null, human: [l.coaches[h] !== null, l.coaches[a] !== null], open: !!l.rooms[key(h, a)], weather: gameSetup(d, d.week, h, a).weather };
  }) : [];
  return {
    code: l.code, state: l.state, stateCode: d.league.state, seed: d.league.seed, year: d.year, week: d.week, over, quarterMinutes: d.setup.quarterMinutes,
    schools: d.league.schools.map((s, i) => ({ name: s.name, mascot: s.mascot, abbr: s.abbr, colors: s.colors, prestige: s.prestige, coach: l.coaches[i]?.name ?? null })),
    you, isCommissioner: l.commissioner.id === coachId, commissioner: l.commissioner.name,
    standings: standings(d.results), games,
    lastWeek: d.week > 0 ? d.results.filter((g) => g.week === d.week - 1).map((g) => ({ home: g.home, away: g.away, score: [g.score[0], g.score[1]] })) : [],
    history: d.history, record: you >= 0 ? recordOf(d.results, you) : [0, 0, 0], forced: !!l.forced,
  };
}

export const roomKey = key;
