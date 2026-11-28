/**
 * The save file: everything a coach would want back on another device. One shape for the copy kept on the server
 * and for the file he can download. Whatever is read back is checked again piece by piece before it is used.
 */
import { DEFAULT_BOOK, MAX_CUSTOM_DEFENSES, MAX_CUSTOM_PLAYS, validateBook, validateDefPlay, validateOffPlay, type DefPlay, type OffPlay } from '@fnd/core';
import { REGULAR_WEEKS, lastWeek, loadDynasty, seasonOver, type Dynasty } from '@fnd/league';

export interface SaveFile {
  fnd: 'save';
  v: 1;
  /** When it was written, in milliseconds. */
  at: number;
  label: string;
  dynasty: Dynasty | null;
  plays: OffPlay[];
  defs: DefPlay[];
  book: string[];
  /** The calls of the coach's own recent dynasty games, so their game books follow him to another device. */
  games?: KeptGame[];
}

/** One kept game: where it is filed, and what is needed to play it again. */
export interface KeptGame {
  key: string;
  book: { seed: number; log: unknown[]; opts: Record<string, unknown> };
}

export interface SaveContents {
  dynasty: Dynasty | null;
  plays: OffPlay[];
  defs: DefPlay[];
  book: string[];
  games: KeptGame[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One line a coach can recognise a save by. */
export function saveLabel(c: SaveContents): string {
  const designs = c.plays.length + c.defs.length;
  const d = c.dynasty;
  if (!d) return designs ? `No dynasty; ${plural(designs, 'design', 'designs')} in the playbook` : 'Nothing saved yet';
  const s = d.league.schools[d.user];
  const when = seasonOver(d) ? 'season over' : d.week === lastWeek(d) ? 'championship week' : d.week === REGULAR_WEEKS ? 'semifinal week' : `week ${d.week + 1}`;
  return `${s.name} ${s.mascot}, year ${d.year}, ${when}${designs ? `; ${plural(designs, 'design', 'designs')}` : ''}`;
}

export function makeSave(c: SaveContents, at: number): SaveFile {
  return { fnd: 'save', v: 1, at, label: saveLabel(c), dynasty: c.dynasty, plays: c.plays, defs: c.defs, book: c.book, games: cleanGames(c.games) };
}

/** How many of the coach's own games are kept, and how much room they may take in a save. */
export const MAX_KEPT_GAMES = 12;
const MAX_KEPT_BYTES = 600_000;

/**
 * Keeps only kept games that have the right shape, the newest twelve, within the room allowed. What is inside a
 * game is not trusted either: it is only ever replayed, and a replay that fails or gives another score is thrown away.
 */
export function cleanGames(raw: unknown): KeptGame[] {
  if (!Array.isArray(raw)) return [];
  const out: KeptGame[] = [];
  let room = MAX_KEPT_BYTES;
  for (const g of raw.slice(-MAX_KEPT_GAMES).reverse()) {
    const k = g as Partial<KeptGame> | null;
    const b = k?.book;
    if (!k || typeof k.key !== 'string' || k.key.length > 80 || !b || typeof b !== 'object' || !Number.isFinite(b.seed) || !Array.isArray(b.log) || b.log.length > 2000 || !b.opts || typeof b.opts !== 'object') continue;
    const size = JSON.stringify(b).length;
    if (size > room) break;
    room -= size;
    out.unshift({ key: k.key, book: { seed: b.seed, log: b.log, opts: b.opts } });
  }
  return out;
}

function checked<T>(raw: unknown, max: number, check: (x: unknown) => { ok: true; value: T } | { ok: false }): T[] {
  const out: T[] = [];
  if (!Array.isArray(raw)) return out;
  for (const x of raw.slice(0, max)) {
    const r = check(x);
    if (r.ok) out.push(r.value);
  }
  return out;
}

/** Reads a save back. Returns null if it is not one of ours; anything inside that does not pass its checks is dropped. */
export function readSave(raw: unknown): SaveContents | null {
  const s = raw as Partial<SaveFile> | null;
  if (!s || typeof s !== 'object' || s.fnd !== 'save' || s.v !== 1) return null;
  const plays = checked(s.plays, MAX_CUSTOM_PLAYS, validateOffPlay);
  const defs = checked(s.defs, MAX_CUSTOM_DEFENSES, validateDefPlay);
  const book = Array.isArray(s.book) && s.book.every((x) => typeof x === 'string') && validateBook(s.book, plays) === null ? [...s.book] : [...DEFAULT_BOOK];
  return { dynasty: s.dynasty ? loadDynasty(s.dynasty) : null, plays, defs, book, games: cleanGames(s.games) };
}

/** A file name for the download: lower case, no spaces. */
export function saveFileName(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `friday-night-dynasty-${slug || 'save'}.json`;
}
