import { WEATHER, type GameSetup, type Weather } from '@fnd/core';
import { REGULAR_WEEKS, STATES, stateByCode } from '@fnd/league';
import type { LeagueView, RoomView } from '@fnd/online';

/**
 * Dynasty with friends: a league on the server where each coach runs a school.
 * This screen only shows what the server says and sends button presses; the server runs the league.
 */

export interface SharedApi {
  create(state: string, setup: GameSetup): Promise<LeagueView>;
  get(code: string): Promise<LeagueView>;
  claim(code: string, school: number): Promise<LeagueView>;
  start(code: string): Promise<LeagueView>;
  force(code: string): Promise<LeagueView>;
  next(code: string): Promise<LeagueView>;
  play(code: string): Promise<RoomView>;
}

export interface SharedHost {
  api: SharedApi;
  setup(): GameSetup;
  /** Hands a game room to the online game screen. */
  openRoom(room: RoomView): void;
  back(): void;
  errorText(e: unknown): string;
  /** How often to ask the server for news, in milliseconds. */
  pollMs(): number;
  remember(code: string | null): void;
}

const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const weekName = (w: number): string => (w < REGULAR_WEEKS ? `Week ${w + 1}` : 'Championship');
const rec = (r: readonly [number, number, number] | { wins: number; losses: number; ties: number }): string => {
  const [w, l, t] = Array.isArray(r) ? r : [(r as { wins: number }).wins, (r as { losses: number }).losses, (r as { ties: number }).ties];
  return `${w}-${l}${t ? `-${t}` : ''}`;
};

export class SharedLeagueScreen {
  private view: LeagueView | null = null;
  private timer = 0;
  private busy = false;
  private drawn = '';
  private pickState = 'TX';
  private message = '';

  constructor(private readonly root: HTMLElement, private readonly title: HTMLElement, private readonly host: SharedHost) {}

  get code(): string | null {
    return this.view?.code ?? null;
  }
  get current(): LeagueView | null {
    return this.view;
  }

  /** Shows the form for starting a league. */
  openNew(): void {
    this.close();
    this.title.textContent = 'Dynasty with friends';
    this.root.innerHTML = `<p>Start a league and share its code. Each friend takes a school; the AI runs the rest. When two coaches meet, both have to be online to play.</p>
      <div class="orow center"><label class="pick">State <select id="shState">${STATES.map((s) => `<option value="${s.code}"${s.code === this.pickState ? ' selected' : ''}>${s.name}</option>`).join('')}</select></label>
      <button class="seg on" id="shCreate">Start the league</button><button class="seg" id="shBack">Back</button></div>
      <p>Quarter length comes from the main menu: ${this.host.setup().quarterMinutes} minutes.</p><div id="shMsg" class="sl-note" role="status" aria-live="polite" style="text-align:center"></div>`;
    const q = (id: string): HTMLElement => this.root.querySelector(`#${id}`) as HTMLElement;
    (q('shState') as HTMLSelectElement).addEventListener('change', (e) => { this.pickState = (e.target as HTMLSelectElement).value; });
    q('shBack').addEventListener('click', () => this.host.back());
    q('shCreate').addEventListener('click', () => void this.act(() => this.host.api.create(this.pickState, this.host.setup())));
  }

  /** Opens a league by its code and keeps it up to date. */
  async open(code: string): Promise<boolean> {
    this.close();
    this.title.textContent = 'Dynasty with friends';
    this.root.innerHTML = '<div class="waiting">Opening the league</div>';
    try {
      this.take(await this.host.api.get(code));
      return true;
    } catch (e) {
      this.root.innerHTML = `<p>${esc(this.host.errorText(e))}</p><div class="orow center"><button class="seg" id="shBack">Back</button></div>`;
      this.root.querySelector('#shBack')!.addEventListener('click', () => this.host.back());
      return false;
    }
  }

  /** Stops asking the server for news (the coach has left the screen or gone into a game). */
  close(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.view = null;
    this.drawn = '';
    this.message = '';
  }

  private take(v: LeagueView): void {
    this.view = v;
    this.host.remember(v.code);
    if (!this.timer) this.timer = window.setInterval(() => void this.poll(), this.host.pollMs());
    this.render();
  }

  private async poll(): Promise<void> {
    if (this.busy || !this.view) return;
    try {
      const v = await this.host.api.get(this.view.code);
      if (this.view) this.take(v);
    } catch {
      // A missed check-in is fine; the next one will catch up.
    }
  }

  private async act(fn: () => Promise<LeagueView>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.message = '';
      this.take(await fn());
    } catch (e) {
      this.message = this.host.errorText(e);
      const el = this.root.querySelector('#shMsg');
      if (el) el.textContent = this.message;
    } finally {
      this.busy = false;
    }
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    // Only redraw when something changed, so a button is never replaced under the coach's finger.
    const stamp = JSON.stringify(v) + this.message;
    if (stamp === this.drawn) return;
    this.drawn = stamp;
    const state = stateByCode(v.stateCode);
    this.title.textContent = v.state === 'lobby' ? `${state.name} league` : `${state.name} · Year ${v.year}`;
    const dot = (i: number): string => `<span class="chip-sq" style="background:${css(v.schools[i].colors.jersey)}"></span>`;
    const who = (i: number): string => (v.schools[i].coach ? ` <small>(${esc(v.schools[i].coach!)})</small>` : '');
    const head = `<p>League code <b class="sh-code">${v.code}</b> · commissioner ${esc(v.commissioner)} · ${v.quarterMinutes}-minute quarters</p>`;
    const foot = `<div class="orow center" style="margin-top:14px"><button class="seg" id="shBack">Main menu</button></div><div id="shMsg" class="sl-note" role="status" aria-live="polite" style="text-align:center">${esc(this.message)}</div>`;

    if (v.state === 'lobby') {
      const coaches = v.schools.filter((s) => s.coach).length;
      this.root.innerHTML = `${head}<p>Share the code. Each coach signs in, joins with it and takes a school. Schools nobody takes are run by the AI.</p>
        <div class="dy-pick">${v.schools.map((s, i) => `<button class="team-card${i === v.you ? ' me' : ''}" data-school="${i}" ${s.coach && i !== v.you ? 'disabled' : ''}><div class="swatch" style="background:linear-gradient(90deg, ${css(s.colors.jersey)} 0 60%, ${css(s.colors.trim)} 60% 80%, ${css(s.colors.helmet)} 80%)"></div><div class="nm">${esc(s.name)} ${s.mascot}</div><div class="sub">${s.coach ? `Coach ${esc(s.coach)}${i === v.you ? ' (you)' : ''}` : 'Open · AI for now'}</div></button>`).join('')}</div>
        <div class="orow center" style="margin-top:12px">${v.isCommissioner ? `<button class="seg on" id="shStart" ${coaches ? '' : 'disabled'}>Start the season (${coaches} ${coaches === 1 ? 'coach' : 'coaches'})</button>` : '<span class="sl-note">Waiting for the commissioner to start the season.</span>'}</div>${foot}`;
      this.root.querySelectorAll<HTMLButtonElement>('[data-school]').forEach((el) => el.addEventListener('click', () => { if (!el.disabled) void this.act(() => this.host.api.claim(v.code, Number(el.dataset.school))); }));
      this.root.querySelector('#shStart')?.addEventListener('click', () => void this.act(() => this.host.api.start(v.code)));
    } else {
      const rows = v.standings.map((r, i) => `<tr class="${r.school === v.you ? 'me' : ''}"><td>${i + 1}</td><td>${dot(r.school)}${esc(v.schools[r.school].name)} ${v.schools[r.school].mascot}${who(r.school)}</td><td><b>${rec(r)}</b></td><td>${r.pointsFor}</td><td>${r.pointsAgainst}</td></tr>`).join('');
      const mine = v.games.find((g) => g.home === v.you || g.away === v.you) ?? null;
      let next = '';
      if (v.over) {
        const h = v.history[v.history.length - 1];
        next = `<div class="dy-next"><div class="big">${h.champion === v.you ? 'State champions! You win it all.' : `${esc(v.schools[h.champion].name)} ${v.schools[h.champion].mascot} are ${state.name} champions${v.schools[h.champion].coach ? `, coached by ${esc(v.schools[h.champion].coach!)}` : ''}.`}</div>
          <div>${v.you >= 0 ? `You finished ${rec(v.record)}.` : ''}</div><div class="orow">${v.isCommissioner ? `<button class="seg on" id="shNext">Start year ${v.year + 1}</button>` : '<span class="sl-note">The commissioner starts the next year.</span>'}</div></div>`;
      } else if (mine && !mine.score) {
        const opp = mine.home === v.you ? mine.away : mine.home;
        const oppCoach = v.schools[opp].coach;
        next = `<div class="dy-next"><div class="big">${weekName(v.week)}: ${mine.home === v.you ? 'home to' : 'away at'} ${esc(v.schools[opp].name)} ${v.schools[opp].mascot}</div>
          <div>${oppCoach ? `Coached by ${esc(oppCoach)}. You both have to be here to play${mine.open ? ', and a coach is already waiting in the game' : ''}.` : 'Run by the AI. Play it whenever you like.'} Forecast: ${WEATHER[mine.weather as Weather].name.toLowerCase()}.</div>
          <div class="orow"><button class="seg on" id="shPlay">${oppCoach ? (mine.open ? 'Join the game' : 'Open the game and wait') : 'Coach the game'}</button></div></div>`;
      } else {
        const left = v.games.filter((g) => !g.score);
        next = `<div class="dy-next"><div class="big">${mine ? 'Your game is in.' : v.you >= 0 ? 'No game for you this week.' : 'You are watching this league.'}</div>
          <div>${left.length ? `Waiting on ${left.map((g) => `${esc(v.schools[g.away].name)} at ${esc(v.schools[g.home].name)}`).join(', ')}.` : 'Finishing the week…'}</div></div>`;
      }
      const games = v.over ? '' : `<h3>${weekName(v.week)}</h3>${v.games.map((g) => `<div class="dy-game${g.home === v.you || g.away === v.you ? ' me' : ''}"><span>${esc(v.schools[g.away].name)} at ${esc(v.schools[g.home].name)}</span>${g.score ? `<b>${g.score[1]}–${g.score[0]}</b>` : `<span>${g.human[0] || g.human[1] ? (g.open ? 'In the room' : 'Waiting for coaches') : 'AI game'}</span>`}</div>`).join('')}`;
      const last = v.lastWeek.length ? `<h3>${weekName(v.week - 1)} results</h3>${v.lastWeek.map((g) => `<div class="dy-game${g.home === v.you || g.away === v.you ? ' me' : ''}"><span>${esc(v.schools[g.away].name)} at ${esc(v.schools[g.home].name)}</span><b>${g.score[1]}–${g.score[0]}</b></div>`).join('')}` : '';
      const past = v.history.length ? `<h3>Champions</h3>${[...v.history].reverse().slice(0, 8).map((h) => `<div class="dy-game${h.champion === v.you ? ' me' : ''}"><span>Year ${h.year}: ${esc(v.schools[h.champion].name)}${who(h.champion)}</span><span>beat ${esc(v.schools[h.runnerUp].name)}</span></div>`).join('')}` : '';
      const force = v.isCommissioner && !v.over && v.games.some((g) => !g.score && (g.human[0] || g.human[1]))
        ? `<div class="orow center" style="margin-top:10px"><button class="seg" id="shForce">${v.forced ? 'Moving the week on…' : 'Commissioner: let the AI finish this week'}</button></div>` : '';
      this.root.innerHTML = `${head}${next}<div class="dy-cols"><div><h3>Standings</h3><table><tr><th>#</th><th>School</th><th>Record</th><th>PF</th><th>PA</th></tr>${rows}</table></div><div>${games}${last}${past}</div></div>${force}${foot}`;
      this.root.querySelector('#shNext')?.addEventListener('click', () => void this.act(() => this.host.api.next(v.code)));
      this.root.querySelector('#shForce')?.addEventListener('click', (e) => {
        const el = e.currentTarget as HTMLElement;
        if (v.forced) return;
        if (el.dataset.sure !== '1') {
          el.dataset.sure = '1';
          el.textContent = 'Really? Coaches who have not played get an AI result';
          return;
        }
        void this.act(() => this.host.api.force(v.code));
      });
      this.root.querySelector('#shPlay')?.addEventListener('click', () => {
        if (this.busy) return;
        this.busy = true;
        this.host.api.play(v.code).then((room) => {
          this.busy = false;
          window.clearInterval(this.timer);
          this.timer = 0;
          this.host.openRoom(room);
        }).catch((e: unknown) => {
          this.busy = false;
          this.message = this.host.errorText(e);
          this.drawn = '';
          this.render();
        });
      });
    }
    this.root.querySelector('#shBack')!.addEventListener('click', () => { this.close(); this.host.back(); });
  }
}
