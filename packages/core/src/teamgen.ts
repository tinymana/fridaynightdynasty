import { Rng } from './rng';
import { clamp } from './math';
import { GROUPS, type Group, type Player, type RatingKey, type Ratings, type Team, type TeamColors } from './types';

const FIRST = ['Aiden', 'Marcus', 'Diego', 'Owen', 'Jalen', 'Caleb', 'Mateo', 'Tyrese', 'Wyatt', 'Andre', 'Luis', 'Colt', 'Devon', 'Eli', 'Kenji', 'Nolan', 'Omar', 'Isaiah', 'Brooks', 'Rafael', 'Sione', 'Trey', 'Gavin', 'Malik', 'Hank', 'Jonah', 'Emilio', 'Cade', 'Darius', 'Finn', 'Tomas', 'Reese'];
const LAST = ['Alder', 'Bostwick', 'Calloway', 'Dunmire', 'Esparza', 'Fenwick', 'Galloway', 'Hartsock', 'Ibarra', 'Jessup', 'Kowalski', 'Lindqvist', 'Mabry', 'Nakamura', 'Okafor', 'Pruitt', 'Quintero', 'Rademaker', 'Sandoval', 'Tuiasosopo', 'Underhill', 'Vandiver', 'Whitlock', 'Yarbrough', 'Zeller', 'Ashcroft', 'Beaumont', 'Corrigan', 'Delacroix', 'Eastman', 'Fontaine', 'Greer', 'Holloway', 'Ingram', 'Jaramillo', 'Kessler'];

type Profile = Partial<Record<RatingKey, number>>;
const PROFILES: Record<Group, Profile> = {
  QB: { throwPower: 12, throwAccuracy: 12, awareness: 8, speed: 0, agility: 2, power: -4 },
  RB: { speed: 12, agility: 12, power: 4, hands: 0, awareness: 2, runBlock: -2 },
  WR: { speed: 14, agility: 10, hands: 12, awareness: 2 },
  TE: { hands: 6, runBlock: 4, passBlock: 0, power: 6, speed: 3 },
  OL: { runBlock: 13, passBlock: 13, power: 14, speed: -14, agility: -10 },
  DL: { power: 12, tackling: 8, speed: -5, agility: 1, awareness: 2 },
  LB: { tackling: 12, power: 6, speed: 4, agility: 2, coverage: 0, awareness: 5 },
  CB: { speed: 13, coverage: 12, agility: 10, tackling: -2, awareness: 2 },
  S: { speed: 9, coverage: 8, tackling: 6, agility: 5, awareness: 5 },
  K: { kicking: 16 },
  P: { kicking: 16 },
};
const KEYS: RatingKey[] = ['speed', 'power', 'agility', 'hands', 'throwPower', 'throwAccuracy', 'runBlock', 'passBlock', 'tackling', 'coverage', 'kicking', 'awareness'];
const NUMBERS: Record<Group, [number, number]> = { QB: [1, 19], RB: [20, 39], WR: [80, 89], TE: [40, 49], OL: [60, 79], DL: [90, 99], LB: [50, 59], CB: [20, 39], S: [20, 39], K: [1, 19], P: [1, 19] };

/** Players per group on a Milestone 2 game-day roster (39 in all). */
export const ROSTER_SIZE: Record<Group, number> = { QB: 2, RB: 3, WR: 5, TE: 2, OL: 7, DL: 6, LB: 5, CB: 4, S: 3, K: 1, P: 1 };

/** A single number for sorting a depth chart: the average of the ratings that matter at the position. */
export function overall(p: Player): number {
  const keys = Object.keys(PROFILES[p.pos]).filter((k) => (PROFILES[p.pos][k as RatingKey] ?? 0) > 0) as RatingKey[];
  let sum = 0;
  for (const k of keys) sum += p.ratings[k];
  return Math.round(sum / Math.max(1, keys.length));
}

export interface TeamMeta {
  name: string;
  mascot: string;
  abbr: string;
  colors: TeamColors;
  /** Overall team strength, roughly 45 to 70. */
  strength: number;
}

/** Deterministically generates a team. `counter` supplies stable, never-reused player IDs. */
export function generateTeam(seed: number, schoolId: string, meta: TeamMeta, counter: { next: number }): Team {
  const rng = Rng.stream(seed, `team:${schoolId}`);
  const used = new Set<number>();
  const usedNames = new Set<string>();
  const roster: Player[] = [];
  const depth = {} as Record<Group, string[]>;

  for (const group of GROUPS) {
    const profile = PROFILES[group];
    const made: Player[] = [];
    for (let k = 0; k < ROSTER_SIZE[group]; k++) {
      // Backups are a little weaker than starters.
      const level = meta.strength - k * 2.5;
      const ratings = { stamina: clamp(Math.round(meta.strength + rng.range(-10, 10)), 20, 99) } as Ratings;
      for (const key of KEYS) {
        const bonus = profile[key];
        const base = bonus === undefined ? level - 12 : level + bonus;
        ratings[key] = clamp(Math.round(base + rng.range(-7, 7)), 15, 99);
      }
      const [lo, hi] = NUMBERS[group];
      let number = rng.int(lo, hi);
      for (let i = 0; i < 300 && used.has(number); i++) number = rng.int(1, 99);
      used.add(number);
      let name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      for (let i = 0; i < 80 && usedNames.has(name); i++) name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      usedNames.add(name);
      made.push({ id: `plr_${String(counter.next++).padStart(6, '0')}`, name, number, pos: group, ratings });
    }
    roster.push(...made);
    depth[group] = [...made].sort((a, b) => overall(b) - overall(a) || (a.id < b.id ? -1 : 1)).map((p) => p.id);
  }
  return { id: schoolId, name: meta.name, mascot: meta.mascot, abbr: meta.abbr, colors: meta.colors, roster, depth };
}

/** Placeholder exhibition teams. Names and colours are stand-ins until art direction is approved (D11). */
export const EXHIBITION_TEAMS: readonly TeamMeta[] = [
  { name: 'Marlow Creek', mascot: 'Wildcats', abbr: 'MCW', strength: 58, colors: { jersey: 0x27307f, helmet: 0x27307f, pants: 0xf2f2f2, trim: 0xd8262c } },
  { name: 'Dunmore Ridge', mascot: 'Stags', abbr: 'DRS', strength: 58, colors: { jersey: 0x7a1f2b, helmet: 0xe8c547, pants: 0xe8c547, trim: 0xf2f2e9 } },
];

export function exhibitionTeams(seed: number): [Team, Team] {
  const counter = { next: 1 };
  return [
    generateTeam(seed, 'sch_0001', EXHIBITION_TEAMS[0], counter),
    generateTeam(seed, 'sch_0002', EXHIBITION_TEAMS[1], counter),
  ];
}

/** One player's ratings for a position at a given level, the same recipe `generateTeam` uses. */
export function rollRatings(rng: Rng, group: Group, level: number): Ratings {
  const profile = PROFILES[group];
  const ratings = { stamina: clamp(Math.round(level + rng.range(-10, 10)), 20, 99) } as Ratings;
  for (const key of KEYS) {
    const bonus = profile[key];
    const base = bonus === undefined ? level - 12 : level + bonus;
    ratings[key] = clamp(Math.round(base + rng.range(-7, 7)), 15, 99);
  }
  return ratings;
}
export const rollName = (rng: Rng): string => `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
/** The jersey numbers a position usually wears. */
export const numberRange = (group: Group): [number, number] => NUMBERS[group];
