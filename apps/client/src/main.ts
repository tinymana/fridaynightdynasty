import {
  BOOK_MIN, BOOK_SIZE, CUSTOM_FRONT, QUARTER_MINUTES, WEATHER, WEATHERS, cleanSetup, DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, FORMATIONS, MAX_CUSTOM_DEFENSES, MAX_CUSTOM_PLAYS, OFFENSE_PLAYS, RULES, U,
  defAssignment, draftFromDefense, draftFromFront, draftFromPlay, exhibitionTeams, formationOf, frontById, newDesignId, overall, playById, schemeById,
  toFront, toScheme, validateBook, validateDefPlay, validateOffPlay,
  type DefDecision, type DefFront, type DefPlay, type DefScheme, type GameSetup, type Group, type KickStyle, type ManageAction, type OffAssign, type OffDecision, type OffPlay, type PlayEvent, type Team,
} from '@fnd/core';
import { fieldGoalDistance } from '@fnd/football-ai';
import { AutoCoach, Game, gameHash, replayGame, simulateGame, summarize, type LoggedDecision, type PlaySim } from '@fnd/match-sim';
import { leagueTeams, type Career, type RoomView } from '@fnd/online';
import { OnlineError, online } from './net/online';
import { cutinFor } from './cutins';
import { DynastyScreen, type DynastyGame } from './dynasty';
import { SharedLeagueScreen } from './shared-league';
import { openDefenseDesigner, openOffenseDesigner, practiceTeams, type DesignerHost } from './designer';
import { voice } from './net/voice';
import { FieldScene, createGame, type FieldView, type ViewPlayer } from './scene';
import { setMuted, sfx, unlockAudio } from './audio';
import titleUrl from './assets/title.jpg';
import logoUrl from './assets/logo.webp';
import devnotes from '../../../site/devnotes.json';

/** Client controller: turns the coach's choices into engine decisions and engine state into a view. */

const W_YD = 53.333;
const CY_YD = W_YD / 2;
const PLAY_CLOCK_MS = 20000;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const other = (t: 0 | 1): 0 | 1 => (t === 0 ? 1 : 0);
const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const ord = (n: number): string => ['', '1st', '2nd', '3rd', '4th'][n] ?? `${n}th`;

type Mode = 'menu' | 'choose' | 'wait' | 'presnap' | 'live' | 'replay' | 'kick' | 'post' | 'final';

/** An online game in progress. The server owns the result; this browser replays the shared log to draw it. */
interface Net {
  token: string;
  pin: string;
  view: RoomView;
  /** Log entries received from the server but not yet shown. */
  queue: LoggedDecision[];
  /** How many log entries this browser has received. */
  received: number;
  timer: number;
  busy: boolean;
  sync: 'ok' | 'bad';
}
interface KickAnim { x0: number; x1: number; y0: number; y1: number; t: number; T: number; e: PlayEvent }

/** Small per-browser conveniences. Storage can be missing or throw, so every access is guarded. */
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* not available: the choice lasts for this visit only */ }
  },
};

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
/** Fourth down on defense: sell out for the block. */
let wantBlock = false;
let lastQuarter = 1;
let keyHandler: ((k: string) => void) | null = null;
/** Designs are kept in this browser. They are checked again every time they are loaded, and again by the engine and the server. */
function loadDesigns<T>(key: string, max: number, check: (raw: unknown) => { ok: true; value: T } | { ok: false }): T[] {
  const raw = store.get<unknown>(key, []);
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const x of raw.slice(0, max)) {
    const r = check(x);
    if (r.ok) out.push(r.value);
  }
  return out;
}
let myPlays: OffPlay[] = loadDesigns('fnd.plays.v1', MAX_CUSTOM_PLAYS, validateOffPlay);
let myDefs: DefPlay[] = loadDesigns('fnd.defs.v1', MAX_CUSTOM_DEFENSES, validateDefPlay);
/** A play by id outside a game: one of this coach's designs, or a library play. */
const myPlay = (id: string): OffPlay => myPlays.find((p) => p.id === id) ?? playById(id);
let book: string[] = (() => {
  const saved = store.get<string[]>('fnd.book.v2', [...DEFAULT_BOOK]);
  return Array.isArray(saved) && validateBook(saved, myPlays) === null ? saved : [...DEFAULT_BOOK];
})();
/** A practice run being watched from the designer. */
let practiceRun: { make: (seed: number) => PlaySim; n: number; pause: number; told: boolean } | null = null;
let career: Career | null = null;
let bookDraft: string[] = [];
/** The dynasty game being played, if this game is one. */
let dynastyGame: DynastyGame | null = null;
/** Cut-in artwork after big plays. Off in tests that only want the football. */
let showCutins = true;
/** Quarter length and weather for the next game this coach starts or hosts. */
let setup: GameSetup = cleanSetup(store.get<unknown>('fnd.setup.v1', null));
const setupLine = (s: GameSetup): string => `${s.quarterMinutes}-minute quarters \u00b7 ${WEATHER[s.weather].name}`;
/** The formation tab open on the offense panel. */
let offTab = FORMATIONS[0].id;
let frontId: string = DEFENSE_FRONTS[0].id;
let useClock = store.get<boolean>('fnd.clock.v1', true);
let clockLeft = 0;
let clockOn = false;
let sidelineOpen = false;
let sidelineTab: 'depth' | 'plan' = 'depth';
let sidelineGroup: Group = 'RB';
let net: Net | null = null;
/** Test-only: shortens the pauses between plays and polls faster. */
let turbo = false;
let session = store.get<{ token: string; name: string } | null>('fnd.session.v1', null);

const scene = new FieldScene();
scene.onFrame = (dt) => step(dt);
createGame('phaser', scene);

// ------------------------------------------------------------------ geometry

/** The front last picked, or the first library front while a designed defense is selected. */
const libraryFront = (): string => (frontId === CUSTOM_FRONT ? DEFENSE_FRONTS[0].id : frontId);
const abs = (team: 0 | 1, x: number, y: number): [number, number] => (team === 0 ? [x, y] : [100 - x, W_YD - y]);

function scrimmageLineup(off: 0 | 1, los: number): ViewPlayer[] {
  const out: ViewPlayer[] = [];
  const formation = formationOf(game.playOf(off, game.books[off][0]));
  const front = frontById(off === user ? DEFENSE_FRONTS[0].id : libraryFront());
  for (const slot of formation.slots) {
    const [x, y] = abs(off, los + slot.at[0], CY_YD + slot.at[1]);
    out.push({ team: off, x, y, moving: false, down: false, hasBall: false });
  }
  for (const slot of front.slots) {
    const [x, y] = abs(off, Math.min(los + slot.at[0], 108), CY_YD + slot.at[1]);
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
    marks = { los: a, toGain: s.phase === 'conversion' ? abs(off, 100, CY_YD)[0] : abs(off, Math.min(los + s.distance, 100), CY_YD)[0] };
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
  if (practiceRun) return stepPractice(Math.min(dt, 100));
  if (mode === 'menu' || !game) return null;
  dt = Math.min(dt, 100);
  switch (mode) {
    case 'choose':
      if (net) {
        // Online, the server's clock is the one that counts; this is only its display.
        clockLeft = Math.max(0, clockLeft - dt);
        showPlayClock();
      } else if (clockOn && !sidelineOpen) {
        clockLeft -= dt;
        showPlayClock();
        if (clockLeft <= 0) playClockExpired();
      }
      break;
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

/** One practice run from the designer, drawn on the real field. */
function stepPractice(dt: number): FieldView {
  const run = practiceRun!;
  const sim = viewSim!;
  if (run.pause > 0) run.pause -= dt;
  else if (!sim.done) {
    acc += dt;
    for (let n = 0; acc >= 16.667 && n < 8 && !sim.done; n++) {
      acc -= 16.667;
      frame++;
      sim.step();
    }
  } else if (!run.told) {
    run.told = true;
    const r = sim.result!;
    const what = r.touchdown ? 'Touchdown' : r.turnover === 'interception' ? 'Intercepted' : r.turnover ? 'Fumble lost' : r.sack ? `Sacked for a loss of ${-r.yards}` : r.incomplete ? 'Incomplete' : `${r.kind === 'pass' ? 'Complete' : 'Run'} for ${r.yards} ${Math.abs(r.yards) === 1 ? 'yard' : 'yards'}`;
    $('prompt').textContent = '';
    $('banner').className = '';
    $('banner').innerHTML = `${what}<small>Practice run ${run.n}</small>`;
    $('banner').classList.remove('hidden');
  }
  return buildView();
}

function startPractice(make: (seed: number) => PlaySim, label: string): void {
  unlockAudio();
  practiceRun = { make, n: 0, pause: 0, told: false };
  mode = 'menu';
  scene.setTeams(practiceTeams);
  $('game').classList.add('practice');
  show('game');
  $('panel').innerHTML = `<div class="wide"><button class="act" id="prAgain">Run it again</button><button class="act" id="prBack">Back to the designer</button></div><div class="waiting">${label.replace(/[&<>]/g, '')} on the practice field</div>`;
  $('prAgain').addEventListener('click', nextPractice);
  $('prBack').addEventListener('click', () => {
    practiceRun = null;
    viewSim = null;
    $('game').classList.remove('practice');
    $('banner').classList.add('hidden');
    show('designer');
  });
  nextPractice();
  scene.snapCamera(30);
}

function nextPractice(): void {
  if (!practiceRun) return;
  practiceRun.n++;
  practiceRun.pause = 700;
  practiceRun.told = false;
  viewSim = practiceRun.make(practiceRun.n * 7919 + (Date.now() & 0xffff));
  viewOffense = 0;
  marks = { los: 30, toGain: 40 };
  acc = 0;
  $('banner').classList.add('hidden');
}

function next(): void {
  $('banner').classList.add('hidden');
  $('cutin').classList.add('hidden');
  $('calls').classList.add('hidden');
  const s = game.state;
  if (s.phase === 'final') return showFinal();
  if (net) return onlineNext();
  updateBug();
  if (s.phase === 'kickoff') {
    setStatic();
    if (s.kicking === user) {
      startPlayClock();
      showKickPanel();
    } else runKickoff(coach.offense(game));
    return;
  }
  setStatic();
  wantTimeout = false;
  wantBlock = false;
  if (s.possession === user) {
    startPlayClock();
    showOffensePanel();
  } else {
    pendingOff = coach.offense(game)!;
    if (pendingOff.kind !== 'play') commit(pendingOff, { frontId: libraryFront(), callId: 'base' });
    else {
      startPlayClock();
      showDefensePanel();
    }
  }
}

/** Runs a kickoff and shows it. */
function runKickoff(off: OffDecision | null): void {
  const k = game.state.kicking;
  const from = game.state.kickFrom;
  keyHandler = null;
  clockOn = false;
  $('pclock').classList.add('hidden');
  setPanelWaiting('Kickoff');
  game.begin(off, null);
  game.tick();
  const e = game.lastEvent!;
  startKick(k, from, Math.min(from + e.yards, 104), CY_YD, e);
}

/** The kicking coach's three choices. */
function showKickPanel(): void {
  mode = 'choose';
  const late = game.onsideExpected();
  $('prompt').textContent = 'Call the kickoff';
  const opt = (style: KickStyle, key: string, name: string, text: string): string => `<button class="act" data-act="k:${style}">${name} <kbd>[${key}]</kbd><small>${text}</small></button>`;
  $('panel').innerHTML = `<div class="wide">${opt('deep', '1', 'Kick deep', 'Pin them back. A return can break loose.')}${opt('squib', '2', 'Squib kick', 'Low and short. No big return, better field position for them.')}${opt('onside', '3', 'Onside kick', late ? 'They are expecting it: about 1 in 9 to recover.' : 'A surprise: about 1 in 4 to recover. Miss and they start near midfield.')}</div>`;
  const pick = (style: KickStyle) => (): void => {
    const off: OffDecision = { kind: 'kickoff', style };
    if (net) void sendCall(off);
    else runKickoff(off);
  };
  bind({ 'k:deep': pick('deep'), 'k:squib': pick('squib'), 'k:onside': pick('onside') }, (k) => (k === '1' ? 'k:deep' : k === '2' ? 'k:squib' : k === '3' ? 'k:onside' : null));
  showPlayClock();
}

function startPlayClock(): void {
  clockOn = useClock;
  clockLeft = PLAY_CLOCK_MS;
  showPlayClock();
}

function showPlayClock(): void {
  const el = $('pclock');
  el.classList.toggle('hidden', !clockOn || mode !== 'choose');
  const secs = Math.max(0, Math.ceil(clockLeft / 1000));
  el.textContent = `:${String(secs).padStart(2, '0')}`;
  el.classList.toggle('low', secs <= 5);
}

/** Time is up: the AI coach makes the call from your game plan. */
function playClockExpired(): void {
  clockOn = false;
  if (mode !== 'choose' || net) return;
  closeSideline();
  if (game.state.phase === 'kickoff') return runKickoff(coach.offense(game));
  if (game.state.possession === user) commit(coach.offense(game)!, coach.defense(game)!);
  else commit(pendingOff!, coach.defense(game)!);
}

function commit(off: OffDecision, def: DefDecision): void {
  const s = game.state;
  const offTeam = s.possession;
  const los = s.phase === 'conversion' ? RULES.twoPointFrom : s.yardLine;
  keyHandler = null;
  clockOn = false;
  $('pclock').classList.add('hidden');
  game.begin(off, def);
  const tb = game.lastTimeoutBy;
  if (game.live) {
    viewSim = game.live;
    viewOffense = offTeam;
    const play = off.kind === 'play' ? game.playOf(offTeam, off.playId) : null;
    const called = game.defenseOf(other(offTeam), def);
    const defName = def.frontId === CUSTOM_FRONT ? called.scheme.name : `${called.front.name} ${called.scheme.name}`;
    const subs = game.lastSubs.filter((x) => x.team === user).map((x) => `${x.slot}: #${x.out.number} resting, #${x.in.number} in`);
    const calls = $('calls');
    calls.innerHTML = `${teams[offTeam].abbr} <b>${play?.name ?? ''}</b><br>${teams[other(offTeam)].abbr} <b>${defName}</b>`
      + (game.caughtBlocking ? '<br>Caught going for the block!' : '') + (tb !== null ? `<br>Timeout ${teams[tb].abbr}` : '') + (subs.length ? `<br>${subs.slice(0, 3).join('<br>')}` : '');
    calls.classList.remove('hidden');
    setPanelWaiting(`${play?.name ?? ''} against ${defName}`);
    updateBug();
    mode = 'presnap';
    timer = speed === 0 ? 0 : speed === 1 ? 900 : 300;
    return;
  }
  game.tick();
  const e = game.lastEvent;
  if (!e || e.type === 'kneel') return showResult(e);
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
  const big = !!e && (e.flags.touchdown || e.flags.blocked || e.flags.recovered || e.flags.interception || e.flags.fumbleLost || e.flags.safety || (e.type === 'twoPoint' && e.flags.good));
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
  setStaticIfIdle();
  const s = game.state;
  const banner = $('banner');
  let period = '';
  if (s.phase === 'final') period = 'End of game. ';
  else if (s.quarter !== lastQuarter) period = lastQuarter === 2 ? 'Halftime. ' : `End of quarter ${lastQuarter}. `;
  const cut = showCutins && speed !== 0 ? cutinFor(e, s.phase === 'final' ? 'final' : s.quarter !== lastQuarter && lastQuarter === 2 ? 'half' : null, s.score[0] + s.score[1] + s.quarter) : null;
  const cutEl = $('cutin') as HTMLImageElement;
  cutEl.classList.toggle('hidden', !cut);
  if (cut) {
    cutEl.src = cut.url;
    cutEl.alt = cut.alt;
    // Restart the pop-in animation.
    cutEl.style.animation = 'none';
    void cutEl.offsetWidth;
    cutEl.style.animation = '';
  }
  lastQuarter = s.quarter;
  const big = !!e && (e.flags.touchdown || e.flags.blocked || e.flags.recovered || e.flags.interception || e.flags.fumbleLost || e.flags.safety || ((e.type === 'fieldGoal' || e.type === 'twoPoint') && !!e.flags.good));
  banner.className = big ? 'big' : '';
  banner.innerHTML = `${e ? e.text : 'Time runs out.'}<small>${period}${situationText()}</small>`;
  if (e) {
    if (e.flags.touchdown || ((e.type === 'fieldGoal' || e.type === 'pat' || e.type === 'twoPoint') && e.flags.good)) sfx.score();
    else if (e.flags.interception || e.flags.fumbleLost || e.flags.safety || e.flags.turnoverOnDowns) sfx.bad();
    else if (e.flags.firstDown) sfx.first();
    else if (e.flags.incomplete || e.type === 'punt' || e.type === 'kickoff' || e.type === 'kneel') sfx.whistle();
    else sfx.tackle();
  }
  const base = cut ? 3000 : big || period ? 2600 : e?.type === 'kneel' ? 1000 : 1700;
  timer = turbo ? 40 : speed === 0 ? Math.min(base, 900) : speed === 1 ? base : Math.round(base * 0.5);
  mode = 'post';
}

/** After a play with no field animation (a kneel-down), show the new spot straight away. */
function setStaticIfIdle(): void {
  if (!viewSim && !kick) setStatic();
}

// ----------------------------------------------------------------- score bug

function updateBug(): void {
  const s = game.state;
  ([0, 1] as const).forEach((t) => {
    const el = $(`s${t}`);
    (el.querySelector('.chip') as HTMLElement).style.background = css(teams[t].colors.jersey);
    el.querySelector('.ab')!.textContent = teams[t].abbr + (t === user ? ' (you)' : net?.view.away[t] ? ' (AI)' : '');
    (el as HTMLElement).title = net ? `${net.view.coaches[t] ?? ''}` : '';
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

// ------------------------------------------------------------------ diagrams

const SX = (lateral: number): number => 50 + lateral * 2.05;

function offenseDiagram(p: OffPlay): string {
  const Y = (d: number): number => 35 - Math.max(-7.5, Math.min(d, 20)) * 1.55;
  const formation = formationOf(p);
  let dots = '';
  let paths = '';
  for (const slot of formation.slots) {
    const [d0, l0] = slot.at;
    const a: OffAssign = p.assign[slot.id] ?? { t: 'block' };
    const x = SX(l0);
    const y = Y(d0);
    if (slot.group === 'OL') dots += `<rect x="${x - 1.8}" y="${y - 1.8}" width="3.6" height="3.6" fill="#f3f1e7"/>`;
    else dots += `<circle cx="${x}" cy="${y}" r="2" fill="${a.t === 'carry' ? '#f2c14e' : a.t === 'qb' ? '#1c6b2c' : '#f3f1e7'}" stroke="#f3f1e7" stroke-width="0.8"/>`;
    if (a.t === 'route' || a.t === 'carry' || a.t === 'lead') {
      const pts: [number, number][] = [[d0, l0]];
      for (const [dx, dy] of a.pts) pts.push(a.t === 'route' ? [d0 + dx, l0 + dy] : [dx, dy]);
      const n = pts.length;
      if (a.t === 'carry') pts.push([pts[n - 1][0] + 5, pts[n - 1][1]]);
      else if (a.t === 'route' && a.go && n > 1) pts.push([pts[n - 1][0] + (pts[n - 1][0] - pts[n - 2][0]) * 0.8, pts[n - 1][1] + (pts[n - 1][1] - pts[n - 2][1]) * 0.8]);
      const colour = a.t === 'carry' ? '#f2c14e' : '#ffffff';
      const style = a.t === 'lead' ? 'stroke-dasharray="2 1.5"' : `marker-end="url(#ar${a.t === 'carry' ? 'c' : 'r'})"`;
      paths += `<polyline points="${pts.map(([d, l]) => `${SX(l).toFixed(1)},${Y(d).toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="${a.t === 'carry' ? 1.8 : 1.1}" stroke-linejoin="round" ${style}/>`;
    }
  }
  return `<svg viewBox="0 0 100 48" aria-hidden="true"><defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" fill="#fff"/></marker><marker id="arc" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M0 0L6 3L0 6z" fill="#f2c14e"/></marker></defs><line x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}" stroke="#4f8ef7" stroke-width="0.7"/>${paths}${dots}</svg>`;
}

function defenseDiagram(front: DefFront, c: DefScheme): string {
  const Y = (d: number): number => 40 - d * 2.1;
  let out = '';
  for (const slot of front.slots) {
    const [d0, l0] = slot.at;
    const a = defAssignment(slot, c.id);
    const x = SX(l0);
    const y = Y(d0);
    if (a.t === 'rush') out += `<line x1="${x}" y1="${y}" x2="${SX(l0 * 0.6)}" y2="${Y(-2)}" stroke="#ff6b6b" stroke-width="1.3" marker-end="url(#ard)"/><circle cx="${x}" cy="${y}" r="2.1" fill="#ff6b6b"/>`;
    else if (a.t === 'zone') out += `<line x1="${x}" y1="${y}" x2="${SX(a.at[1])}" y2="${Y(a.at[0])}" stroke="#f2c14e" stroke-width="0.7"/><ellipse cx="${SX(a.at[1])}" cy="${Y(a.at[0])}" rx="9" ry="4.5" fill="rgba(242,193,78,0.2)" stroke="#f2c14e" stroke-width="0.7" stroke-dasharray="2 1.5"/><circle cx="${x}" cy="${y}" r="2.1" fill="#f2c14e"/>`;
    else out += `<circle cx="${x}" cy="${y}" r="2.1" fill="#f3f1e7"/>${a.t === 'read' ? `<circle cx="${x}" cy="${y}" r="3.6" fill="none" stroke="#f3f1e7" stroke-width="0.6"/>` : ''}`;
  }
  return `<svg viewBox="0 0 100 46" aria-hidden="true"><defs><marker id="ard" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M0 0L6 3L0 6z" fill="#ff6b6b"/></marker></defs><line x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}" stroke="#4f8ef7" stroke-width="0.7"/>${out}</svg>`;
}

const playCard = (p: OffPlay, act: string, hint: string, extra = ''): string =>
  `<button class="card${extra}" data-act="${act}">${offenseDiagram(p)}<span class="nm">${p.name} <span class="kind">${p.kind}</span></span><span class="form">${p.slots ? 'Your design' : formationOf(p).name}</span><span class="ds">${p.desc}${hint}</span></button>`;

// -------------------------------------------------------------------- panels

function setPanelWaiting(text: string): void {
  $('panel').innerHTML = `<div class="waiting">${text}</div>`;
  $('prompt').textContent = '';
  keyHandler = null;
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
  showPlayClock();
  if (s.phase === 'conversion' && !twoPointPick) {
    $('prompt').textContent = 'Touchdown! Choose the try';
    panel.innerHTML = `<div class="wide"><button class="act" data-act="pat">Kick extra point <kbd>[1]</kbd><small>1 point</small></button><button class="act" data-act="two">Go for two <kbd>[2]</kbd><small>One play from the 3</small></button></div>`;
    bind({ pat: () => submitOff({ kind: 'patKick' }), two: () => showOffensePanel(true) }, (k) => (k === '1' ? 'pat' : k === '2' ? 'two' : null));
    return;
  }
  $('prompt').textContent = s.phase === 'conversion' ? 'Two-point play' : s.down === 4 ? '4th down: go, punt or kick' : 'Call your play';
  // A big book is called by formation: pick the formation, then the play.
  const all = game.bookPlays(user);
  const tabKeys = ['Z', 'X', 'C', 'V', 'B', 'N'];
  const tabs = [...FORMATIONS.map((f) => ({ id: f.id, name: f.name, plays: all.filter((p) => !p.slots && p.formation === f.id) })), { id: '@mine', name: 'Mine', plays: all.filter((p) => !!p.slots) }].filter((t) => t.plays.length);
  if (!tabs.some((t) => t.id === offTab)) offTab = tabs[0].id;
  const plays = tabs.find((t) => t.id === offTab)!.plays;
  let html = (tabs.length > 1 ? `<div class="fronts"><span class="lbl">Formation</span>${tabs.map((t, i) => `<button class="act${t.id === offTab ? ' on' : ''}" data-act="tab:${t.id}">${t.name} <kbd>[${tabKeys[i]}]</kbd><small>${t.plays.length} ${t.plays.length === 1 ? 'play' : 'plays'}</small></button>`).join('')}</div>` : '')
    + plays.map((p, i) => playCard(p, `p:${p.id}`, i < 9 ? ` <kbd>[${i + 1}]</kbd>` : '')).join('');
  if (s.phase === 'scrimmage') {
    const fg = fieldGoalDistance(s.yardLine);
    const canKneel = (s.quarter === 2 || s.quarter === 4) && s.down < 4;
    html += `<div class="wide"><button class="act" data-act="punt">Punt <kbd>[P]</kbd></button>${fg <= 60 ? `<button class="act" data-act="fg">Field goal <kbd>[F]</kbd><small>${fg} yards</small></button>` : ''}${canKneel ? '<button class="act" data-act="kneel">Kneel <kbd>[K]</kbd><small>Lose a yard, keep the clock running</small></button>' : ''}${timeoutButton()}</div>`;
  }
  panel.innerHTML = html;
  const acts: Record<string, () => void> = {
    punt: () => submitOff({ kind: 'punt', timeout: wantTimeout }),
    fg: () => submitOff({ kind: 'fieldGoal', timeout: wantTimeout }),
    kneel: () => submitOff({ kind: 'kneel' }),
    timeout: () => { wantTimeout = !wantTimeout; showOffensePanel(twoPointPick); },
  };
  for (const p of plays) acts[`p:${p.id}`] = () => submitOff({ kind: 'play', playId: p.id, timeout: wantTimeout });
  for (const t of tabs) acts[`tab:${t.id}`] = () => { offTab = t.id; showOffensePanel(twoPointPick); };
  bind(acts, (k) => {
    const n = Number(k);
    if (n >= 1 && n <= Math.min(9, plays.length)) return `p:${plays[n - 1].id}`;
    const ti = tabKeys.indexOf(k.toUpperCase());
    if (ti >= 0 && ti < tabs.length) return `tab:${tabs[ti].id}`;
    return k === 'p' ? 'punt' : k === 'f' ? 'fg' : k === 'k' ? 'kneel' : k === 't' ? 'timeout' : null;
  });
}

function showDefensePanel(): void {
  mode = 'choose';
  showPlayClock();
  $('prompt').textContent = game.state.phase === 'conversion' ? 'Defend the two-point try' : 'Pick a front, then call it';
  const mine = game.defenses[user];
  if (frontId === CUSTOM_FRONT && !mine.length) frontId = DEFENSE_FRONTS[0].id;
  const custom = frontId === CUSTOM_FRONT;
  const front = frontById(libraryFront());
  const fourth = game.state.phase === 'scrimmage' && game.state.down === 4;
  if (!fourth) wantBlock = false;
  const tb = timeoutButton() + (fourth ? `<button class="act${wantBlock ? ' on' : ''}" data-act="block">Go for the block <kbd>[G]</kbd><small>${wantBlock ? 'Selling out. A real play will catch you out of position.' : 'Rush a punt or field goal: a chance to block it, a risk of a flag, no return.'}</small></button>` : '');
  const withExtras = (d: DefDecision): DefDecision => (wantBlock ? { ...d, timeout: wantTimeout, block: true } : { ...d, timeout: wantTimeout });
  const keys = ['Q', 'W', 'E', 'R', 'Y'];
  const fronts = `<div class="fronts"><span class="lbl">Front</span>${DEFENSE_FRONTS.map((f, i) => `<button class="act${f.id === frontId ? ' on' : ''}" data-act="f:${f.id}" title="${f.desc}">${f.name} <kbd>[${keys[i]}]</kbd></button>`).join('')}${mine.length ? `<button class="act${custom ? ' on' : ''}" data-act="f:${CUSTOM_FRONT}" title="The defenses you designed">Mine <kbd>[A]</kbd></button>` : ''}</div>`;
  const kindLabel = { run: 'vs run', pass: 'vs pass', blitz: 'pressure', balanced: 'balanced' };
  if (custom) {
    $('panel').innerHTML = fronts
      + mine.map((d, i) => `<button class="card" data-act="m:${d.id}">${defenseDiagram(toFront(d), toScheme(d))}<span class="nm">${d.name} <span class="kind">${kindLabel[d.kind]}</span></span><span class="form">Your design</span><span class="ds">Designed defense <kbd>[${i + 1}]</kbd></span></button>`).join('')
      + (tb ? `<div class="wide">${tb}</div>` : '');
    const acts: Record<string, () => void> = { timeout: () => { wantTimeout = !wantTimeout; showDefensePanel(); }, block: () => { wantBlock = !wantBlock; showDefensePanel(); } };
    for (const f of DEFENSE_FRONTS) acts[`f:${f.id}`] = () => { frontId = f.id; setStatic(); showDefensePanel(); };
    for (const d of mine) acts[`m:${d.id}`] = () => submitDef(withExtras({ frontId: CUSTOM_FRONT, callId: d.id }));
    bind(acts, (k) => {
      const n = Number(k);
      if (n >= 1 && n <= mine.length) return `m:${mine[n - 1].id}`;
      const fi = keys.indexOf(k.toUpperCase());
      if (fi >= 0) return `f:${DEFENSE_FRONTS[fi].id}`;
      return k === 't' ? 'timeout' : k === 'g' ? 'block' : null;
    });
    return;
  }
  $('panel').innerHTML = fronts
    + DEFENSE_SCHEMES.map((c, i) => `<button class="card" data-act="d:${c.id}">${defenseDiagram(front, c)}<span class="nm">${c.name} <span class="kind">${kindLabel[c.kind]}</span></span><span class="form">${front.name}: ${front.desc}</span><span class="ds">${c.desc} <kbd>[${i + 1}]</kbd></span></button>`).join('')
    + (tb ? `<div class="wide">${tb}</div>` : '');
  const acts: Record<string, () => void> = { timeout: () => { wantTimeout = !wantTimeout; showDefensePanel(); }, block: () => { wantBlock = !wantBlock; showDefensePanel(); } };
  for (const f of DEFENSE_FRONTS) acts[`f:${f.id}`] = () => { frontId = f.id; setStatic(); showDefensePanel(); };
  acts[`f:${CUSTOM_FRONT}`] = () => { frontId = CUSTOM_FRONT; showDefensePanel(); };
  for (const c of DEFENSE_SCHEMES) acts[`d:${c.id}`] = () => submitDef(withExtras({ frontId, callId: c.id }));
  bind(acts, (k) => {
    const n = Number(k);
    if (n >= 1 && n <= DEFENSE_SCHEMES.length) return `d:${DEFENSE_SCHEMES[n - 1].id}`;
    if (k === 'a' && mine.length) return `f:${CUSTOM_FRONT}`;
    const fi = keys.indexOf(k.toUpperCase());
    if (fi >= 0) return `f:${DEFENSE_FRONTS[fi].id}`;
    return k === 't' ? 'timeout' : k === 'g' ? 'block' : null;
  });
}

/** A call made by the person at this screen. Offline it runs at once; online it goes to the server, hidden until the snap. */
function submitOff(off: OffDecision): void {
  if (net) void sendCall(off);
  else commit(off, coach.defense(game)!);
}
function submitDef(def: DefDecision): void {
  if (net) void sendCall(def);
  else commit(pendingOff!, def);
}

function bind(acts: Record<string, () => void>, keys: (k: string) => string | null): void {
  const run = (a: string | null): void => {
    if (!a || !acts[a] || mode !== 'choose' || sidelineOpen) return;
    if ($('panel').querySelector(`[data-act="${a}"]`) === null) return;
    sfx.select();
    acts[a]();
  };
  $('panel').querySelectorAll<HTMLElement>('[data-act]').forEach((el) => el.addEventListener('click', () => run(el.dataset.act ?? null)));
  keyHandler = (k) => run(keys(k));
}

// ------------------------------------------------------------------ sideline

const DEPTH_GROUPS: Group[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];
const GROUP_NAMES: Record<Group, string> = { QB: 'Quarterbacks', RB: 'Running backs', WR: 'Receivers', TE: 'Tight ends', OL: 'Offensive line', DL: 'Defensive line', LB: 'Linebackers', CB: 'Cornerbacks', S: 'Safeties', K: 'Kicker', P: 'Punter' };
const STARTERS: Record<Group, number> = { QB: 1, RB: 2, WR: 4, TE: 2, OL: 5, DL: 5, LB: 4, CB: 3, S: 2, K: 1, P: 1 };

function openSideline(): void {
  if (!game || mode === 'menu' || mode === 'final') return;
  sidelineOpen = true;
  $('sideline').classList.remove('hidden');
  renderSideline();
}

function closeSideline(): void {
  if (!sidelineOpen) return;
  sidelineOpen = false;
  $('sideline').classList.add('hidden');
}

function renderSideline(): void {
  $('slTabs').innerHTML = `<button class="seg${sidelineTab === 'depth' ? ' on' : ''}" data-tab="depth">Depth chart</button><button class="seg${sidelineTab === 'plan' ? ' on' : ''}" data-tab="plan">Game plan</button>`;
  $('slTabs').querySelectorAll<HTMLElement>('[data-tab]').forEach((el) => el.addEventListener('click', () => {
    sidelineTab = el.dataset.tab as 'depth' | 'plan';
    renderSideline();
  }));
  const body = $('slBody');
  if (sidelineTab === 'plan') {
    const plan = coach.plans[user];
    const seg = (name: string, value: number, labels: [number, string][]): string =>
      `<div class="opts">${labels.map(([v, l]) => `<button class="seg${v === value ? ' on' : ''}" data-${name}="${v}">${l}</button>`).join('')}</div>`;
    body.innerHTML = `<p class="sl-note">Your game plan is what the AI coach follows when the play clock runs out before you call a play.</p>`
      + `<div class="sl-field"><div class="t">Run or pass</div>${seg('bias', plan.passBias, [[-2, 'Run heavy'], [-1, 'Lean run'], [0, 'Balanced'], [1, 'Lean pass'], [2, 'Pass heavy']])}</div>`
      + `<div class="sl-field"><div class="t">Fourth downs and tries</div>${seg('agg', plan.aggression, [[0, 'Conservative'], [1, 'Normal'], [2, 'Aggressive']])}</div>`
      + `<div class="sl-field"><div class="t">Rest starters below ${game.subThreshold[user]}% energy</div>${seg('thr', game.subThreshold[user], [[0, 'Never'], [35, '35%'], [55, '55%'], [70, '70%']])}</div>`
      + `<p class="sl-note">A tired player is slower. A resting starter returns once he has recovered 20 points above the line.</p>`;
    const savePlan = (): void => { if (net) void netRequest(() => online.plan(net!.token, net!.pin, plan, net!.received)); renderSideline(); };
    body.querySelectorAll<HTMLElement>('[data-bias]').forEach((el) => el.addEventListener('click', () => { plan.passBias = Number(el.dataset.bias); savePlan(); }));
    body.querySelectorAll<HTMLElement>('[data-agg]').forEach((el) => el.addEventListener('click', () => { plan.aggression = Number(el.dataset.agg); savePlan(); }));
    body.querySelectorAll<HTMLElement>('[data-thr]').forEach((el) => el.addEventListener('click', () => manage({ kind: 'threshold', team: user, value: Number(el.dataset.thr) })));
    return;
  }
  const ids = game.depth[user][sidelineGroup];
  const rows = ids.map((id, i) => {
    const p = game.player(id);
    const e = Math.round(game.energy[id]);
    return `<div class="sl-row${i < STARTERS[sidelineGroup] ? ' start' : ''}"><span class="rk">${i + 1}</span><span>#${p.number} ${p.name}</span><span>${overall(p)}</span>`
      + `<span class="bar${e < 40 ? ' low' : e < 65 ? ' mid' : ''}" title="${e}% energy"><i style="width:${e}%"></i></span>`
      + `<span class="mv"><button data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button data-mv="${i}:1" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></span></div>`;
  }).join('');
  body.innerHTML = `<div class="sl-groups">${DEPTH_GROUPS.map((g) => `<button class="seg${g === sidelineGroup ? ' on' : ''}" data-grp="${g}">${g}</button>`).join('')}</div>`
    + `<div class="sl-row" style="color:var(--dim)"><span></span><span>${GROUP_NAMES[sidelineGroup]}</span><span>Rating</span><span>Energy</span><span></span></div>${rows}`
    + `<p class="sl-note">The top ${STARTERS[sidelineGroup]} can start, depending on the formation. Changes take effect on the next snap.</p>`;
  body.querySelectorAll<HTMLElement>('[data-grp]').forEach((el) => el.addEventListener('click', () => { sidelineGroup = el.dataset.grp as Group; renderSideline(); }));
  body.querySelectorAll<HTMLElement>('[data-mv]').forEach((el) => el.addEventListener('click', () => {
    const [i, d] = (el.dataset.mv ?? '').split(':').map(Number);
    const order = [...game.depth[user][sidelineGroup]];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    manage({ kind: 'depth', team: user, group: sidelineGroup, order });
  }));
}

/** A sideline change. Online it goes through the server so both browsers apply it in the same order. */
function manage(action: ManageAction): void {
  if (net) {
    void netRequest(() => online.manage(net!.token, net!.pin, action as unknown as Record<string, unknown>, net!.received));
    return;
  }
  game.manage(action);
  renderSideline();
}

// ---------------------------------------------------------- playbook builder

function showBookScreen(): void {
  bookDraft = [...book];
  show('bookScreen');
  renderBook();
}

function renderBook(): void {
  const problem = validateBook(bookDraft, myPlays);
  $('bookCount').textContent = `${bookDraft.length} plays${problem ? ` \u00b7 ${problem}` : ` (${BOOK_MIN} to ${BOOK_SIZE})`}`;
  ($('bookSave') as HTMLButtonElement).disabled = problem !== null;
  $('bookSave').style.opacity = problem ? '0.4' : '1';
  const tools = (kind: 'p' | 'd', id: string): string => `<div class="mine-tools"><button class="seg" data-edit="${kind}:${id}">Edit</button><button class="seg" data-del="${kind}:${id}">Delete</button></div>`;
  const minePlays = `<h3>My plays <span class="count">${myPlays.length} of ${MAX_CUSTOM_PLAYS}</span></h3>`
    + `<div class="book-grid">${myPlays.map((p) => `<div class="mine">${playCard(p, `b:${p.id}`, '', bookDraft.includes(p.id) ? ' sel' : '')}${tools('p', p.id)}</div>`).join('')}`
    + (myPlays.length < MAX_CUSTOM_PLAYS ? '<button class="card new" id="newPlay"><span class="plus">+</span><span class="nm">Design a play</span><span class="ds">Line up your eleven, draw the routes and try it on the practice field.</span></button>' : '') + '</div>';
  const mineDefs = `<h3>My defenses <span class="count">${myDefs.length} of ${MAX_CUSTOM_DEFENSES}</span></h3><p class="sub">Every defense you design comes to every game with you. Call one from the Mine tab on defense.</p>`
    + `<div class="book-grid">${myDefs.map((d) => `<div class="mine"><div class="card still">${defenseDiagram(toFront(d), toScheme(d))}<span class="nm">${d.name}</span><span class="form">Your design</span></div>${tools('d', d.id)}</div>`).join('')}`
    + (myDefs.length < MAX_CUSTOM_DEFENSES ? '<button class="card new" id="newDef"><span class="plus">+</span><span class="nm">Design a defense</span><span class="ds">Place your eleven and give each a job: rush, cover a man, drop to a zone or read.</span></button>' : '') + '</div>';
  $('bookList').innerHTML = minePlays + FORMATIONS.map((f) => {
    const plays = OFFENSE_PLAYS.filter((p) => p.formation === f.id);
    return `<h3>${f.name}</h3><div class="book-grid">${plays.map((p) => playCard(p, `b:${p.id}`, '', bookDraft.includes(p.id) ? ' sel' : '')).join('')}</div>`;
  }).join('') + mineDefs;
  $('bookList').querySelectorAll<HTMLElement>('[data-act]').forEach((el) => el.addEventListener('click', () => {
    const id = (el.dataset.act ?? '').slice(2);
    if (bookDraft.includes(id)) bookDraft = bookDraft.filter((x) => x !== id);
    else if (bookDraft.length < BOOK_SIZE) bookDraft.push(id);
    else return;
    sfx.select();
    renderBook();
  }));
  $('bookList').querySelector('#newPlay')?.addEventListener('click', () => designOffense(null));
  $('bookList').querySelector('#newDef')?.addEventListener('click', () => designDefense(null));
  $('bookList').querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => el.addEventListener('click', () => {
    const [kind, id] = (el.dataset.edit ?? '').split(':');
    if (kind === 'p') designOffense(id);
    else designDefense(id);
  }));
  $('bookList').querySelectorAll<HTMLElement>('[data-del]').forEach((el) => el.addEventListener('click', () => {
    const [kind, id] = (el.dataset.del ?? '').split(':');
    if (el.dataset.sure !== '1') {
      el.dataset.sure = '1';
      el.textContent = 'Really delete?';
      return;
    }
    if (kind === 'p') {
      myPlays = myPlays.filter((p) => p.id !== id);
      store.set('fnd.plays.v1', myPlays);
      bookDraft = bookDraft.filter((x) => x !== id);
      settleBook();
    } else {
      myDefs = myDefs.filter((d) => d.id !== id);
      store.set('fnd.defs.v1', myDefs);
    }
    renderBook();
  }));
}

/** After a design changes or goes, the saved book must still be a legal book. */
function settleBook(): void {
  if (validateBook(book, myPlays) === null) return;
  book = [...DEFAULT_BOOK];
  store.set('fnd.book.v2', book);
}

const designerHost: DesignerHost = {
  saveOffense(play) {
    const i = myPlays.findIndex((p) => p.id === play.id);
    if (i >= 0) myPlays[i] = play;
    else if (myPlays.length < MAX_CUSTOM_PLAYS) myPlays.push(play);
    store.set('fnd.plays.v1', myPlays);
    settleBook();
    show('bookScreen');
    renderBook();
  },
  saveDefense(def) {
    const i = myDefs.findIndex((d) => d.id === def.id);
    if (i >= 0) myDefs[i] = def;
    else if (myDefs.length < MAX_CUSTOM_DEFENSES) myDefs.push(def);
    store.set('fnd.defs.v1', myDefs);
    show('bookScreen');
    renderBook();
  },
  close() {
    show('bookScreen');
    renderBook();
  },
  watch: startPractice,
};

function designOffense(id: string | null): void {
  const old = id ? myPlays.find((p) => p.id === id) : undefined;
  const draft = old ? draftFromPlay(old, old.id, old.name) : draftFromPlay(OFFENSE_PLAYS.find((p) => p.kind === 'pass') ?? OFFENSE_PLAYS[0], newDesignId(Math.random), `My play ${myPlays.length + 1}`);
  $('dsTitle').textContent = old ? 'Edit your play' : 'Design a play';
  show('designer');
  openOffenseDesigner($('dsRoot'), draft, designerHost);
}

function designDefense(id: string | null): void {
  const old = id ? myDefs.find((d) => d.id === id) : undefined;
  const draft = old ? draftFromDefense(old, old.id, old.name) : draftFromFront(DEFENSE_FRONTS[0], schemeById('base'), newDesignId(Math.random), `My defense ${myDefs.length + 1}`);
  $('dsTitle').textContent = old ? 'Edit your defense' : 'Design a defense';
  show('designer');
  openDefenseDesigner($('dsRoot'), draft, designerHost);
}

function bookSummary(): void {
  const runs = book.filter((id) => myPlay(id).kind === 'run').length;
  const starter = book.length === DEFAULT_BOOK.length && DEFAULT_BOOK.every((id) => book.includes(id));
  const own = book.filter((id) => myPlays.some((p) => p.id === id)).length;
  $('bookSummary').textContent = `${runs} runs, ${book.length - runs} passes${starter ? ' (starter book)' : ''}${own ? `, ${own} of your own` : ''}${myDefs.length ? ` \u00b7 ${myDefs.length} designed ${myDefs.length === 1 ? 'defense' : 'defenses'}` : ''}`;
}

// --------------------------------------------------------------- screens

function show(id: 'title' | 'setup' | 'game' | 'final' | 'bookScreen' | 'lobby' | 'designer' | 'hall' | 'dynasty' | 'shared'): void {
  for (const s of ['title', 'setup', 'game', 'final', 'bookScreen', 'lobby', 'designer', 'hall', 'dynasty', 'shared']) $(s).classList.toggle('hidden', s !== id);
}

let dynastyDone = false;
/** The league to go back to after a league game. */
let leagueReturn: string | null = null;
const shared = new SharedLeagueScreen($('shBody'), $('shTitle'), {
  api: {
    create: async (state, s) => (await online.leagueCreate(session!.token, state, s)).league,
    get: async (code) => (await online.league(session!.token, code)).league,
    claim: async (code, school) => (await online.leagueClaim(session!.token, code, school)).league,
    start: async (code) => (await online.leagueStart(session!.token, code)).league,
    force: async (code) => (await online.leagueForce(session!.token, code)).league,
    next: async (code) => (await online.leagueNext(session!.token, code)).league,
    play: async (code) => (await online.leaguePlay(session!.token, code, book, myPlays, myDefs)).room,
  },
  setup: () => setup,
  openRoom: (room) => openLobby(room),
  back: () => showSetup(false),
  errorText: (e) => (e instanceof OnlineError ? e.message : 'Something went wrong.'),
  pollMs: () => (turbo ? 150 : 2000),
  remember: (code) => {
    store.set('fnd.league.v1', code);
    renderLeagueRow();
  },
});

function renderLeagueRow(): void {
  const code = store.get<string | null>('fnd.league.v1', null);
  const el = $('lgMine');
  el.classList.toggle('hidden', !code);
  el.textContent = code ? `My league ${code}` : '';
}
const dynasty = new DynastyScreen($('dyBody'), $('dyTitle'), {
  load: () => store.get<unknown>('fnd.dynasty.v1', null),
  save: (d) => store.set('fnd.dynasty.v1', d),
  quarterMinutes: () => setup.quarterMinutes,
  play: (g) => {
    stopOnline();
    seed = g.seed;
    teams = g.teams;
    dynastyGame = g;
    dynastyDone = false;
    startGame(g.user, g.setup);
  },
  back: () => showSetup(),
}, () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);

function showSetup(fresh = true): void {
  unlockAudio();
  mode = 'menu';
  closeSideline();
  stopOnline();
  dynastyGame = null;
  if (fresh || !teams || teams[0].id !== 'sch_0001') {
    seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    teams = exhibitionTeams(seed);
  }
  $('dynastyLine').textContent = dynasty.summary();
  $('dynastyBtn').textContent = dynasty.active ? 'Continue dynasty' : 'Dynasty';
  const qb = (t: Team) => t.roster.find((p) => p.id === t.depth.QB[0])!;
  $('teams').innerHTML = teams.map((t, i) => `<button class="team-card" data-team="${i}"><div class="swatch" style="background:linear-gradient(90deg, ${css(t.colors.jersey)} 0 60%, ${css(t.colors.trim)} 60% 80%, ${css(t.colors.helmet)} 80%)"></div><div class="nm">${t.name} ${t.mascot}</div><div class="sub">${i === 0 ? 'Home' : 'Visitors'} · QB ${qb(t).name} #${qb(t).number}</div></button>`).join('');
  $('teams').querySelectorAll<HTMLElement>('[data-team]').forEach((el) => el.addEventListener('click', () => startGame(Number(el.dataset.team) as 0 | 1)));
  ($('clockToggle') as HTMLInputElement).checked = useClock;
  bookSummary();
  renderOnlineBox();
  show('setup');
}

function startGame(team: 0 | 1, conditions: GameSetup = setup): void {
  unlockAudio();
  sfx.select();
  user = team;
  const books: [string[], string[]] = [[...DEFAULT_BOOK], [...DEFAULT_BOOK]];
  books[user] = [...book];
  const plays: [OffPlay[], OffPlay[]] = [[], []];
  const defenses: [DefPlay[], DefPlay[]] = [[], []];
  plays[user] = myPlays;
  defenses[user] = myDefs;
  game = new Game(seed, teams, { books, plays, defenses, setup: conditions });
  coach = new AutoCoach(seed);
  showWeather();
  lastQuarter = 1;
  kick = null;
  viewSim = null;
  frontId = DEFENSE_FRONTS[0].id;
  scene.setTeams(teams);
  show('game');
  setStatic();
  scene.snapCamera(spot.x);
  updateBug();
  const receiving = other(game.state.kicking);
  $('banner').className = '';
  $('banner').innerHTML = `${teams[receiving].name} will receive the opening kickoff.<small>You are coaching the ${teams[user].name} ${teams[user].mascot}. ${setupLine(game.setup)}.</small>`;
  $('banner').classList.remove('hidden');
  setPanelWaiting('Kickoff');
  timer = 2200;
  mode = 'post';
}

/** Rain, snow, wind or heat over the field, and a small tag naming it. */
function showWeather(): void {
  const w = game.setup.weather;
  $('wx').className = w === 'clear' ? '' : w;
  $('wxTag').textContent = WEATHER[w].name;
  $('wxTag').classList.toggle('hidden', w === 'clear');
}

function showFinal(): void {
  mode = 'final';
  closeSideline();
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
  const official = net ? (net.sync === 'ok' && net.view.hash === gameHash(game) ? ' · matches the server' : ' · DOES NOT MATCH THE SERVER') : '';
  $('finalMeta').textContent = `Seed ${seed} · ${game.log.length} decisions · game fingerprint ${gameHash(game)}${official}`;
  if (net) window.clearInterval(net.timer);
  $('finalCareer').textContent = '';
  $('again').textContent = dynastyGame ? 'Back to the dynasty' : net?.view.league ? 'Back to the league' : 'New game';
  leagueReturn = net?.view.league?.code ?? null;
  if (net) void loadCareer(true);
  if (dynastyGame && !dynastyDone) {
    dynastyDone = true;
    const g = dynastyGame;
    const score: [number, number] = [s.score[0], s.score[1]];
    $('finalCareer').textContent = 'Playing the rest of the league\u2026';
    ($('again') as HTMLButtonElement).disabled = true;
    // Let the final score paint before the other games are worked out.
    window.setTimeout(() => {
      $('finalCareer').textContent = dynasty.finishGame(g, score).text;
      ($('again') as HTMLButtonElement).disabled = false;
    }, 60);
  }
  $('log').innerHTML = game.events.filter((e) => e.points[0] + e.points[1] > 0).map((e) => `<div><b>Q${e.quarter} ${Math.floor(e.clock / 60)}:${String(e.clock % 60).padStart(2, '0')}</b> ${e.text} <b>${e.scoreAfter[0]}–${e.scoreAfter[1]}</b></div>`).join('') || '<div>No scoring.</div>';
  show('final');
}

// ------------------------------------------------------------------ online

const localTurn = (): number => game.log.filter((d) => !('manage' in d)).length;

function onlineMessage(where: 'oMsg' | 'lobbyMsg', e: unknown): void {
  $(where).textContent = e instanceof OnlineError ? e.message : 'Something went wrong.';
}

function renderOnlineBox(): void {
  $('oMsg').textContent = '';
  $('oSignedOut').classList.toggle('hidden', !!session);
  $('oSignedIn').classList.toggle('hidden', !session);
  if (!session || !teams) return;
  $('oWho').textContent = `Signed in as ${session.name}`;
  renderCareer();
  void loadCareer(false);
  $('oHostRow').innerHTML = teams.map((t, i) => `<button class="seg" data-host="${i}">Host as ${t.name}</button>`).join('');
  $('oHostRow').querySelectorAll<HTMLElement>('[data-host]').forEach((el) => el.addEventListener('click', async () => {
    try {
      openLobby((await online.host(session!.token, Number(el.dataset.host) as 0 | 1, book, myPlays, myDefs, setup)).room);
    } catch (e) {
      signedOutCheck(e);
      onlineMessage('oMsg', e);
    }
  }));
}

const recordText = (c: Career): string => `${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''}`;

function renderCareer(): void {
  const c = career;
  $('oCareer').innerHTML = !c ? '' : c.games === 0
    ? 'No online games yet. Your record starts with your first finished game.'
    : `<b>${recordText(c)}</b> career record \u00b7 <b>${c.championships}</b> ${c.championships === 1 ? 'championship' : 'championships'} \u00b7 ${c.pointsFor} points for, ${c.pointsAgainst} against \u00b7 best winning streak ${c.bestStreak}`;
}

/** Fetches this coach's record. After a game the server may still be writing it, so the final screen asks twice. */
async function loadCareer(final: boolean, again = true): Promise<void> {
  if (!session) return;
  try {
    career = (await online.profile(session.token)).career;
    renderCareer();
    if (final && career) $('finalCareer').textContent = `Coach ${career.name}: ${recordText(career)} career \u00b7 ${career.championships} ${career.championships === 1 ? 'championship' : 'championships'}`;
    if (final && again) window.setTimeout(() => void loadCareer(true, false), 2500);
  } catch (e) {
    signedOutCheck(e);
  }
}

async function showHall(): Promise<void> {
  show('hall');
  $('hallBody').innerHTML = '<div class="waiting">Loading the Hall of Fame</div>';
  try {
    const list = (await online.hall()).hall;
    $('hallBody').innerHTML = list.length === 0
      ? '<p>No finished online games yet. The first coach to finish one goes straight in.</p>'
      : `<table><tr><th>#</th><th>Coach</th><th>Record</th><th>Win %</th><th>Titles</th><th>Points</th><th>Best streak</th></tr>${list.map((c, i) => `<tr class="${session && c.name === session.name ? 'me' : ''}"><td>${i + 1}</td><td>${c.name.replace(/[&<>]/g, '')}</td><td><b>${recordText(c)}</b></td><td>${Math.round((100 * (c.wins + c.ties / 2)) / c.games)}</td><td>${c.championships}</td><td>${c.pointsFor}\u2013${c.pointsAgainst}</td><td>${c.bestStreak}</td></tr>`).join('')}</table>`;
  } catch (e) {
    $('hallBody').innerHTML = `<p>${e instanceof OnlineError ? e.message : 'Something went wrong.'}</p>`;
  }
}

function signedOutCheck(e: unknown): void {
  if (e instanceof OnlineError && e.code === 'signed_out') {
    session = null;
    career = null;
    store.set('fnd.session.v1', null);
    renderOnlineBox();
  }
}

async function signIn(): Promise<void> {
  const name = ($('oName') as HTMLInputElement).value;
  const pin = ($('oPin') as HTMLInputElement).value;
  try {
    const r = await online.enter(name, pin);
    career = null;
    session = { token: r.token, name: r.coach.name };
    store.set('fnd.session.v1', session);
    renderOnlineBox();
  } catch (e) {
    onlineMessage('oMsg', e);
  }
}

async function joinByPin(): Promise<void> {
  if (!session) return;
  try {
    openLobby((await online.join(session.token, ($('oJoinPin') as HTMLInputElement).value.trim(), book, myPlays, myDefs)).room);
  } catch (e) {
    signedOutCheck(e);
    onlineMessage('oMsg', e);
  }
}

function openLobby(view: RoomView): void {
  stopOnline();
  net = { token: session!.token, pin: view.pin, view, queue: [...view.log], received: view.logSize, timer: 0, busy: false, sync: 'ok' };
  net.timer = window.setInterval(() => void poll(), turbo ? 120 : 1000);
  $('lobbyMsg').textContent = '';
  renderVoice();
  if (view.state === 'lobby') {
    show('lobby');
    renderLobby();
  } else enterOnlineGame();
}

function stopOnline(): void {
  voice.leave();
  if (!net) return;
  window.clearInterval(net.timer);
  net = null;
  renderVoice();
}

function renderLobby(): void {
  if (!net) return;
  const v = net.view;
  const lobbyTeams = v.league ? leagueTeams(v.league) : exhibitionTeams(v.seed);
  $('lobbyPin').textContent = v.pin;
  $('lobbySetup').textContent = setupLine(cleanSetup(v.setup));
  $('lobbySeats').innerHTML = lobbyTeams.map((t, i) => `<div class="team-card seat${i === v.you ? ' me' : ''}"><div class="swatch" style="background:linear-gradient(90deg, ${css(t.colors.jersey)} 0 60%, ${css(t.colors.trim)} 60% 80%, ${css(t.colors.helmet)} 80%)"></div><div class="nm">${t.name} ${t.mascot}</div><div class="coach${v.coaches[i] ? '' : ' empty'}">${v.coaches[i] ? `${v.coaches[i]}${i === v.you ? ' (you)' : ''}` : 'Waiting for a coach…'}</div></div>`).join('');
  const ready = !!v.coaches[0] && !!v.coaches[1];
  const start = $('lobbyStart') as HTMLButtonElement;
  start.classList.toggle('hidden', !v.isHost || !!v.league);
  start.disabled = !ready;
  start.style.opacity = ready ? '1' : '0.4';
  $('lobbyHelp').textContent = v.league
    ? 'League game. It starts as soon as the other coach sits down: you both have to be here.'
    : v.isHost
    ? (ready ? 'Both coaches are here. Start when you are ready.' : 'Tell the other coach to sign in, type this PIN and press Join.')
    : 'You are in. Waiting for the host to start the game.';
}

/** Every reply carries the room, so every reply is also a poll. */
async function netRequest(fn: () => Promise<{ room: RoomView }>): Promise<boolean> {
  if (!net) return false;
  const mine = net;
  try {
    const r = await fn();
    if (net !== mine) return false;
    takeView(r.room);
    return true;
  } catch (e) {
    if (net !== mine) return false;
    if (e instanceof OnlineError && e.code === 'stale') return false;
    if (mode === 'menu') onlineMessage('lobbyMsg', e);
    else if (e instanceof OnlineError && e.code !== 'offline') console.warn('online', e.code, e.message);
    return false;
  }
}

async function poll(): Promise<void> {
  if (!net || net.busy) return;
  net.busy = true;
  const mine = net;
  await netRequest(() => online.game(mine.token, mine.pin, mine.received));
  mine.busy = false;
}

function takeView(view: RoomView): void {
  if (!net) return;
  const was = net.view.state;
  // Two replies can overlap; only take the entries that continue from what this browser already has.
  const start = view.logSize - view.log.length;
  if (start <= net.received && view.logSize > net.received) {
    const fresh = view.log.slice(net.received - start);
    net.queue.push(...fresh);
    net.received += fresh.length;
  }
  // An older reply must not replace a newer picture of the room.
  if (view.logSize >= net.view.logSize) net.view = view;
  renderVoice();
  if (net.view.state === 'lobby') return renderLobby();
  if (was === 'lobby' || mode === 'menu') return enterOnlineGame();
  if (mode === 'choose' || mode === 'wait') {
    clockLeft = Math.max(0, net.view.deadlineInMs);
    updateBug();
    pump();
  }
}

/** Builds the local copy of the game. A game already under way is caught up without animation. */
function enterOnlineGame(): void {
  if (!net) return;
  const v = net.view;
  unlockAudio();
  seed = v.seed;
  teams = v.league ? leagueTeams(v.league) : exhibitionTeams(seed);
  user = v.you;
  coach = new AutoCoach(seed, [v.plan, v.plan]);
  const catchUp = net.queue.length > 1 ? net.queue.splice(0, net.queue.length) : [];
  game = replayGame(seed, teams, catchUp, { books: v.books, plays: v.designs.plays, defenses: v.designs.defenses, setup: cleanSetup(v.setup) });
  showWeather();
  lastQuarter = game.state.quarter;
  kick = null;
  viewSim = null;
  frontId = DEFENSE_FRONTS[0].id;
  scene.setTeams(teams);
  show('game');
  setStatic();
  scene.snapCamera(spot.x);
  updateBug();
  $('banner').className = '';
  $('banner').innerHTML = `${v.coaches[0] ?? ''} (${teams[0].abbr}) against ${v.coaches[1] ?? ''} (${teams[1].abbr})<small>You are coaching the ${teams[user].name} ${teams[user].mascot}. Game PIN ${v.pin}.</small>`;
  $('banner').classList.remove('hidden');
  setPanelWaiting(catchUp.length ? 'Rejoining the game' : 'Kickoff');
  timer = 1800;
  mode = 'post';
}

/** Between plays online: show what the server has resolved, or ask for this sideline's call. */
function onlineNext(): void {
  if (!net) return;
  updateBug();
  setStatic();
  wantTimeout = false;
  wantBlock = false;
  mode = 'wait';
  if (net.queue.length) return pump();
  showOnlinePanel();
}

function showOnlinePanel(): void {
  if (!net || game.state.phase === 'final') return;
  const v = net.view;
  if (v.turn !== localTurn()) {
    setPanelWaiting('Waiting for the server');
    return;
  }
  clockOn = true;
  clockLeft = Math.max(0, v.deadlineInMs);
  if (v.mine) {
    mode = 'wait';
    setPanelWaiting('Your call is in. Waiting for the other sideline…');
    return;
  }
  if (game.state.phase === 'kickoff') {
    if (game.state.kicking === user) showKickPanel();
    else {
      mode = 'wait';
      setPanelWaiting('The other coach is calling the kickoff');
    }
    return;
  }
  if (game.state.possession === user) showOffensePanel();
  else showDefensePanel();
}

async function sendCall(call: OffDecision | DefDecision): Promise<void> {
  if (!net) return;
  const mine = net;
  mode = 'wait';
  keyHandler = null;
  $('pclock').classList.add('hidden');
  setPanelWaiting('Your call is in. Waiting for the other sideline…');
  const ok = await netRequest(() => online.call(mine.token, mine.pin, localTurn(), call, mine.received));
  // A refused call (the clock ran out first, say) simply leaves the server's result to arrive by polling.
  if (!ok && net === mine && mode === 'wait' && !mine.queue.length && mine.view.turn === localTurn() && !mine.view.mine) showOnlinePanel();
}

/** Applies what the server has resolved. Sideline changes apply at once; a play is shown, then the next waits its turn. */
function pump(): void {
  if (!net || (mode !== 'choose' && mode !== 'wait')) return;
  while (net.queue.length) {
    const entry = net.queue.shift()!;
    if ('manage' in entry) {
      game.manage(entry.manage);
      if (sidelineOpen) renderSideline();
      continue;
    }
    closeSideline();
    $('banner').classList.add('hidden');
    $('calls').classList.add('hidden');
    if (game.state.phase === 'kickoff') {
      setStatic();
      runKickoff(entry.off);
    } else {
      commit(entry.off!, entry.def!);
    }
    checkSync();
    return;
  }
  if (mode === 'wait' && game.state.phase !== 'final' && $('panel').querySelector('[data-act]') === null) showOnlinePanel();
}

/** Once this browser has everything the server has resolved, the two must agree exactly. */
function checkSync(): void {
  if (!net || net.queue.length || game.log.length !== net.view.logSize) return;
  // The play just begun is still being drawn here, so compare a finished copy built from the same log.
  const probe = replayGame(seed, teams, game.log, { books: net.view.books, plays: net.view.designs.plays, defenses: net.view.designs.defenses, setup: cleanSetup(net.view.setup) });
  if (gameHash(probe) !== net.view.hash) {
    net.sync = 'bad';
    console.error('out of sync with the server', gameHash(probe), net.view.hash);
  }
}

// ------------------------------------------------------------------- voice

/** Voice chat buttons and status line, in the lobby and during the game. Audio goes browser to browser. */
function renderVoice(): void {
  const on = voice.state === 'on';
  const them = net ? (net.view.you === 0 ? 1 : 0) : 0;
  const name = net?.view.coaches[them] ?? 'the other coach';
  const peer = net ? voice.peerState(String(them)) : null;
  let text = '';
  let tone = '';
  if (voice.state === 'asking') text = 'Allow the microphone to talk.';
  else if (voice.state === 'blocked') { text = 'The microphone is blocked. Allow it in your browser settings to talk.'; tone = 'bad'; }
  else if (voice.state === 'unsupported') { text = 'This browser cannot do voice chat here.'; tone = 'bad'; }
  else if (on && peer === 'connected') { text = `Voice on: talking with ${name}${voice.micMuted ? ' (your mic is muted)' : ''}.`; tone = 'good'; }
  else if (on && peer === 'failed') { text = `Voice on, but the call to ${name} cannot get through. Some networks block direct calls. Still trying.`; tone = 'bad'; }
  else if (on && peer === 'connecting') text = `Voice on: connecting to ${name}\u2026`;
  else if (on) text = `Voice on: waiting for ${name} to turn voice on.`;
  else if (net?.view.voice[them]) text = `${name} has voice on. Press Voice chat to talk.`;
  for (const [btn, mic, line] of [['voiceBtn', 'micBtn', 'voiceState'], ['lobbyVoice', 'lobbyMic', 'lobbyVoiceState']] as const) {
    $(btn).classList.toggle('hidden', !net);
    $(btn).textContent = on ? 'Leave voice' : 'Voice chat';
    $(btn).classList.toggle('live', on);
    $(mic).classList.toggle('hidden', !net || !on);
    $(mic).textContent = voice.micMuted ? 'Unmute mic' : 'Mute mic';
    $(line).textContent = net ? text : '';
    $(line).className = `voice-state ${tone}`;
  }
}

function toggleVoice(): void {
  if (!net) return;
  if (voice.state === 'on' || voice.state === 'asking') voice.leave();
  else void voice.join(net.token, net.pin, String(net.view.you));
}

voice.onChange(renderVoice);

// ---------------------------------------------------------------- wiring

($('titleArt') as HTMLImageElement).src = titleUrl;
($('setupLogo') as HTMLImageElement).src = logoUrl;
$('version').textContent = `v${devnotes.notes[0].version} · ${devnotes.notes[0].title}`;
$('title').addEventListener('click', () => showSetup());
$('again').addEventListener('click', () => {
  if (leagueReturn && session) {
    const code = leagueReturn;
    leagueReturn = null;
    stopOnline();
    mode = 'menu';
    show('shared');
    void shared.open(code);
    return;
  }
  if (!dynastyGame) return showSetup();
  dynastyGame = null;
  mode = 'menu';
  dynasty.render();
  show('dynasty');
});
$('dynastyBtn').addEventListener('click', () => {
  unlockAudio();
  dynasty.render();
  show('dynasty');
});
$('editBook').addEventListener('click', showBookScreen);
$('bookReset').addEventListener('click', () => { bookDraft = [...DEFAULT_BOOK]; renderBook(); });
$('bookSave').addEventListener('click', () => {
  if (validateBook(bookDraft, myPlays) !== null) return;
  book = [...bookDraft];
  store.set('fnd.book.v2', book);
  showSetup(false);
});
$('clockToggle').addEventListener('change', (ev) => {
  useClock = (ev.target as HTMLInputElement).checked;
  store.set('fnd.clock.v1', useClock);
});
$('oEnter').addEventListener('click', () => void signIn());
$('oPin').addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter') void signIn(); });
const quarterPick = $('quarterPick') as HTMLSelectElement;
const weatherPick = $('weatherPick') as HTMLSelectElement;
quarterPick.innerHTML = QUARTER_MINUTES.map((m) => `<option value="${m}">${m} minutes${m === 12 ? ' (standard)' : ''}</option>`).join('');
weatherPick.innerHTML = WEATHERS.map((w) => `<option value="${w}">${WEATHER[w].name}</option>`).join('');
const showSetupPicks = (): void => {
  quarterPick.value = String(setup.quarterMinutes);
  weatherPick.value = setup.weather;
  $('weatherNote').textContent = WEATHER[setup.weather].desc;
};
const readSetupPicks = (): void => {
  setup = cleanSetup({ quarterMinutes: Number(quarterPick.value), weather: weatherPick.value });
  store.set('fnd.setup.v1', setup);
  showSetupPicks();
};
quarterPick.addEventListener('change', readSetupPicks);
weatherPick.addEventListener('change', readSetupPicks);
showSetupPicks();
$('lgNew').addEventListener('click', () => {
  if (!session) return;
  show('shared');
  shared.openNew();
});
const openLeague = (code: string): void => {
  if (!session || !/^[A-Za-z]{5}$/.test(code)) {
    $('oMsg').textContent = 'A league code is five letters.';
    return;
  }
  $('oMsg').textContent = '';
  show('shared');
  void shared.open(code.toUpperCase());
};
$('lgJoin').addEventListener('click', () => openLeague(($('lgCode') as HTMLInputElement).value.trim()));
$('lgMine').addEventListener('click', () => openLeague(store.get<string | null>('fnd.league.v1', null) ?? ''));
renderLeagueRow();
for (const id of ['hallBtn', 'hallBtn2']) $(id).addEventListener('click', () => void showHall());
$('hallBack').addEventListener('click', () => showSetup(false));
$('oOut').addEventListener('click', () => { session = null; career = null; store.set('fnd.session.v1', null); renderOnlineBox(); });
$('oJoin').addEventListener('click', () => void joinByPin());
$('oJoinPin').addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter') void joinByPin(); });
$('lobbyStart').addEventListener('click', () => { if (net) void netRequest(() => online.start(net!.token, net!.pin)); });
$('lobbyLeave').addEventListener('click', () => {
  if (net) void online.leave(net.token, net.pin).catch(() => undefined);
  showSetup(false);
});
for (const id of ['voiceBtn', 'lobbyVoice']) $(id).addEventListener('click', toggleVoice);
for (const id of ['micBtn', 'lobbyMic']) $(id).addEventListener('click', () => voice.toggleMic());
$('sidelineBtn').addEventListener('click', openSideline);
$('slClose').addEventListener('click', closeSideline);
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
  if ($('game').classList.contains('hidden')) return;
  if (k === 'escape' && sidelineOpen) return closeSideline();
  if (k === 's') return sidelineOpen ? closeSideline() : openSideline();
  if (mode === 'choose' && keyHandler && !sidelineOpen) keyHandler(k);
});

/** Debug hooks used by the browser checks. */
(window as unknown as Record<string, unknown>).__fnd = {
  selftest: (s: number): string => gameHash(simulateGame(s, exhibitionTeams(s))),
  state: () => ({ mode, league: shared.current ? { code: shared.current.code, state: shared.current.state, year: shared.current.year, week: shared.current.week, you: shared.current.you, over: shared.current.over, played: shared.current.games.filter((g) => g.score).length } : null, dynasty: dynasty.active ? { year: dynasty.active.year, week: dynasty.active.week, user: dynasty.active.user, results: dynasty.active.results.length, history: dynasty.active.history.length } : null, cutin: $('cutin').classList.contains('hidden') ? null : ($('cutin') as HTMLImageElement).alt, setup: game?.setup ?? setup, myPlays: myPlays.length, myDefs: myDefs.length, career, practice: practiceRun ? { n: practiceRun.n, done: !!viewSim?.done } : null, phase: game?.state.phase, score: game?.state.score, quarter: game?.state.quarter, clock: game?.state.clock, sidelineOpen, playClock: clockOn ? Math.ceil(clockLeft / 1000) : null, book,
    online: net ? { pin: net.pin, state: net.view.state, turn: net.view.turn, you: net.view.you, sync: net.sync, serverHash: net.view.hash, localHash: game ? gameHash(game) : '', queued: net.queue.length, serverScore: net.view.score, mine: !!net.view.mine, voice: voice.state, peer: voice.peerState(String(net.view.you === 0 ? 1 : 0)), voiceSeen: net.view.voice } : null }),
  setSpeed: (n: number) => { speed = n; },
  setTurbo: (on: boolean) => { turbo = on; },
  setPlayClock: (on: boolean) => { useClock = on; clockOn = clockOn && on; },
};
