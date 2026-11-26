import { GROUPS, WEATHER, overall, type GameSetup, type Team } from '@fnd/core';
import {
  CLASS_NAMES, CLASS_SHORT, MAX_CALL_UPS, REGULAR_WEEKS, STATES, career, incomingOf, occasionFor, programOf, recordOf, setCallUp, createDynasty, createLeague, editSchool, gameSeed, gameSetup, loadDynasty, nextSeason, playWeek, standings, stateByCode, teamFor, userGame, weekGames, winnerOf,
  type Dynasty, type GameResult, type ProgramPlayer,
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
const weekName = (w: number): string => (w < REGULAR_WEEKS ? `Week ${w + 1}` : 'Championship');

export class DynastyScreen {
  private d: Dynasty | null;
  private pickState = 'TX';
  private pickSeed = 1;
  private busy = false;
  private editing = -1;
  /** Which page of the dynasty is showing: the season, or the program (varsity, junior varsity, classes). */
  private view: 'season' | 'program' = 'season';

  constructor(private readonly root: HTMLElement, private readonly title: HTMLElement, private readonly host: DynastyHost, newSeed: () => number) {
    this.d = loadDynasty(host.load());
    this.newSeed = newSeed;
    this.pickSeed = newSeed();
  }
  private readonly newSeed: () => number;

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
    else if (this.d) this.renderSeason(this.d);
    else this.renderNew();
  }

  /** Records the coach's finished game and plays the rest of that week. */
  finishGame(g: DynastyGame, score: readonly [number, number]): { won: boolean | null; text: string } {
    const d = this.d!;
    const mine: GameResult = { week: g.week, home: g.home, away: g.away, score: [score[0], score[1]] };
    this.d = playWeek(d, mine);
    this.host.save(this.d);
    const us = g.user === 0 ? score[0] : score[1];
    const them = g.user === 0 ? score[1] : score[0];
    if (g.week === REGULAR_WEEKS) {
      const champ = winnerOf(mine) === d.user;
      return { won: champ, text: champ ? `${d.league.schools[d.user].name} are ${stateByCode(d.league.state).name} champions!${us === them ? ' A tie goes to the home team, which finished first.' : ''}` : `Runners-up. ${us === them ? 'A tie goes to the home team, which finished first.' : 'So close.'}` };
    }
    return { won: us === them ? null : us > them, text: `${weekName(g.week)} is in the books.` };
  }

  private renderNew(): void {
    this.title.textContent = 'Start a dynasty';
    const league = createLeague(this.pickState, this.pickSeed);
    this.root.innerHTML = `<p>Pick a state. Eight schools are drawn up for it; choose the one you will coach. Seven league games, then first plays second for the title.</p>
      <div class="orow center"><label class="pick">State <select id="dyState">${STATES.map((s) => `<option value="${s.code}"${s.code === this.pickState ? ' selected' : ''}>${s.name}</option>`).join('')}</select></label>
      <button class="seg" id="dyShuffle">Draw new schools</button><button class="seg" id="dyBack">Back</button></div>
      <h3>${esc(stateByCode(this.pickState).name)} league: choose your school</h3>
      <div class="dy-pick">${league.schools.map((s, i) => `<button class="team-card" data-school="${i}"><div class="swatch" style="background:linear-gradient(90deg, ${css(s.colors.jersey)} 0 60%, ${css(s.colors.trim)} 60% 80%, ${css(s.colors.helmet)} 80%)"></div><div class="nm">${esc(s.name)} ${esc(s.mascot)}</div><div class="sub">${s.abbr} · ${s.prestige >= 60 ? 'Powerhouse' : s.prestige >= 58 ? 'Contender' : s.prestige >= 56 ? 'Middle of the pack' : 'Rebuilding'}</div></button>`).join('')}</div>`;
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
    const row = (p: ProgramPlayer, action: string): string => `<tr><td>${p.pos}</td><td>${esc(p.name)}${p.calledUp ? ' <span class="tag-up">called up</span>' : ''}</td><td>${cls(p)}</td><td><b>${overall(p)}</b></td><td>${p.year < 4 ? p.ceiling : ''}</td><td>${action}</td></tr>`;
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
        <table>${head}${[...jv].sort(order).map((p) => row(p, `<button class="seg mini" data-up="${p.id}"${full ? ' disabled' : ''}>Call up</button>`)).join('')}</table></div></div>
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
      <div class="dy-cols"><div><h3>Standings</h3><table><tr><th>#</th><th>School</th><th>Record</th><th>PF</th><th>PA</th></tr>${rows}</table></div>
      <div>${upcoming}${last.length ? `<h3>${weekName(lastWeek)} results</h3>${last.map(line).join('')}` : ''}${past}</div></div>
      ${this.editing >= 0 ? schoolFormHtml(schools[this.editing]) : `<div class="orow center" style="margin-top:12px"><label class="pick">Rename a school <select id="dyEdit"><option value="">Choose\u2026</option>${schools.map((s, i) => `<option value="${i}">${esc(s.name)} ${esc(s.mascot)}</option>`).join('')}</select></label></div>`}
      <div class="orow center" style="margin-top:14px"><button class="seg on" id="dyProgram">Your program: varsity and JV</button><button class="seg" id="dyBack">Main menu</button><button class="seg" id="dyQuit">Abandon this dynasty</button></div>
      <div id="dyMsg" class="sl-note" role="status" aria-live="polite" style="text-align:center"></div>`;
    const q = (id: string): HTMLElement | null => this.root.querySelector(`#${id}`);
    q('dyBack')!.addEventListener('click', () => this.host.back());
    q('dyProgram')!.addEventListener('click', () => { this.view = 'program'; this.render(); });
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
        seed: gameSeed(d, d.week, hm, aw), teams: [teamFor(d, hm), teamFor(d, aw)], user: hm === d.user ? 0 : 1, setup: gameSetup(d, d.week, hm, aw),
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
