import { Rng, hashString, rollName } from '@fnd/core';
import { STAT_KEYS, addLine, emptyLine, type BoxScore, type StatKey, type StatLine } from './stats';

/**
 * School record books. Every school has records for a single game, a season and a career, and they come
 * with a history: when a dynasty starts the book is already full of names from years gone by, so a record
 * has to be taken from somebody.
 */

export type RecordScope = 'game' | 'season' | 'career';
export const RECORD_SCOPES: readonly RecordScope[] = ['game', 'season', 'career'];

export interface RecordDef {
  key: StatKey;
  /** As it reads in the book: "Rushing yards". */
  label: string;
  /** As it reads in a sentence: "rushing yards". */
  unit: string;
  /** The standing record at an average school with twelve-minute quarters. */
  base: Record<RecordScope, number>;
}

export const RECORD_DEFS: readonly RecordDef[] = [
  { key: 'passYds', label: 'Passing yards', unit: 'passing yards', base: { game: 330, season: 1750, career: 4200 } },
  { key: 'passTd', label: 'Touchdown passes', unit: 'touchdown passes', base: { game: 5, season: 15, career: 34 } },
  { key: 'rushYds', label: 'Rushing yards', unit: 'rushing yards', base: { game: 255, season: 1150, career: 2700 } },
  { key: 'rushTd', label: 'Rushing touchdowns', unit: 'rushing touchdowns', base: { game: 4, season: 11, career: 24 } },
  { key: 'rec', label: 'Receptions', unit: 'catches', base: { game: 11, season: 52, career: 120 } },
  { key: 'recYds', label: 'Receiving yards', unit: 'receiving yards', base: { game: 180, season: 820, career: 1900 } },
  { key: 'recTd', label: 'Touchdown catches', unit: 'touchdown catches', base: { game: 4, season: 9, career: 18 } },
  { key: 'tackles', label: 'Tackles', unit: 'tackles', base: { game: 16, season: 88, career: 205 } },
  { key: 'sacks', label: 'Sacks', unit: 'sacks', base: { game: 3, season: 10, career: 22 } },
  { key: 'ints', label: 'Interceptions', unit: 'interceptions', base: { game: 3, season: 7, career: 15 } },
];
/** The team's own mark: most points in a game. */
export const TEAM_POINTS_BASE = 52;

export interface RecordEntry {
  value: number;
  /** Who holds it. For the team record, the opponent it was set against. */
  name: string;
  /** Calendar year of the season. */
  year: number;
}
/** One school's book, keyed `scope:stat` (and `game:teamPoints`). */
export type RecordBook = Record<string, RecordEntry>;

/** Dynasty season 1 is played in this calendar year. */
export const FIRST_SEASON = 2026;
export const seasonYear = (year: number): number => FIRST_SEASON - 1 + year;

/** The book a school has on the day the new coach arrives: fifty years of names. */
export function historicBook(leagueSeed: number, schoolId: string, prestige: number, quarterMinutes: number): RecordBook {
  const rng = Rng.stream(hashString(`${leagueSeed}:${schoolId}`), 'records');
  // Shorter quarters mean smaller numbers; a stronger program has had better players.
  const scale = (quarterMinutes / 12) * (1 + (prestige - 58) * 0.012);
  const book: RecordBook = {};
  for (const def of RECORD_DEFS) {
    // The same great player often holds more than one line.
    const star = { name: rollName(rng), year: rng.int(FIRST_SEASON - 50, FIRST_SEASON - 2) };
    for (const scope of RECORD_SCOPES) {
      const own = rng.chance(0.55);
      const holder = own ? star : { name: rollName(rng), year: rng.int(FIRST_SEASON - 50, FIRST_SEASON - 1) };
      const floor = scope === 'game' ? 2 : scope === 'season' ? 4 : 8;
      book[`${scope}:${def.key}`] = { value: Math.max(floor, Math.round(def.base[scope] * scale * rng.range(0.84, 1.06))), name: holder.name, year: holder.year + (scope === 'career' ? 1 : 0) };
    }
  }
  book['game:teamPoints'] = { value: Math.max(14, Math.round(TEAM_POINTS_BASE * scale * rng.range(0.86, 1.08))), name: '', year: rng.int(FIRST_SEASON - 50, FIRST_SEASON - 1) };
  return book;
}

/** A record that fell. */
export interface RecordNews {
  school: number;
  scope: RecordScope;
  key: StatKey | 'teamPoints';
  label: string;
  unit: string;
  value: number;
  name: string;
  year: number;
  /** The mark that was beaten and who held it. */
  old: RecordEntry;
  /** Regular-season week (7 for the title game); -1 for season and career marks, settled when the season ends. */
  week: number;
}

/** Reads like the PA announcer: who, how many, and whose record it was. */
export function newsText(n: RecordNews, schoolName: string): string {
  const was = n.old.name ? `${n.old.name}'s ${n.old.value} from ${n.old.year}` : `${n.old.value} from ${n.old.year}`;
  if (n.key === 'teamPoints') return `${schoolName} scored ${n.value} points against ${n.name}, the most in school history. The record was ${was}.`;
  const span = n.scope === 'game' ? 'in a game' : n.scope === 'season' ? 'in a season' : 'in a career';
  return `${n.name} set the ${schoolName} record for ${n.unit} ${span} with ${n.value}, passing ${was}.`;
}

export interface StatBook {
  /** This season's lines for every player in the league who has played, by player id. */
  season: Record<string, StatLine>;
  /** Earlier seasons' totals for players still in school. */
  career: Record<string, StatLine>;
  /** One record book per school. */
  books: RecordBook[];
  /** Records that have fallen, newest first. */
  news: RecordNews[];
}

const NEWS_KEPT = 40;

/** Beats the book? Then write it in and report it. A tie does not take a record. */
function challenge(book: RecordBook, school: number, scope: RecordScope, def: { key: StatKey | 'teamPoints'; label: string; unit: string }, value: number, name: string, year: number, week: number, out: RecordNews[]): void {
  const k = `${scope}:${def.key}`;
  const old = book[k];
  if (!old || value <= old.value) return;
  book[k] = { value, name, year };
  out.push({ school, scope, key: def.key, label: def.label, unit: def.unit, value, name, year, old, week });
}

/**
 * Adds one game to the season and checks the single-game records of both schools.
 * `schools` are the league indexes of the home and away teams; `names` gives a player's name from his id.
 * Returns a new stat book and the records that fell.
 */
export function recordGame(stats: StatBook, box: BoxScore, schools: readonly [number, number], schoolNames: readonly [string, string], names: (id: string) => string, year: number, week: number): { stats: StatBook; fell: RecordNews[] } {
  const season = { ...stats.season };
  const books = stats.books.map((b) => ({ ...b }));
  const fell: RecordNews[] = [];
  for (const t of [0, 1] as const) {
    const book = books[schools[t]];
    for (const [id, line] of Object.entries(box.players[t])) {
      season[id] = addLine(season[id] ?? emptyLine(), line);
      for (const def of RECORD_DEFS) challenge(book, schools[t], 'game', def, line[def.key], names(id), seasonYear(year), week, fell);
    }
    challenge(book, schools[t], 'game', { key: 'teamPoints', label: 'Points in a game', unit: 'points' }, box.teams[t].points, schoolNames[1 - t], seasonYear(year), week, fell);
  }
  return { stats: { season, career: stats.career, books, news: [...fell, ...stats.news].slice(0, NEWS_KEPT) }, fell };
}

/**
 * The season is over: settle the season and career records, then turn the page.
 * `schoolOf` gives a player's school from his id; `staying` says whether he will be back next year.
 */
export function closeSeason(stats: StatBook, schoolOf: (id: string) => number, names: (id: string) => string, staying: (id: string) => boolean, year: number): { stats: StatBook; fell: RecordNews[] } {
  const books = stats.books.map((b) => ({ ...b }));
  const fell: RecordNews[] = [];
  const career: Record<string, StatLine> = {};
  const ids = Object.keys(stats.season).sort();
  for (const id of ids) {
    const school = schoolOf(id);
    if (school < 0) continue;
    const line = stats.season[id];
    const total = addLine(stats.career[id] ?? emptyLine(), line);
    for (const def of RECORD_DEFS) {
      challenge(books[school], school, 'season', def, line[def.key], names(id), seasonYear(year), -1, fell);
      challenge(books[school], school, 'career', def, total[def.key], names(id), seasonYear(year), -1, fell);
    }
    if (staying(id)) career[id] = total;
  }
  // A player who sat out the season keeps his earlier numbers.
  for (const id of Object.keys(stats.career)) if (!career[id] && !stats.season[id] && staying(id)) career[id] = stats.career[id];
  return { stats: { season: {}, career, books, news: [...fell, ...stats.news].slice(0, NEWS_KEPT) }, fell };
}

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-9999, Math.min(99999, Math.round(x))) : 0);
function cleanLines(raw: unknown, cap: number): Record<string, StatLine> {
  const out: Record<string, StatLine> = {};
  if (!raw || typeof raw !== 'object') return out;
  let n = 0;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n++ >= cap || !v || typeof v !== 'object' || id.length > 40) continue;
    const line = emptyLine();
    for (const k of STAT_KEYS) line[k] = num((v as Record<string, unknown>)[k]);
    out[id] = line;
  }
  return out;
}

/** Checks a saved stat book. Anything missing or broken is rebuilt from the school's historic book. */
export function cleanStatBook(raw: unknown, fresh: RecordBook[]): StatBook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StatBook>;
  const books = fresh.map((base, i) => {
    const saved = Array.isArray(r.books) ? r.books[i] : null;
    const book: RecordBook = {};
    for (const k of Object.keys(base)) {
      const e = saved && typeof saved === 'object' ? (saved as RecordBook)[k] : null;
      const ok = e && typeof e === 'object' && typeof e.name === 'string' && e.name.length <= 40 && num(e.value) > 0 && num(e.year) > 1900;
      book[k] = ok ? { value: num(e.value), name: e.name.replace(/[<>&"]/g, ''), year: num(e.year) } : base[k];
    }
    return book;
  });
  const news: RecordNews[] = [];
  for (const n of Array.isArray(r.news) ? r.news.slice(0, NEWS_KEPT) : []) {
    if (!n || typeof n !== 'object' || typeof n.name !== 'string' || typeof n.label !== 'string' || typeof n.unit !== 'string' || !n.old || typeof n.old.name !== 'string') continue;
    if (!RECORD_SCOPES.includes(n.scope) || !(n.key === 'teamPoints' || STAT_KEYS.includes(n.key))) continue;
    const strip = (s: string): string => s.replace(/[<>&"]/g, '').slice(0, 40);
    news.push({ school: Math.max(0, Math.min(fresh.length - 1, num(n.school))), scope: n.scope, key: n.key, label: strip(n.label), unit: strip(n.unit), value: num(n.value), name: strip(n.name), year: num(n.year), old: { value: num(n.old.value), name: strip(n.old.name), year: num(n.old.year) }, week: num(n.week) });
  }
  return { season: cleanLines(r.season, 1200), career: cleanLines(r.career, 1200), books, news };
}
