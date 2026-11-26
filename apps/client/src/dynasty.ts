import { WEATHER, type GameSetup, type Team } from '@fnd/core';
import {
  REGULAR_WEEKS, STATES, career, createDynasty, createLeague, gameSeed, gameSetup, loadDynasty, nextSeason, playWeek, standings, stateByCode, teamFor, userGame, weekGames, winnerOf,
  type Dynasty, type GameResult,
} from '@fnd/league';

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
    if (this.d) this.renderSeason(this.d);
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
      <div class="dy-pick">${league.schools.map((s, i) => `<button class="team-card" data-school="${i}"><div class="swatch" style="background:linear-gradient(90deg, ${css(s.colors.jersey)} 0 60%, ${css(s.colors.trim)} 60% 80%, ${css(s.colors.helmet)} 80%)"></div><div class="nm">${esc(s.name)} ${s.mascot}</div><div class="sub">${s.abbr} · ${s.prestige >= 60 ? 'Powerhouse' : s.prestige >= 58 ? 'Contender' : s.prestige >= 56 ? 'Middle of the pack' : 'Rebuilding'}</div></button>`).join('')}</div>`;
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

  private renderSeason(d: Dynasty): void {
    const schools = d.league.schools;
    const me = schools[d.user];
    const state = stateByCode(d.league.state);
    const over = d.week > REGULAR_WEEKS;
    this.title.textContent = `${state.name} · Year ${d.year}`;
    const table = standings(d.results);
    const dot = (i: number): string => `<span class="chip-sq" style="background:${css(schools[i].colors.jersey)}"></span>`;
    const rows = table.map((r, i) => `<tr class="${r.school === d.user ? 'me' : ''}"><td>${i + 1}</td><td>${dot(r.school)}${esc(schools[r.school].name)} ${schools[r.school].mascot}</td><td><b>${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}</b></td><td>${r.pointsFor}</td><td>${r.pointsAgainst}</td></tr>`).join('');
    const line = (g: GameResult): string => `<div class="dy-game${g.home === d.user || g.away === d.user ? ' me' : ''}"><span>${esc(schools[g.away].name)} at ${esc(schools[g.home].name)}</span><b>${g.score[1]}–${g.score[0]}</b></div>`;
    const lastWeek = d.week - 1;
    const last = lastWeek >= 0 ? d.results.filter((g) => g.week === lastWeek) : [];
    const own = over ? null : userGame(d);
    const c = career(d);

    let next = '';
    if (over) {
      const h = d.history[d.history.length - 1];
      next = `<div class="dy-next"><div class="big">${h.champion === d.user ? `State champions! ${esc(me.name)} ${me.mascot} win it all.` : `${esc(schools[h.champion].name)} ${schools[h.champion].mascot} are ${state.name} champions.`}</div>
        <div>You finished the regular season in place ${h.place} at ${h.record[0]}-${h.record[1]}${h.record[2] ? `-${h.record[2]}` : ''} overall.</div>
        <div class="orow"><button class="seg on" id="dyNext">Start year ${d.year + 1}</button></div></div>`;
    } else if (own) {
      const [hm, aw] = own;
      const opp = hm === d.user ? aw : hm;
      const wx = WEATHER[gameSetup(d, d.week, hm, aw).weather];
      const oppRow = table.find((r) => r.school === opp)!;
      next = `<div class="dy-next"><div class="big">${weekName(d.week)}: ${hm === d.user ? 'home to' : 'away at'} ${esc(schools[opp].name)} ${schools[opp].mascot}</div>
        <div>They are ${oppRow.wins}-${oppRow.losses}${oppRow.ties ? `-${oppRow.ties}` : ''}. Forecast: ${wx.name.toLowerCase()}. ${d.setup.quarterMinutes}-minute quarters.</div>
        <div class="orow"><button class="seg on" id="dyPlay">Coach the game</button><button class="seg" id="dySim">Let my assistant coach it</button></div></div>`;
    } else {
      const [hm, aw] = weekGames(d)[0];
      next = `<div class="dy-next"><div class="big">Championship: ${esc(schools[aw].name)} at ${esc(schools[hm].name)}</div><div>Your season is over. Watch how it ends.</div>
        <div class="orow"><button class="seg on" id="dySim">Play the championship</button></div></div>`;
    }

    const upcoming = over ? '' : `<h3>${weekName(d.week)}</h3>${weekGames(d).map(([hm, aw]) => `<div class="dy-game${hm === d.user || aw === d.user ? ' me' : ''}"><span>${esc(schools[aw].name)} at ${esc(schools[hm].name)}</span><span>${WEATHER[gameSetup(d, d.week, hm, aw).weather].name}</span></div>`).join('')}`;
    const past = d.history.length ? `<h3>Trophy case</h3>${[...d.history].reverse().slice(0, 8).map((h) => `<div class="dy-game${h.champion === d.user ? ' me' : ''}"><span>Year ${h.year}: ${esc(schools[h.champion].name)} beat ${esc(schools[h.runnerUp].name)}</span><span>you ${h.record[0]}-${h.record[1]}${h.record[2] ? `-${h.record[2]}` : ''}</span></div>`).join('')}` : '';

    this.root.innerHTML = `<p>${dot(d.user)}Coach of the ${esc(me.name)} ${me.mascot}${c.seasons ? ` · career ${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''} · ${c.championships} ${c.championships === 1 ? 'championship' : 'championships'}` : ''}</p>
      ${next}
      <div class="dy-cols"><div><h3>Standings</h3><table><tr><th>#</th><th>School</th><th>Record</th><th>PF</th><th>PA</th></tr>${rows}</table></div>
      <div>${upcoming}${last.length ? `<h3>${weekName(lastWeek)} results</h3>${last.map(line).join('')}` : ''}${past}</div></div>
      <div class="orow center" style="margin-top:14px"><button class="seg" id="dyBack">Main menu</button><button class="seg" id="dyQuit">Abandon this dynasty</button></div>
      <div id="dyMsg" class="sl-note" role="status" aria-live="polite" style="text-align:center"></div>`;
    const q = (id: string): HTMLElement | null => this.root.querySelector(`#${id}`);
    q('dyBack')!.addEventListener('click', () => this.host.back());
    q('dyQuit')!.addEventListener('click', (e) => {
      const el = e.currentTarget as HTMLElement;
      if (el.dataset.sure !== '1') {
        el.dataset.sure = '1';
        el.textContent = 'Really abandon? This cannot be undone';
        return;
      }
      this.d = null;
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
