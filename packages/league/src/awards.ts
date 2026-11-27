import type { Group } from '@fnd/core';
import type { StatLine } from './stats';

/** End-of-season honours for a league: the best players, the all-league team and the coach of the year. */

export interface Honoree {
  id: string;
  name: string;
  school: number;
  pos: Group;
  /** Class year when he won it: 1 freshman to 4 senior. */
  year: number;
  /** His season in a line: "1,204 rushing yards, 13 touchdowns". */
  line: string;
}

export interface SeasonAwards {
  /** Dynasty season number. */
  year: number;
  player: Honoree | null;
  defender: Honoree | null;
  /** The best freshman or sophomore. */
  newcomer: Honoree | null;
  /** The school whose season most beat what was expected of it. */
  coach: number;
  allLeague: Honoree[];
}

export interface Candidate {
  id: string;
  name: string;
  school: number;
  pos: Group;
  year: number;
  line: StatLine;
}

const n = (x: number): string => x.toLocaleString('en-US');
const plural = (x: number, one: string, many = `${one}s`): string => `${n(x)} ${x === 1 ? one : many}`;

/** What a player gave his offense, in points of value: yards, scores and the ball looked after. */
export const offenseScore = (l: StatLine): number => l.passYds * 0.04 + l.passTd * 4 - l.passInt * 2.5 + l.rushYds * 0.1 + l.rushTd * 6 + l.recYds * 0.1 + l.recTd * 6 + l.rec * 0.4;
export const defenseScore = (l: StatLine): number => l.tackles + l.sacks * 4 + l.ints * 6;
const kickScore = (l: StatLine): number => l.fgMade * 3 + l.xpMade;

function summary(c: Candidate): string {
  const l = c.line;
  if (c.pos === 'K' || c.pos === 'P') return `${l.fgMade} of ${l.fgAtt} field goals, ${plural(l.xpMade, 'extra point')}`;
  if (c.pos === 'DL' || c.pos === 'LB' || c.pos === 'CB' || c.pos === 'S') {
    return [plural(l.tackles, 'tackle'), l.sacks ? plural(l.sacks, 'sack') : '', l.ints ? plural(l.ints, 'interception') : ''].filter(Boolean).join(', ');
  }
  const parts: string[] = [];
  if (l.passYds >= Math.max(l.rushYds, l.recYds)) parts.push(`${n(l.passYds)} passing yards, ${plural(l.passTd, 'touchdown pass', 'touchdown passes')}`);
  if (l.rushYds > 0 && (c.pos === 'RB' || l.rushYds >= 200)) parts.push(`${n(l.rushYds)} rushing yards, ${plural(l.rushTd, 'touchdown')}`);
  if (l.recYds > 0 && c.pos !== 'QB' && (c.pos !== 'RB' || l.recYds >= 100)) parts.push(`${plural(l.rec, 'catch', 'catches')} for ${n(l.recYds)} yards, ${plural(l.recTd, 'touchdown')}`);
  return parts.join('; ') || plural(l.games, 'game');
}

const honor = (c: Candidate): Honoree => ({ id: c.id, name: c.name, school: c.school, pos: c.pos, year: c.year, line: summary(c) });

/** How many of each position make the all-league team: eleven on offense's side of the ball, eleven on defense's, and a kicker. */
const TEAM: readonly [readonly Group[], number, (l: StatLine) => number][] = [
  [['QB'], 1, offenseScore],
  [['RB'], 2, offenseScore],
  [['WR', 'TE'], 3, offenseScore],
  [['DL'], 3, defenseScore],
  [['LB'], 3, defenseScore],
  [['CB', 'S'], 3, defenseScore],
  [['K'], 1, kickScore],
];

/**
 * Votes the season's awards. `wins` is each school's regular-season wins and `expected` what its strength
 * said it should win, both by school index. Ties go to the lower player id so the vote never changes.
 */
export function voteAwards(year: number, players: readonly Candidate[], wins: readonly number[], expected: readonly number[]): SeasonAwards {
  const rank = (list: readonly Candidate[], score: (l: StatLine) => number): Candidate[] => list.filter((c) => score(c.line) > 0).sort((a, b) => score(b.line) - score(a.line) || (a.id < b.id ? -1 : 1));
  const offense = rank(players.filter((c) => ['QB', 'RB', 'WR', 'TE'].includes(c.pos)), offenseScore);
  const defense = rank(players.filter((c) => ['DL', 'LB', 'CB', 'S'].includes(c.pos)), defenseScore);
  // A young player's defensive numbers are weighed against offensive ones on a common scale.
  const young = rank(players.filter((c) => c.year <= 2), (l) => Math.max(offenseScore(l), defenseScore(l) * 1.4));
  const allLeague: Honoree[] = [];
  for (const [groups, count, score] of TEAM) allLeague.push(...rank(players.filter((c) => groups.includes(c.pos)), score).slice(0, count).map(honor));
  let coach = 0;
  for (let i = 1; i < wins.length; i++) if (wins[i] - expected[i] > wins[coach] - expected[coach] || (wins[i] - expected[i] === wins[coach] - expected[coach] && wins[i] > wins[coach])) coach = i;
  return { year, player: offense[0] ? honor(offense[0]) : null, defender: defense[0] ? honor(defense[0]) : null, newcomer: young[0] ? honor(young[0]) : null, coach, allLeague };
}

const GROUPS_OK = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];
function cleanHonoree(raw: unknown, schools: number): Honoree | null {
  const h = raw as Partial<Honoree> | null;
  if (!h || typeof h !== 'object' || typeof h.id !== 'string' || typeof h.name !== 'string' || typeof h.line !== 'string' || !GROUPS_OK.includes(h.pos as string)) return null;
  if (!Number.isInteger(h.school) || h.school! < 0 || h.school! >= schools || !Number.isInteger(h.year) || h.year! < 1 || h.year! > 4) return null;
  const strip = (s: string, len: number): string => s.replace(/[<>&"]/g, '').slice(0, len);
  return { id: strip(h.id, 40), name: strip(h.name, 40), school: h.school!, pos: h.pos as Group, year: h.year!, line: strip(h.line, 120) };
}

/** Checks saved awards. Anything that is not a well-formed season of awards is dropped. */
export function cleanAwards(raw: unknown, schools: number): SeasonAwards[] {
  const out: SeasonAwards[] = [];
  for (const a of Array.isArray(raw) ? raw.slice(-60) : []) {
    if (!a || typeof a !== 'object' || !Number.isInteger(a.year) || a.year < 1 || !Number.isInteger(a.coach) || a.coach < 0 || a.coach >= schools) continue;
    const team = (Array.isArray(a.allLeague) ? a.allLeague.slice(0, 20) : []).map((h: unknown) => cleanHonoree(h, schools)).filter((h: Honoree | null): h is Honoree => !!h);
    out.push({ year: a.year, player: cleanHonoree(a.player, schools), defender: cleanHonoree(a.defender, schools), newcomer: cleanHonoree(a.newcomer, schools), coach: a.coach, allLeague: team });
  }
  return out;
}
