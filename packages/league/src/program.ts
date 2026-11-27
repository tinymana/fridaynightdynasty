import { GROUPS, ROSTER_SIZE, Rng, clamp, hashString, numberRange, overall, rollName, rollRatings, type Group, type Player, type RatingKey, type Ratings, type Team, type TeamColors } from '@fnd/core';

/**
 * A school's football program: four classes of players who age from freshman to senior.
 *
 * Nothing here is stored. A class is generated from the league seed, the school and the year the class
 * enrolled, so the same boy turns up a year older every season until he graduates, on every browser and
 * on the server alike. The varsity plays on Friday; everyone else is the junior varsity.
 */

export const CLASS_NAMES = ['Freshman', 'Sophomore', 'Junior', 'Senior'] as const;
export const CLASS_SHORT = ['Fr', 'So', 'Jr', 'Sr'] as const;

/** Players per position in each class. Every class also brings one kicker or one punter, turn about. */
const CLASS_GROUPS: Record<Group, number> = { QB: 1, RB: 2, WR: 3, TE: 1, OL: 4, DL: 3, LB: 3, CB: 2, S: 2, K: 0, P: 0 };
/** Senior-year level of an average player at an average school. Set so a varsity matches the old generated teams. */
const SENIOR_LEVEL = 54.2;
/**
 * How far apart schools are, and what playing at home is worth. Measured against real high school results by
 * tools/league-realism.ts; the tool changes these to try other values, the game never does.
 */
export const LEAGUE_TUNING = {
  /** Rating points a school's players gain or lose for each point of prestige above or below the middle. */
  gap: 2,
  /** Rating points a home player gets on the night. */
  homeEdge: 1,
  /** Every player gets it (1), or every second man on the roster (2). */
  homeEvery: 2,
};

/** The middle of the prestige range: a school at this strength gets no lift and no drag. */
const MID = 58;
/** Underclassmen have to be this much better than an upperclassman to take his varsity place. */
const CLASS_HANDICAP = [7, 3, 0, -1] as const;
/** The most junior varsity players a coach may call up at once. */
export const MAX_CALL_UPS = 6;

interface Recruit {
  id: string;
  name: string;
  pos: Group;
  /** Ratings as a senior. Younger, he is `growth` points a year short of them. */
  senior: Ratings;
  growth: number;
  number: number;
  /** The rare freshman who is ready for the varsity the day he arrives. */
  phenom?: boolean;
  /** How he joined, if not with his class: walked on at fall camp, or transferred in. */
  origin?: 'walkon' | 'transfer';
  /** Where a walk-on or a transfer came from, in words. */
  from?: string;
}

export interface ProgramPlayer extends Player {
  year: number;
  squad: 'varsity' | 'jv';
  /** On the varsity because the coach called him up, not on merit. */
  calledUp: boolean;
  /** His rating when he is a senior, if he keeps developing as expected. */
  ceiling: number;
  /** Not available this week, and why. He keeps his place on the list but does not dress. */
  out?: Incident;
  phenom?: boolean;
  origin?: 'walkon' | 'transfer';
  from?: string;
}

/** What a program works on in spring practice. Every returning player gets a point on each of its ratings in the autumn. */
export const FOCUSES = [
  { id: 'strength', name: 'Strength and conditioning', desc: 'A winter in the weight room. Stronger runners, blockers and tacklers.', keys: ['power', 'runBlock', 'tackling'] },
  { id: 'speed', name: 'Speed and agility', desc: 'Track work and footwork. A step quicker at every position.', keys: ['speed', 'agility'] },
  { id: 'passing', name: 'The passing game', desc: 'Seven-on-seven all spring. Better throwing, catching and coverage.', keys: ['throwAccuracy', 'hands', 'coverage'] },
  { id: 'fundamentals', name: 'Film and fundamentals', desc: 'Assignments, technique and pass protection. Fewer mistakes.', keys: ['awareness', 'passBlock', 'kicking'] },
] as const satisfies readonly { id: string; name: string; desc: string; keys: readonly RatingKey[] }[];
export type FocusId = (typeof FOCUSES)[number]['id'];
export const isFocus = (x: unknown): x is FocusId => FOCUSES.some((f) => f.id === x);
/** What a school with no coach at this screen works on: the same for a given school and spring every time. Nobody had a spring before the first season. */
export function seededFocus(leagueSeed: number, schoolId: string, season: number): FocusId | undefined {
  if (season < 2) return undefined;
  return FOCUSES[Rng.stream(hashString(`${leagueSeed}:${schoolId}`), `focus:${season}`).int(0, FOCUSES.length - 1)]!.id;
}
/** What changes a program's ratings beyond its classes: the spring's work, and what individual players have lost or gained. */
export interface ProgramTune {
  focus?: FocusId;
  /** Rating points by player id. A boy called up before he had earned it stood on the sideline and fell behind. */
  dev?: Readonly<Record<string, number>>;
}

/** The fewest players a squad can dress at each position: the most any formation or front asks for. */
const MIN_DRESSED: Record<Group, number> = { QB: 1, RB: 2, WR: 4, TE: 2, OL: 5, DL: 5, LB: 4, CB: 3, S: 2, K: 1, P: 1 };
/** Regular-season weeks. The title game is the week after. */
const SEASON_WEEKS = 7;
/** Players in a class as it enrols. */
const CLASS_SIZE = 22;
/** `back` values for a player who is done for the year, and one who will not play again. */
export const OUT_FOR_SEASON = 90;
export const OUT_FOR_GOOD = 999;

export type IncidentKind = 'injury' | 'grades' | 'suspension' | 'moved';
/** Something that takes a player off the field. Nothing is stored: like the classes, a season's incidents come from the league seed. */
export interface Incident {
  /** The player. */
  id: string;
  kind: IncidentKind;
  /** It happens after this week's game; -1 is fall camp, before the opener. */
  week: number;
  /** The first week he can play again. */
  back: number;
  /** In words: the injury, or the reason. */
  what: string;
}

/** A player who joins outside his class: a walk-on at fall camp, or a transfer in. */
interface Arrival {
  recruit: Recruit;
  /** His class year (1 to 4) in the season he arrives. */
  year: number;
}

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  if (cache.size > 6000) cache.clear();
  const v = make();
  cache.set(key, v);
  return v;
}

const SHORT_INJURIES = ['a sprained ankle', 'a bruised shoulder', 'a jammed thumb', 'a hip pointer', 'a pulled hamstring', 'a stinger'];
const LONGER_INJURIES = ['a high ankle sprain', 'a concussion', 'a sprained knee', 'a separated shoulder', 'a cracked rib'];
const SEASON_INJURIES = ['a broken collarbone', 'a torn knee ligament', 'a broken wrist', 'a broken ankle'];
const CAREER_INJURIES = ['a serious knee injury', 'a serious neck injury'];
const WHY_LEFT = ['transferred to another school', 'moved away with his family', 'gave up football for another sport'];
const WALK_ON_FROM = ['the soccer team', 'the track team', 'the wrestling team', 'the basketball team', 'the baseball team', 'the marching band'];
const TRANSFER_FROM = ['a school across the state', 'out of state', 'a private school in town', 'a school in the next county'];
const pad = (n: number, len: number): string => String(n).padStart(len, '0');
const slotId = (schoolId: string, enrolled: number, slot: number): string => `${schoolId}_c${enrolled}_${pad(slot, 2)}`;

/**
 * A school's incidents in one season: injuries week by week (most cost a game or two, a few end a season, and once in
 * a great while one ends a career), ineligibility when report cards come out, the odd suspension, a family moving away.
 */
export function incidentsOf(leagueSeed: number, schoolId: string, season: number): readonly Incident[] {
  return memo(`i:${leagueSeed}:${schoolId}:${season}`, () => {
    const rng = Rng.stream(hashString(`${leagueSeed}:${schoolId}`), `incidents:${season}`);
    const out: Incident[] = [];
    const pick = <T>(list: readonly T[]): T => list[rng.int(0, list.length - 1)] as T;
    // Upperclassmen play more, so more happens to them.
    const someone = (): string => {
      const roll = rng.int(1, 10);
      const year = roll <= 1 ? 1 : roll <= 3 ? 2 : roll <= 6 ? 3 : 4;
      return slotId(schoolId, season - year + 1, rng.int(1, CLASS_SIZE));
    };
    for (let week = -1; week < SEASON_WEEKS; week++) {
      const hurt = (rng.chance(0.42) ? 1 : 0) + (rng.chance(0.12) ? 1 : 0);
      for (let k = 0; k < hurt; k++) {
        const id = someone();
        const u = rng.range(0, 1);
        if (u < 0.45) out.push({ id, kind: 'injury', week, back: week + 2, what: pick(SHORT_INJURIES) });
        else if (u < 0.72) out.push({ id, kind: 'injury', week, back: week + 3, what: pick(SHORT_INJURIES) });
        else if (u < 0.86) out.push({ id, kind: 'injury', week, back: week + 4 + rng.int(0, 1), what: pick(LONGER_INJURIES) });
        else if (u < 0.995) out.push({ id, kind: 'injury', week, back: OUT_FOR_SEASON, what: pick(SEASON_INJURIES) });
        else out.push({ id, kind: 'injury', week, back: OUT_FOR_GOOD, what: pick(CAREER_INJURIES) });
      }
      // Report cards come out in the middle of the season.
      if (week === 3) {
        const failing = (rng.chance(0.5) ? 1 : 0) + (rng.chance(0.15) ? 1 : 0);
        for (let k = 0; k < failing; k++) out.push({ id: someone(), kind: 'grades', week, back: week + 1 + rng.int(2, 3), what: 'his grades' });
      }
      if (rng.chance(0.04)) out.push({ id: someone(), kind: 'suspension', week, back: week + 1 + rng.int(1, 2), what: 'a violation of team rules' });
    }
    if (rng.chance(0.1)) out.push({ id: someone(), kind: 'moved', week: rng.int(0, SEASON_WEEKS - 2), back: OUT_FOR_GOOD, what: 'his family moved away' });
    return out;
  });
}

/** Players who do not come back for a season: a transfer out, a family that moved over the summer, a boy who gave the game up. */
export function departuresOf(leagueSeed: number, schoolId: string, season: number): readonly { id: string; why: string }[] {
  if (season < 2) return [];
  return memo(`d:${leagueSeed}:${schoolId}:${season}`, () => {
    const rng = Rng.stream(hashString(`${leagueSeed}:${schoolId}`), `departures:${season}`);
    const out: { id: string; why: string }[] = [];
    const n = (rng.chance(0.45) ? 1 : 0) + (rng.chance(0.12) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const year = rng.int(2, 4);
      out.push({ id: slotId(schoolId, season - year + 1, rng.int(1, CLASS_SIZE)), why: WHY_LEFT[rng.int(0, WHY_LEFT.length - 1)] as string });
    }
    return out;
  });
}

const POSITION_POOL: Group[] = [...GROUPS.flatMap((g) => Array<Group>(CLASS_GROUPS[g]).fill(g)), 'K', 'P'];

/** Who turns up at fall camp: one to three walk-ons, most of them depth and now and then a find, and sometimes a transfer. */
function arrivalsOf(leagueSeed: number, schoolId: string, season: number): readonly Arrival[] {
  if (season < 1) return [];
  return memo(`a:${leagueSeed}:${schoolId}:${season}`, () => {
    const rng = Rng.stream(hashString(`${leagueSeed}:${schoolId}`), `arrivals:${season}`);
    const out: Arrival[] = [];
    const make = (k: number, origin: 'walkon' | 'transfer', year: number, talent: number, from: string): void => {
      const pos = POSITION_POOL[rng.int(0, POSITION_POOL.length - 1)] as Group;
      const senior = rollRatings(rng, pos, SENIOR_LEVEL + talent);
      const growth = rng.range(1.5, 4.5);
      const [lo, hi] = numberRange(pos);
      const number = rng.int(lo, hi);
      const id = `${schoolId}_c${season - year + 1}_${origin === 'walkon' ? 9 : 8}${pad(season, 3)}${k}`;
      out.push({ recruit: { id, name: rollName(rng), pos, senior, growth, number, origin, from }, year });
    };
    const walkOns = 1 + (rng.chance(0.6) ? 1 : 0) + (rng.chance(0.25) ? 1 : 0);
    for (let k = 0; k < walkOns; k++) {
      const year = [1, 1, 2, 2, 2, 3, 3, 3, 4, 4][rng.int(0, 9)] as number;
      // One walk-on in eight is a real find: an athlete from another sport who can play.
      const find = rng.chance(0.12);
      make(k, 'walkon', year, find ? rng.range(3, 9) : rng.range(-14, -3), WALK_ON_FROM[rng.int(0, WALK_ON_FROM.length - 1)] as string);
    }
    if (rng.chance(0.3)) make(0, 'transfer', rng.int(2, 4), rng.range(-4, 8), TRANSFER_FROM[rng.int(0, TRANSFER_FROM.length - 1)] as string);
    return out;
  });
}

/**
 * Where a class player stands in a given week: gone from the program, out (with the incident), or available (null).
 * With no week given, this season's incidents are left out: the roster as it stood at fall camp.
 */
function statusOf(leagueSeed: number, schoolId: string, id: string, season: number, week: number | undefined): 'gone' | Incident | null {
  const enrolled = enrolledIn(id);
  if (enrolled === null) return null;
  let out: Incident | null = null;
  for (let s = Math.max(1, enrolled); s <= season; s++) {
    if (departuresOf(leagueSeed, schoolId, s).some((d) => d.id === id)) return 'gone';
    for (const inc of incidentsOf(leagueSeed, schoolId, s)) {
      if (inc.id !== id) continue;
      if (s < season) {
        if (inc.back === OUT_FOR_GOOD) return 'gone';
      } else if (week !== undefined && week > inc.week) {
        if (inc.back === OUT_FOR_GOOD) return 'gone';
        if (week < inc.back && (!out || inc.back > out.back)) out = inc;
      }
    }
  }
  return out;
}

export interface SchoolLike {
  id: string;
  name: string;
  mascot: string;
  abbr: string;
  colors: TeamColors;
  prestige: number;
}

const even = (n: number): boolean => ((n % 2) + 2) % 2 === 0;

/** The class that enrolled in season `enrolled` (season 1's seniors enrolled in season -2). */
function classOf(leagueSeed: number, schoolId: string, enrolled: number): Recruit[] {
  const rng = Rng.stream(hashString(`${leagueSeed}:${schoolId}`), `class:${enrolled}`);
  // Some classes are simply better than others.
  const quality = rng.range(-1.5, 1.5);
  const out: Recruit[] = [];
  const names = new Set<string>();
  const add = (pos: Group): void => {
    const talent = quality + rng.range(-6, 6);
    const senior = rollRatings(rng, pos, SENIOR_LEVEL + talent);
    const growth = rng.range(1.5, 4.5);
    const [lo, hi] = numberRange(pos);
    const number = rng.int(lo, hi);
    let name = rollName(rng);
    for (let i = 0; i < 40 && names.has(name); i++) name = rollName(rng);
    names.add(name);
    out.push({ id: `${schoolId}_c${enrolled}_${String(out.length + 1).padStart(2, '0')}`, name, pos, senior, growth, number });
  };
  for (const g of GROUPS) for (let k = 0; k < CLASS_GROUPS[g]; k++) add(g);
  add(even(enrolled) ? 'K' : 'P');
  // About one class in eight has a phenom: senior-level talent on the day he enrols, and not much growing left to do.
  // He has a stream of his own, so the rest of the class is who it always was.
  const star = Rng.stream(hashString(`${leagueSeed}:${schoolId}`), `phenom:${enrolled}`);
  if (star.chance(0.12)) {
    const i = star.int(0, out.length - 2);
    const r = out[i] as Recruit;
    out[i] = { ...r, senior: rollRatings(star, r.pos, SENIOR_LEVEL + star.range(8, 11)), growth: star.range(0.8, 1.4), phenom: true };
  }
  return out;
}

function ratingsAt(r: Recruit, year: number, lift: number): Ratings {
  const out = {} as Ratings;
  const short = r.growth * (4 - year);
  for (const key of Object.keys(r.senior) as RatingKey[]) out[key] = clamp(Math.round(r.senior[key] - short + lift), 15, 99);
  return out;
}

/** The year a player with this id enrolled, or null for an id that is not a program player's. */
export function enrolledIn(id: string): number | null {
  const m = /_c(-?\d+)_\d+$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * Everyone in the program this season, sorted into varsity and junior varsity.
 * The varsity is the best at each position, with upperclassmen given the edge; `callUps` puts a younger
 * player on the varsity anyway, and the weakest varsity player at his position goes down in his place.
 */
export function programFor(leagueSeed: number, school: SchoolLike, season: number, callUps: readonly string[] = [], week?: number, tune: ProgramTune = {}): ProgramPlayer[] {
  const lift = Math.round((school.prestige - MID) * LEAGUE_TUNING.gap);
  const all: ProgramPlayer[] = [];
  const worked = FOCUSES.find((f) => f.id === tune.focus)?.keys as readonly RatingKey[] | undefined;
  // Spring practice helps the boys who were there for it; a player's own gains and losses go with him every year.
  const tuned = (r: Recruit, year: number): Ratings => {
    const out = ratingsAt(r, year, lift);
    const own = tune.dev?.[r.id] ?? 0;
    for (const key of Object.keys(r.senior) as RatingKey[]) out[key] = clamp(out[key] + own + (year >= 2 && worked?.includes(key) ? 1 : 0), 15, 99);
    return out;
  };
  const add = (r: Recruit, year: number, out?: Incident): void => {
    const p: Player = { id: r.id, name: r.name, number: r.number, pos: r.pos, ratings: tuned(r, year), year };
    const top: Player = { ...p, ratings: tuned(r, 4) };
    all.push({ ...p, year, squad: 'jv', calledUp: false, ceiling: overall(top), ...(out ? { out } : {}), ...(r.phenom ? { phenom: true } : {}), ...(r.origin ? { origin: r.origin, from: r.from } : {}) });
  };
  for (let year = 4; year >= 1; year--) {
    for (const r of classOf(leagueSeed, school.id, season - year + 1)) {
      const st = statusOf(leagueSeed, school.id, r.id, season, week);
      if (st !== 'gone') add(r, year, st ?? undefined);
    }
  }
  // Walk-ons and transfers from this camp and the last three, until their class graduates.
  for (let s = Math.max(1, season - 3); s <= season; s++) {
    for (const a of arrivalsOf(leagueSeed, school.id, s)) {
      const year = a.year + (season - s);
      if (year <= 4) add(a.recruit, year);
    }
  }
  const wanted = new Set(callUps.slice(0, MAX_CALL_UPS));
  for (const g of GROUPS) {
    const here = all.filter((p) => p.pos === g);
    const fit = here.filter((p) => !p.out);
    const merit = (p: ProgramPlayer): number => overall(p) - CLASS_HANDICAP[p.year - 1];
    const byMerit = (list: ProgramPlayer[]): ProgramPlayer[] => [...list].sort((a, b) => merit(b) - merit(a) || (a.id < b.id ? -1 : 1));
    const earned = new Set(byMerit(fit).slice(0, ROSTER_SIZE[g]).map((p) => p.id));
    const order = [...fit].sort((a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)) || merit(b) - merit(a) || (a.id < b.id ? -1 : 1));
    order.slice(0, ROSTER_SIZE[g]).forEach((p) => {
      p.squad = 'varsity';
      p.calledUp = wanted.has(p.id) && !earned.has(p.id);
    });
    // A man who is out stays on the list he would be on if he were fit; someone moves up to dress in his place.
    byMerit(here).slice(0, ROSTER_SIZE[g]).forEach((p) => { if (p.out) p.squad = 'varsity'; });
  }
  return all;
}

export interface ProgramNews {
  /** The week it happened after; -1 is fall camp. */
  week: number;
  kind: IncidentKind | 'left' | 'walkon' | 'transfer' | 'phenom';
  id: string;
  text: string;
  /** Worth telling the whole league: a career ended, a phenom arrived. */
  big: boolean;
}

const POSITION_NAMES: Record<Group, string> = { QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end', OL: 'offensive lineman', DL: 'defensive lineman', LB: 'linebacker', CB: 'cornerback', S: 'safety', K: 'kicker', P: 'punter' };
const games = (n: number): string => (n === 1 ? 'one game' : `${n} games`);

/** Everything that happened to a school's program in a season, in the order it happened, in words. */
export function programNews(leagueSeed: number, school: SchoolLike, season: number): ProgramNews[] {
  const out: ProgramNews[] = [];
  const who = (id: string): { name: string; pos: Group; year: number } | null => {
    const enrolled = enrolledIn(id);
    if (enrolled === null) return null;
    const r = classOf(leagueSeed, school.id, enrolled).find((x) => x.id === id);
    const year = season - enrolled + 1;
    return r && year >= 1 && year <= 4 ? { name: r.name, pos: r.pos, year } : null;
  };
  const tag = (p: { name: string; pos: Group; year: number }): string => `${p.pos} ${p.name} (${CLASS_SHORT[p.year - 1]})`;
  for (const d of departuresOf(leagueSeed, school.id, season)) {
    const p = who(d.id);
    // A boy who had already left is not news a second time.
    if (p && statusOf(leagueSeed, school.id, d.id, season - 1, undefined) !== 'gone') out.push({ week: -1, kind: 'left', id: d.id, text: `${tag(p)} ${d.why} over the summer.`, big: false });
  }
  for (const a of arrivalsOf(leagueSeed, school.id, season)) {
    const r = a.recruit;
    const cls = CLASS_NAMES[a.year - 1].toLowerCase();
    const level = overall({ id: r.id, name: r.name, number: r.number, pos: r.pos, ratings: r.senior });
    out.push(r.origin === 'transfer'
      ? { week: -1, kind: 'transfer', id: r.id, text: `${r.name}, a ${cls} ${POSITION_NAMES[r.pos]}, transferred in from ${r.from}.`, big: false }
      : { week: -1, kind: 'walkon', id: r.id, text: `${r.name}, a ${cls} from ${r.from}, walked on at fall camp as ${/^[aeiou]/.test(POSITION_NAMES[r.pos]) ? 'an' : 'a'} ${POSITION_NAMES[r.pos]}.${level >= SENIOR_LEVEL + 2 ? ' The coaches think he can play.' : ''}`, big: false });
  }
  for (const r of classOf(leagueSeed, school.id, season)) {
    if (r.phenom && statusOf(leagueSeed, school.id, r.id, season, undefined) !== 'gone') out.push({ week: -1, kind: 'phenom', id: r.id, text: `Freshman ${POSITION_NAMES[r.pos]} ${r.name} is the most gifted newcomer ${school.name} has seen in years.`, big: true });
  }
  for (const inc of incidentsOf(leagueSeed, school.id, season)) {
    const p = who(inc.id);
    if (!p || statusOf(leagueSeed, school.id, inc.id, season, inc.week) === 'gone') continue;
    const missed = inc.back - inc.week - 1;
    const text = inc.kind === 'moved' ? `${tag(p)} has left school: ${inc.what}.`
      : inc.kind === 'grades' ? `${tag(p)} is academically ineligible and will miss ${games(missed)}.`
        : inc.kind === 'suspension' ? `${tag(p)} is suspended for ${games(missed)} for ${inc.what}.`
          : inc.back === OUT_FOR_GOOD ? `${tag(p)} has ${inc.what} and will not play football again.`
            : inc.back === OUT_FOR_SEASON ? `${tag(p)} has ${inc.what} and is out for the season.`
              : `${tag(p)} has ${inc.what} and will miss ${games(missed)}.`;
    out.push({ week: inc.week, kind: inc.kind, id: inc.id, text, big: inc.kind === 'injury' && inc.back === OUT_FOR_GOOD });
  }
  return out.sort((a, b) => a.week - b.week);
}

/** Everyone who is or was in the program this season, by id: for putting a name to a statistic after a player has left. */
export function programNames(leagueSeed: number, school: SchoolLike, season: number): Map<string, string> {
  const names = new Map<string, string>();
  for (let year = 4; year >= 1; year--) for (const r of classOf(leagueSeed, school.id, season - year + 1)) names.set(r.id, r.name);
  for (let s = Math.max(1, season - 3); s <= season; s++) for (const a of arrivalsOf(leagueSeed, school.id, s)) names.set(a.recruit.id, a.recruit.name);
  return names;
}

/** Builds a team from one squad. Numbers are handed out so no two players on the field share one. */
function squadTeam(school: SchoolLike, fit: readonly ProgramPlayer[], jv: boolean): Team {
  // Injuries can leave a squad short at a position. The deepest group gives up its weakest man to play out of position,
  // so no formation ever has to put the same player in two places.
  const players = fit.map((p) => ({ ...p }));
  const count = (g: Group): number => players.filter((p) => p.pos === g).length;
  for (const g of GROUPS) {
    while (count(g) < MIN_DRESSED[g]) {
      const from = [...GROUPS].filter((h) => h !== g).sort((a, b) => (count(b) - MIN_DRESSED[b]) - (count(a) - MIN_DRESSED[a]))[0] as Group;
      if (count(from) <= MIN_DRESSED[from]) break;
      const donor = players.filter((p) => p.pos === from).sort((a, b) => overall(a) - overall(b) || (a.id < b.id ? -1 : 1))[0] as ProgramPlayer;
      donor.pos = g;
    }
  }
  const used = new Set<number>();
  const roster: Player[] = [];
  const depth = {} as Record<Group, string[]>;
  for (const g of GROUPS) {
    const made: Player[] = [];
    for (const p of players.filter((x) => x.pos === g)) {
      const [lo, hi] = numberRange(g);
      let number = p.number;
      for (let n = lo; used.has(number) && n <= hi; n++) number = n;
      for (let n = 1; used.has(number) && n <= 99; n++) number = n;
      used.add(number);
      made.push({ id: p.id, name: p.name, number, pos: p.pos, ratings: p.ratings, year: p.year });
    }
    roster.push(...made);
    depth[g] = [...made].sort((a, b) => overall(b) - overall(a) || (a.id < b.id ? -1 : 1)).map((p) => p.id);
  }
  return { id: jv ? `${school.id}_jv` : school.id, name: school.name, mascot: school.mascot, abbr: school.abbr, colors: school.colors, roster, depth };
}

/** Friday's team. */
export function varsityTeam(leagueSeed: number, school: SchoolLike, season: number, callUps: readonly string[] = [], week?: number, tune?: ProgramTune): Team {
  return squadTeam(school, programFor(leagueSeed, school, season, callUps, week, tune).filter((p) => p.squad === 'varsity' && !p.out), false);
}

/** Thursday's team: everyone who is not on the varsity. */
export function jvTeam(leagueSeed: number, school: SchoolLike, season: number, callUps: readonly string[] = [], week?: number, tune?: ProgramTune): Team {
  return squadTeam(school, programFor(leagueSeed, school, season, callUps, week, tune).filter((p) => p.squad === 'jv' && !p.out), true);
}

/** Next season's freshmen, as they will arrive. */
export function incomingClass(leagueSeed: number, school: SchoolLike, season: number): ProgramPlayer[] {
  return programFor(leagueSeed, school, season + 1).filter((p) => p.year === 1);
}

/** Call-ups worth keeping: real players of this school who are still in the program and still need the call. */
export function cleanCallUps(leagueSeed: number, school: SchoolLike, season: number, raw: unknown, tune?: ProgramTune): string[] {
  if (!Array.isArray(raw)) return [];
  const merit = programFor(leagueSeed, school, season, [], undefined, tune);
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || out.includes(id) || out.length >= MAX_CALL_UPS) continue;
    const p = merit.find((x) => x.id === id);
    if (p && p.squad === 'jv') out.push(id);
  }
  return out;
}
