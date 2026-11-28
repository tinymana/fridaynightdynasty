import { hashString, type Team } from '@fnd/core';
import {
  REGULAR_WEEKS, RIVALRY_WEEK, isRivalryGame, lastWeek, leagueNews, recordOf, replayResult, rivalries, standings, stateByCode, userGame, weekGames,
  type Dynasty, type GameResult,
} from './index';
import { newsText, seasonYear } from './records';
import { boxScore, type StatLine } from './stats';

/**
 * The weekly paper: what the local sports page prints on Saturday morning. Everything in it is worked out from the
 * week's results, the standings and the news, so it is the same every time it is opened.
 */
export interface PaperStory {
  headline: string;
  body: string[];
}
export interface Paper {
  name: string;
  /** "Week 3, 2026" */
  edition: string;
  lead: PaperStory;
  stories: PaperStory[];
  /** Short items: records that fell, injuries, comings and goings. */
  notes: string[];
  /** The standings, top to bottom, one line a school. */
  table: string[];
  /** What is coming next, or null when the season is over. */
  next: string | null;
}

const ROUT = ['routs', 'rolls past', 'runs away from', 'overwhelms'];
const SOLID = ['handles', 'pulls away from', 'beats', 'takes care of'];
const CLOSE = ['holds off', 'gets past', 'tops', 'outlasts'];
const TIGHT = ['edges', 'survives', 'slips past', 'nips'];
const pickBy = <T>(list: readonly T[], key: string): T => list[hashString(key) % list.length] as T;
const rec = (r: readonly [number, number, number]): string => `${r[0]}-${r[1]}${r[2] ? `-${r[2]}` : ''}`;
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'last'];

function headline(d: Dynasty, g: GameResult): string {
  const s = d.league.schools;
  const [h, a] = g.score;
  const key = `${d.league.seed}:${d.year}:${g.week}:${g.home}`;
  if (h === a) return `${s[g.away].name} and ${s[g.home].name} finish level at ${h}`;
  const w = h > a ? g.home : g.away;
  const l = w === g.home ? g.away : g.home;
  const hi = Math.max(h, a);
  const lo = Math.min(h, a);
  if (g.week === lastWeek(d)) return `${s[w].name} ${s[w].mascot} are ${stateByCode(d.league.state).name} champions`;
  const verb = lo === 0 && hi >= 14 ? 'shuts out' : hi - lo >= 28 ? pickBy(ROUT, key) : hi - lo >= 14 ? pickBy(SOLID, key) : hi - lo <= 3 ? pickBy(TIGHT, key) : pickBy(CLOSE, key);
  return `${s[w].name} ${verb} ${s[l].name}, ${hi}-${lo}`;
}

/** The night's best player in a line, from the box score. */
function star(d: Dynasty, g: GameResult): string | null {
  const book = replayResult(d, g);
  if (!book) return null;
  const box = boxScore(book.events);
  let best: { text: string; worth: number } | null = null;
  ([0, 1] as const).forEach((t) => {
    const team: Team = book.teams[t];
    for (const [id, l] of Object.entries(box.players[t]) as [string, StatLine][]) {
      const name = team.roster.find((p) => p.id === id)?.name;
      if (!name) continue;
      const tds = (n: number): string => (n === 0 ? '' : n === 1 ? ' and a touchdown' : ` and ${n} touchdowns`);
      const cands = [
        { worth: l.rushYds + l.rushTd * 20, text: `${name} ran ${l.rushAtt} times for ${l.rushYds} yards${tds(l.rushTd)} for ${team.name}.`, ok: l.rushAtt >= 5 },
        { worth: l.passYds * 0.6 + l.passTd * 20 - l.passInt * 15, text: `${name} threw for ${l.passYds} yards${tds(l.passTd)} for ${team.name}.`, ok: l.passAtt >= 8 },
        { worth: l.recYds * 1.1 + l.recTd * 20, text: `${name} caught ${l.rec} passes for ${l.recYds} yards${tds(l.recTd)} for ${team.name}.`, ok: l.rec >= 3 },
        { worth: l.tackles * 7 + l.sacks * 18 + l.ints * 30, text: `${name} led the ${team.name} defense with ${l.tackles} tackles${l.sacks ? ` and ${l.sacks === 1 ? 'a sack' : `${l.sacks} sacks`}` : ''}${l.ints ? ` and ${l.ints === 1 ? 'an interception' : `${l.ints} interceptions`}` : ''}.`, ok: l.tackles >= 6 },
      ];
      for (const c of cands) if (c.ok && (!best || c.worth > best.worth)) best = { text: c.text, worth: c.worth };
    }
  });
  return (best as { text: string } | null)?.text ?? null;
}

/**
 * The paper for the week just played, or null before the first game. `stars` replays the other schools' games to
 * name the night's best players; leave it off where that would be too slow.
 */
export function weeklyPaper(d: Dynasty, stars = true): Paper | null {
  const week = d.week - 1;
  if (week < 0) return null;
  const s = d.league.schools;
  const state = stateByCode(d.league.state);
  const games = d.results.filter((g) => g.week === week);
  if (!games.length) return null;
  const table = standings(d.results);
  const place = (school: number): string => ORDINAL[table.findIndex((r) => r.school === school)] ?? 'last';
  const title = week === lastWeek(d);
  const semis = !!d.bracket && week === REGULAR_WEEKS;
  const mine = games.find((g) => g.home === d.user || g.away === d.user) ?? null;
  const rivalry = (g: GameResult): string | null => {
    if (!isRivalryGame(g.week, g.home, g.away)) return null;
    const r = rivalries(d).find((x) => (x.a === g.home && x.b === g.away) || (x.a === g.away && x.b === g.home))!;
    const lead = r.series[0] === r.series[1] ? `The series is level at ${r.series[0]}` : `${s[r.series[0] > r.series[1] ? r.a : r.b].name} leads the series ${Math.max(r.series[0], r.series[1])}-${Math.min(r.series[0], r.series[1])}`;
    const t = r.trophy.replace(/^the /, 'The ');
    return g.score[0] === g.score[1] ? `${t} stays with ${s[r.holder].name} after the tie. ${lead}${r.series[2] ? `, with ${r.series[2]} ties` : ''}.` : `${t} belongs to ${s[r.holder].name} for another year. ${lead}${r.series[2] ? `, with ${r.series[2]} ties` : ''}.`;
  };
  const story = (g: GameResult, withStar: boolean): PaperStory => {
    const body: string[] = [];
    const [h, a] = g.score;
    const w = h >= a ? g.home : g.away;
    const l = w === g.home ? g.away : g.home;
    if (title) body.push(`${s[w].name} beat ${s[l].name} ${Math.max(h, a)}-${Math.min(h, a)} in the championship game and finish the season ${rec(recordOf(d.results, w))}.`);
    else if (h === a) body.push(`Neither side could find a winner at ${s[g.home].name}. ${s[g.home].name} is ${rec(recordOf(d.results, g.home))}, ${s[g.away].name} ${rec(recordOf(d.results, g.away))}.`);
    else body.push(`${s[w].name} is now ${rec(recordOf(d.results, w))} and ${place(w)} in the standings. ${s[l].name} falls to ${rec(recordOf(d.results, l))}.`);
    const r = rivalry(g);
    if (r) body.push(r);
    if (withStar) {
      const best = star(d, g);
      if (best) body.push(best);
    }
    return { headline: headline(d, g), body };
  };
  const leadGame = mine ?? [...games].sort((x, y) => Math.abs(y.score[0] - y.score[1]) - Math.abs(x.score[0] - x.score[1]))[0] as GameResult;
  const lead = story(leadGame, stars);
  const news = leagueNews(d).filter((n) => n.week === week);
  const myNews = news.find((n) => n.school === d.user);
  if (mine && myNews) lead.body.push(myNews.text);
  const stories = games.filter((g) => g !== leadGame).map((g) => story(g, stars));
  const notes: string[] = [];
  for (const n of d.stats?.news ?? []) if (n.year === seasonYear(d.year) && n.week === week) notes.push(newsText(n, s[n.school].name));
  for (const n of news) if (n.big || (n.school === d.user && n !== myNews)) notes.push(`${s[n.school].name}: ${n.text}`);
  if (title) {
    const a = d.awards?.find((x) => x.year === d.year);
    if (a?.player) notes.unshift(`Player of the year: ${a.player.name}, ${s[a.player.school].name} (${a.player.line}).`);
    if (a) notes.push(`Coach of the year: the coach of ${s[a.coach].name}.`);
  }
  let next: string | null = null;
  if (d.week < REGULAR_WEEKS) {
    const own = userGame(d);
    if (own) {
      const opp = own[0] === d.user ? own[1] : own[0];
      next = `Next week: ${s[d.user].name} ${own[0] === d.user ? 'hosts' : 'travels to'} ${s[opp].name} (${rec(recordOf(d.results, opp))}).`;
      if (d.week === RIVALRY_WEEK) {
        const r = rivalries(d).find((x) => x.a === d.user || x.b === d.user)!;
        next += ` It is rivalry week: ${r.trophy} is on the line, and ${s[r.holder].name} has it.`;
      }
    }
  } else if (d.week === lastWeek(d)) {
    const [h, a] = weekGames(d)[0] as [number, number];
    next = `Next week: ${s[a].name} at ${s[h].name} for the ${state.name} championship.`;
  } else if (d.bracket && d.week === REGULAR_WEEKS) {
    next = `Next week, the semifinals: ${weekGames(d).map(([h, a]) => `${s[a].name} at ${s[h].name}`).join(', and ')}.`;
  }
  return {
    name: `The ${state.name} Prep Ledger`,
    edition: `${title ? 'Championship edition' : semis ? 'Semifinals' : `Week ${week + 1}`}, ${seasonYear(d.year)}`,
    lead, stories, notes: notes.slice(0, 8),
    table: table.map((r, i) => `${i + 1}. ${s[r.school].name} ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`),
    next,
  };
}
