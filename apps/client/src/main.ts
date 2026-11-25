import {
  DEFENSE_CALLS, DEF_POS, OFFENSE_PLAYS, OFF_POS, RULES, U, callById, exhibitionTeams, playById,
  type DefCall, type DefDecision, type OffDecision, type OffPlay, type PlayEvent, type Team,
} from '@fnd/core';
import { fieldGoalDistance } from '@fnd/football-ai';
import { AutoCoach, Game, gameHash, simulateGame, summarize, type PlaySim } from '@fnd/match-sim';
import { FieldScene, createGame, type FieldView, type ViewPlayer } from './scene';
import { setMuted, sfx, unlockAudio } from './audio';
import titleUrl from './assets/title.jpg';

/** Client controller: turns the coach's choices into engine decisions and engine state into a view. */

const W_YD = 53.333;
const CY_YD = W_YD / 2;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const other = (t: 0 | 1): 0 | 1 => (t === 0 ? 1 : 0);
const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const ord = (n: number): string => ['', '1st', '2nd', '3rd', '4th'][n] ?? `${n}th`;

type Mode = 'menu' | 'choose' | 'presnap' | 'live' | 'replay' | 'kick' | 'post' | 'final';
interface KickAnim { x0: number; x1: number; y0: number; y1: number; t: number; T: number; e: PlayEvent }

let teams: readonly [Team, Team];
let game: Game;
let coach: AutoCoach;
let seed = 1;
let user: 0 | 1 = 0;
let mode: Mode = 'menu';
let speed = 1; // 1 normal, 4 fast, 0 skip
let timer = 0;
let acc = 0;
let frame = 0;
let viewSim: PlaySim | null = null;
let viewOffense: 0 | 1 = 0;
let lineup: ViewPlayer[] = [];
let spot = { x: 50, y: CY_YD };
let marks: { los: number; toGain: number } | null = null;
let kick: KickAnim | null = null;
let pendingOff: OffDecision | null = null;
let pendingEvent: PlayEvent | null = null;
let wantTimeout = false;
let lastQuarter = 1;
let keyHandler: ((k: string) => void) | null = null;

const scene = new FieldScene();
scene.onFrame = (dt) => step(dt);
createGame('phaser', scene);

// ------------------------------------------------------------------ geometry

const abs = (team: 0 | 1, x: number, y: number): [number, number] => (team === 0 ? [x, y] : [100 - x, W_YD - y]);

function scrimmageLineup(off: 0 | 1, los: number): ViewPlayer[] {
  const out: ViewPlayer[] = [];
  const play = OFFENSE_PLAYS[0];
  const call = DEFENSE_CALLS[0];
  for (const pos of OFF_POS) {
    const [x, y] = abs(off, los + play.formation[pos][0], CY_YD + play.formation[pos][1]);
    out.push({ team: off, x, y, moving: false, down: false, hasBall: false });
  }
  for (const pos of DEF_POS) {
    const [x, y] = abs(off, Math.min(los + call.formation[pos][0], 108), CY_YD + call.formation[pos][1]);
    out.push({ team: other(off), x, y, moving: false, down: false, hasBall: false });
  }
  return out;
}

function kickoffLineup(kicking: 0 | 1, from: number): ViewPlayer[] {
  const out: ViewPlayer[] = [];
  for (let i = 0; i < 11; i++) {
    const [x, y] = abs(kicking, i === 5 ? from - 4 : from - 1, 4 + i * 4.5);
    out.push({ team: kicking, x, y, moving: false, down: false, hasBall: false });
  }
  const rows: [number, number][] = [[15, 5], [28, 4], [48, 2]];
  for (const [depth, n] of rows) for (let i = 0; i < n; i++) {
    const [x, y] = abs(kicking, Math.min(from + depth, 96), (W_YD * (i + 1)) / (n + 1));
    out.push({ team: other(kicking), x, y, moving: false, down: false, hasBall: false });
  }
  return out;
}

function setStatic(): void {
  const s = game.state;
  viewSim = null;
  if (s.phase === 'kickoff') {
    lineup = kickoffLineup(s.kicking, s.kickFrom);
    marks = null;
    spot = { x: abs(s.kicking, s.kickFrom, CY_YD)[0], y: CY_YD };
  } else if (s.phase !== 'final') {
    const los = s.phase === 'conversion' ? RULES.twoPointFrom : s.yardLine;
    const off = s.possession;
    lineup = scrimmageLineup(off, los);
    const a = abs(off, los, CY_YD)[0];
    marks = { los: a, toGain: s.phase === 'conversion' ? 100 : abs(off, Math.min(los + s.distance, 100), CY_YD)[0] };
    if (s.phase === 'conversion') marks.toGain = 100;
    spot = { x: a, y: CY_YD };
  }
}

function buildView(): FieldView {
  if (viewSim) {
    const sim = viewSim;
    const off = viewOffense;
    const players: ViewPlayer[] = sim.players.map((p) => {
      const [x, y] = abs(off, p.x / U, p.y / U);
      return {
        team: p.side === 0 ? off : other(off), x, y,
        moving: p.x !== p.px || p.y !== p.py,
        down: sim.tick < p.stunUntil || (sim.done && sim.result !== null && !sim.result.touchdown && sim.ball.holder === p.idx && !sim.result.incomplete && sim.result.turnover !== 'interception'),
        hasBall: sim.ball.state === 'held' && sim.ball.holder === p.idx,
      };
    });
    const b = sim.ball;
    const [bx, by] = abs(off, b.x / U, b.y / U);
    const z = b.state === 'air' && b.T > 0 ? Math.round(4 * Math.min(16, b.T * 0.3) * (b.t / b.T) * (1 - b.t / b.T)) : 0;
    return { players, ball: { x: bx, y: by, z, visible: b.state !== 'held' || mode === 'presnap' }, los: marks?.los ?? null, toGain: marks?.toGain ?? null, focusX: bx, frame };
  }
  if (kick) {
    const k = kick;
    const f = k.T <= 0 ? 1 : Math.min(1, k.t / k.T);
    const x = k.x0 + (k.x1 - k.x0) * f;
    return { players: lineup, ball: { x, y: k.y0 + (k.y1 - k.y0) * f, z: Math.round(4 * 22 * f * (1 - f)), visible: true }, los: null, toGain: null, focusX: x, frame };
  }
  return { players: lineup, ball: { x: spot.x, y: spot.y, z: 0, visible: mode !== 'menu' }, los: marks?.los ?? null, toGain: marks?.toGain ?? null, focusX: spot.x, frame };
}

// ---------------------------------------------------------------- game loop

function step(dt: number): FieldView | null {
  if (mode === 'menu' || !game) return null;
  dt = Math.min(dt, 100);
  switch (mode) {
    case 'presnap':
      timer -= dt;
      if (timer <= 0) {
        mode = 'live';
        acc = 0;
        sfx.snap();
      }
      break;
    case 'live': {
      let done = false;
      if (speed === 0) {
        while (!game.tick()) { /* run to the whistle */ }
        done = true;
      } else {
        acc += dt * speed;
        for (let n = 0; acc >= 16.667 && n < 16 && !done; n++) {
          acc -= 16.667;
          frame++;
          done = game.tick();
        }
      }
      if (done) playOver(game.lastEvent);
      break;
    }
    case 'replay': {
      acc += dt;
      for (let n = 0; acc >= 16.667 && n < 4 && viewSim && !viewSim.done; n++) {
        acc -= 16.667;
        frame++;
        viewSim.step();
      }
      if (!viewSim || viewSim.done) {
        $('tag').classList.add('hidden');
        showResult(pendingEvent);
      }
      break;
    }
    case 'kick':
      if (kick) {
        kick.t += dt;
        if (kick.t >= kick.T) {
          const e = kick.e;
          kick = null;
          setStatic();
          showResult(e);
        }
      }
      break;
    case 'post':
      timer -= dt;
      if (timer <= 0) next();
      break;
    default:
      break;
  }
  return buildView();
}

function next(): void {
  $('banner').classList.add('hidden');
  $('calls').classList.add('hidden');
  const s = game.state;
  if (s.phase === 'final') return showFinal();
  updateBug();
  if (s.phase === 'kickoff') {
    const k = s.kicking;
    const from = s.kickFrom;
    setStatic();
    setPanelWaiting('Kickoff');
    game.begin(null, null);
    game.tick();
    const e = game.lastEvent!;
    startKick(k, from, Math.min(from + e.yards, 104), CY_YD, e);
    return;
  }
  setStatic();
  wantTimeout = false;
  if (s.possession === user) {
    showOffensePanel();
  } else {
    pendingOff = coach.offense(game)!;
    if (pendingOff.kind !== 'play') commit(pendingOff, { callId: 'base' });
    else showDefensePanel();
  }
}

function commit(off: OffDecision, def: DefDecision): void {
  const s = game.state;
  const offTeam = s.possession;
  const los = s.phase === 'conversion' ? RULES.twoPointFrom : s.yardLine;
  keyHandler = null;
  game.begin(off, def);
  const tb = game.lastTimeoutBy;
  if (game.live) {
    viewSim = game.live;
    viewOffense = offTeam;
    const play = off.kind === 'play' ? playById(off.playId) : null;
    const call = callById(def.callId);
    const calls = $('calls');
    calls.innerHTML = `${teams[offTeam].abbr} <b>${play?.name ?? ''}</b><br>${teams[other(offTeam)].abbr} <b>${call.name}</b>${tb !== null ? `<br>Timeout ${teams[tb].abbr}` : ''}`;
    calls.classList.remove('hidden');
    setPanelWaiting(`${play?.name ?? ''} against ${call.name}`);
    updateBug();
    mode = 'presnap';
    timer = speed === 0 ? 0 : speed === 1 ? 900 : 300;
    return;
  }
  game.tick();
  const e = game.lastEvent;
  if (!e) return showResult(null);
  setPanelWaiting(e.type === 'punt' ? 'Punt' : e.type === 'fieldGoal' ? 'Field goal attempt' : 'Extra point');
  if (e.type === 'punt') startKick(offTeam, los - 10, Math.min(los + e.yards, 104), CY_YD, e);
  else startKick(offTeam, los - 7, 110, e.flags.good ? CY_YD : CY_YD + 13, e);
}

function startKick(team: 0 | 1, from: number, to: number, toY: number, e: PlayEvent): void {
  const [x0, y0] = abs(team, from, CY_YD);
  const [x1, y1] = abs(team, to, toY);
  kick = { x0, x1, y0, y1, t: 0, T: speed === 0 ? 0 : speed === 1 ? 1200 : 450, e };
  mode = 'kick';
  sfx.kick();
}

function playOver(e: PlayEvent | null): void {
  pendingEvent = e;
  const big = !!e && (e.flags.touchdown || e.flags.interception || e.flags.fumbleLost || e.flags.safety || (e.type === 'twoPoint' && e.flags.good));
  // Scoring plays and turnovers are always shown at normal speed: replay them if they were fast-forwarded.
  if (big && speed !== 1) {
    const r = game.replayLast();
    if (r) {
      viewSim = r.sim;
      viewOffense = r.offense;
      acc = 0;
      $('tag').classList.remove('hidden');
      mode = 'replay';
      return;
    }
  }
  showResult(e);
}

function situationText(): string {
  const s = game.state;
  if (s.phase === 'final') return 'Final';
  if (s.phase === 'kickoff') return `${teams[s.kicking].abbr} to kick off`;
  if (s.phase === 'conversion') return `${teams[s.possession].abbr} try after touchdown`;
  const goal = s.yardLine + s.distance >= 100;
  return `${teams[s.possession].abbr} ${ord(s.down)} & ${goal ? 'goal' : s.distance} at ${ballOn()}`;
}

function ballOn(): string {
  const s = game.state;
  if (s.yardLine === 50) return 'the 50';
  return s.yardLine < 50 ? `${teams[s.possession].abbr} ${s.yardLine}` : `${teams[other(s.possession)].abbr} ${100 - s.yardLine}`;
}

function showResult(e: PlayEvent | null): void {
  updateBug();
  const s = game.state;
  const banner = $('banner');
  let period = '';
  if (s.phase === 'final') period = 'End of game. ';
  else if (s.quarter !== lastQuarter) period = lastQuarter === 2 ? 'Halftime. ' : `End of quarter ${lastQuarter}. `;
  lastQuarter = s.quarter;
  const big = !!e && (e.flags.touchdown || e.flags.interception || e.flags.fumbleLost || e.flags.safety || ((e.type === 'fieldGoal' || e.type === 'twoPoint') && !!e.flags.good));
  banner.className = big ? 'big' : '';
  banner.innerHTML = `${e ? e.text : 'Time runs out.'}<small>${period}${situationText()}</small>`;
  if (e) {
    if (e.flags.touchdown || ((e.type === 'fieldGoal' || e.type === 'pat' || e.type === 'twoPoint') && e.flags.good)) sfx.score();
    else if (e.flags.interception || e.flags.fumbleLost || e.flags.safety || e.flags.turnoverOnDowns) sfx.bad();
    else if (e.flags.firstDown) sfx.first();
    else if (e.flags.incomplete || e.type === 'punt' || e.type === 'kickoff') sfx.whistle();
    else sfx.tackle();
  }
  const base = big || period ? 2600 : 1700;
  timer = speed === 0 ? Math.min(base, 900) : speed === 1 ? base : Math.round(base * 0.5);
  mode = 'post';
}

// ----------------------------------------------------------------- score bug

function updateBug(): void {
  const s = game.state;
  ([0, 1] as const).forEach((t) => {
    const el = $(`s${t}`);
    (el.querySelector('.chip') as HTMLElement).style.background = css(teams[t].colors.jersey);
    el.querySelector('.ab')!.textContent = teams[t].abbr + (t === user ? ' (you)' : '');
    el.querySelector('.sc')!.textContent = String(s.score[t]);
    el.querySelector('.to')!.textContent = '■'.repeat(s.timeouts[t]) + '□'.repeat(RULES.timeoutsPerHalf - s.timeouts[t]);
    el.classList.toggle('poss', s.phase !== 'final' && (s.phase === 'kickoff' ? other(s.kicking) : s.possession) === t);
  });
  const m = Math.floor(s.clock / 60);
  const sec = String(s.clock % 60).padStart(2, '0');
  $('mid').querySelector('.clk')!.textContent = s.phase === 'final' ? 'FINAL' : `Q${s.quarter}  ${m}:${sec}`;
  let dd = '';
  if (s.phase === 'scrimmage') dd = `${ord(s.down)} & ${s.yardLine + s.distance >= 100 ? 'GOAL' : s.distance} · ${ballOn().replace('the ', '')}`;
  else if (s.phase === 'conversion') dd = 'TRY';
  else if (s.phase === 'kickoff') dd = 'KICKOFF';
  $('mid').querySelector('.dd')!.textContent = dd;
}

// -------------------------------------------------------------------- panels

function setPanelWaiting(text: string): void {
  $('panel').innerHTML = `<div class="waiting">${text}</div>`;
  $('prompt').textContent = '';
  keyHandler = null;
}

const SX = (lateral: number): number => 50 + lateral * 2.05;

function offenseDiagram(p: OffPlay): string {
  const Y = (d: number): number => 35 - Math.max(-6.5, Math.min(d, 20)) * 1.55;
  let marks = '';
  let paths = '';
  for (const pos of OFF_POS) {
    const [d0, l0] = p.formation[pos];
    const a = p.assign[pos];
    const x = SX(l0);
    const y = Y(d0);
    if (a.t === 'block' && ['LT', 'LG', 'C', 'RG', 'RT'].includes(pos)) marks += `<rect x="${x - 1.8}" y="${y - 1.8}" width="3.6" height="3.6" fill="#f3f1e7"/>`;
    else marks += `<circle cx="${x}" cy="${y}" r="2" fill="${a.t === 'carry' ? '#f2c14e' : a.t === 'qb' ? '#1c6b2c' : '#f3f1e7'}" stroke="#f3f1e7" stroke-width="0.8"/>`;
    if (a.t === 'route' || a.t === 'carry') {
      const pts: [number, number][] = [[d0, l0]];
      for (const [dx, dy] of a.pts) pts.push(a.t === 'route' ? [d0 + dx, l0 + dy] : [dx, dy]);
      const n = pts.length;
      if (a.t === 'carry') pts.push([pts[n - 1][0] + 5, pts[n - 1][1]]);
      else if (a.go) pts.push([pts[n - 1][0] + (pts[n - 1][0] - pts[n - 2][0]) * 0.8, pts[n - 1][1] + (pts[n - 1][1] - pts[n - 2][1]) * 0.8]);
      const colour = a.t === 'carry' ? '#f2c14e' : '#ffffff';
      paths += `<polyline points="${pts.map(([d, l]) => `${SX(l).toFixed(1)},${Y(d).toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="${a.t === 'carry' ? 1.8 : 1.1}" stroke-linejoin="round" marker-end="url(#ar${a.t === 'carry' ? 'c' : 'r'})"/>`;
    }
  }
  return `<svg viewBox="0 0 100 46" aria-hidden="true"><defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" fill="#fff"/></marker><marker id="arc" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M0 0L6 3L0 6z" fill="#f2c14e"/></marker></defs><line x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}" stroke="#4f8ef7" stroke-width="0.7"/>${paths}${marks}</svg>`;
}

function defenseDiagram(c: DefCall): string {
  const Y = (d: number): number => 40 - d * 2.1;
  let out = '';
  for (const pos of DEF_POS) {
    const [d0, l0] = c.formation[pos];
    const a = c.assign[pos];
    const x = SX(l0);
    const y = Y(d0);
    if (a.t === 'rush') out += `<line x1="${x}" y1="${y}" x2="${SX(l0 * 0.6)}" y2="${Y(-2)}" stroke="#ff6b6b" stroke-width="1.3" marker-end="url(#ard)"/><circle cx="${x}" cy="${y}" r="2.1" fill="#ff6b6b"/>`;
    else if (a.t === 'zone') out += `<line x1="${x}" y1="${y}" x2="${SX(a.at[1])}" y2="${Y(a.at[0])}" stroke="#f2c14e" stroke-width="0.7"/><ellipse cx="${SX(a.at[1])}" cy="${Y(a.at[0])}" rx="9" ry="4.5" fill="rgba(242,193,78,0.2)" stroke="#f2c14e" stroke-width="0.7" stroke-dasharray="2 1.5"/><circle cx="${x}" cy="${y}" r="2.1" fill="#f2c14e"/>`;
    else out += `<circle cx="${x}" cy="${y}" r="2.1" fill="#f3f1e7"/>${a.t === 'read' ? `<circle cx="${x}" cy="${y}" r="3.6" fill="none" stroke="#f3f1e7" stroke-width="0.6"/>` : ''}`;
  }
  return `<svg viewBox="0 0 100 46" aria-hidden="true"><defs><marker id="ard" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M0 0L6 3L0 6z" fill="#ff6b6b"/></marker></defs><line x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}" stroke="#4f8ef7" stroke-width="0.7"/>${out}</svg>`;
}

function timeoutButton(): string {
  const s = game.state;
  if (!s.clockRunning || s.timeouts[user] <= 0 || s.phase !== 'scrimmage') return '';
  return `<button class="act${wantTimeout ? ' on' : ''}" data-act="timeout">Timeout <kbd>[T]</kbd><small>${wantTimeout ? 'Will stop the clock before this snap' : `Clock is running. ${s.timeouts[user]} left`}</small></button>`;
}

function showOffensePanel(twoPointPick = false): void {
  const s = game.state;
  const panel = $('panel');
  mode = 'choose';
  if (s.phase === 'conversion' && !twoPointPick) {
    $('prompt').textContent = 'Touchdown! Choose the try';
    panel.innerHTML = `<div class="wide"><button class="act" data-act="pat">Kick extra point <kbd>[1]</kbd><small>1 point</small></button><button class="act" data-act="two">Go for two <kbd>[2]</kbd><small>One play from the 3</small></button></div>`;
    bind({ pat: () => commit({ kind: 'patKick' }, coach.defense(game)!), two: () => showOffensePanel(true) }, (k) => (k === '1' ? 'pat' : k === '2' ? 'two' : null));
    return;
  }
  $('prompt').textContent = s.phase === 'conversion' ? 'Two-point play' : s.down === 4 ? '4th down: go, punt or kick' : 'Call your play';
  let html = OFFENSE_PLAYS.map((p, i) => `<button class="card" data-act="p:${p.id}">${offenseDiagram(p)}<span class="nm">${p.name} <span class="kind">${p.kind}</span></span><span class="ds">${p.desc} <kbd>[${i + 1}]</kbd></span></button>`).join('');
  if (s.phase === 'scrimmage') {
    const fg = fieldGoalDistance(s.yardLine);
    html += `<div class="wide"><button class="act" data-act="punt">Punt <kbd>[P]</kbd></button>${fg <= 60 ? `<button class="act" data-act="fg">Field goal <kbd>[F]</kbd><small>${fg} yards</small></button>` : ''}${timeoutButton()}</div>`;
  }
  panel.innerHTML = html;
  const acts: Record<string, () => void> = {
    punt: () => commit({ kind: 'punt', timeout: wantTimeout }, coach.defense(game)!),
    fg: () => commit({ kind: 'fieldGoal', timeout: wantTimeout }, coach.defense(game)!),
    timeout: () => { wantTimeout = !wantTimeout; showOffensePanel(twoPointPick); },
  };
  for (const p of OFFENSE_PLAYS) acts[`p:${p.id}`] = () => commit({ kind: 'play', playId: p.id, timeout: wantTimeout }, coach.defense(game)!);
  bind(acts, (k) => {
    const n = Number(k);
    if (n >= 1 && n <= OFFENSE_PLAYS.length) return `p:${OFFENSE_PLAYS[n - 1].id}`;
    return k === 'p' ? 'punt' : k === 'f' ? 'fg' : k === 't' ? 'timeout' : null;
  });
}

function showDefensePanel(): void {
  mode = 'choose';
  $('prompt').textContent = game.state.phase === 'conversion' ? 'Defend the two-point try' : 'Call your defense';
  const tb = timeoutButton();
  $('panel').innerHTML = DEFENSE_CALLS.map((c, i) => `<button class="card" data-act="d:${c.id}">${defenseDiagram(c)}<span class="nm">${c.name} <span class="kind">${{ run: 'vs run', pass: 'vs pass', blitz: 'pressure', balanced: 'balanced' }[c.kind]}</span></span><span class="ds">${c.desc} <kbd>[${i + 1}]</kbd></span></button>`).join('') + (tb ? `<div class="wide">${tb}</div>` : '');
  const acts: Record<string, () => void> = { timeout: () => { wantTimeout = !wantTimeout; showDefensePanel(); } };
  for (const c of DEFENSE_CALLS) acts[`d:${c.id}`] = () => commit(pendingOff!, { callId: c.id, timeout: wantTimeout });
  bind(acts, (k) => {
    const n = Number(k);
    if (n >= 1 && n <= DEFENSE_CALLS.length) return `d:${DEFENSE_CALLS[n - 1].id}`;
    return k === 't' ? 'timeout' : null;
  });
}

function bind(acts: Record<string, () => void>, keys: (k: string) => string | null): void {
  const run = (a: string | null): void => {
    if (!a || !acts[a] || mode !== 'choose') return;
    if ($('panel').querySelector(`[data-act="${a}"]`) === null) return;
    sfx.select();
    acts[a]();
  };
  $('panel').querySelectorAll<HTMLElement>('[data-act]').forEach((el) => el.addEventListener('click', () => run(el.dataset.act ?? null)));
  keyHandler = (k) => run(keys(k));
}

// --------------------------------------------------------------- screens

function show(id: 'title' | 'setup' | 'game' | 'final'): void {
  for (const s of ['title', 'setup', 'game', 'final']) $(s).classList.toggle('hidden', s !== id);
}

function showSetup(): void {
  unlockAudio();
  mode = 'menu';
  seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  teams = exhibitionTeams(seed);
  $('teams').innerHTML = teams.map((t, i) => `<button class="team-card" data-team="${i}"><div class="swatch" style="background:linear-gradient(90deg, ${css(t.colors.jersey)} 0 60%, ${css(t.colors.trim)} 60% 80%, ${css(t.colors.helmet)} 80%)"></div><div class="nm">${t.name} ${t.mascot}</div><div class="sub">${i === 0 ? 'Home' : 'Visitors'} · QB ${t.offense.QB.name} #${t.offense.QB.number}</div></button>`).join('');
  $('teams').querySelectorAll<HTMLElement>('[data-team]').forEach((el) => el.addEventListener('click', () => startGame(Number(el.dataset.team) as 0 | 1)));
  show('setup');
}

function startGame(team: 0 | 1): void {
  unlockAudio();
  sfx.select();
  user = team;
  game = new Game(seed, teams);
  coach = new AutoCoach(seed);
  lastQuarter = 1;
  kick = null;
  viewSim = null;
  scene.setTeams(teams);
  show('game');
  setStatic();
  scene.snapCamera(spot.x);
  updateBug();
  const receiving = other(game.state.kicking);
  $('banner').className = '';
  $('banner').innerHTML = `${teams[receiving].name} will receive the opening kickoff.<small>You are coaching the ${teams[user].name} ${teams[user].mascot}.</small>`;
  $('banner').classList.remove('hidden');
  setPanelWaiting('Kickoff');
  timer = 2200;
  mode = 'post';
}

function showFinal(): void {
  mode = 'final';
  const s = game.state;
  const [a, b] = summarize(game.events);
  const verdict = s.score[user] > s.score[other(user)] ? 'You win' : s.score[user] < s.score[other(user)] ? 'You lose' : 'Tie game';
  $('finalScore').textContent = `${teams[0].abbr} ${s.score[0]}  –  ${s.score[1]} ${teams[1].abbr}`;
  const row = (label: string, x: string | number, y: string | number): string => `<tr><td>${label}</td><td>${x}</td><td>${y}</td></tr>`;
  $('finalTable').innerHTML = `<tr><th>${verdict}</th><th>${teams[0].abbr}</th><th>${teams[1].abbr}</th></tr>`
    + row('Total yards', a.totalYds, b.totalYds) + row('Plays', a.plays, b.plays) + row('First downs', a.firstDowns, b.firstDowns)
    + row('Rushing', `${a.rushAtt} for ${a.rushYds}`, `${b.rushAtt} for ${b.rushYds}`)
    + row('Passing', `${a.passComp}/${a.passAtt} for ${a.passYds}`, `${b.passComp}/${b.passAtt} for ${b.passYds}`)
    + row('Sacks taken', a.sacksTaken, b.sacksTaken) + row('Turnovers', a.turnovers, b.turnovers);
  $('finalMeta').textContent = `Seed ${seed} · ${game.log.length} decisions · game fingerprint ${gameHash(game)}`;
  $('log').innerHTML = game.events.filter((e) => e.points[0] + e.points[1] > 0).map((e) => `<div><b>Q${e.quarter} ${Math.floor(e.clock / 60)}:${String(e.clock % 60).padStart(2, '0')}</b> ${e.text} <b>${e.scoreAfter[0]}–${e.scoreAfter[1]}</b></div>`).join('') || '<div>No scoring.</div>';
  show('final');
}

// ---------------------------------------------------------------- wiring

($('titleArt') as HTMLImageElement).src = titleUrl;
$('title').addEventListener('click', showSetup);
$('again').addEventListener('click', showSetup);
document.querySelectorAll<HTMLElement>('[data-speed]').forEach((el) => el.addEventListener('click', () => {
  speed = Number(el.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === el));
}));
let muted = false;
$('mute').addEventListener('click', () => {
  muted = !muted;
  setMuted(muted);
  $('mute').textContent = muted ? 'Sound off' : 'Sound on';
});
window.addEventListener('keydown', (ev) => {
  if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (!$('title').classList.contains('hidden')) {
    if (k === 'enter' || k === ' ') {
      ev.preventDefault();
      showSetup();
    }
    return;
  }
  if (mode === 'choose' && keyHandler) keyHandler(k);
});

/** Debug hooks used by the browser determinism check. */
(window as unknown as Record<string, unknown>).__fnd = {
  selftest: (s: number): string => gameHash(simulateGame(s, exhibitionTeams(s))),
  state: () => ({ mode, phase: game?.state.phase, score: game?.state.score, quarter: game?.state.quarter, clock: game?.state.clock }),
  setSpeed: (n: number) => { speed = n; },
};
