import { Rng } from './rng';
import { clamp } from './math';
import { DEF_POS, OFF_POS, type DefPos, type OffPos, type Player, type RatingKey, type Ratings, type Team, type TeamColors } from './types';

const FIRST = ['Aiden', 'Marcus', 'Diego', 'Owen', 'Jalen', 'Caleb', 'Mateo', 'Tyrese', 'Wyatt', 'Andre', 'Luis', 'Colt', 'Devon', 'Eli', 'Kenji', 'Nolan', 'Omar', 'Isaiah', 'Brooks', 'Rafael', 'Sione', 'Trey', 'Gavin', 'Malik', 'Hank', 'Jonah', 'Emilio', 'Cade', 'Darius', 'Finn', 'Tomas', 'Reese'];
const LAST = ['Alder', 'Bostwick', 'Calloway', 'Dunmire', 'Esparza', 'Fenwick', 'Galloway', 'Hartsock', 'Ibarra', 'Jessup', 'Kowalski', 'Lindqvist', 'Mabry', 'Nakamura', 'Okafor', 'Pruitt', 'Quintero', 'Rademaker', 'Sandoval', 'Tuiasosopo', 'Underhill', 'Vandiver', 'Whitlock', 'Yarbrough', 'Zeller', 'Ashcroft', 'Beaumont', 'Corrigan', 'Delacroix', 'Eastman', 'Fontaine', 'Greer', 'Holloway', 'Ingram', 'Jaramillo', 'Kessler'];

type Profile = Partial<Record<RatingKey, number>>;
const PROFILES: Record<string, Profile> = {
  QB: { throwPower: 12, throwAccuracy: 12, awareness: 8, speed: 0, agility: 2 },
  RB: { speed: 12, agility: 12, power: 4, hands: 0, awareness: 2 },
  WR: { speed: 14, agility: 10, hands: 12, awareness: 2 },
  TE: { hands: 6, runBlock: 4, passBlock: 0, power: 6, speed: 3 },
  OL: { runBlock: 13, passBlock: 13, power: 14, speed: -14, agility: -10 },
  DL: { power: 12, tackling: 8, speed: -5, agility: 1, awareness: 2 },
  LB: { tackling: 12, power: 6, speed: 4, agility: 2, coverage: 0, awareness: 5 },
  CB: { speed: 13, coverage: 12, agility: 10, tackling: -2, awareness: 2 },
  S: { speed: 9, coverage: 8, tackling: 6, agility: 5, awareness: 5 },
  K: { kicking: 16 },
};
const GROUP: Record<string, string> = {
  QB: 'QB', RB: 'RB', TE: 'TE', WR1: 'WR', WR2: 'WR', WR3: 'WR', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  DE1: 'DL', DT1: 'DL', DT2: 'DL', DE2: 'DL', OLB1: 'LB', MLB: 'LB', OLB2: 'LB', CB1: 'CB', CB2: 'CB', FS: 'S', SS: 'S', K: 'K', P: 'K',
};
const KEYS: RatingKey[] = ['speed', 'power', 'agility', 'hands', 'throwPower', 'throwAccuracy', 'runBlock', 'passBlock', 'tackling', 'coverage', 'kicking', 'awareness'];
const NUMBERS: Record<string, [number, number]> = { QB: [1, 19], RB: [20, 39], WR: [80, 89], TE: [40, 49], OL: [50, 79], DL: [90, 99], LB: [50, 59], CB: [20, 39], S: [20, 39], K: [1, 19] };

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

  const make = (pos: string): Player => {
    const group = GROUP[pos];
    const profile = PROFILES[group];
    const ratings = { stamina: clamp(Math.round(meta.strength + rng.range(-8, 8)), 20, 99) } as Ratings;
    for (const k of KEYS) {
      const bonus = profile[k];
      const base = bonus === undefined ? meta.strength - 12 : meta.strength + bonus;
      ratings[k] = clamp(Math.round(base + rng.range(-7, 7)), 15, 99);
    }
    const [lo, hi] = NUMBERS[group];
    let number = rng.int(lo, hi);
    for (let i = 0; i < 200 && used.has(number); i++) number = rng.int(1, 99);
    used.add(number);
    let name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    for (let i = 0; i < 50 && usedNames.has(name); i++) name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    usedNames.add(name);
    const id = `plr_${String(counter.next++).padStart(6, '0')}`;
    return { id, name, number, pos, ratings };
  };

  const offense = {} as Record<OffPos, Player>;
  for (const p of OFF_POS) offense[p] = make(p);
  const defense = {} as Record<DefPos, Player>;
  for (const p of DEF_POS) defense[p] = make(p);
  return { id: schoolId, name: meta.name, mascot: meta.mascot, abbr: meta.abbr, colors: meta.colors, offense, defense, kicker: make('K'), punter: make('P') };
}

/** Placeholder exhibition teams. Names and colours are stand-ins until art direction is approved (D11). */
export const EXHIBITION_TEAMS: readonly TeamMeta[] = [
  { name: 'Marlow Creek', mascot: 'Kingfishers', abbr: 'MCK', strength: 58, colors: { jersey: 0x13806f, helmet: 0xf28c28, pants: 0xf2f2e9, trim: 0xf28c28 } },
  { name: 'Dunmore Ridge', mascot: 'Stags', abbr: 'DRS', strength: 58, colors: { jersey: 0x7a1f2b, helmet: 0xe8c547, pants: 0xe8c547, trim: 0xf2f2e9 } },
];

export function exhibitionTeams(seed: number): [Team, Team] {
  const counter = { next: 1 };
  return [
    generateTeam(seed, 'sch_0001', EXHIBITION_TEAMS[0], counter),
    generateTeam(seed, 'sch_0002', EXHIBITION_TEAMS[1], counter),
  ];
}
