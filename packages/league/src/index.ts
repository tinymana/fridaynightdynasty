import { DEFAULT_SETUP, Rng, clamp, cleanSetup, generateTeam, hashString, type GameSetup, type Team, type TeamColors, type Weather } from '@fnd/core';
import { simulateGame } from '@fnd/match-sim';

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
}

export interface SeasonRecord {
  year: number;
  champion: number;
  runnerUp: number;
  /** The coach's own wins, losses and ties, championship game included. */
  record: [number, number, number];
  /** Where the coach's school finished the regular season, 1 to 8. */
  place: number;
}

export function createDynasty(stateCode: string, seed: number, user: number, setup: Partial<GameSetup> = {}): Dynasty {
  return { v: 1, league: createLeague(stateCode, seed), user: clamp(Math.trunc(user), 0, LEAGUE_SIZE - 1), year: 1, week: 0, results: [], setup: cleanSetup({ ...DEFAULT_SETUP, ...setup }), history: [] };
}

/** This year's rosters. A school's players change every year; its strength follows its prestige. */
export function teamFor(d: Pick<Dynasty, 'league' | 'year'>, school: number): Team {
  const s = d.league.schools[school];
  const counter = { next: school * 1000 + 1 };
  return generateTeam(hashString(`${d.league.seed}:${d.year}:${s.id}`), s.id, { name: s.name, mascot: s.mascot, abbr: s.abbr, colors: s.colors, strength: s.prestige }, counter);
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

export function simulate(d: Dynasty, week: number, home: number, away: number): GameResult {
  const g = simulateGame(gameSeed(d, week, home, away), [teamFor(d, home), teamFor(d, away)], { setup: gameSetup(d, week, home, away) });
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
  if (next.week > REGULAR_WEEKS) {
    const final = d.results[d.results.length - 1];
    const champion = winnerOf(final);
    const table = standings(d.results);
    next.history.push({ year: d.year, champion, runnerUp: champion === final.home ? final.away : final.home, record: recordOf(d.results, d.user), place: table.findIndex((r) => r.school === d.user) + 1 });
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
 * Plays out the current week. `mine` is the result of the coach's own game when he played it;
 * leave it out to have the AI coach his team too. Returns a new dynasty; the input is not changed.
 */
export function playWeek(d: Dynasty, mine?: GameResult): Dynasty {
  if (d.week > REGULAR_WEEKS) throw new Error('the season is over');
  const own = userGame(d);
  if (mine && (!own || mine.home !== own[0] || mine.away !== own[1] || mine.week !== d.week)) throw new Error('that result is not for this week\'s game');
  let next = d;
  for (const [h, a] of weekGames(d)) next = addResult(next, mine && own && h === own[0] && a === own[1] ? mine : simulate(d, d.week, h, a));
  return closeWeek(next);
}

/** Starts the next season: winners gain prestige, everyone drifts toward the middle, and a little luck shuffles the order. */
export function nextSeason(d: Dynasty): Dynasty {
  if (d.week <= REGULAR_WEEKS) throw new Error('the season is not over');
  const table = standings(d.results);
  const champion = d.history[d.history.length - 1].champion;
  const rng = Rng.stream(d.league.seed, `offseason:${d.year}`);
  const schools = d.league.schools.map((s, i) => {
    const row = table.find((r) => r.school === i)!;
    const earned = (row.wins - row.losses) * 0.15 + (i === champion ? 0.5 : 0);
    const drift = (PRESTIGE_MID - s.prestige) * 0.4;
    return { ...s, prestige: clamp(Math.round((s.prestige + earned + drift + rng.range(-2, 2)) * 10) / 10, PRESTIGE_MIN, PRESTIGE_MAX) };
  });
  return { ...d, league: { ...d.league, schools }, year: d.year + 1, week: 0, results: [] };
}

/** Career totals across every finished season. */
export function career(d: Dynasty): { seasons: number; wins: number; losses: number; ties: number; championships: number } {
  const c = { seasons: d.history.length, wins: 0, losses: 0, ties: 0, championships: 0 };
  for (const h of d.history) {
    c.wins += h.record[0]; c.losses += h.record[1]; c.ties += h.record[2];
    if (h.champion === d.user) c.championships++;
  }
  return c;
}

/** Checks a saved dynasty before it is used. Anything that does not hold together is thrown away. */
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
    return { v: 1, league: { seed: base.seed, state: base.state, schools }, user: d.user, year: d.year, week: d.week, results, setup: cleanSetup(d.setup), history: d.history.filter((h) => h && Number.isInteger(h.year) && Array.isArray(h.record)) };
  } catch {
    return null;
  }
}
