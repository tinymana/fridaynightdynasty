import { GROUPS, WEATHER, overall, type GameSetup, type Team } from '@fnd/core';
import {
  CLASS_NAMES, CLASS_SHORT, MAX_CALL_UPS, RECORD_DEFS, OUT_FOR_SEASON, REGULAR_WEEKS, STATES, leagueNews, career, emptyLine, incomingOf, newsText, occasionFor, openings, programOf, schoolOfPlayer, seasonYear, statsOf, recordOf, setCallUp, createDynasty, createLeague, editSchool, gameSeed, gameSetup, loadDynasty, nextSeason, playWeek, standings, stateByCode, matchTeams, userGame, weekGames, winnerOf,
  type BoxScore, type Incident, type LeagueNews, type Dynasty, type GameResult, type Honoree, type ProgramPlayer, type RecordNews, type SeasonAwards, type StatLine,
} from '@fnd/league';
import { bindSchoolForm, schoolFormHtml } from './school-form';

/**
 * The solo dynasty screen: pick a state and a school, then play a season a week at a time.
 * The save is small (seed, results, prestige): rosters and AI games are rebuilt from it.
 */

export interface DynastyGame {
  seed: number;
  teams: [Team, Team];
  /** Which of the two the coach runs. */
  user: 0 | 1;
  setup: GameSetup;
  week: number;
  home: number;
  away: number;
  label: string;
}

export interface DynastyHost {
  load(): unknown;
  save(d: Dynasty | null): void;
  /** Quarter length for a new dynasty. */
  quarterMinutes(): GameSetup['quarterMinutes'];
  play(g: DynastyGame): void;
  back(): void;
}

const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
/** Why a player is not dressing and when he is back, in a few words. */
const outText = (o: Incident): string => {
  const why = o.kind === 'grades' ? 'ineligible' : o.kind === 'suspension' ? 'suspended' : `out: ${o.what.replace(/^an? /, '')}`;
  return o.back >= OUT_FOR_SEASON ? `${why}, season` : `${why}, back ${o.back < REGULAR_WEEKS ? `week ${o.back + 1}` : o.back === REGULAR_WEEKS ? 'for the title game' : 'next year'}`;
};
const weekName = (w: number): string => (w < REGULAR_WEEKS ? `Week ${w + 1}` : 'Championship');

export class DynastyScreen {
  private d: Dynasty | null;
  private pickState = 'TX';
  private pickSeed = 1;
  private busy = false;
  private editing = -1;
  /** Which page of the dynasty is showing: the season, or the program (varsity, junior varsity, classes). */
  private view: 'season' | 'program' | 'stats' | 'records' | 'awards' = 'season';
  /** Which school's record book is open. */
  private bookOf = -1;
  /** Record calls already made in the game being played, so each is made once. */
  private called = new Set<string>();

  constructor(private readonly root: HTMLElement, private readonly title: HTMLElement, private readonly host: DynastyHost, newSeed: () => number) {
    this.d = loadDynasty(host.load());
    this.newSeed = newSeed;
    this.pickSeed = newSeed();
  }
  private readonly newSeed: () => number;

  /** Reads the dynasty again from where it is kept, after a save has been loaded over it. */
  reload(): void {
    this.d = loadDynasty(this.host.load());
    this.view = 'season';
    this.bookOf = -1;
    this.editing = -1;
    this.called.clear();
  }

  get active(): Dynasty | null {
    return this.d;
  }

  /** One line for the main menu. */
  summary(): string {
    const d = this.d;
    if (!d) return 'Run a school season after season in the state of your choice.';
    const s = d.league.schools[d.user];
    const c = career(d);
    return `${s.name} ${s.mascot}, ${stateByCode(d.league.state).name} · year ${d.year}${c.seasons ? ` · ${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''}, ${c.championships} ${c.championships === 1 ? 'title' : 'titles'}` : ''}`;
  }

  render(): void {
    if (this.d && this.view === 'program') this.renderProgram(this.d);
    else if (this.d && this.view === 'stats') this.renderStats(this.d);
    else if (this.d && this.view === 'records') this.renderRecords(this.d);
    else if (this.d && this.view === 'awards') this.renderAwards(this.d);
    else if (this.d) this.renderSeason(this.d);
    else this.renderNew();
  }

  /** Records the coach's finished game and plays the rest of that week. */
  finishGame(g: DynastyGame, score: readonly [number, number], box?: BoxScore): { won: boolean | null; text: string; records: string[] } {
    const d = this.d!;
    const mine: GameResult = { week: g.week, home: g.home, away: g.away, score: [score[0], score[1]] };
    this.d = playWeek(d, mine, box);
    this.host.save(this.d);
    this.called.clear();
    // Records my school set tonight, and at the end of the season the season and career marks too.
    const me = d.league.schools[d.user].name;
    const records = (this.d.stats?.news ?? []).filter((n) => n.school === d.user && n.year === seasonYear(d.year) && (n.week === g.week || (g.week === REGULAR_WEEKS && n.week === -1))).map((n) => newsText(n, me));
    const done = (r: { won: boolean | null; text: string }): { won: boolean | null; text: string; records: string[] } => ({ ...r, records });
    const us = g.user === 0 ? score[0] : score[1];
    const them = g.user === 0 ? score[1] : score[0];
    if (g.week === REGULAR_WEEKS) {
      const champ = winnerOf(mine) === d.user;
      return done({ won: champ, text: champ ? `${d.league.schools[d.user].name} are ${stateByCode(d.league.state).name} champions!${us === them ? ' A tie goes to the home team, which finished first.' : ''}` : `Runners-up. ${us === them ? 'A tie goes to the home team, which finished first.' : 'So close.'}` });
    }
    return done({ won: us === them ? null : us > them, text: `${weekName(g.week)} is in the books.` });
  }

  /**
   * Record watch, called after every play of the coach's own game. Says so once when one of his players
   * passes a school record for a game, a season or a career, and once when a yardage record is within reach.
   */
  watch(g: DynastyGame, box: BoxScore): string[] {
    const d = this.d;
    if (!d) return [];
    const stats = statsOf(d);
    const book = stats.books[d.user];
    const out: string[] = [];
    const team = g.teams[g.user];
    for (const [id, line] of Object.entries(box.players[g.user])) {
      const name = team.roster.find((p) => p.id === id)?.name ?? 'Unknown';
      const before = stats.season[id] ?? emptyLine();
      const earlier = stats.career[id] ?? emptyLine();
      for (const def of RECORD_DEFS) {
        const spans: [string, string, number][] = [['game', 'in a game', line[def.key]], ['season', 'in a season', before[def.key] + line[def.key]], ['career', 'in a career', earlier[def.key] + before[def.key] + line[def.key]]];
        for (const [scope, words, value] of spans) {
          const old = book[`${scope}:${def.key}`];
          const tag = `${id}:${scope}:${def.key}`;
          if (value > old.value && !this.called.has(tag)) {
            this.called.add(tag);
            out.push(`School record! ${name} now has ${value} ${def.unit} ${words}, passing ${old.name}'s ${old.value} from ${old.year}.`);
          } else if (scope === 'game' && def.key.endsWith('Yds') && value <= old.value && value >= old.value * 0.85 && !this.called.has(`near:${tag}`)) {
            this.called.add(`near:${tag}`);
            out.push(`Record watch: ${name} is ${old.value - value + 1} ${def.unit} from the school record (${old.name}, ${old.value}, ${old.year}).`);
          }
        }
      }
    }
    return out;
  }

  private renderNew(): void {
    this.title.textContent = 'Start a dynasty';
    const league = createLeague(this.pickState, this.pickSeed);
    const jobs = openings(league);
    const others = league.schools.map((s, i) => ({ s, i })).filter((x) => !jobs.some((j) => j.school === x.i));
    const posting = (j: (typeof jobs)[number]): string => {
      const s = league.schools[j.school];
      const varsity = programOf({ league, year: 1 }, j.school).filter((p) => p.squad === 'varsity');
      const seniors = varsity.filter((p) => p.year === 4).length;
      const star = varsity.filter((p) => p.pos !== 'K' && p.pos !== 'P').sort((a, b) => overall(b) - overall(a))[0];
      const tier = s.prestige >= 60 ? 'Powerhouse' : s.prestige >= 58 ? 'Contender' : s.prestige >= 56 ? 'Middle of the pack' : 'Rebuilding';
      return `<div class="job"><div class="swatch" style="background:linear-gradient(90deg, ${css(s.colors.jersey)} 0 60%, ${css(s.colors.trim)} 60% 80%, ${css(s.colors.helmet)} 80%)"></div>
        <div class="job-body"><div class="nm">${esc(s.name)} ${esc(s.mascot)} <span class="tier">${tier}</span></div>
        <div class="why">${j.reason}</div>
        <div class="facts">Last season ${j.lastRecord[0]}-${j.lastRecord[1]}. ${seniors} seniors on the varsity. Best player: ${CLASS_NAMES[star.year - 1].toLowerCase()} ${star.pos} ${esc(star.name)}, rated ${overall(star)}.</div>
        <div class="facts">${j.expects}</div></div>
        <button class="seg on" data-school="${j.school}">Take the job</button></div>`;
    };
    this.root.innerHTML = `<p>Pick a state and see who is hiring. Take a job and the program is yours: seven league games a season, then first plays second for the state title.</p>
      <div class="orow center"><label class="pick">State <select id="dyState">${STATES.map((s) => `<option value="${s.code}"${s.code === this.pickState ? ' selected' : ''}>${s.name}</option>`).join('')}</select></label>
      <button class="seg" id="dyShuffle">Draw new schools</button><button class="seg" id="dyBack">Back</button></div>
      <h3>Head coach wanted: ${jobs.length} schools in ${esc(stateByCode(this.pickState).name)}</h3>
      <div class="dy-pick jobs">${jobs.map(posting).join('')}</div>
      <p class="sl-note" style="text-align:center">Also in the league, and not hiring: ${others.map((x) => `${esc(x.s.name)} ${esc(x.s.mascot)}`).join(', ')}.</p>`;
    const q = (id: string): HTMLElement => this.root.querySelector(`#${id}`) as HTMLElement;
    (q('dyState') as HTMLSelectElement).addEventListener('change', (e) => { this.pickState = (e.target as HTMLSelectElement).value; this.render(); });
    q('dyShuffle').addEventListener('click', () => { this.pickSeed = this.newSeed(); this.render(); });
    q('dyBack').addEventListener('click', () => this.host.back());
    this.root.querySelectorAll<HTMLElement>('[data-school]').forEach((el) => el.addEventListener('click', () => {
      this.d = createDynasty(this.pickState, this.pickSeed, Number(el.dataset.school), { quarterMinutes: this.host.quarterMinutes() });
      this.host.save(this.d);
      this.render();
    }));
  }

  /** One season's awards as a block: the three player awards, coach of the year and the all-league team. */
  private awardsHtml(d: Dynasty, a: SeasonAwards, full: boolean): string {
    const schools = d.league.schools;
    const who = (h: Honoree | null): string => (h ? `<b>${esc(h.name)}</b>, ${CLASS_NAMES[h.year - 1].toLowerCase()} ${h.pos}, ${esc(schools[h.school].name)} <small>${esc(h.line)}</small>` : 'Not awarded');
    const row = (label: string, body: string, mine: boolean): string => `<div class="award${mine ? ' me' : ''}"><span class="lbl">${label}</span><span>${body}</span></div>`;
    const team = full ? `<div class="allteam">${a.allLeague.map((h) => `<span class="${h.school === d.user ? 'me' : ''}">${h.pos} ${esc(h.name)} <small>${esc(schools[h.school].abbr)}</small></span>`).join('')}</div>` : '';
    const mineOnTeam = a.allLeague.filter((h) => h.school === d.user).length;
    return row('Player of the year', who(a.player), a.player?.school === d.user)
      + row('Defensive player of the year', who(a.defender), a.defender?.school === d.user)
      + row('Newcomer of the year', who(a.newcomer), a.newcomer?.school === d.user)
      + row('Coach of the year', a.coach === d.user ? '<b>You.</b> Your school won more than anyone expected.' : `The coach at ${esc(schools[a.coach].name)}`, a.coach === d.user)
      + row('All-league team', full ? team : `${a.allLeague.length} players named, ${mineOnTeam} of them yours.`, mineOnTeam > 0);
  }

  /** Every season's awards, newest first. */
  private renderAwards(d: Dynasty): void {
    this.title.textContent = `${stateByCode(d.league.state).name} awards`;
    const all = [...(d.awards ?? [])].reverse();
    this.root.innerHTML = `<div class="orow center"><button class="seg on" id="pgBack">Back to the season</button><button class="seg" id="awRecords">Record book</button></div>
      ${all.length ? all.map((a) => `<h3>${seasonYear(a.year)} season</h3>${this.awardsHtml(d, a, true)}`).join('') : '<p>The awards are voted when the title game has been played. Finish a season and they will be here.</p>'}`;
    (this.root.querySelector('#pgBack') as HTMLElement).addEventListener('click', () => { this.view = 'season'; this.render(); });
    (this.root.querySelector('#awRecords') as HTMLElement).addEventListener('click', () => { this.view = 'records'; this.bookOf = d.user; this.render(); });
  }

  /** The latest records to fall around the league, newest first. */
  /** The injury report and the comings and goings: my program's, and anything the whole league is talking about. */
  private programNewsHtml(d: Dynasty): string {
    const all = leagueNews(d);
    const mine = all.filter((n) => n.school === d.user).slice(0, 7);
    const around = all.filter((n) => n.school !== d.user && n.big).slice(0, 3);
    if (!mine.length && !around.length) return '';
    const when = (w: number): string => (w < 0 ? 'Fall camp' : `After ${weekName(w).toLowerCase()}`);
    const line = (n: LeagueNews, withSchool: boolean): string => `<div class="dy-game${n.school === d.user ? ' me' : ''}"><span>${withSchool ? `${esc(d.league.schools[n.school].name)}: ` : ''}${esc(n.text)}</span><span>${when(n.week)}</span></div>`;
    return `${mine.length ? `<h3>Team news</h3>${mine.map((n) => line(n, false)).join('')}` : ''}${around.length ? `<h3>Around the league</h3>${around.map((n) => line(n, true)).join('')}` : ''}`;
  }

  private newsHtml(d: Dynasty): string {
    const news = (d.stats?.news ?? []).slice(0, 4);
    if (!news.length) return '';
    const line = (n: RecordNews): string => `<div class="dy-game${n.school === d.user ? ' me' : ''}"><span>${esc(newsText(n, d.league.schools[n.school].name))}</span><span>${n.year}</span></div>`;
    return `<h3>Records that have fallen</h3>${news.map(line).join('')}`;
  }

  /** Season statistics: my team's leaders and the league's. */
  private renderStats(d: Dynasty): void {
    const schools = d.league.schools;
    const me = schools[d.user];
    this.title.textContent = `${seasonYear(d.year)} statistics`;
    const stats = statsOf(d);
    const who = new Map<string, { name: string; pos: string; year: number; school: number }>();
    for (let i = 0; i < schools.length; i++) for (const p of programOf(d, i)) who.set(p.id, { name: p.name, pos: p.pos, year: p.year, school: i });
    const all = Object.entries(stats.season).map(([id, l]) => ({ id, l, p: who.get(id) })).filter((x): x is { id: string; l: StatLine; p: { name: string; pos: string; year: number; school: number } } => !!x.p);
    const mine = all.filter((x) => x.p.school === d.user);
    const nm = (x: (typeof all)[number], league = false): string => `${esc(x.p.name)} <span class="cls c${x.p.year}">${CLASS_SHORT[x.p.year - 1]}</span>${league ? ` <small>${esc(schools[x.p.school].abbr)}</small>` : ''}`;
    const table = (title: string, head: string[], rows: (typeof all), cells: (x: (typeof all)[number]) => (string | number)[], league = false): string => (rows.length
      ? `<h3>${title}</h3><table><tr><th>Player</th>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((x) => `<tr class="${league && x.p.school === d.user ? 'me' : ''}"><td>${nm(x, league)}</td>${cells(x).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>` : '');
    const top = (list: typeof all, key: keyof StatLine, n: number): typeof all => list.filter((x) => x.l[key] > 0).sort((a, b) => b.l[key] - a.l[key] || (a.id < b.id ? -1 : 1)).slice(0, n);
    const avg = (y: number, a: number): string => (a ? (y / a).toFixed(1) : '0.0');
    const passing = (x: (typeof all)[number]): (string | number)[] => [`${x.l.passComp}/${x.l.passAtt}`, x.l.passYds, x.l.passTd, x.l.passInt];
    const rushing = (x: (typeof all)[number]): (string | number)[] => [x.l.rushAtt, x.l.rushYds, avg(x.l.rushYds, x.l.rushAtt), x.l.rushTd];
    const receiving = (x: (typeof all)[number]): (string | number)[] => [x.l.rec, x.l.recYds, avg(x.l.recYds, x.l.rec), x.l.recTd];
    const defense = (x: (typeof all)[number]): (string | number)[] => [x.l.tackles, x.l.sacks, x.l.ints];
    const kicking = (x: (typeof all)[number]): (string | number)[] => [`${x.l.fgMade}/${x.l.fgAtt}`, x.l.xpMade, x.l.fgMade * 3 + x.l.xpMade];
    const empty = !all.length;
    this.root.innerHTML = `<div class="orow center"><button class="seg on" id="pgBack">Back to the season</button><button class="seg" id="stRecords">Record book</button></div>
      ${empty ? '<p>No games have been played yet this season. The numbers start with week 1.</p>' : ''}
      <div class="dy-cols prog"><div><h2 class="colhead">${esc(me.name)} ${esc(me.mascot)}</h2>
        ${table('Passing', ['C/A', 'Yds', 'TD', 'Int'], top(mine, 'passAtt', 3), passing)}
        ${table('Rushing', ['Att', 'Yds', 'Avg', 'TD'], top(mine, 'rushYds', 6), rushing)}
        ${table('Receiving', ['Rec', 'Yds', 'Avg', 'TD'], top(mine, 'recYds', 7), receiving)}
        ${table('Defense', ['Tkl', 'Sacks', 'Int'], top(mine, 'tackles', 10), defense)}
        ${table('Kicking', ['FG', 'XP', 'Pts'], top(mine, 'xpMade', 2), kicking)}</div>
      <div><h2 class="colhead">${esc(stateByCode(d.league.state).name)} leaders</h2>
        ${table('Passing yards', ['C/A', 'Yds', 'TD', 'Int'], top(all, 'passYds', 5), passing, true)}
        ${table('Rushing yards', ['Att', 'Yds', 'Avg', 'TD'], top(all, 'rushYds', 5), rushing, true)}
        ${table('Receiving yards', ['Rec', 'Yds', 'Avg', 'TD'], top(all, 'recYds', 5), receiving, true)}
        ${table('Tackles', ['Tkl', 'Sacks', 'Int'], top(all, 'tackles', 5), defense, true)}
        ${table('Sacks', ['Tkl', 'Sacks', 'Int'], top(all, 'sacks', 5), defense, true)}
        ${table('Interceptions', ['Tkl', 'Sacks', 'Int'], top(all, 'ints', 5), defense, true)}</div></div>`;
    (this.root.querySelector('#pgBack') as HTMLElement).addEventListener('click', () => { this.view = 'season'; this.render(); });
    (this.root.querySelector('#stRecords') as HTMLElement).addEventListener('click', () => { this.view = 'records'; this.bookOf = d.user; this.render(); });
  }

  /** A school's record book: single game, season and career, with who holds each and since when. */
  private renderRecords(d: Dynasty): void {
    const schools = d.league.schools;
    const at = this.bookOf >= 0 && this.bookOf < schools.length ? this.bookOf : d.user;
    const s = schools[at];
    this.title.textContent = `${s.name} ${s.mascot} record book`;
    const stats = statsOf(d);
    const book = stats.books[at];
    const mineEra = seasonYear(1);
    const cell = (k: string): string => {
      const e = book[k];
      return `<td class="${e.year >= mineEra ? 'fresh' : ''}"><b>${e.value}</b> ${esc(e.name)} <small>${e.year}</small></td>`;
    };
    const rows = RECORD_DEFS.map((def) => `<tr><td>${def.label}</td>${cell(`game:${def.key}`)}${cell(`season:${def.key}`)}${cell(`career:${def.key}`)}</tr>`).join('');
    const pts = book['game:teamPoints'];
    const fallen = stats.news.filter((n) => n.school === at).slice(0, 12);
    this.root.innerHTML = `<p>Every mark in the book belongs to somebody. Beat it and your player's name goes in. Records set since you took the job in ${mineEra} are shown in gold.</p>
      <div class="orow center"><button class="seg on" id="pgBack">Back to the season</button><button class="seg" id="rcStats">Statistics</button>
        <label class="pick">School <select id="rcSchool">${schools.map((x, i) => `<option value="${i}"${i === at ? ' selected' : ''}>${esc(x.name)} ${esc(x.mascot)}${i === d.user ? ' (yours)' : ''}</option>`).join('')}</select></label></div>
      <div class="prog recbook"><table><tr><th>Record</th><th>Game</th><th>Season</th><th>Career</th></tr>${rows}
        <tr><td>Points by the team</td><td class="${pts.year >= mineEra ? 'fresh' : ''}"><b>${pts.value}</b> ${pts.name ? `against ${esc(pts.name)} ` : ''}<small>${pts.year}</small></td><td></td><td></td></tr></table></div>
      ${(() => {
        // The school's honours: everyone it has put on the all-league team, and its award winners.
        const lines: string[] = [];
        for (const a of [...(d.awards ?? [])].reverse()) {
          const tag = (h: Honoree | null, what: string): void => { if (h && h.school === at) lines.push(`<div class="dy-game me"><span>${what}: ${esc(h.name)}, ${h.pos}. ${esc(h.line)}</span><span>${seasonYear(a.year)}</span></div>`); };
          tag(a.player, 'Player of the year');
          tag(a.defender, 'Defensive player of the year');
          tag(a.newcomer, 'Newcomer of the year');
          const team = a.allLeague.filter((h) => h.school === at);
          if (team.length) lines.push(`<div class="dy-game"><span>All-league: ${team.map((h) => `${h.pos} ${esc(h.name)}`).join(', ')}</span><span>${seasonYear(a.year)}</span></div>`);
        }
        return lines.length ? `<h3>Honors at ${esc(s.name)}</h3>${lines.slice(0, 16).join('')}` : '';
      })()}
      ${fallen.length ? `<h3>Records broken at ${esc(s.name)}</h3>${fallen.map((n) => `<div class="dy-game me"><span>${esc(newsText(n, s.name))}</span><span>${n.year}</span></div>`).join('')}` : `<p class="sl-note" style="text-align:center">Nobody has broken a ${esc(s.name)} record since ${mineEra - 1}.</p>`}`;
    (this.root.querySelector('#pgBack') as HTMLElement).addEventListener('click', () => { this.view = 'season'; this.render(); });
    (this.root.querySelector('#rcStats') as HTMLElement).addEventListener('click', () => { this.view = 'stats'; this.render(); });
    (this.root.querySelector('#rcSchool') as HTMLSelectElement).addEventListener('change', (e) => { this.bookOf = Number((e.target as HTMLSelectElement).value); this.render(); });
  }

  /** The program page: who is on the varsity, who is on the junior varsity, and who is coming. */
  private renderProgram(d: Dynasty): void {
    const schools = d.league.schools;
    const me = schools[d.user];
    const over = d.week > REGULAR_WEEKS;
    this.title.textContent = `${me.name} ${me.mascot} · the program`;
    const all = programOf(d, d.user);
    const varsity = all.filter((p) => p.squad === 'varsity');
    const jv = all.filter((p) => p.squad === 'jv');
    const ups = d.callUps ?? [];
    const order = (a: ProgramPlayer, b: ProgramPlayer): number => GROUPS.indexOf(a.pos) - GROUPS.indexOf(b.pos) || overall(b) - overall(a);
    const cls = (p: ProgramPlayer): string => `<span class="cls c${p.year}" title="${CLASS_NAMES[p.year - 1]}">${CLASS_SHORT[p.year - 1]}</span>`;
    const tags = (p: ProgramPlayer): string => `${p.calledUp ? ' <span class="tag-up">called up</span>' : ''}${p.phenom ? ' <span class="tag-star" title="The rare freshman who is ready now">phenom</span>' : ''}${p.origin === 'walkon' ? ` <span class="tag-new" title="Walked on from ${esc(p.from ?? '')}">walk-on</span>` : p.origin === 'transfer' ? ` <span class="tag-new" title="Transferred in from ${esc(p.from ?? '')}">transfer</span>` : ''}${p.out ? ` <span class="tag-out">${esc(outText(p.out))}</span>` : ''}`;
    const row = (p: ProgramPlayer, action: string): string => `<tr class="${p.out ? 'is-out' : ''}"><td>${p.pos}</td><td>${esc(p.name)}${tags(p)}</td><td>${cls(p)}</td><td><b>${overall(p)}</b></td><td>${p.year < 4 ? p.ceiling : ''}</td><td>${action}</td></tr>`;
    const head = '<tr><th>Pos</th><th>Player</th><th>Class</th><th>Now</th><th title="His rating as a senior if he keeps developing">Senior</th><th></th></tr>';
    const full = ups.length >= MAX_CALL_UPS;
    const count = (list: ProgramPlayer[]): string => [4, 3, 2, 1].map((y) => `${list.filter((p) => p.year === y).length} ${CLASS_SHORT[y - 1]}`).join(' · ');
    const jvRec = recordOf((d.jv ?? []).map((g) => ({ ...g, week: Math.min(g.week, REGULAR_WEEKS - 1) })), d.user);
    const jvLast = (d.jv ?? []).filter((g) => g.home === d.user || g.away === d.user).slice(-1)[0];
    const jvLine = jvLast ? ` Last time out: ${jvLast.home === d.user ? 'home to' : 'away at'} ${esc(schools[jvLast.home === d.user ? jvLast.away : jvLast.home].name)}, ${jvLast.home === d.user ? `${jvLast.score[0]}–${jvLast.score[1]}` : `${jvLast.score[1]}–${jvLast.score[0]}`}.` : '';
    let turnover = '';
    if (over) {
      const seniors = all.filter((p) => p.year === 4).sort((a, b) => overall(b) - overall(a));
      const frosh = incomingOf(d, d.user).sort((a, b) => b.ceiling - a.ceiling);
      const names = (list: ProgramPlayer[], f: (p: ProgramPlayer) => number): string => list.slice(0, 5).map((p) => `${esc(p.name)} (${p.pos}, ${f(p)})`).join(', ');
      turnover = `<div class="dy-next"><div class="big">${seniors.length} seniors graduate. ${frosh.length} freshmen arrive.</div>
        <div><b>Leaving:</b> ${names(seniors, overall)}.</div><div><b>Freshmen to watch:</b> ${names(frosh, (p) => p.ceiling)} as seniors.</div></div>`;
    }
    this.root.innerHTML = `<p>You coach the varsity on Friday night. Everyone else plays junior varsity on Thursday. Players move up a class every year and seniors graduate.
      Call a junior varsity player up and the weakest varsity player at his position goes down in his place.</p>
      ${turnover}
      <div class="orow center"><button class="seg on" id="pgBack">Back to the season</button></div>
      <div class="dy-cols prog"><div><h3>Varsity <small>${varsity.length} players · ${count(varsity)}</small></h3>
        <table>${head}${[...varsity].sort(order).map((p) => row(p, p.calledUp ? `<button class="seg mini" data-down="${p.id}">Send down</button>` : '')).join('')}</table></div>
      <div><h3>Junior varsity <small>${jv.length} players · ${count(jv)}</small></h3>
        <p class="sl-note">JV record ${jvRec[0]}-${jvRec[1]}${jvRec[2] ? `-${jvRec[2]}` : ''}.${jvLine} Call-ups used: ${ups.length} of ${MAX_CALL_UPS}.</p>
        <table>${head}${[...jv].sort(order).map((p) => row(p, p.out ? '' : `<button class="seg mini" data-up="${p.id}"${full ? ' disabled' : ''}>Call up</button>`)).join('')}</table></div></div>
      <div id="dyMsg" class="sl-note" role="status" aria-live="polite" style="text-align:center"></div>`;
    (this.root.querySelector('#pgBack') as HTMLElement).addEventListener('click', () => { this.view = 'season'; this.render(); });
    const move = (id: string, up: boolean): void => {
      try {
        this.d = setCallUp(d, id, up);
        this.host.save(this.d);
        this.render();
      } catch (e) {
        (this.root.querySelector('#dyMsg') as HTMLElement).textContent = e instanceof Error ? e.message : String(e);
      }
    };
    this.root.querySelectorAll<HTMLElement>('[data-up]').forEach((el) => el.addEventListener('click', () => move(el.dataset.up!, true)));
    this.root.querySelectorAll<HTMLElement>('[data-down]').forEach((el) => el.addEventListener('click', () => move(el.dataset.down!, false)));
  }

  private renderSeason(d: Dynasty): void {
    const schools = d.league.schools;
    const me = schools[d.user];
    const state = stateByCode(d.league.state);
    const over = d.week > REGULAR_WEEKS;
    this.title.textContent = `${state.name} · Year ${d.year}`;
    const table = standings(d.results);
    const dot = (i: number): string => `<span class="chip-sq" style="background:${css(schools[i].colors.jersey)}"></span>`;
    const rows = table.map((r, i) => `<tr class="${r.school === d.user ? 'me' : ''}"><td>${i + 1}</td><td>${dot(r.school)}${esc(schools[r.school].name)} ${esc(schools[r.school].mascot)}</td><td><b>${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}</b></td><td>${r.pointsFor}</td><td>${r.pointsAgainst}</td></tr>`).join('');
    const line = (g: GameResult): string => `<div class="dy-game${g.home === d.user || g.away === d.user ? ' me' : ''}"><span>${esc(schools[g.away].name)} at ${esc(schools[g.home].name)}</span><b>${g.score[1]}–${g.score[0]}</b></div>`;
    const lastWeek = d.week - 1;
    const last = lastWeek >= 0 ? d.results.filter((g) => g.week === lastWeek) : [];
    const own = over ? null : userGame(d);
    const c = career(d);
    // Varsity players who cannot play this week.
    const sidelined = over ? [] : programOf(d, d.user).filter((p) => p.out && p.squad === 'varsity');

    let next = '';
    if (over) {
      const h = d.history[d.history.length - 1];
      next = `<div class="dy-next"><div class="big">${h.champion === d.user ? `State champions! ${esc(me.name)} ${esc(me.mascot)} win it all.` : `${esc(schools[h.champion].name)} ${esc(schools[h.champion].mascot)} are ${state.name} champions.`}</div>
        <div>You finished the regular season in place ${h.place} at ${h.record[0]}-${h.record[1]}${h.record[2] ? `-${h.record[2]}` : ''} overall.</div>
        <div class="orow"><button class="seg on" id="dyNext">Start year ${d.year + 1}</button></div></div>`;
    } else if (own) {
      const [hm, aw] = own;
      const opp = hm === d.user ? aw : hm;
      const wx = WEATHER[gameSetup(d, d.week, hm, aw).weather];
      const oppRow = table.find((r) => r.school === opp)!;
      const night = occasionFor(d.week, hm);
      const nightText = night === 'homecoming' ? `Homecoming at ${esc(schools[hm].name)}. ` : night === 'seniorNight' ? `Senior night at ${esc(schools[hm].name)}. ` : night === 'opener' ? `Home opener for ${esc(schools[hm].name)}. ` : '';
      next = `<div class="dy-next"><div class="big">${weekName(d.week)}: ${hm === d.user ? 'home to' : 'away at'} ${esc(schools[opp].name)} ${esc(schools[opp].mascot)}</div>
        <div>${nightText}They are ${oppRow.wins}-${oppRow.losses}${oppRow.ties ? `-${oppRow.ties}` : ''}. Forecast: ${wx.name.toLowerCase()}. ${d.setup.quarterMinutes}-minute quarters.</div>
        ${sidelined.length ? `<div class="dy-out">Not dressing: ${sidelined.map((p) => `${p.pos} ${esc(p.name)} (${esc(outText(p.out!))})`).join(', ')}.</div>` : ''}
        <div class="orow"><button class="seg on" id="dyPlay">Coach the game</button><button class="seg" id="dySim">Let my assistant coach it</button></div></div>`;
    } else {
      const [hm, aw] = weekGames(d)[0];
      next = `<div class="dy-next"><div class="big">Championship: ${esc(schools[aw].name)} at ${esc(schools[hm].name)}</div><div>Your season is over. Watch how it ends.</div>
        <div class="orow"><button class="seg on" id="dySim">Play the championship</button></div></div>`;
    }

    const upcoming = over ? '' : `<h3>${weekName(d.week)}</h3>${weekGames(d).map(([hm, aw]) => `<div class="dy-game${hm === d.user || aw === d.user ? ' me' : ''}"><span>${esc(schools[aw].name)} at ${esc(schools[hm].name)}</span><span>${WEATHER[gameSetup(d, d.week, hm, aw).weather].name}</span></div>`).join('')}`;
    const past = d.history.length ? `<h3>Trophy case</h3>${[...d.history].reverse().slice(0, 8).map((h) => `<div class="dy-game${h.champion === d.user ? ' me' : ''}"><span>Year ${h.year}: ${esc(schools[h.champion].name)} beat ${esc(schools[h.runnerUp].name)}</span><span>you ${h.record[0]}-${h.record[1]}${h.record[2] ? `-${h.record[2]}` : ''}</span></div>`).join('')}` : '';

    this.root.innerHTML = `<p>${dot(d.user)}Coach of the ${esc(me.name)} ${esc(me.mascot)}${c.seasons ? ` · career ${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''} · ${c.championships} ${c.championships === 1 ? 'championship' : 'championships'}` : ''}</p>
      ${next}
      ${over && d.awards?.length && d.awards[d.awards.length - 1].year === d.year ? `<h3>${seasonYear(d.year)} awards</h3>${this.awardsHtml(d, d.awards[d.awards.length - 1], false)}` : ''}
      <div class="dy-cols"><div><h3>Standings</h3><table><tr><th>#</th><th>School</th><th>Record</th><th>PF</th><th>PA</th></tr>${rows}</table></div>
      <div>${upcoming}${last.length ? `<h3>${weekName(lastWeek)} results</h3>${last.map(line).join('')}` : ''}${past}</div></div>
      ${this.editing >= 0 ? schoolFormHtml(schools[this.editing]) : `<div class="orow center" style="margin-top:12px"><label class="pick">Rename a school <select id="dyEdit"><option value="">Choose\u2026</option>${schools.map((s, i) => `<option value="${i}">${esc(s.name)} ${esc(s.mascot)}</option>`).join('')}</select></label></div>`}
      ${this.programNewsHtml(d)}
      ${this.newsHtml(d)}
      <div class="orow center" style="margin-top:14px"><button class="seg on" id="dyProgram">Your program: varsity and JV</button><button class="seg on" id="dyStats">Statistics</button><button class="seg on" id="dyRecords">Record book</button><button class="seg on" id="dyAwards">Awards</button><button class="seg" id="dyBack">Main menu</button><button class="seg" id="dyQuit">Abandon this dynasty</button></div>
      <div id="dyMsg" class="sl-note" role="status" aria-live="polite" style="text-align:center"></div>`;
    const q = (id: string): HTMLElement | null => this.root.querySelector(`#${id}`);
    q('dyBack')!.addEventListener('click', () => this.host.back());
    q('dyProgram')!.addEventListener('click', () => { this.view = 'program'; this.render(); });
    q('dyStats')!.addEventListener('click', () => { this.view = 'stats'; this.render(); });
    q('dyRecords')!.addEventListener('click', () => { this.view = 'records'; this.bookOf = d.user; this.render(); });
    q('dyAwards')!.addEventListener('click', () => { this.view = 'awards'; this.render(); });
    q('dyEdit')?.addEventListener('change', (e) => {
      const i = (e.target as HTMLSelectElement).value;
      if (i === '') return;
      this.editing = Number(i);
      this.render();
    });
    if (this.editing >= 0) {
      const i = this.editing;
      bindSchoolForm(this.root, schools.filter((_, k) => k !== i), (identity) => {
        this.d = { ...d, league: editSchool(d.league, i, identity) };
        this.host.save(this.d);
        this.editing = -1;
        this.render();
      }, () => { this.editing = -1; this.render(); });
    }
    q('dyQuit')!.addEventListener('click', (e) => {
      const el = e.currentTarget as HTMLElement;
      if (el.dataset.sure !== '1') {
        el.dataset.sure = '1';
        el.textContent = 'Really abandon? This cannot be undone';
        return;
      }
      this.d = null;
      this.view = 'season';
      this.host.save(null);
      this.pickSeed = this.newSeed();
      this.render();
    });
    q('dyNext')?.addEventListener('click', () => {
      this.d = nextSeason(d);
      this.host.save(this.d);
      this.render();
    });
    q('dyPlay')?.addEventListener('click', () => {
      const [hm, aw] = own!;
      this.host.play({
        seed: gameSeed(d, d.week, hm, aw), teams: matchTeams(d, hm, aw), user: hm === d.user ? 0 : 1, setup: gameSetup(d, d.week, hm, aw),
        week: d.week, home: hm, away: aw, label: `${state.name} year ${d.year}, ${weekName(d.week).toLowerCase()}`,
      });
    });
    q('dySim')?.addEventListener('click', () => {
      if (this.busy) return;
      this.busy = true;
      q('dyMsg')!.textContent = 'Playing the games…';
      // Let the message paint before the games are worked out.
      window.setTimeout(() => {
        this.d = playWeek(d);
        this.host.save(this.d);
        this.busy = false;
        this.render();
      }, 30);
    });
  }
}
