import { Rng, hashString, overall, type Group } from '@fnd/core';
import { LEAGUE_SIZE, seasonOver, career, programOf, standings, statsOf, type Dynasty } from './index';
import { voteAwards, type Candidate, type Honoree } from './awards';
import { programNews, type ProgramNews } from './program';

/**
 * The off-season: the banquet, signing day, the coaching carousel, spring practice and fall camp.
 * All of it is read from the season that just ended; the only things a coach decides are whether to take another
 * job and what to work on in the spring.
 */

/** The team's own awards at the banquet: its best on offense and defense and its best young player. */
export function teamHonors(d: Dynasty): { offense: Honoree | null; defense: Honoree | null; newcomer: Honoree | null; seniors: number } {
  const stats = statsOf(d);
  const players: Candidate[] = [];
  const program = programOf(d, d.user);
  for (const p of program) {
    const line = stats.season[p.id];
    if (line) players.push({ id: p.id, name: p.name, school: d.user, pos: p.pos, year: p.year, line });
  }
  const zero = Array<number>(LEAGUE_SIZE).fill(0);
  const a = voteAwards(d.year, players, zero, zero);
  return { offense: a.player, defense: a.defender, newcomer: a.newcomer, seniors: program.filter((p) => p.year === 4).length };
}

export type CollegeLevel = 'Division I' | 'Division II' | 'Division III' | 'Junior college';
export interface Signing {
  id: string;
  name: string;
  pos: Group;
  overall: number;
  level: CollegeLevel;
  college: string;
}
const PLACES = ['Northern Plains', 'Lakeshore', 'Red River', 'Blue Ridge', 'Great Basin', 'Tidewater', 'Prairie View Valley', 'Cumberland Gap', 'High Desert', 'Gulf Shore', 'Pine Barrens', 'Three Rivers', 'Copper Mountain', 'Stonebridge', 'Larkspur', 'Eastern Ridge'];
const STYLE: Record<CollegeLevel, string[]> = {
  'Division I': ['State University', 'University', 'Tech'],
  'Division II': ['State College', 'A&M', 'University'],
  'Division III': ['College', 'Wesleyan', 'College'],
  'Junior college': ['Community College', 'Junior College', 'Community College'],
};

/**
 * Signing day: where this year's seniors are going to play. Most high school players are done; the best few in a
 * program go on, and only a rare one to the top level. The colleges are made up, and the same every time.
 */
export function signings(d: Dynasty, school: number = d.user): Signing[] {
  const out: Signing[] = [];
  for (const p of programOf(d, school)) {
    if (p.year !== 4) continue;
    const ovr = overall(p);
    const rng = Rng.stream(hashString(`${d.league.seed}:${p.id}`), 'college');
    const luck = rng.range(-2, 2);
    const v = ovr + luck;
    const level: CollegeLevel | null = v >= 78 ? 'Division I' : v >= 75 ? 'Division II' : v >= 72 ? 'Division III' : v >= 70 && rng.chance(0.5) ? 'Junior college' : null;
    if (!level) continue;
    const place = PLACES[rng.int(0, PLACES.length - 1)] as string;
    const style = STYLE[level][rng.int(0, 2)] as string;
    out.push({ id: p.id, name: p.name, pos: p.pos, overall: ovr, level, college: `${place} ${style}` });
  }
  const order: CollegeLevel[] = ['Division I', 'Division II', 'Division III', 'Junior college'];
  return out.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || b.overall - a.overall || (a.id < b.id ? -1 : 1));
}

export interface JobOffer {
  school: number;
  /** Why they are calling, in a sentence. */
  pitch: string;
}

/**
 * The coaching carousel. A school that had a losing year looks for a new coach, and it calls a coach who has just
 * won: a winning season, or a title. At most two call. Nobody is ever fired; the coach can stay as long as he likes.
 */
export function jobOffers(d: Dynasty): JobOffer[] {
  if (!seasonOver(d)) return [];
  const h = d.history[d.history.length - 1];
  if (!h) return [];
  const [w, l] = h.record;
  const champion = h.champion === d.user;
  if (!champion && w <= l) return [];
  const table = standings(d.results);
  const s = d.league.schools;
  const rng = Rng.stream(d.league.seed, `carousel:${d.year}`);
  const looking = table.filter((r) => r.school !== d.user && r.wins < r.losses)
    // A bigger program than his own is the call a coach wants; a coach with a title gets calls from anyone.
    .filter((r) => champion || s[r.school].prestige >= s[d.user].prestige - 1 || rng.chance(0.35))
    .sort((a, b) => s[b.school].prestige - s[a.school].prestige || a.school - b.school)
    .slice(0, 2);
  const c = career(d);
  return looking.map((r) => ({
    school: r.school,
    pitch: `${s[r.school].name} went ${r.wins}-${r.losses} and wants a new coach. ${s[r.school].prestige > s[d.user].prestige ? 'It is a bigger program than yours' : 'It is a rebuilding job'}, and they like a coach who is ${c.wins}-${c.losses} with ${c.championships} ${c.championships === 1 ? 'title' : 'titles'}.`,
  }));
}

/**
 * The carousel in a league with friends, for the coach of `school`. The same rule as a solo dynasty: a school that
 * had a losing year calls a coach who has just had a winning one, or won the title. Only a school that `open` says
 * has no coach of its own can call, and at most two do.
 */
export function jobOffersFor(d: Dynasty, school: number, open: (school: number) => boolean): JobOffer[] {
  if (!seasonOver(d)) return [];
  const h = d.history[d.history.length - 1];
  if (!h) return [];
  const table = standings(d.results);
  const mine = table.find((r) => r.school === school);
  if (!mine) return [];
  const champion = h.champion === school;
  if (!champion && mine.wins <= mine.losses) return [];
  const s = d.league.schools;
  const rng = Rng.stream(d.league.seed, `carousel:${d.year}:${school}`);
  return table.filter((r) => r.school !== school && open(r.school) && r.wins < r.losses)
    .filter((r) => champion || s[r.school].prestige >= s[school].prestige - 1 || rng.chance(0.35))
    .sort((a, b) => s[b.school].prestige - s[a.school].prestige || a.school - b.school)
    .slice(0, 2)
    .map((r) => ({
      school: r.school,
      pitch: `${s[r.school].name} went ${r.wins}-${r.losses} and wants a new coach. ${s[r.school].prestige > s[school].prestige ? 'It is a bigger program than yours.' : 'It is a rebuilding job.'}`,
    }));
}

/** Takes another school's job. His record goes with him; his call-ups, his spring plans and his players' histories stay behind. */
export function takeJob(d: Dynasty, school: number): Dynasty {
  if (!jobOffers(d).some((o) => o.school === school)) throw new Error('that school has not offered the job');
  const out: Dynasty = { ...d, user: school, callUps: [] };
  delete out.focus;
  delete out.dev;
  return out;
}

/** What fall camp will bring next season: who left over the summer, who walked on, who transferred in, any phenom. */
export function campNews(d: Dynasty): ProgramNews[] {
  return programNews(d.league.seed, d.league.schools[d.user], d.year + 1).filter((n) => n.week < 0);
}
