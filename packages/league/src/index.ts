import { DEFAULT_SETUP, Rng, clamp, cleanSetup, hashString, type GameSetup, type PlayEvent, type Ratings, type Team, type TeamColors, type Weather } from '@fnd/core';
import { simulateGame } from '@fnd/match-sim';
import { LEAGUE_TUNING, MAX_CALL_UPS, isFocus, seededFocus, cleanCallUps, enrolledIn, incomingClass, jvTeam, programFor, programNames, programNews, varsityTeam, type FocusId, type ProgramNews, type ProgramPlayer, type ProgramTune } from './program';
import { cleanStatBook, closeSeason, historicBook, recordGame, type RecordNews, type StatBook } from './records';
import { boxScore, type BoxScore } from './stats';
import { cleanAwards, voteAwards, type Candidate, type SeasonAwards } from './awards';

/**
 * A high school league and its seasons. Pure data and pure functions: the same league seed always gives the
 * same schools, schedule and AI results, so a dynasty can be saved as a few numbers and rebuilt anywhere,
 * in a browser for a solo dynasty or on the server for a shared one.
 */

export const LEAGUE_SIZE = 8;
export const REGULAR_WEEKS = LEAGUE_SIZE - 1;
/** School strength stays in a narrow band so a league stays a contest. 58 is an even exhibition team. */
export const PRESTIGE_MIN = 54;
export const PRESTIGE_MID = 58;
export const PRESTIGE_MAX = 62;

export type Region = 'northeast' | 'south' | 'midwest' | 'plains' | 'mountain' | 'desert' | 'pacific';
export interface StateInfo {
  code: string;
  name: string;
  region: Region;
}
const st = (code: string, name: string, region: Region): StateInfo => ({ code, name, region });
/** The fifty states. The schools in them are invented. */
export const STATES: readonly StateInfo[] = [
  st('AL', 'Alabama', 'south'), st('AK', 'Alaska', 'pacific'), st('AZ', 'Arizona', 'desert'), st('AR', 'Arkansas', 'south'), st('CA', 'California', 'pacific'),
  st('CO', 'Colorado', 'mountain'), st('CT', 'Connecticut', 'northeast'), st('DE', 'Delaware', 'northeast'), st('FL', 'Florida', 'south'), st('GA', 'Georgia', 'south'),
  st('HI', 'Hawaii', 'pacific'), st('ID', 'Idaho', 'mountain'), st('IL', 'Illinois', 'midwest'), st('IN', 'Indiana', 'midwest'), st('IA', 'Iowa', 'plains'),
  st('KS', 'Kansas', 'plains'), st('KY', 'Kentucky', 'south'), st('LA', 'Louisiana', 'south'), st('ME', 'Maine', 'northeast'), st('MD', 'Maryland', 'northeast'),
  st('MA', 'Massachusetts', 'northeast'), st('MI', 'Michigan', 'midwest'), st('MN', 'Minnesota', 'midwest'), st('MS', 'Mississippi', 'south'), st('MO', 'Missouri', 'plains'),
  st('MT', 'Montana', 'mountain'), st('NE', 'Nebraska', 'plains'), st('NV', 'Nevada', 'desert'), st('NH', 'New Hampshire', 'northeast'), st('NJ', 'New Jersey', 'northeast'),
  st('NM', 'New Mexico', 'desert'), st('NY', 'New York', 'northeast'), st('NC', 'North Carolina', 'south'), st('ND', 'North Dakota', 'plains'), st('OH', 'Ohio', 'midwest'),
  st('OK', 'Oklahoma', 'plains'), st('OR', 'Oregon', 'pacific'), st('PA', 'Pennsylvania', 'northeast'), st('RI', 'Rhode Island', 'northeast'), st('SC', 'South Carolina', 'south'),
  st('SD', 'South Dakota', 'plains'), st('TN', 'Tennessee', 'south'), st('TX', 'Texas', 'plains'), st('UT', 'Utah', 'mountain'), st('VT', 'Vermont', 'northeast'),
  st('VA', 'Virginia', 'south'), st('WA', 'Washington', 'pacific'), st('WV', 'West Virginia', 'south'), st('WI', 'Wisconsin', 'midwest'), st('WY', 'Wyoming', 'mountain'),
];
export const stateByCode = (code: string): StateInfo => STATES.find((s) => s.code === code) ?? STATES[0];

/** Town names are built from two parts, flavoured by region, so they sound local without naming a real school. */
const FIRST: Record<Region, readonly string[]> = {
  northeast: ['Ash', 'Stone', 'Mill', 'Had', 'Wren', 'Brook', 'Fair', 'North', 'Marl', 'Thorn', 'Whit', 'Elm'],
  south: ['Magnolia', 'Pine', 'Cypress', 'Pecan', 'Red Clay', 'Sweet', 'Laurel', 'Muscadine', 'Tall Oak', 'Blue', 'Cane', 'Willow'],
  midwest: ['Corn', 'Maple', 'Mill', 'Oak', 'Prairie', 'Lake', 'Fox', 'Cedar', 'Clear', 'Elk', 'Harvest', 'Birch'],
  plains: ['Dust', 'Wheat', 'Buffalo', 'Lone', 'Red', 'Wind', 'Mesquite', 'Coyote', 'Big Sky', 'Flat', 'Cotton', 'Sand'],
  mountain: ['Granite', 'Timber', 'Silver', 'Eagle', 'Snow', 'High', 'Aspen', 'Bear', 'Summit', 'Copper', 'Elk', 'Juniper'],
  desert: ['Sage', 'Mesa', 'Canyon', 'Agave', 'Sun', 'Dry', 'Saguaro', 'Painted', 'Red Rock', 'Coyote', 'Palo', 'Quartz'],
  pacific: ['Harbor', 'Redwood', 'Bay', 'Cedar', 'Fog', 'Salmon', 'Kelp', 'Orchard', 'Tide', 'Fir', 'Golden', 'Cascade'],
};
const SECOND: Record<Region, readonly string[]> = {
  northeast: ['field', 'ford', 'bury', 'wick', 'ham', ' Harbor', ' Mills', 'ton', ' Hollow', 'bridge'],
  south: [' Grove', ' Springs', ' Bluff', ' Bayou', 'ville', ' Hollow', ' Creek', ' Landing', ' Ridge', ' Crossing'],
  midwest: [' Falls', ' Rapids', 'ton', ' Grove', ' Creek', 'field', ' Junction', ' Heights', ' Center', 'dale'],
  plains: [' Flats', ' Creek', ' Draw', ' Prairie', ' Bend', ' Crossing', ' Butte', ' Springs', ' Station', 'water'],
  mountain: [' Peak', ' Pass', ' Gulch', ' Ridge', ' Fork', ' Basin', ' Valley', ' Falls', ' Hollow', ' Creek'],
  desert: [' Wells', ' Springs', ' Verde', ' Flats', ' Vista', ' Wash', ' Ridge', ' Crossing', ' Valley', ' Butte'],
  pacific: [' Cove', ' Point', ' Heights', ' Valley', ' Landing', ' Bluff', ' Sound', ' Grove', ' Creek', ' Ridge'],
};
const MASCOTS = ['Wildcats', 'Stags', 'Hornets', 'Mustangs', 'Rams', 'Falcons', 'Bulldogs', 'Panthers', 'Rattlers', 'Owls', 'Miners', 'Lumberjacks', 'Comets', 'Mariners', 'Bison', 'Foxes', 'Ravens', 'Cougars', 'Thunder', 'Pioneers'] as const;
const hex = (jersey: number, helmet: number, pants: number, trim: number): TeamColors => ({ jersey, helmet, pants, trim });
const COLORS: readonly TeamColors[] = [
  hex(0x27307f, 0x27307f, 0xf2f2f2, 0xd8262c), hex(0x7a1f2b, 0xe8c547, 0xe8c547, 0xf2f2e9), hex(0x14532d, 0xf2f2f2, 0xf2f2f2, 0xf2c14e), hex(0x111111, 0xd97706, 0x111111, 0xd97706),
  hex(0x5b21b6, 0xf2c14e, 0xf2f2f2, 0xf2c14e), hex(0xb91c1c, 0xf2f2f2, 0xf2f2f2, 0x111111), hex(0x0e7490, 0x0e7490, 0xe5e7eb, 0x111111), hex(0x78350f, 0xfde68a, 0xfde68a, 0xf2f2f2),
  hex(0x1d4ed8, 0xf2f2f2, 0x1d4ed8, 0xfbbf24), hex(0xea580c, 0x1e293b, 0xf2f2f2, 0x1e293b), hex(0x4d7c0f, 0x111111, 0x111111, 0xf2f2f2), hex(0x9d174d, 0xe5e7eb, 0xe5e7eb, 0x111111),
];

export interface School {
  id: string;
  name: string;
  mascot: string;
  abbr: string;
  colors: TeamColors;
  /** Team strength this year, 54 to 62. Winning raises it for next year; everyone drifts back toward the middle. */
  prestige: number;
}

export interface League {
  seed: number;
  state: string;
  schools: School[];
}

/** Eight invented schools for a state. The same state and seed always give the same league. */
export function createLeague(stateCode: string, seed: number): League {
  const state = stateByCode(stateCode);
  const rng = Rng.stream(seed >>> 0, `league:${state.code}`);
  const pick = <T>(list: readonly T[], taken: Set<T>): T => {
    for (;;) {
      const x = list[rng.int(0, list.length - 1)];
      if (!taken.has(x)) {
        taken.add(x);
        return x;
      }
    }
  };
  const names = new Set<string>();
  const mascots = new Set<string>();
  const colors = new Set<TeamColors>();
  const abbrs = new Set<string>();
  const schools: School[] = [];
  for (let i = 0; i < LEAGUE_SIZE; i++) {
    let name = '';
    do name = `${FIRST[state.region][rng.int(0, FIRST[state.region].length - 1)]}${SECOND[state.region][rng.int(0, SECOND[state.region].length - 1)]}`;
    while (names.has(name));
    names.add(name);
    const mascot = pick(MASCOTS, mascots);
    const letters = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
    let abbr = (letters.length > 1 ? letters.map((w) => w[0]).join('') + mascot[0] : name.slice(0, 2) + mascot[0]).toUpperCase().slice(0, 3);
    for (let k = 1; abbrs.has(abbr); k++) abbr = (name.replace(/[^A-Za-z]/g, '').slice(0, 2) + String.fromCharCode(65 + ((mascot.charCodeAt(0) - 65 + k) % 26))).toUpperCase();
    abbrs.add(abbr);
    schools.push({ id: `sch_${state.code}_${i + 1}`, name, mascot, abbr, colors: pick(COLORS, colors), prestige: Math.round(PRESTIGE_MIN + 1 + rng.range(0, PRESTIGE_MAX - PRESTIGE_MIN - 2)) });
  }
  return { seed: seed >>> 0, state: state.code, schools };
}

/** What a commissioner may change about a school: what it is called and what it wears. Not how good it is. */
/** A school that needs a head coach: what you would be walking into. */
export interface Opening {
  school: number;
  /** Last season's wins and losses under the old coach. */
  lastRecord: [number, number];
  /** Why the job is open. */
  reason: string;
  /** What the school expects of the new coach. */
  expects: string;
}

/** How many of a league's eight schools are hiring when a dynasty starts. */
export const OPENINGS = 5;
const REASONS_GOOD = ['The coach retired after 24 seasons and three titles.', 'The coach left to be an assistant at a college.', 'The coach moved up to athletic director.', 'The coach took a bigger job two states away.'];
const REASONS_MID = ['The coach stepped down to spend Fridays with his family.', 'The coach retired. Nobody remembers a season without him.', 'The coach left to teach at the junior high.', 'The coach and the school board agreed it was time.'];
const REASONS_BAD = ['The coach was let go after another losing season.', 'The coach resigned in October. An assistant finished the year.', 'Three coaches in five years. They want someone who will stay.', 'The program nearly folded for lack of players. It is yours to rebuild.'];

/**
 * The head coaching jobs open in a league, strongest program first. Always the same five for the same league.
 * Last season's record follows the school's strength, so a powerhouse is hiring after a good year and a
 * rebuilding school after a bad one.
 */
export function openings(league: League): Opening[] {
  const rng = Rng.stream(league.seed, 'openings');
  const order = league.schools.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, OPENINGS).map((school) => {
    const p = league.schools[school].prestige;
    const wins = clamp(Math.round(3.5 + (p - PRESTIGE_MID) * 0.8 + rng.range(-1, 1)), 0, REGULAR_WEEKS);
    const tier = p >= 60 ? 0 : p >= 57 ? 1 : 2;
    const reason = rng.pick(tier === 0 ? REASONS_GOOD : tier === 1 ? REASONS_MID : REASONS_BAD);
    const expects = tier === 0 ? 'The boosters expect to play for the state title. Soon.' : tier === 1 ? 'A winning season and a shot at the title game would do.' : 'Patience. Three or four wins would feel like a parade.';
    return { school, lastRecord: [wins, REGULAR_WEEKS - wins] as [number, number], reason, expects };
  }).sort((a, b) => league.schools[b.school].prestige - league.schools[a.school].prestige || a.school - b.school);
}

export interface SchoolIdentity {
  name: string;
  mascot: string;
  abbr: string;
  colors: TeamColors;
}

const NAME_OK = /^[A-Za-z][A-Za-z '.-]{1,21}[A-Za-z.]$/;
const MASCOT_OK = /^[A-Za-z][A-Za-z '-]{1,15}[A-Za-z]$/;
const ABBR_OK = /^[A-Z]{2,4}$/;
const tidy = (x: unknown): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');

/** Checks a renamed or recoloured school. Returns the cleaned identity, or the reason it was refused. */
export function checkIdentity(raw: unknown, taken: readonly SchoolIdentity[] = []): { ok: true; value: SchoolIdentity } | { ok: false; problem: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = tidy(r['name']);
  const mascot = tidy(r['mascot']);
  const abbr = tidy(r['abbr']).toUpperCase();
  if (!NAME_OK.test(name)) return { ok: false, problem: 'A school name is 3 to 23 letters and spaces.' };
  if (!MASCOT_OK.test(mascot)) return { ok: false, problem: 'A mascot is 3 to 17 letters.' };
  if (!ABBR_OK.test(abbr)) return { ok: false, problem: 'The short name is 2 to 4 capital letters.' };
  const c = (r['colors'] ?? {}) as Record<string, unknown>;
  const colour = (k: string): number | null => (typeof c[k] === 'number' && Number.isInteger(c[k]) && (c[k] as number) >= 0 && (c[k] as number) <= 0xffffff ? (c[k] as number) : null);
  const [jersey, helmet, pants, trim] = [colour('jersey'), colour('helmet'), colour('pants'), colour('trim')];
  if (jersey === null || helmet === null || pants === null || trim === null) return { ok: false, problem: 'Choose all four colours.' };
  if (taken.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { ok: false, problem: 'Another school in the league has that name.' };
  if (taken.some((t) => t.abbr === abbr)) return { ok: false, problem: 'Another school in the league has that short name.' };
  return { ok: true, value: { name, mascot, abbr, colors: { jersey, helmet, pants, trim } } };
}

/** Renames or recolours one school. Its players, strength and results are untouched. Throws with the reason if refused. */
export function editSchool(league: League, school: number, raw: unknown): League {
  if (!Number.isInteger(school) || school < 0 || school >= league.schools.length) throw new Error('Choose a school.');
  const r = checkIdentity(raw, league.schools.filter((_, i) => i !== school));
  if (!r.ok) throw new Error(r.problem);
  return { ...league, schools: league.schools.map((s, i) => (i === school ? { ...s, ...r.value } : s)) };
}

/** Round robin by the circle method: seven weeks, four games a week, everyone plays everyone once. Pairs are [home, away]. */
export function schedule(): [number, number][][] {
  const ring = Array.from({ length: LEAGUE_SIZE }, (_, i) => i);
  const weeks: [number, number][][] = [];
  const homes = Array<number>(LEAGUE_SIZE).fill(0);
  for (let w = 0; w < REGULAR_WEEKS; w++) {
    const games: [number, number][] = [];
    for (let k = 0; k < LEAGUE_SIZE / 2; k++) {
      const a = ring[k];
      const b = ring[LEAGUE_SIZE - 1 - k];
      // Whoever has hosted less often hosts, so every school gets three or four home games.
      const aHome = homes[a] !== homes[b] ? homes[a] < homes[b] : (w + k) % 2 === 0;
      games.push(aHome ? [a, b] : [b, a]);
      homes[aHome ? a : b]++;
    }
    weeks.push(games);
    ring.splice(1, 0, ring.pop()!);
  }
  return weeks;
}

/** A night that is more than a game. */
export type Occasion = 'opener' | 'homecoming' | 'seniorNight' | 'championship' | null;

/**
 * What the night is for the home school. Its first home game is the home opener, its last is senior night and
 * the one in the middle is homecoming; the title game is its own occasion. Every school gets one of each.
 */
export function occasionFor(week: number, home: number): Occasion {
  if (week >= REGULAR_WEEKS) return 'championship';
  const weeks = schedule().map((games, w) => (games.some(([h]) => h === home) ? w : -1)).filter((w) => w >= 0);
  const at = weeks.indexOf(week);
  if (at < 0) return null;
  if (at === weeks.length - 1) return 'seniorNight';
  if (at === Math.floor(weeks.length / 2)) return 'homecoming';
  return at === 0 ? 'opener' : null;
}

export interface GameResult {
  /** 0 to 6 for the regular season; 7 is the championship. */
  week: number;
  home: number;
  away: number;
  score: [number, number];
}

export interface Dynasty {
  v: 1;
  league: League;
  /** The school the coach runs. */
  user: number;
  /** Season number, starting at 1. */
  year: number;
  /** The week about to be played: 0 to 6, 7 for the championship, 8 when the season is over. */
  week: number;
  results: GameResult[];
  setup: GameSetup;
  history: SeasonRecord[];
  /** Junior varsity players the coach has called up to the varsity. */
  callUps?: string[];
  /** This season's junior varsity scores, regular season only. */
  jv?: GameResult[];
  /** Player statistics and every school's record book. Kept by a solo dynasty from its first game. */
  stats?: StatBook;
  /** The awards voted at the end of each season, oldest first. */
  awards?: SeasonAwards[];
  /** What the coach's school worked on in spring practice before this season. */
  focus?: FocusId;
  /** Rating points the coach's players have lost or gained for good, by player id. */
  dev?: Record<string, number>;
  /** Rivalry games played in this dynasty, one entry per rivalry: wins for each side, ties, and who won last. */
  rivals?: RivalryLog[];
}

/** Rivals meet in the last week of the regular season, every year. */
export const RIVALRY_WEEK = REGULAR_WEEKS - 1;
/** What a dynasty has added to a rivalry. `w` is wins for the school that hosts in the schedule, wins for the other, ties. */
export interface RivalryLog {
  w: [number, number, number];
  /** 0 or 1: which of the two won the last meeting that had a winner. */
  holder?: 0 | 1;
}
export interface Rivalry {
  /** The two schools. */
  a: number;
  b: number;
  /** What they play for. */
  trophy: string;
  /** All-time: wins for `a`, wins for `b`, ties. Fifty years of history plus this dynasty. */
  series: [number, number, number];
  /** The school that holds the trophy. */
  holder: number;
}
const TROPHY_WHAT = ['Copper', 'Brass', 'Cedar', 'Mill', 'Harvest', 'Railroad', 'Quarry', 'Old County', 'River', 'Tin'];
const TROPHY_THING = ['Lantern', 'Whistle', 'Drum', 'Anvil', 'Kettle', 'Horseshoe', 'Milk Can', 'Weathervane', 'Signal Flag', 'Toolbox'];

/** The league's four rivalries, with the all-time series. Each pair meets in the season's last week. */
export function rivalries(d: Pick<Dynasty, 'league' | 'rivals'>): Rivalry[] {
  return schedule()[RIVALRY_WEEK].map(([a, b], k) => {
    // The years before the coach arrived: a long series, never far from level.
    const rng = Rng.stream(d.league.seed, `rivalry:${k}`);
    const played = rng.int(38, 61);
    const ties = rng.int(0, 3);
    const aWins = Math.round((played - ties) * (0.5 + rng.range(-0.12, 0.12)));
    const trophy = `the ${TROPHY_WHAT[rng.int(0, TROPHY_WHAT.length - 1)]} ${TROPHY_THING[rng.int(0, TROPHY_THING.length - 1)]}`;
    const before: 0 | 1 = rng.chance(0.5) ? 0 : 1;
    const log = d.rivals?.[k];
    const holder = (log?.holder ?? before) === 0 ? a : b;
    return { a, b, trophy, series: [aWins + (log?.w[0] ?? 0), played - ties - aWins + (log?.w[1] ?? 0), ties + (log?.w[2] ?? 0)], holder };
  });
}
/** A school's rival. */
export function rivalOf(school: number): number {
  const pair = schedule()[RIVALRY_WEEK].find(([a, b]) => a === school || b === school)!;
  return pair[0] === school ? pair[1] : pair[0];
}
/** True for the regular-season game between two rivals. */
export const isRivalryGame = (week: number, home: number, away: number): boolean => week === RIVALRY_WEEK && rivalOf(home) === away;

export interface SeasonRecord {
  year: number;
  champion: number;
  runnerUp: number;
  /** The coach's own wins, losses and ties, championship game included. */
  record: [number, number, number];
  /** Where the coach's school finished the regular season, 1 to 8. */
  place: number;
  /** The school he was coaching that year. Absent in seasons saved before a coach could change schools. */
  school?: number;
}

export function createDynasty(stateCode: string, seed: number, user: number, setup: Partial<GameSetup> = {}): Dynasty {
  return { v: 1, league: createLeague(stateCode, seed), user: clamp(Math.trunc(user), 0, LEAGUE_SIZE - 1), year: 1, week: 0, results: [], setup: cleanSetup({ ...DEFAULT_SETUP, ...setup }), history: [], callUps: [], jv: [] };
}

/** `week` is the game about to be played. Without it (a league with friends, for now) nobody is sidelined in season. */
type Rosters = Pick<Dynasty, 'league' | 'year'> & { user?: number; callUps?: string[]; week?: number; focus?: FocusId; dev?: Record<string, number> };
/** The coach's school does what he chose in the spring and carries his players' gains and losses; every other school's spring comes from the seed. */
const tuneOf = (d: Rosters, school: number): ProgramTune => (d.user === school ? { focus: d.focus, dev: d.dev } : { focus: seededFocus(d.league.seed, d.league.schools[school].id, d.year) });
const callUpsOf = (d: Rosters, school: number): readonly string[] => (d.user === school ? d.callUps ?? [] : []);

/** This year's varsity. Players age a class every season and graduate; a school's prestige lifts or drags the whole program. */
export function teamFor(d: Rosters, school: number, week: number | undefined = d.week): Team {
  return varsityTeam(d.league.seed, d.league.schools[school], d.year, callUpsOf(d, school), week, tuneOf(d, school));
}
/** The home side on the night: the crowd, the bus ride they did not take and their own field are worth a little to every player. */
function atHome(t: Team): Team {
  const edge = LEAGUE_TUNING.homeEdge;
  if (!edge) return t;
  const lift = (r: Ratings): Ratings => {
    const out = { ...r };
    for (const k of Object.keys(out) as (keyof Ratings)[]) if (k !== 'stamina') out[k] = Math.min(99, out[k] + edge);
    return out;
  };
  return { ...t, roster: t.roster.map((p, i) => (i % LEAGUE_TUNING.homeEvery === 0 ? { ...p, ratings: lift(p.ratings) } : p)) };
}
/** The two varsities for a game, home side first, as they play on the night. */
export function matchTeams(d: Rosters, home: number, away: number, week: number | undefined = d.week): [Team, Team] {
  return [atHome(teamFor(d, home, week)), teamFor(d, away, week)];
}
/** This year's junior varsity: everyone in the program who is not on the varsity. */
export function jvTeamFor(d: Rosters, school: number, week: number | undefined = d.week): Team {
  return jvTeam(d.league.seed, d.league.schools[school], d.year, callUpsOf(d, school), week, tuneOf(d, school));
}
/** Everyone in a school's program this season, marked varsity or junior varsity. */
export function programOf(d: Rosters, school: number): ProgramPlayer[] {
  return programFor(d.league.seed, d.league.schools[school], d.year, callUpsOf(d, school), d.week, tuneOf(d, school));
}
/** Next season's freshman class at a school. */
export function incomingOf(d: Rosters, school: number): ProgramPlayer[] {
  return incomingClass(d.league.seed, d.league.schools[school], d.year);
}

export interface LeagueNews extends ProgramNews {
  school: number;
}
/**
 * What has happened around the league's programs so far this season, newest first: fall camp (who walked on, who
 * transferred, who left), then injuries, ineligibility and suspensions after each week's games.
 */
export function leagueNews(d: Pick<Dynasty, 'league' | 'year' | 'week'>): LeagueNews[] {
  const out: LeagueNews[] = [];
  d.league.schools.forEach((s, school) => {
    for (const n of programNews(d.league.seed, s, d.year)) if (n.week < d.week) out.push({ ...n, school });
  });
  return out.sort((a, b) => b.week - a.week || a.school - b.school);
}

/** Calls a junior varsity player up to the varsity, or sends a called-up player back down. */
export function setCallUp(d: Dynasty, playerId: string, up: boolean): Dynasty {
  const now = (d.callUps ?? []).filter((id) => id !== playerId);
  if (up) {
    if (now.length >= MAX_CALL_UPS) throw new Error(`no more than ${MAX_CALL_UPS} call-ups at a time`);
    now.push(playerId);
  }
  return { ...d, callUps: cleanCallUps(d.league.seed, d.league.schools[d.user], d.year, now, tuneOf(d, d.user)) };
}

/** The junior varsity game between two schools in a week. They play the same opponent the varsity does. */
export function simulateJv(d: Dynasty, week: number, home: number, away: number): GameResult {
  const g = simulateGame(hashString(`${gameSeed(d, week, home, away)}:jv`), [jvTeamFor(d, home, week), jvTeamFor(d, away, week)], { setup: gameSetup(d, week, home, away) });
  return { week, home, away, score: [g.state.score[0], g.state.score[1]] };
}

export const gameSeed = (d: Pick<Dynasty, 'league' | 'year'>, week: number, home: number, away: number): number => hashString(`${d.league.seed}:${d.year}:${week}:${home}:${away}`);

export interface Standing {
  school: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** Regular-season table: most wins, then fewest losses, then point margin, then points scored, then school order. */
export function standings(results: readonly GameResult[]): Standing[] {
  const rows: Standing[] = Array.from({ length: LEAGUE_SIZE }, (_, school) => ({ school, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
  for (const g of results) {
    if (g.week >= REGULAR_WEEKS) continue;
    const [h, a] = [rows[g.home], rows[g.away]];
    h.pointsFor += g.score[0]; h.pointsAgainst += g.score[1];
    a.pointsFor += g.score[1]; a.pointsAgainst += g.score[0];
    if (g.score[0] > g.score[1]) { h.wins++; a.losses++; } else if (g.score[0] < g.score[1]) { a.wins++; h.losses++; } else { h.ties++; a.ties++; }
  }
  return rows.sort((x, y) => y.wins - x.wins || x.losses - y.losses || (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) || y.pointsFor - x.pointsFor || x.school - y.school);
}

/** The games of the week about to be played. The championship is first place at home to second. */
export function weekGames(d: Dynasty): [number, number][] {
  if (d.week < REGULAR_WEEKS) return schedule()[d.week];
  if (d.week === REGULAR_WEEKS) {
    const t = standings(d.results);
    return [[t[0].school, t[1].school]];
  }
  return [];
}

/** The coach's game this week as [home, away], or null when his school is not playing (a championship he missed). */
export function userGame(d: Dynasty): [number, number] | null {
  return weekGames(d).find(([h, a]) => h === d.user || a === d.user) ?? null;
}

/** Chance of each kind of weather by region: [rain, wind, snow late in the season, heat early in the season]. The rest is clear. */
const CLIMATE: Record<Region, readonly [number, number, number, number]> = {
  northeast: [0.2, 0.1, 0.25, 0.02], south: [0.2, 0.05, 0.01, 0.3], midwest: [0.15, 0.15, 0.25, 0.05], plains: [0.08, 0.3, 0.1, 0.15],
  mountain: [0.08, 0.15, 0.35, 0.03], desert: [0.03, 0.15, 0.01, 0.45], pacific: [0.3, 0.1, 0.03, 0.05],
};

/** The weather for one game: it depends on the state, the week and that game's own seed. Snow comes late, heat early. */
export function gameWeather(d: Pick<Dynasty, 'league' | 'year'>, week: number, home: number, away: number): Weather {
  const [rain, wind, snow, heat] = CLIMATE[stateByCode(d.league.state).region];
  const roll = Rng.stream(gameSeed(d, week, home, away), 'weather').range(0, 1);
  const late = week >= 4 ? snow : 0;
  const early = week <= 2 ? heat : 0;
  if (roll < rain) return 'rain';
  if (roll < rain + wind) return 'wind';
  if (roll < rain + wind + late) return 'snow';
  if (roll < rain + wind + late + early) return 'heat';
  return 'clear';
}

/** Quarter length is the dynasty's; the weather is that game's. */
export const gameSetup = (d: Dynasty, week: number, home: number, away: number): GameSetup => ({ quarterMinutes: d.setup.quarterMinutes, weather: gameWeather(d, week, home, away) });

/** The stat book a dynasty starts with: nothing played yet, and every school's records as the last fifty years left them. */
export function statsOf(d: Dynasty): StatBook {
  return d.stats ?? { season: {}, career: {}, news: [], books: d.league.schools.map((s) => historicBook(d.league.seed, s.id, s.prestige, d.setup.quarterMinutes)) };
}
/** Which school a program player belongs to, from his id. -1 for an id that is nobody's. */
export function schoolOfPlayer(d: Pick<Dynasty, 'league'>, id: string): number {
  return d.league.schools.findIndex((s) => id.startsWith(`${s.id}_c`));
}
/** Every program player's name in the league this season, by id. */
function nameBook(d: Dynasty): (id: string) => string {
  const names = new Map<string, string>();
  // Everyone who has been in a program this season, so a player who was hurt or left keeps his name on his numbers.
  for (let i = 0; i < LEAGUE_SIZE; i++) for (const [id, name] of programNames(d.league.seed, d.league.schools[i], d.year)) names.set(id, name);
  return (id) => names.get(id) ?? 'Unknown';
}
/** True for a player who will be back next season (anyone but a senior). */
const returning = (d: Dynasty, id: string): boolean => {
  const enrolled = enrolledIn(id);
  return enrolled !== null && d.year - enrolled + 1 < 4;
};

/**
 * The season's awards, voted from the statistics once the title game is played. Coach of the year goes to
 * the school that most outplayed its strength: a rebuilding school that wins five beats a powerhouse that wins six.
 */
export function seasonAwards(d: Dynasty, stats: StatBook): SeasonAwards {
  const players: Candidate[] = [];
  for (let i = 0; i < LEAGUE_SIZE; i++) {
    for (const p of programOf(d, i)) {
      const line = stats.season[p.id];
      if (line) players.push({ id: p.id, name: p.name, school: i, pos: p.pos, year: p.year, line });
    }
  }
  const table = standings(d.results);
  const wins = d.league.schools.map((_, i) => table.find((r) => r.school === i)!.wins);
  const expected = d.league.schools.map((s) => REGULAR_WEEKS / 2 + (s.prestige - PRESTIGE_MID) * 0.8);
  return voteAwards(d.year, players, wins, expected);
}

/** Plays a game between two schools and keeps its box score. */
export function simulateWithBox(d: Dynasty, week: number, home: number, away: number): { result: GameResult; box: BoxScore } {
  const g = simulateGame(gameSeed(d, week, home, away), matchTeams(d, home, away, week), { setup: gameSetup(d, week, home, away) });
  return { result: { week, home, away, score: [g.state.score[0], g.state.score[1]] }, box: boxScore(g.events) };
}

/**
 * Plays a finished game between two other schools again to get its play-by-play, for the game book. A league game is
 * its seed and its two rosters, so the replay is the game. Returns null for a game of the coach's own school (his
 * calls are not kept) or if the replay does not end on the recorded score.
 */
export function replayResult(d: Dynasty, g: GameResult): { events: PlayEvent[]; teams: [Team, Team] } | null {
  if (g.home === d.user || g.away === d.user) return null;
  const teams = matchTeams(d, g.home, g.away, g.week);
  const game = simulateGame(gameSeed(d, g.week, g.home, g.away), teams, { setup: gameSetup(d, g.week, g.home, g.away) });
  if (game.state.score[0] !== g.score[0] || game.state.score[1] !== g.score[1]) return null;
  return { events: [...game.events], teams };
}

export function simulate(d: Dynasty, week: number, home: number, away: number): GameResult {
  const g = simulateGame(gameSeed(d, week, home, away), matchTeams(d, home, away, week), { setup: gameSetup(d, week, home, away) });
  return { week, home, away, score: [g.state.score[0], g.state.score[1]] };
}

/** The championship cannot end level: a tie goes to the home team, which earned first place. */
export const winnerOf = (g: GameResult): number => (g.score[1] > g.score[0] ? g.away : g.home);

/** True when every game of the current week has a result. */
export function weekComplete(d: Dynasty): boolean {
  return d.week <= REGULAR_WEEKS && weekGames(d).every(([h, a]) => d.results.some((g) => g.week === d.week && g.home === h && g.away === a));
}

/** Adds one result for the current week. The game must be on this week's schedule and not already played. */
export function addResult(d: Dynasty, r: GameResult): Dynasty {
  if (d.week > REGULAR_WEEKS) throw new Error('the season is over');
  if (r.week !== d.week || !weekGames(d).some(([h, a]) => h === r.home && a === r.away)) throw new Error('that result is not for this week\'s game');
  if (d.results.some((g) => g.week === r.week && g.home === r.home && g.away === r.away)) throw new Error('that game has already been played');
  return { ...d, results: [...d.results, { week: r.week, home: r.home, away: r.away, score: [r.score[0], r.score[1]] }] };
}

/** Moves on to the next week once every game is in. After the championship it writes the season into the history. */
export function closeWeek(d: Dynasty): Dynasty {
  if (!weekComplete(d)) throw new Error('this week still has games to play');
  const next: Dynasty = { ...d, week: d.week + 1, history: [...d.history] };
  if (d.week === RIVALRY_WEEK) {
    // Rivalry week: each series gets its game.
    next.rivals = schedule()[RIVALRY_WEEK].map(([a, b], k) => {
      const log: RivalryLog = { w: [...(d.rivals?.[k]?.w ?? [0, 0, 0])] as [number, number, number], ...(d.rivals?.[k]?.holder !== undefined ? { holder: d.rivals[k].holder } : {}) };
      const g = d.results.find((r) => r.week === RIVALRY_WEEK && ((r.home === a && r.away === b) || (r.home === b && r.away === a)));
      if (!g) return log;
      const aScore = g.home === a ? g.score[0] : g.score[1];
      const bScore = g.home === a ? g.score[1] : g.score[0];
      if (aScore === bScore) log.w[2]++;
      else {
        log.w[aScore > bScore ? 0 : 1]++;
        log.holder = aScore > bScore ? 0 : 1;
      }
      return log;
    });
  }
  if (next.week > REGULAR_WEEKS) {
    const final = d.results[d.results.length - 1];
    const champion = winnerOf(final);
    const table = standings(d.results);
    next.history.push({ year: d.year, champion, runnerUp: champion === final.home ? final.away : final.home, record: recordOf(d.results, d.user), place: table.findIndex((r) => r.school === d.user) + 1, school: d.user });
  }
  return next;
}

/** One school's wins, losses and ties in a season, the championship game included (it always has a winner). */
export function recordOf(results: readonly GameResult[], school: number): [number, number, number] {
  const rec: [number, number, number] = [0, 0, 0];
  for (const g of results) {
    if (g.home !== school && g.away !== school) continue;
    const us = g.home === school ? g.score[0] : g.score[1];
    const them = g.home === school ? g.score[1] : g.score[0];
    if (g.week === REGULAR_WEEKS) rec[winnerOf(g) === school ? 0 : 1]++;
    else rec[us > them ? 0 : us < them ? 1 : 2]++;
  }
  return rec;
}

/**
 * Plays out the current week. `mine` is the result of the coach's own game when he played it, and `mineBox`
 * its box score; leave them out to have the AI coach his team too. Every game's numbers go into the season
 * statistics and are checked against the record books. Returns a new dynasty; the input is not changed.
 */
export function playWeek(d: Dynasty, mine?: GameResult, mineBox?: BoxScore): Dynasty {
  if (d.week > REGULAR_WEEKS) throw new Error('the season is over');
  const own = userGame(d);
  if (mine && (!own || mine.home !== own[0] || mine.away !== own[1] || mine.week !== d.week)) throw new Error('that result is not for this week\'s game');
  let next = d;
  let stats = statsOf(d);
  const names = nameBook(d);
  for (const [h, a] of weekGames(d)) {
    const isMine = !!(mine && own && h === own[0] && a === own[1]);
    const played = isMine ? null : simulateWithBox(d, d.week, h, a);
    next = addResult(next, isMine ? mine! : played!.result);
    const box = isMine ? mineBox : played!.box;
    if (box) stats = recordGame(stats, box, [h, a], [d.league.schools[h].name, d.league.schools[a].name], names, d.year, d.week).stats;
  }
  // When the title game is over the season and career records are settled. The season's numbers stay on show until next year starts.
  if (d.week === REGULAR_WEEKS) {
    const settled = closeSeason(stats, (id) => schoolOfPlayer(d, id), names, (id) => returning(d, id), d.year).stats;
    stats = { ...stats, books: settled.books, news: settled.news };
    next = { ...next, awards: [...(d.awards ?? []).filter((a) => a.year !== d.year), seasonAwards(d, stats)] };
  }
  next = { ...next, stats };
  // The junior varsity plays the same schedule through the regular season.
  if (d.week < REGULAR_WEEKS) next = { ...next, jv: [...(d.jv ?? []), ...weekGames(d).map(([h, a]) => simulateJv(d, d.week, h, a))] };
  return closeWeek(next);
}

/** Starts the next season: winners gain prestige, everyone drifts toward the middle, and a little luck shuffles the order. */
/** The most a player can fall behind from seasons spent called up before he had earned it. */
export const CALL_UP_COST_MAX = 3;

/**
 * Starts the next season. `focus` is what the coach's school worked on in spring practice. A player who ended the
 * season still needing the coach's call to be on the varsity spent the year standing behind older players instead of
 * playing every Thursday: he comes back a rating point short of where he would have been, for good.
 */
export function nextSeason(d: Dynasty, focus?: FocusId): Dynasty {
  if (d.week <= REGULAR_WEEKS) throw new Error('the season is not over');
  const table = standings(d.results);
  const champion = d.history[d.history.length - 1].champion;
  const rng = Rng.stream(d.league.seed, `offseason:${d.year}`);
  const schools = d.league.schools.map((s, i) => {
    const row = table.find((r) => r.school === i)!;
    // Beating your rival is worth a little on its own: kids want to play for the school that holds the trophy.
    const rivalGame = d.results.find((g) => isRivalryGame(g.week, g.home, g.away) && (g.home === i || g.away === i));
    const beatRival = !!rivalGame && (rivalGame.home === i ? rivalGame.score[0] > rivalGame.score[1] : rivalGame.score[1] > rivalGame.score[0]);
    const earned = (row.wins - row.losses) * 0.15 + (i === champion ? 0.5 : 0) + (beatRival ? 0.15 : 0);
    const drift = (PRESTIGE_MID - s.prestige) * 0.6;
    return { ...s, prestige: clamp(Math.round((s.prestige + earned + drift + rng.range(-2.5, 2.5)) * 10) / 10, PRESTIGE_MIN, PRESTIGE_MAX) };
  });
  // Seniors graduate, everyone moves up a class and a new freshman class arrives. Call-ups who earned a place no longer need the call.
  const moved: Dynasty = { ...d, league: { ...d.league, schools }, year: d.year + 1, week: 0, results: [], jv: [] };
  // Last season's numbers go into each returning player's career line.
  if (d.stats) moved.stats = closeSeason(d.stats, (id) => schoolOfPlayer(d, id), nameBook(d), (id) => returning(d, id), d.year).stats;
  const dev: Record<string, number> = {};
  for (const [id, v] of Object.entries(d.dev ?? {})) {
    const enrolled = enrolledIn(id);
    if (enrolled !== null && moved.year - enrolled + 1 <= 4 && v !== 0) dev[id] = v;
  }
  for (const id of cleanCallUps(d.league.seed, d.league.schools[d.user], d.year, d.callUps ?? [], tuneOf(d, d.user))) dev[id] = Math.max(-CALL_UP_COST_MAX, (dev[id] ?? 0) - 1);
  const out: Dynasty = { ...moved };
  delete out.focus;
  delete out.dev;
  if (isFocus(focus)) out.focus = focus;
  if (Object.keys(dev).length) out.dev = dev;
  return { ...out, callUps: cleanCallUps(out.league.seed, schools[d.user], out.year, d.callUps ?? [], tuneOf(out, d.user)) };
}

/** Career totals across every finished season. */
export function career(d: Dynasty): { seasons: number; wins: number; losses: number; ties: number; championships: number } {
  const c = { seasons: d.history.length, wins: 0, losses: 0, ties: 0, championships: 0 };
  for (const h of d.history) {
    c.wins += h.record[0]; c.losses += h.record[1]; c.ties += h.record[2];
    if (h.champion === (h.school ?? d.user)) c.championships++;
  }
  return c;
}

/** Checks a saved dynasty before it is used. Anything that does not hold together is thrown away. */
/** Saved player gains and losses: program-player ids with a whole number of points, at most a few each. */
function cleanDev(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (enrolledIn(id) !== null && Number.isInteger(v) && (v as number) >= -CALL_UP_COST_MAX && (v as number) <= CALL_UP_COST_MAX && v !== 0) out[id] = v as number;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A saved rivalry log, kept only if it is the right shape: one entry per rivalry, sensible counts. */
function cleanRivals(raw: unknown[]): RivalryLog[] {
  return Array.from({ length: LEAGUE_SIZE / 2 }, (_, k) => {
    const r = raw[k] as RivalryLog | undefined;
    const n = (x: unknown): number => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < 1000 ? (x as number) : 0);
    const w = Array.isArray(r?.w) ? r.w : [];
    return { w: [n(w[0]), n(w[1]), n(w[2])], ...(r?.holder === 0 || r?.holder === 1 ? { holder: r.holder } : {}) };
  });
}

export function loadDynasty(raw: unknown): Dynasty | null {
  try {
    const d = raw as Dynasty;
    if (!d || d.v !== 1 || !d.league || !Array.isArray(d.league.schools) || d.league.schools.length !== LEAGUE_SIZE) return null;
    if (!Number.isInteger(d.user) || d.user < 0 || d.user >= LEAGUE_SIZE || !Number.isInteger(d.year) || d.year < 1 || !Number.isInteger(d.week) || d.week < 0 || d.week > REGULAR_WEEKS + 1) return null;
    if (!Array.isArray(d.results) || !Array.isArray(d.history)) return null;
    const base = createLeague(d.league.state, d.league.seed);
    // Strength is kept within its range. A name or colours the coach changed are kept only if they still pass the checks.
    let schools = base.schools.map((s, i) => ({ ...s, prestige: clamp(Number(d.league.schools[i]?.prestige) || s.prestige, PRESTIGE_MIN, PRESTIGE_MAX) }));
    for (let i = 0; i < LEAGUE_SIZE; i++) {
      const r = checkIdentity(d.league.schools[i], schools.filter((_, k) => k !== i));
      if (r.ok) schools = schools.map((s, k) => (k === i ? { ...s, ...r.value } : s));
    }
    const results: GameResult[] = [];
    for (const g of d.results) {
      const ok = Number.isInteger(g.week) && g.week >= 0 && g.week <= REGULAR_WEEKS && Number.isInteger(g.home) && Number.isInteger(g.away) && g.home !== g.away
        && g.home >= 0 && g.home < LEAGUE_SIZE && g.away >= 0 && g.away < LEAGUE_SIZE && Array.isArray(g.score) && g.score.every((x) => Number.isInteger(x) && x >= 0 && x < 200);
      if (!ok) return null;
      results.push({ week: g.week, home: g.home, away: g.away, score: [g.score[0], g.score[1]] });
    }
    const expected = Math.min(d.week, REGULAR_WEEKS) * (LEAGUE_SIZE / 2) + (d.week > REGULAR_WEEKS ? 1 : 0);
    if (results.length !== expected) return null;
    const jv: GameResult[] = [];
    for (const g of Array.isArray(d.jv) ? d.jv : []) {
      const ok = g && Number.isInteger(g.week) && g.week >= 0 && g.week < REGULAR_WEEKS && Number.isInteger(g.home) && Number.isInteger(g.away) && g.home !== g.away
        && g.home >= 0 && g.home < LEAGUE_SIZE && g.away >= 0 && g.away < LEAGUE_SIZE && Array.isArray(g.score) && g.score.every((x) => Number.isInteger(x) && x >= 0 && x < 200);
      if (ok && jv.length < REGULAR_WEEKS * (LEAGUE_SIZE / 2)) jv.push({ week: g.week, home: g.home, away: g.away, score: [g.score[0], g.score[1]] });
    }
    return {
      v: 1, league: { seed: base.seed, state: base.state, schools }, user: d.user, year: d.year, week: d.week, results, setup: cleanSetup(d.setup), history: d.history.filter((h) => h && Number.isInteger(h.year) && Array.isArray(h.record)),
      ...(isFocus(d.focus) ? { focus: d.focus } : {}), ...(cleanDev(d.dev) ? { dev: cleanDev(d.dev) } : {}),
      callUps: cleanCallUps(base.seed, schools[d.user], d.year, d.callUps, { focus: isFocus(d.focus) ? d.focus : undefined, dev: cleanDev(d.dev) }), jv,
      ...(d.awards ? { awards: cleanAwards(d.awards, LEAGUE_SIZE) } : {}),
      ...(Array.isArray(d.rivals) ? { rivals: cleanRivals(d.rivals) } : {}),
      ...(d.stats ? { stats: cleanStatBook(d.stats, schools.map((s) => historicBook(base.seed, s.id, s.prestige, cleanSetup(d.setup).quarterMinutes))) } : {}),
    };
  } catch {
    return null;
  }
}

export { FOCUSES, isFocus, type FocusId } from './program';
export { CLASS_NAMES, CLASS_SHORT, LEAGUE_TUNING, MAX_CALL_UPS, OUT_FOR_GOOD, OUT_FOR_SEASON, enrolledIn, incidentsOf, type Incident, type ProgramNews, type ProgramPlayer } from './program';
export * from './stats';
export * from './records';
export * from './awards';
export * from './gamebook';
export * from './paper';
export * from './offseason';
