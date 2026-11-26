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
}

export interface ProgramPlayer extends Player {
  year: number;
  squad: 'varsity' | 'jv';
  /** On the varsity because the coach called him up, not on merit. */
  calledUp: boolean;
  /** His rating when he is a senior, if he keeps developing as expected. */
  ceiling: number;
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
export function programFor(leagueSeed: number, school: SchoolLike, season: number, callUps: readonly string[] = []): ProgramPlayer[] {
  const lift = Math.round(school.prestige - MID);
  const all: ProgramPlayer[] = [];
  for (let year = 4; year >= 1; year--) {
    for (const r of classOf(leagueSeed, school.id, season - year + 1)) {
      const p: Player = { id: r.id, name: r.name, number: r.number, pos: r.pos, ratings: ratingsAt(r, year, lift), year };
      const top: Player = { ...p, ratings: ratingsAt(r, 4, lift) };
      all.push({ ...p, year, squad: 'jv', calledUp: false, ceiling: overall(top) });
    }
  }
  const wanted = new Set(callUps.slice(0, MAX_CALL_UPS));
  for (const g of GROUPS) {
    const here = all.filter((p) => p.pos === g);
    const merit = (p: ProgramPlayer): number => overall(p) - CLASS_HANDICAP[p.year - 1];
    const byMerit = [...here].sort((a, b) => merit(b) - merit(a) || (a.id < b.id ? -1 : 1));
    const earned = new Set(byMerit.slice(0, ROSTER_SIZE[g]).map((p) => p.id));
    const order = [...here].sort((a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)) || merit(b) - merit(a) || (a.id < b.id ? -1 : 1));
    order.slice(0, ROSTER_SIZE[g]).forEach((p) => {
      p.squad = 'varsity';
      p.calledUp = wanted.has(p.id) && !earned.has(p.id);
    });
  }
  return all;
}

/** Builds a team from one squad. Numbers are handed out so no two players on the field share one. */
function squadTeam(school: SchoolLike, players: readonly ProgramPlayer[], jv: boolean): Team {
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
export function varsityTeam(leagueSeed: number, school: SchoolLike, season: number, callUps: readonly string[] = []): Team {
  return squadTeam(school, programFor(leagueSeed, school, season, callUps).filter((p) => p.squad === 'varsity'), false);
}

/** Thursday's team: everyone who is not on the varsity. */
export function jvTeam(leagueSeed: number, school: SchoolLike, season: number, callUps: readonly string[] = []): Team {
  return squadTeam(school, programFor(leagueSeed, school, season, callUps).filter((p) => p.squad === 'jv'), true);
}

/** Next season's freshmen, as they will arrive. */
export function incomingClass(leagueSeed: number, school: SchoolLike, season: number): ProgramPlayer[] {
  return programFor(leagueSeed, school, season + 1).filter((p) => p.year === 1);
}

/** Call-ups worth keeping: real players of this school who are still in the program and still need the call. */
export function cleanCallUps(leagueSeed: number, school: SchoolLike, season: number, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const merit = programFor(leagueSeed, school, season);
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || out.includes(id) || out.length >= MAX_CALL_UPS) continue;
    const p = merit.find((x) => x.id === id);
    if (p && p.squad === 'jv') out.push(id);
  }
  return out;
}
