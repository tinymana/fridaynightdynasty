import {
  BOOK_MIN, BOOK_SIZE, CUSTOM_FRONT, QUARTER_MINUTES, WEATHER, WEATHERS, cleanSetup, DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, FORMATIONS, MAX_CUSTOM_DEFENSES, MAX_CUSTOM_PLAYS, OFFENSE_PLAYS, RULES, U,
  defAssignment, draftFromDefense, draftFromFront, draftFromPlay, exhibitionTeams, formationOf, frontById, newDesignId, overall, playById, schemeById,
  toFront, toScheme, validateBook, validateDefPlay, validateOffPlay,
  type DefDecision, type DefFront, type DefPlay, type DefScheme, type GameSetup, type Group, type KickStyle, type ManageAction, type OffAssign, type OffDecision, type OffPlay, type PlayEvent, type Team,
} from '@fnd/core';
import { fieldGoalDistance } from '@fnd/football-ai';
import { AutoCoach, Game, gameHash, replayGame, simulateGame, summarize, type LoggedDecision, type MoveKind, type PlaySim, type ReturnSim } from '@fnd/match-sim';
import { leagueTeams, type Career, type RoomView, type SaveMeta } from '@fnd/online';
import { boxScore, occasionFor, type Occasion, type StatLine } from '@fnd/league';
import { FIGHT_SONG_BEAT, chantFor, fightSong, halftimeShow, type CrowdInput, type Note } from './atmosphere';
import { OnlineError, online } from './net/online';
import { cutinFor } from './cutins';
import { makeSave, readSave, saveFileName, saveLabel, type SaveContents } from './saves';
import wxRainUrl from './assets/wx-rain.png';
import wxSnowUrl from './assets/wx-snow.png';
import wxFogUrl from './assets/wx-fog.png';
import wxLeavesUrl from './assets/wx-leaves.png';
import menuArtUrl from './assets/menu-stadium.webp';
import pressStartUrl from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2';
import jerseyUrl from '@fontsource/jersey-15/files/jersey-15-latin-400-normal.woff2';
import { DynastyScreen, type DynastyGame } from './dynasty';
import { SharedLeagueScreen } from './shared-league';
import { openDefenseDesigner, openOffenseDesigner, practiceTeams, type DesignerHost } from './designer';
import { voice } from './net/voice';
import { FieldScene, createGame, type FieldView, type ViewPlayer } from './scene';
import { announce, band, crowd, refreshAtmosphere, setMuted, setPa, sfx, unlockAudio } from './audio';
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

type Mode = 'menu' | 'choose' | 'wait' | 'presnap' | 'live' | 'return' | 'replay' | 'kick' | 'post' | 'final';

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
interface KickAnim {
  x0: number; x1: number; y0: number; y1: number; t: number;
  /** Time the ball is in the air, then time the return takes (0 when there is none). */
  T: number; R: number;
  e: PlayEvent;
  /** Where everyone stood at the kick, the kicking team, and the returner's index among them (-1 for none). */
  start: ViewPlayer[]; kicking: 0 | 1; returner: number;
  /** When a return follows: where each drawn player has to be when the ball comes down, so the return starts without a jump. */
  to: ({ x: number; y: number } | null)[] | null;
  /** Field yards the return covers, along x toward the kicking team's side. */
  run: number;
}

/** What a save holds. A change to any of these is a change to the save. */
const SAVED_KEYS = ['fnd.dynasty.v1', 'fnd.plays.v1', 'fnd.defs.v1', 'fnd.book.v2'];
/** Set while a loaded save is being written into this browser, so that writing it does not count as a new change. */
let applyingSave = false;
let savedChanged: () => void = () => {};

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
    if (SAVED_KEYS.includes(key)) savedChanged();
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
/** Poses for the drawing: who threw the ball and when, who is fending a tackler off, and which team is celebrating. */
let thrower = -1;
let armUntil = new Map<unknown, number>();
let spinUntil = new Map<unknown, number>();
/** Who had the ball last frame in the play being shown, and the man who has just handed it off. */
let heldBy: { sim: unknown; idx: number } | null = null;
let gave: { sim: unknown; idx: number; until: number } | null = null;
/** The play being shown was called as a run. */
let viewRun = false;
/** A move drawn with its own picture (a truck, a juke, a dive), and the frame it lasts until. */
let moveUntil = new Map<unknown, { pose: 'truck' | 'juke' | 'pylon'; until: number }>();
const movePose = (player: unknown): 'truck' | 'juke' | 'pylon' | undefined => { const m = moveUntil.get(player); return m && m.until > frame ? m.pose : undefined; };
let cheerTeam: 0 | 1 | null = null;
let official: 'td' | 'point' | 'flag' | null = null;
let kick: KickAnim | null = null;
/** A kick, punt or turnover being run back: the real return, replayed from the game. */
let viewReturn: { sim: ReturnSim; frame: 0 | 1; then: (() => void) | null; hold: number } | null = null;
let pendingOff: OffDecision | null = null;
/** Solo: your offense is at the line with this call, facing this defense. */
let atLine: { off: OffDecision & { kind: 'play' }; def: DefDecision } | null = null;
let pendingEvent: PlayEvent | null = null;
let wantTimeout = false;
/** Fourth down on defense: sell out for the block. */
let wantBlock = false;
let lastQuarter = 1;
/** Atmosphere for the game being played: what night it is, the home school's fight song, and a snap counter for chants. */
let occasion: Occasion = null;
let fightTune: Note[] = [];
let snapCount = 0;
let chantUntil = 0;
let firstDowns = 0;
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
/** On fourth down the call sheet opens on special teams, until the coach picks a formation for that snap. */
let stAuto = true;
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

/** Between plays both teams huddle: the offense seven yards behind the ball, the defense five yards off it. */
function scrimmageLineup(off: 0 | 1, los: number, lined = false): ViewPlayer[] {
  const out: ViewPlayer[] = [];
  if (lined) {
    // Lined up: used when the coach is trying fronts on the call sheet and wants to see them.
    const formation = formationOf(game.playOf(off, game.books[off][0]));
    const front = frontById(off === user ? DEFENSE_FRONTS[0].id : libraryFront());
    for (const slot of formation.slots) {
      const [x, y] = abs(off, los + slot.at[0], CY_YD + slot.at[1]);
      out.push({ team: off, x, y, moving: false, down: false, hasBall: false, pose: slot.group === 'OL' ? 'line' : undefined });
    }
    for (const slot of front.slots) {
      const [x, y] = abs(off, Math.min(los + slot.at[0], 108), CY_YD + slot.at[1]);
      out.push({ team: other(off), x, y, moving: false, down: false, hasBall: false, pose: slot.group === 'DL' ? 'line' : 'crouch' });
    }
    return out;
  }
  const ring = (team: 0 | 1, depth: number, rx: number, ry: number): void => {
    for (let i = 0; i < 11; i++) {
      // One man (the quarterback, or the middle linebacker) stands in the middle; the other ten close round him.
      const a = (i / 10) * Math.PI * 2;
      const dx = i === 10 ? 0 : Math.cos(a) * rx;
      const dy = i === 10 ? 0 : Math.sin(a) * ry;
      const [x, y] = abs(off, Math.max(-8, Math.min(los + depth + dx, 108)), CY_YD + dy);
      out.push({ team, x, y, moving: false, down: false, hasBall: false });
    }
  };
  ring(off, -7, 1.7, 2.6);
  ring(other(off), 5, 1.7, 2.6);
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

function setStatic(lined = false): void {
  const s = game.state;
  viewSim = null;
  viewReturn = null;
  if (s.phase === 'kickoff') {
    lineup = kickoffLineup(s.kicking, s.kickFrom);
    marks = null;
    spot = { x: abs(s.kicking, s.kickFrom, CY_YD)[0], y: CY_YD };
  } else if (s.phase !== 'final') {
    const los = s.phase === 'conversion' ? RULES.twoPointFrom : s.yardLine;
    const off = s.possession;
    lineup = scrimmageLineup(off, los, lined);
    const a = abs(off, los, CY_YD)[0];
    marks = { los: a, toGain: s.phase === 'conversion' ? abs(off, 100, CY_YD)[0] : abs(off, Math.min(los + s.distance, 100), CY_YD)[0] };
    spot = { x: a, y: CY_YD };
  }
}

/** Shows the return on the last play, if there was one and plays are being watched, then carries on. */
function startReturn(then: () => void): void {
  const r = game.lastReturn;
  if (!r || speed === 0) return then();
  viewReturn = { sim: r.make(), frame: r.frame, then, hold: 350 };
  kick = null;
  mode = 'return';
  acc = 0;
}

const MOVE_WORDS: Record<MoveKind, string> = { stiffArm: 'STIFF ARM!', truck: 'TRUCKED!', juke: 'JUKE!', spin: 'SPIN!', dive: 'DIVES!' };
const movesShown = new WeakMap<object, number>();
let moveTimer = 0;

/** Calls out a broken tackle or a dive as it happens. */
function showMoves(dt: number): void {
  const el = $('moveTag');
  if (moveTimer > 0 && (moveTimer -= dt) <= 0) el.classList.add('hidden');
  const sim = viewReturn?.sim ?? viewSim;
  if (!sim || speed === 0) return;
  const seen = movesShown.get(sim) ?? 0;
  if (sim.moves.length <= seen) return;
  movesShown.set(sim, sim.moves.length);
  const m = sim.moves[sim.moves.length - 1];
  // A stiff arm or a truck is drawn as one for the next half second.
  if (m.kind === 'stiffArm') armUntil.set(m.carrier, frame + 30);
  // A spin turns the runner round for a moment.
  if (m.kind === 'spin') spinUntil.set(m.carrier, frame + 24);
  // A truck, a juke and a dive each have a picture of their own.
  if (m.kind === 'truck') moveUntil.set(m.carrier, { pose: 'truck', until: frame + 30 });
  if (m.kind === 'juke') moveUntil.set(m.carrier, { pose: 'juke', until: frame + 14 });
  if (m.kind === 'dive') moveUntil.set(m.carrier, { pose: 'pylon', until: frame + 36 });
  // A comic-book burst over the runner: the word, his number, a colour for each move. Rebuilding it restarts the pop.
  el.innerHTML = `<span class="burst"><b>${MOVE_WORDS[m.kind]}</b><small>#${m.carrier.number}</small></span>`;
  el.className = `k-${m.kind}`;
  const at = scene.carrierAt();
  el.style.left = `${Math.round(Math.max(0.14, Math.min(0.86, at.x)) * 100)}%`;
  el.style.top = `${Math.round(Math.max(0.3, Math.min(0.8, at.y - 0.13)) * 100)}%`;
  moveTimer = 950;
  sfx.tackle();
}

/** The man nearest the ball when it is kicked swings his leg through it. */
function kickPose(players: ViewPlayer[], k: KickAnim, f: number): void {
  // With the ball coming down, the returner settles under it.
  if (k.returner >= 0 && f > 0.55 && f < 1 && players[k.returner]) players[k.returner] = { ...players[k.returner], pose: 'field', moving: false };
  if (f > 0.35) return;
  let best = -1;
  let dist = 1e9;
  k.start.forEach((p, i) => {
    const d = Math.abs(p.x - k.x0) + Math.abs(p.y - k.y0);
    if (p.team === k.kicking && d < dist) { dist = d; best = i; }
  });
  if (best < 0 || !players[best]) return;
  const punt = k.e.type === 'punt';
  players[best] = { ...players[best], pose: punt ? (f < 0.12 ? 'punt0' : 'punt1') : f < 0.12 ? 'kick0' : 'kick1', moving: false };
  if (k.e.type !== 'fieldGoal' && k.e.type !== 'pat') return;
  // On a place kick the next man over is the holder, down on one knee with the ball.
  let holder = -1;
  dist = 1e9;
  k.start.forEach((p, i) => {
    const d = Math.abs(p.x - k.x0) + Math.abs(p.y - k.y0);
    if (i !== best && p.team === k.kicking && d < dist) { dist = d; holder = i; }
  });
  if (holder >= 0 && players[holder]) players[holder] = { ...players[holder], pose: 'hold', moving: false };
}

function buildView(): FieldView {
  if (viewReturn) {
    const { sim, frame: side } = viewReturn;
    const players: ViewPlayer[] = sim.players.map((p) => {
      const [x, y] = abs(side, p.x / U, p.y / U);
      const fending = p.idx === 0 && (armUntil.get(p.player) ?? 0) > frame;
      return { team: p.side === 0 ? other(side) : side, x, y, moving: p.x !== p.px || p.y !== p.py, down: p.idx === 0 && sim.done && !sim.result?.touchdown, hasBall: p.idx === 0, pose: (p.idx === 0 ? movePose(p.player) : undefined) ?? (fending ? (frame % 12 < 6 ? 'arm0' : 'arm1') : undefined), spin: p.idx === 0 && (spinUntil.get(p.player) ?? 0) > frame };
    });
    const c = players[0];
    return { players, ball: { x: c.x, y: c.y, z: 0, visible: false }, los: null, toGain: null, focusX: c.x, frame };
  }
  if (viewSim) {
    const sim = viewSim;
    const off = viewOffense;
    const b = sim.ball;
    if (b.state === 'held') thrower = b.holder;
    // A run: the quarterback turns and hands the ball off, he does not set up to throw.
    const isRun = !practiceRun && viewRun;
    if (b.state === 'held') {
      if (heldBy && heldBy.sim === sim && heldBy.idx !== b.holder && mode === 'live') gave = { sim, idx: heldBy.idx, until: frame + 20 };
      heldBy = { sim, idx: b.holder };
    }
    const giving = gave && gave.sim === sim && gave.until > frame ? gave.idx : -1;
    const players: ViewPlayer[] = sim.players.map((p) => {
      const [x, y] = abs(off, p.x / U, p.y / U);
      const team = p.side === 0 ? off : other(off);
      const moving = p.x !== p.px || p.y !== p.py;
      const hasBall = b.state === 'held' && b.holder === p.idx;
      const down = sim.tick < p.stunUntil || (sim.done && sim.result !== null && !sim.result.touchdown && b.holder === p.idx && !sim.result.incomplete && sim.result.turnover !== 'interception');
      let pose: ViewPlayer['pose'];
      const lineman = p.player.pos === 'OL' || p.player.pos === 'DL';
      // After a touchdown the man with the ball spikes it and his team throws its arms up.
      if (mode === 'post' && cheerTeam === team) pose = hasBall ? 'spike' : 'cheer';
      else if (b.state === 'air' && b.t < 16 && p.idx === thrower) pose = 'throw1';
      else if (p.idx === giving) pose = 'handoff';
      else if (hasBall && !moving && mode === 'live' && sim.tick > 12) pose = isRun ? 'ready' : 'throw0';
      else if (hasBall && movePose(p.player)) pose = movePose(p.player);
      else if (hasBall && (armUntil.get(p.player) ?? 0) > frame) pose = frame % 12 < 6 ? 'arm0' : 'arm1';
      // A man who is in the play and not running is blocking or being blocked: hands up, not down in a stance.
      // Linemen get down in a three-point stance before the snap, and drive into their man after it.
      else if (lineman && !hasBall && !down && sim.tick <= 8) pose = 'line';
      // Linebackers and the secondary wait in a crouch.
      else if (p.side === 1 && !lineman && !moving && sim.tick <= 8) pose = 'crouch';
      // The end of the play: the tackler is laid out where he made the stop, an interceptor has the ball above his head.
      else if (sim.done && sim.result?.tackler === p.player && !down) pose = 'tackle';
      else if (sim.done && hasBall && p.side === 1 && sim.result?.turnover === 'interception' && !moving) pose = 'pick';
      else if (lineman && !hasBall && !down && mode === 'live' && (p.engaged >= 0 || !moving)) pose = 'drive';
      else if (!moving && !hasBall && !down && mode === 'live' && sim.tick > 8) pose = 'ready';
      // Handing off, he faces the back behind him.
      const turned = p.idx === giving || (isRun && hasBall && p.idx === thrower && !moving && mode === 'live' && sim.tick <= 40);
      return { team, x, y, moving, down, hasBall, pose, back: turned, spin: hasBall && (spinUntil.get(p.player) ?? 0) > frame };
    });
    // A pass that fell incomplete: the nearest receiver is laid out on the turf where he dived for it.
    if (sim.done && sim.result?.incomplete && sim.result.thrown) {
      let best = -1;
      let dist = U * 5;
      sim.players.forEach((p, i) => {
        const d = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
        if (p.side === 0 && p.idx !== thrower && p.player.pos !== 'OL' && d < dist) { dist = d; best = i; }
      });
      if (best >= 0 && !players[best].down) players[best] = { ...players[best], pose: 'dive', moving: false };
      // And the nearest defender has his hand up where he knocked it away.
      let near = -1;
      dist = U * 4;
      sim.players.forEach((p, i) => {
        const d = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
        if (p.side === 1 && d < dist) { dist = d; near = i; }
      });
      if (near >= 0 && !players[near].down) players[near] = { ...players[near], pose: 'swat', moving: false };
    }
    // With the ball nearly there, the nearest receiver turns and puts his hands up for it.
    if (b.state === 'air' && b.T > 0 && b.t / b.T > 0.7) {
      let best = -1;
      let dist = U * 4;
      sim.players.forEach((p, i) => {
        const d = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
        if (p.side === 0 && p.idx !== thrower && d < dist) { dist = d; best = i; }
      });
      if (best >= 0) players[best] = { ...players[best], pose: 'catch' };
    }
    const [bx, by] = abs(off, b.x / U, b.y / U);
    const z = b.state === 'air' && b.T > 0 ? Math.round(4 * Math.min(16, b.T * 0.3) * (b.t / b.T) * (1 - b.t / b.T)) : 0;
    return { players, ball: { x: bx, y: by, z, visible: b.state !== 'held' || mode === 'presnap' }, los: marks?.los ?? null, toGain: marks?.toGain ?? null, focusX: bx, frame, down: (game as Game | undefined)?.state.phase === 'scrimmage' ? game.state.down : 1, official: mode === 'post' ? official : null, cheering: mode === 'post' ? cheerTeam : null };
  }
  if (kick) {
    const k = kick;
    const f = k.T <= 0 ? 1 : Math.min(1, k.t / k.T);
    const g = k.R <= 0 ? 0 : Math.min(1, Math.max(0, (k.t - k.T) / k.R));
    const ballX = k.x0 + (k.x1 - k.x0) * f;
    const ballY = k.y0 + (k.y1 - k.y0) * f;
    // The returner's path: straight upfield with a little weave, easing to a stop where he is brought down.
    const ease = 1 - (1 - g) * (1 - g);
    const rx = k.x1 + k.run * ease;
    const ry = k.y1 + Math.sin(g * 6) * 2.2 * (1 - g);
    const scored = !!k.e.flags.touchdown;
    if (k.to) {
      // Everyone runs to where the return will start: the coverage down the field, the blockers back to their man.
      const ease = f * f * (3 - 2 * f);
      const players: ViewPlayer[] = k.start.map((p, i) => {
        const t = k.to![i];
        return t ? { ...p, x: p.x + (t.x - p.x) * ease, y: p.y + (t.y - p.y) * ease, moving: f < 1 } : p;
      });
      kickPose(players, k, f);
      return { players, ball: { x: ballX, y: ballY, z: Math.round(4 * 22 * f * (1 - f)), visible: true }, los: null, toGain: null, focusX: ballX, frame };
    }
    const players: ViewPlayer[] = k.start.map((p, i) => {
      if (i === k.returner) {
        // He settles under the ball while it is in the air, then runs it back.
        const x = g > 0 ? rx : p.x + (k.x1 - p.x) * f;
        const y = g > 0 ? ry : p.y + (k.y1 - p.y) * f;
        return { ...p, x, y, moving: f < 1 || (g > 0 && g < 1), hasBall: f >= 1, down: g >= 1 && !scored };
      }
      if (k.returner < 0) return p;
      if (p.team === k.kicking) {
        // Coverage: run downfield in lanes during the kick, then close on the ball carrier.
        const laneX = p.x + (k.x1 - p.x) * 0.55 * f;
        const close = 0.2 + 0.75 * ((i * 37) % 11) / 11;
        const x = laneX + (rx - laneX) * g * close;
        const y = p.y + (ry - p.y) * g * close;
        return { ...p, x, y, moving: g < 1, down: false };
      }
      // Blockers: fall back in front of the returner, then lead him upfield.
      const lead = Math.sign(k.x0 - k.x1) * (3 + (i % 4) * 2.5);
      const tx = k.x1 + lead + k.run * ease * 0.8;
      return { ...p, x: p.x + (tx - p.x) * Math.max(f * 0.5, g), y: p.y + ((k.y1 + ((i % 5) - 2) * 4) - p.y) * Math.max(f * 0.3, g * 0.7), moving: g < 1, down: false };
    });
    const flying = f < 1 || k.returner < 0;
    kickPose(players, k, f);
    return {
      players, ball: { x: flying ? ballX : rx, y: flying ? ballY : ry, z: flying ? Math.round(4 * 22 * f * (1 - f)) : 0, visible: flying },
      los: null, toGain: null, focusX: flying ? ballX : rx, frame,
    };
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
      if (done) startReturn(() => playOver(game.lastEvent));
      break;
    }
    case 'return': {
      const v = viewReturn;
      if (!v) break;
      if (!v.sim.done) {
        acc += dt * Math.max(1, speed);
        for (let n = 0; acc >= 16.667 && n < 16 && !v.sim.done; n++) {
          acc -= 16.667;
          frame++;
          v.sim.step();
        }
      } else if ((v.hold -= dt) <= 0 && v.then) {
        // The picture of the tackle stays up until the next snap is set.
        const then = v.then;
        v.then = null;
        then();
      }
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
        if (kick.t >= kick.T + kick.R) {
          const e = kick.e;
          startReturn(() => {
            kick = null;
            setStatic();
            showResult(e);
          });
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
  showMoves(dt);
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
  scene.resetTurf('grass');
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
  atmosphereBeforeSnap();
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
  stAuto = true;
  if (offTab === '@st') offTab = FORMATIONS[0].id;
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
  if (!quiet()) crowd.rise(speed === 1 ? 1.2 : 0.5);
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
  if (atLine) {
    const l = atLine;
    atLine = null;
    return commit(l.off, l.def);
  }
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
    viewRun = off.kind === 'play' && game.playOf(offTeam, off.audible ?? off.playId).kind === 'run';
    const checked = off.kind === 'play' && off.audible !== undefined && off.audible !== off.playId;
    const play = off.kind === 'play' ? game.playOf(offTeam, off.audible ?? off.playId) : null;
    const called = game.defenseOf(other(offTeam), def);
    const defName = def.frontId === CUSTOM_FRONT ? called.scheme.name : `${called.front.name} ${called.scheme.name}`;
    const subs = game.lastSubs.filter((x) => x.team === user).map((x) => `${x.slot}: #${x.out.number} resting, #${x.in.number} in`);
    const calls = $('calls');
    calls.innerHTML = `${teams[offTeam].abbr} <b>${play?.name ?? ''}</b>${checked ? ' <span class="aud">AUDIBLE</span>' : ''}<br>${teams[other(offTeam)].abbr} <b>${defName}</b>`
      + (game.caughtBlocking ? '<br>Caught going for the block!' : '') + (tb !== null ? `<br>Timeout ${teams[tb].abbr}` : '') + (subs.length ? `<br>${subs.slice(0, 3).join('<br>')}` : '');
    calls.classList.remove('hidden');
    setPanelWaiting(`${checked ? 'Audible! ' : ''}${play?.name ?? ''} against ${defName}`);
    if (checked) sfx.select();
    updateBug();
    mode = 'presnap';
    timer = speed === 0 ? 0 : speed === 1 ? 900 : 300;
    return;
  }
  game.tick();
  const e = game.lastEvent;
  if (!e || e.type === 'kneel' || e.type === 'penalty') return showResult(e);
  setPanelWaiting(e.type === 'punt' ? 'Punt' : e.type === 'fieldGoal' ? 'Field goal attempt' : 'Extra point');
  lineup = scrimmageLineup(offTeam, los, true);
  if (e.type === 'punt') startKick(offTeam, los - 10, Math.min(los + e.yards, 104), CY_YD, e);
  else startKick(offTeam, los - 7, 110, e.flags.good ? CY_YD : CY_YD + 13, e);
}

function startKick(team: 0 | 1, from: number, to: number, toY: number, e: PlayEvent): void {
  const [x0, y0] = abs(team, from, CY_YD);
  const [x1, y1] = abs(team, to, toY);
  // A return is run back on the field: the nearest receiver fields the kick and the coverage closes on him.
  const start = lineup.map((p) => ({ ...p }));
  const yards = (e.type === 'kickoff' || e.type === 'punt') && !e.flags.onside && !e.flags.blocked ? e.returnYards ?? 0 : 0;
  let returner = -1;
  if (yards > 0) {
    let best = Infinity;
    start.forEach((p, i) => {
      const d = Math.abs(p.x - x1) + Math.abs(p.y - y1) * 0.5;
      if (p.team !== team && d < best) { best = d; returner = i; }
    });
  }
  const run = returner >= 0 ? Math.sign(x0 - x1) * yards : 0;
  const pace = speed === 1 ? 1 : 0.4;
  // A real return follows: pair every man on the field with his place at the start of it, nearest lanes together,
  // and bring the ball down on the returner.
  let dest: ({ x: number; y: number } | null)[] | null = null;
  let landX = x1;
  let landY = y1;
  const ret = (e.type === 'kickoff' || e.type === 'punt') && speed !== 0 ? game.lastReturn : null;
  if (ret) {
    const sim = ret.make();
    const spots = sim.players.map((p) => {
      const [x, y] = abs(ret.frame, p.x / U, p.y / U);
      return { x, y, team: (p.side === 0 ? other(ret.frame) : ret.frame) as 0 | 1, idx: p.idx };
    });
    const places: ({ x: number; y: number } | null)[] = start.map(() => null);
    dest = places;
    for (const side of [0, 1] as const) {
      const men = start.map((p, i) => ({ p, i })).filter((m) => m.p.team === side).sort((a, b) => a.p.y - b.p.y);
      const want = spots.filter((sp) => sp.team === side && sp.idx !== 0).sort((a, b) => a.y - b.y);
      const carrier = spots.find((sp) => sp.team === side && sp.idx === 0);
      if (carrier) {
        // The deepest man on the receiving side fields it.
        const deep = men.reduce((best, m) => (Math.abs(m.p.x - carrier.x) < Math.abs(best.p.x - carrier.x) ? m : best), men[0]);
        places[deep.i] = carrier;
        men.splice(men.indexOf(deep), 1);
        landX = carrier.x;
        landY = carrier.y;
      }
      // Any man without a place in the return (the kicker) stays where he is.
      const spare = men.length - want.length;
      const skip = spare > 0 ? new Set(men.filter((m) => m.p.team === team).sort((a, b) => Math.abs(a.p.y - CY_YD) - Math.abs(b.p.y - CY_YD)).slice(0, spare).map((m) => m.i)) : new Set<number>();
      let k = 0;
      for (const m of men) {
        if (skip.has(m.i) || k >= want.length) continue;
        places[m.i] = want[k++];
      }
    }
  }
  kick = {
    x0, x1: landX, y0, y1: landY, t: 0, T: speed === 0 ? 0 : Math.round(1200 * pace), R: 0,
    e, start, kicking: team, returner, run, to: dest,
  };
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
      viewReturn = null;
      viewOffense = r.offense;
      viewRun = e?.type === 'run';
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

/**
 * What a play leaves on the field. On a dry night the turf scuffs along the line and where the runner went down;
 * in the rain it turns to mud and puddles; in snow the cover is trampled off. Worked out from the play alone, so
 * a rejoined or reloaded game shows the same field.
 */
let wornTo = -1;
function wearFrom(e: PlayEvent): void {
  if ((e.type !== 'run' && e.type !== 'pass') || e.seq <= wornTo) return;
  wornTo = e.seq;
  const w = game.setup.weather;
  const kind = w === 'rain' ? 'mud' : 'scuff';
  // A cheap, steady scatter from the play's own number.
  const r = (k: number): number => (((e.seq * 2654435761 + k * 40503) >>> 0) % 1000) / 1000;
  const [lx] = abs(e.offense, e.yardLine, CY_YD);
  const lateral = CY_YD + (r(1) - 0.5) * 14;
  const marks = w === 'rain' ? 3 : w === 'snow' ? 4 : 2;
  for (let i = 0; i < marks; i++) scene.addWear(lx + (r(10 + i) - 0.5) * 1.6, lateral + (i - (marks - 1) / 2) * 2.4 + (r(20 + i) - 0.5), kind, e.seq + i);
  if (!e.flags.incomplete) {
    const [ex] = abs(e.offense, Math.max(1, Math.min(99, e.yardLine + e.yards)), CY_YD);
    scene.addWear(ex, lateral + (r(2) - 0.5) * 20, kind, e.seq + 7);
  }
  if (w === 'rain' && e.seq % 5 === 0) scene.addWear(lx + (r(3) - 0.5) * 12, CY_YD + (r(4) - 0.5) * 34, 'puddle', e.seq);
}

/** Lays the field for this game's weather and marks it with every play already run. */
function startTurf(): void {
  const w = game.setup.weather;
  scene.resetTurf(w === 'snow' ? 'snow' : 'grass');
  wornTo = -1;
  for (const e of game.events) wearFrom(e);
}

/** Sets up the stands and the band for a new game. Team 0 is at home. */
function startAtmosphere(): void {
  startTurf();
  const lg = net?.view.league;
  occasion = dynastyGame ? occasionFor(dynastyGame.week, dynastyGame.home) : lg ? occasionFor(lg.week, lg.home) : null;
  let h = 0;
  for (const ch of `${teams[0].id}:${teams[0].name}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  fightTune = fightSong(h);
  snapCount = 0;
  chantUntil = 0;
  firstDowns = 0;
}

function crowdInput(): CrowdInput {
  const s = game.state;
  return { possession: s.phase === 'kickoff' ? other(s.kicking) : s.possession, down: s.phase === 'scrimmage' ? s.down : 1, yardLine: s.phase === 'scrimmage' ? s.yardLine : 50, quarter: s.quarter, homeLead: s.score[0] - s.score[1], occasion };
}
const quiet = (): boolean => speed === 0 || turbo;

/** Before each snap: sometimes the stands start a chant. */
function atmosphereBeforeSnap(): void {
  scene.showBand(false);
  const s = game.state;
  if (s.phase === 'final') return;
  if (quiet() || s.phase !== 'scrimmage') return;
  const chant = chantFor(crowdInput(), snapCount++);
  const now = performance.now();
  if (chant && now >= chantUntil) {
    crowd[chant]();
    chantUntil = now + 9000;
  }
}

/** Floats a small emoji up from a spot on the field view. `x` and `y` are fractions of the view. */
function emote(face: string, x: number, y: number, delay = 0, top = 0.2): void {
  window.setTimeout(() => {
    const el = document.createElement('span');
    el.className = 'emote';
    el.textContent = face;
    el.setAttribute('aria-hidden', 'true');
    el.style.left = `${Math.round(Math.max(0.05, Math.min(0.95, x)) * 100)}%`;
    el.style.top = `${Math.round(Math.max(top, Math.min(0.94, y)) * 100)}%`;
    $('stage').appendChild(el);
    window.setTimeout(() => el.remove(), 1600);
  }, delay);
}
/** Where each team's bench reads on screen: home on the left, visitors on the right. */
const benchAt = (team: 0 | 1): [number, number] => [team === 0 ? 0.24 : 0.76, 0.9];

/**
 * Feelings. Now and then a player or a bench shows how the last play felt: joy at a touchdown, despair at a
 * turnover, a flexed arm after a sack. Chosen from the play's own number, so it is not on every snap.
 */
function feelings(e: PlayEvent): void {
  const f = e.flags;
  const at = scene.carrierAt();
  const sometimes = (n: number): boolean => e.seq % n === 0;
  const off = e.offense;
  const def = other(off);
  const pick = (faces: string[]): string => faces[e.seq % faces.length];
  if (f.touchdown || f.defensiveTouchdown) {
    const scorer = f.defensiveTouchdown ? def : off;
    emote(pick(['🎉', '🙌', '🔥']), at.x, at.y - 0.08);
    emote(pick(['🙌', '🥳', '💪']), ...benchAt(scorer), 250);
    emote(pick(['😞', '😩', '🤦']), ...benchAt(other(scorer)), 400);
  } else if (f.interception || f.fumbleLost) {
    emote(pick(['😱', '😬']), at.x, at.y - 0.08);
    emote(pick(['😤', '💪', '🙌']), ...benchAt(def), 250);
    emote(pick(['🤦', '😖']), ...benchAt(off), 400);
  } else if (f.sack) {
    emote('💪', at.x, at.y - 0.08);
    if (sometimes(2)) emote('😖', ...benchAt(off), 300);
  } else if (e.type === 'penalty') {
    if (sometimes(2)) emote('🤦', ...benchAt(f.foul === 'offside' || f.foul === 'interference' ? def : off));
  } else if (e.type === 'fieldGoal' || e.type === 'pat') {
    if (!f.good) emote(pick(['😬', '😩']), ...benchAt(off));
    else if (sometimes(2)) emote('👍', ...benchAt(off));
  } else if (f.turnoverOnDowns) {
    emote('🧱', at.x, at.y - 0.08);
    emote('😤', ...benchAt(def), 250);
  } else if ((e.type === 'run' || e.type === 'pass') && e.yards >= 15) {
    emote(pick(['🔥', '💨', '😎']), at.x, at.y - 0.08);
    if (sometimes(2)) emote('😮', ...benchAt(def), 300);
  } else if ((e.type === 'run' || e.type === 'pass') && e.yards <= -3 && sometimes(2)) {
    emote('😵', at.x, at.y - 0.08);
  } else if (f.incomplete && e.down >= 3 && sometimes(2)) {
    emote('😮‍💨', ...benchAt(def));
  }
  crowdFeels(e);
}

/** A yellow penalty flag, drawn here: a square of cloth with a weighted knot at one corner. */
const FLAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 14" shape-rendering="crispEdges"><path d="M2 3h11v1h2v2h1v4h-2v2h-3v1H5v-1H3v-2H2V8H1V5h1z" fill="#f5c400"/><path d="M4 4h7v1H4zM3 6h5v1H3z" fill="#ffe66a"/><path d="M10 9h4v1h-4zM6 11h5v1H6zM13 6h2v3h-2z" fill="#c89600"/><path d="M0 1h3v3H0z" fill="#8a6a00"/></svg>`;
/**
 * A flag on the play: one big flag is thrown across the screen from the far corner and two small ones follow it.
 * Where they land comes from the play's own number, so it is the same on both coaches' screens.
 */
function flagDrop(e: PlayEvent): void {
  const stage = $('stage');
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const fromLeft = e.seq % 2 === 0;
  for (let i = 0; i < 3; i++) {
    const el = document.createElement('div');
    el.className = 'flagdrop';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = FLAG_SVG;
    const size = i === 0 ? 0.075 : 0.04;
    const land = 0.3 + ((e.seq * 17 + i * 23) % 40) / 100;
    el.style.setProperty('--fw', `${Math.round(w * size)}px`);
    el.style.setProperty('--x0', `${Math.round(fromLeft ? -w * 0.1 : w * 1.02)}px`);
    el.style.setProperty('--x1', `${Math.round(w * (fromLeft ? land : 1 - land - size))}px`);
    el.style.setProperty('--y1', `${Math.round(h * (0.42 + ((e.seq * 7 + i * 11) % 20) / 100))}px`);
    el.style.setProperty('--ft', `${1.5 + i * 0.25}s`);
    el.style.animationDelay = `${i * 140}ms`;
    stage.appendChild(el);
    window.setTimeout(() => el.remove(), 2400 + i * 400);
  }
}

const CROWD_UP = ['🎉', '🙌', '👏', '📣', '🥳', '😆'];
const CROWD_DOWN = ['😩', '😱', '🤦', '😬', '😤'];
/**
 * The stands are the home crowd. A handful of faces pop up out of the seats after the plays that matter: happy when
 * the play helped the home team, unhappy when it hurt. Where and which come from the play's own number.
 */
function crowdFeels(e: PlayEvent): void {
  const f = e.flags;
  const def = other(e.offense);
  let helped: 0 | 1 | null = null;
  let n = 0;
  if (f.touchdown || f.defensiveTouchdown) [helped, n] = [f.defensiveTouchdown ? def : e.offense, 6];
  else if (f.interception || f.fumbleLost || f.safety) [helped, n] = [def, 4];
  else if (f.blocked) [helped, n] = [def, 4];
  else if (e.type === 'fieldGoal') [helped, n] = [f.good ? e.offense : def, 3];
  else if (e.type === 'pat') [helped, n] = [f.good ? e.offense : def, f.good ? 1 : 2];
  else if (f.turnoverOnDowns) [helped, n] = [def, 3];
  else if (f.sack) [helped, n] = [def, 2];
  else if ((e.type === 'run' || e.type === 'pass') && e.yards >= 15) [helped, n] = [e.offense, e.yards >= 30 ? 4 : 2];
  else if (f.firstDown && e.down >= 3) [helped, n] = [e.offense, 1];
  else if (f.incomplete && e.down >= 3 && e.seq % 2 === 0) [helped, n] = [def, 1];
  if (helped === null) return;
  const faces = helped === 0 ? CROWD_UP : CROWD_DOWN;
  for (let i = 0; i < n; i++) {
    const x = (5 + ((e.seq * 37 + i * 53) % 90)) / 100;
    const y = (3 + ((e.seq * 13 + i * 29) % 10)) / 100;
    emote(faces[(e.seq + i * 7) % faces.length], x, y, 150 + i * 130, 0.02);
  }
}

/** After each play: the band answers a home score or first down, and the PA calls the big moments. */
function atmosphereAfterPlay(e: PlayEvent | null, half: boolean): void {
  if (quiet()) return;
  const s = game.state;
  const later = (ms: number, f: () => void): void => { window.setTimeout(() => { if (!quiet() && mode !== 'menu') f(); }, ms); };
  if (e) {
    const f = e.flags;
    const scorer = f.defensiveTouchdown ? other(e.offense) : e.offense;
    if (f.touchdown || f.defensiveTouchdown) {
      if (scorer === 0) later(500, () => band.play(fightTune, FIGHT_SONG_BEAT));
      announce(scorer === 0 ? `Touchdown, ${teams[0].mascot}!` : `Touchdown, ${teams[1].name}.`);
    } else if ((e.type === 'fieldGoal' || e.type === 'pat' || e.type === 'twoPoint') && f.good && e.offense === 0) band.stab(fightTune);
    else if ((f.interception || f.fumbleLost || f.turnoverOnDowns || f.blocked) && e.offense === 1) announce(`${teams[0].mascot} ball!`);
    else if (f.firstDown && e.offense === 0 && e.type !== 'penalty') {
      if (firstDowns++ % 2 === 0) band.stab(fightTune);
      if (firstDowns % 3 === 1) announce(`First down, ${teams[0].mascot}.`);
    }
  }
  if (s.phase === 'final') {
    if (s.score[0] > s.score[1]) later(700, () => band.play(fightTune, FIGHT_SONG_BEAT, 2));
    later(1500, () => announce(`Final score: ${teams[0].name} ${s.score[0]}, ${teams[1].name} ${s.score[1]}. Drive home safely.`));
  } else if (half) {
    later(900, () => band.play(fightTune, FIGHT_SONG_BEAT, 2));
    later(300, () => announce(`At the half: ${teams[0].name} ${s.score[0]}, ${teams[1].name} ${s.score[1]}.`));
  }
}

function showResult(e: PlayEvent | null): void {
  updateBug();
  // The team that just scored a touchdown throws its arms up.
  cheerTeam = e && (e.flags.touchdown || e.flags.defensiveTouchdown) ? (e.flags.defensiveTouchdown ? other(e.offense) : e.offense) : null;
  official = !e ? null : e.type === 'penalty' ? 'flag' : cheerTeam !== null ? 'td' : e.flags.firstDown ? 'point' : null;
  // A call sheet left up by a play that never ran (the clock ran out first) comes down.
  if ($('panel').querySelector('[data-act]')) setPanelWaiting('');
  setStaticIfIdle();
  const s = game.state;
  const banner = $('banner');
  let period = '';
  if (s.phase === 'final') period = 'End of game. ';
  else if (s.quarter !== lastQuarter) period = lastQuarter === 2 ? 'Halftime. ' : lastQuarter === 4 ? 'End of regulation: overtime! Each team gets the ball at the ten. ' : lastQuarter > 4 ? 'Still level: another overtime. ' : `End of quarter ${lastQuarter}. `;
  const cut = showCutins && speed !== 0 ? cutinFor(e, s.phase === 'final' ? 'final' : s.quarter === lastQuarter ? null : lastQuarter === 2 ? 'half' : lastQuarter === 3 ? 'fourth' : lastQuarter >= 4 ? 'overtime' : null, s.score[0] + s.score[1] + s.quarter, { won: s.score[user] > s.score[other(user)], title: occasion === 'championship', homecoming: occasion === 'homecoming' }) : null;
  const cutEl = $('cutin') as HTMLImageElement;
  cutEl.classList.toggle('hidden', !cut);
  if (cut) {
    cutEl.src = cut.url;
    cutEl.alt = cut.alt;
    // Restart the pop-in animation.
    cutEl.style.animation = 'none';
    void cutEl.offsetWidth;
    cutEl.style.animation = '';
    // The quarter and overtime banners are a flash, not a picture to hold on.
    if (cut.alt === 'Fourth quarter' || cut.alt === 'Overtime') window.setTimeout(() => { if (cutEl.alt === cut.alt) cutEl.classList.add('hidden'); }, 2000);
  }
  const lastQuarterWas = lastQuarter;
  lastQuarter = s.quarter;
  const big = !!e && (e.flags.touchdown || e.flags.blocked || e.flags.recovered || e.flags.interception || e.flags.fumbleLost || e.flags.safety || ((e.type === 'fieldGoal' || e.type === 'twoPoint') && !!e.flags.good));
  banner.className = big ? 'big' : e?.type === 'penalty' ? 'flag' : '';
  const half = s.phase !== 'final' && s.quarter !== lastQuarterWas && lastQuarterWas === 2;
  const show = half && speed !== 0 ? halftimeShow(game.seed, occasion, teams[0], teams[1]) : null;
  banner.innerHTML = `${e ? e.text : 'Time runs out.'}<small>${period}${situationText()}</small>`
    + (show ? `<div class="show"><b>${show.title}</b>${show.lines.map((l) => `<span>${l}</span>`).join('')}</div>` : '');
  atmosphereAfterPlay(e, half);
  if (e && !quiet()) feelings(e);
  if (e && e.type === 'penalty' && speed !== 0) flagDrop(e);
  // At half time the home band takes the field.
  if (show) {
    scene.showBand(true, occasion === 'homecoming');
    // The panel gives way after a moment so the band can be seen.
    window.setTimeout(() => { if (mode === 'post') $('cutin').classList.add('hidden'); }, 2200);
  }
  if (e) wearFrom(e);
  // In a dynasty the record book is open on the bench: say so the moment a school record falls or comes within reach.
  let recordCalls = 0;
  if (dynastyGame && !turbo && e) {
    const calls = dynasty.watch(dynastyGame, boxScore(game.events));
    recordCalls = calls.length;
    if (calls.length) {
      banner.innerHTML += calls.map((c) => `<div class="rec">${c}</div>`).join('');
      if (calls[0].startsWith('School record') && !quiet()) announce(calls[0]);
    }
  }
  if (e) {
    if (e.flags.touchdown || e.flags.defensiveTouchdown || ((e.type === 'fieldGoal' || e.type === 'pat' || e.type === 'twoPoint') && e.flags.good)) sfx.score();
    else if (e.flags.interception || e.flags.fumbleLost || e.flags.safety || e.flags.turnoverOnDowns) sfx.bad();
    else if (e.flags.firstDown) sfx.first();
    else if (e.flags.incomplete || e.type === 'punt' || e.type === 'kickoff' || e.type === 'kneel' || e.type === 'penalty') sfx.whistle();
    else sfx.tackle();
  }
  const base = show ? 7000 : recordCalls ? 4500 : cut ? 3000 : big || period ? 2600 : e?.type === 'kneel' ? 1000 : 1700;
  timer = turbo ? 40 : speed === 0 ? Math.min(base, 900) : speed === 1 ? base : Math.round(base * 0.5);
  mode = 'post';
}

/** After a play with no field animation (a kneel-down), show the new spot straight away. */
function setStaticIfIdle(): void {
  if (!viewSim && !kick && !viewReturn) setStatic();
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
  const otName = game.overtime > 1 ? `${game.overtime}OT` : 'OT';
  $('mid').querySelector('.clk')!.textContent = s.phase === 'final' ? (game.overtime ? `FINAL ${otName}` : 'FINAL') : game.overtime ? `OVERTIME${game.overtime > 1 ? ` ${game.overtime}` : ''}` : `Q${s.quarter}  ${m}:${sec}`;
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
  // Special teams have their own tab on the call sheet during a drive.
  const hasSt = s.phase === 'scrimmage';
  const onSt = hasSt && (offTab === '@st' || (s.down === 4 && stAuto));
  if (offTab === '@st' && !hasSt) offTab = tabs[0].id;
  if (hasSt) tabs.push({ id: '@st', name: 'Special teams', plays: [] });
  const shown = onSt ? '@st' : offTab === '@st' ? tabs[0].id : offTab;
  const plays = tabs.find((t) => t.id === shown)!.plays;
  const fgYards = fieldGoalDistance(s.yardLine);
  const stCards = !onSt ? '' : `<button class="card st" data-act="punt"><span class="nm">Punt <kbd>[P]</kbd></span><span class="ds">Kick it away and make them drive the field. They may come after it.</span></button>`
    + (fgYards <= 60 ? `<button class="card st" data-act="fg"><span class="nm">Field goal <kbd>[F]</kbd></span><span class="form">${fgYards} yards</span><span class="ds">${fgYards <= 30 ? 'A short one.' : fgYards <= 40 ? 'In range for a good high school kicker.' : 'A long one for a high school kicker.'} Three points.</span></button>` : '')
    + `<button class="card st" data-act="fake"><span class="nm">Fake it <kbd>[G]</kbd></span><span class="ds">Line up to kick, then run a real play. Pick the play next. It works when they sell out for the block.</span></button>`
    + ((s.quarter === 2 || s.quarter === 4) && s.down < 4 ? '<button class="card st" data-act="kneel"><span class="nm">Kneel <kbd>[K]</kbd></span><span class="ds">Lose a yard and keep the clock running.</span></button>' : '');
  let html = (tabs.length > 1 ? `<div class="fronts"><span class="lbl">Formation</span>${tabs.map((t, i) => `<button class="act${t.id === shown ? ' on' : ''}" data-act="tab:${t.id}">${t.name} <kbd>[${t.id === '@st' ? 'M' : tabKeys[i]}]</kbd><small>${t.id === '@st' ? 'punt, kick, fake' : `${t.plays.length} ${t.plays.length === 1 ? 'play' : 'plays'}`}</small></button>`).join('')}</div>` : '')
    + stCards + plays.map((p, i) => playCard(p, `p:${p.id}`, i < 9 ? ` <kbd>[${i + 1}]</kbd>` : '')).join('');
  if (s.phase === 'scrimmage') {
    const fg = fieldGoalDistance(s.yardLine);
    const canKneel = (s.quarter === 2 || s.quarter === 4) && s.down < 4;
    // The quick row under the plays; on the special teams tab the same calls are the cards above.
    const quick = onSt ? '' : `<button class="act" data-act="punt">Punt <kbd>[P]</kbd></button>${fg <= 60 ? `<button class="act" data-act="fg">Field goal <kbd>[F]</kbd><small>${fg} yards</small></button>` : ''}${canKneel ? '<button class="act" data-act="kneel">Kneel <kbd>[K]</kbd><small>Lose a yard, keep the clock running</small></button>' : ''}`;
    const tbtn = timeoutButton();
    if (quick || tbtn) html += `<div class="wide">${quick}${tbtn}</div>`;
  }
  panel.innerHTML = html;
  const acts: Record<string, () => void> = {
    punt: () => submitOff({ kind: 'punt', timeout: wantTimeout }),
    fg: () => submitOff({ kind: 'fieldGoal', timeout: wantTimeout }),
    kneel: () => submitOff({ kind: 'kneel' }),
    timeout: () => { wantTimeout = !wantTimeout; showOffensePanel(twoPointPick); },
    // A fake is a real play called in a kicking situation: go and pick it.
    fake: () => { stAuto = false; if (offTab === '@st') offTab = tabs[0].id; showOffensePanel(twoPointPick); },
  };
  for (const p of plays) acts[`p:${p.id}`] = () => submitOff({ kind: 'play', playId: p.id, timeout: wantTimeout });
  for (const t of tabs) acts[`tab:${t.id}`] = () => { offTab = t.id; stAuto = false; showOffensePanel(twoPointPick); };
  bind(acts, (k) => {
    const n = Number(k);
    if (n >= 1 && n <= Math.min(9, plays.length)) return `p:${plays[n - 1].id}`;
    const ti = tabKeys.indexOf(k.toUpperCase());
    if (ti >= 0 && ti < tabs.length && tabs[ti].id !== '@st') return `tab:${tabs[ti].id}`;
    if (k === 'm' && hasSt) return 'tab:@st';
    if (k === 'g' && onSt) return 'fake';
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
    for (const f of DEFENSE_FRONTS) acts[`f:${f.id}`] = () => { frontId = f.id; setStatic(true); showDefensePanel(); };
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
  for (const f of DEFENSE_FRONTS) acts[`f:${f.id}`] = () => { frontId = f.id; setStatic(true); showDefensePanel(); };
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
  if (net) return void sendCall(off.kind === 'play' ? ({ ...off, look: true } as OffDecision) : off);
  const def = coach.defense(game)!;
  if (off.kind !== 'play') return commit(off, def);
  // A play goes to the line first: the defense shows its front and the call can still be changed.
  atLine = { off, def };
  const front = game.defenseOf(other(user), def).front;
  showLinePanel(off.playId, front.name, front.desc, front, (to) => {
    atLine = null;
    commit(to ? { ...off, audible: to } : off, def);
  });
}
function submitDef(def: DefDecision): void {
  if (net) void sendCall(def);
  // The AI quarterback gets the same look at your front that you get at his.
  else commit(coach.audible(game, pendingOff, def)!, def);
}

/**
 * At the line. The defense has shown its front (never its call). Snap the play that was called, or check to
 * another play from the formation already lined up. Changing the play risks a false start.
 */
function showLinePanel(playId: string, frontName: string, frontDesc: string, front: DefFront | null, go: (audible: string | null) => void): void {
  const s = game.state;
  const off = s.possession;
  const called = game.playOf(off, playId);
  const others = game.bookPlays(off).filter((p) => p.formation === called.formation && p.id !== called.id).slice(0, 9);
  mode = 'choose';
  // Draw both sides as they line up.
  const los = s.phase === 'conversion' ? RULES.twoPointFrom : s.yardLine;
  const shown: ViewPlayer[] = [];
  for (const slot of formationOf(called).slots) {
    const [x, y] = abs(off, los + slot.at[0], CY_YD + slot.at[1]);
    shown.push({ team: off, x, y, moving: false, down: false, hasBall: false, pose: slot.group === 'OL' ? 'line' : undefined });
  }
  if (front) {
    for (const slot of front.slots) {
      const [x, y] = abs(off, Math.min(los + slot.at[0], 108), CY_YD + slot.at[1]);
      shown.push({ team: other(off), x, y, moving: false, down: false, hasBall: false, pose: slot.group === 'DL' ? 'line' : 'crouch' });
    }
    viewSim = null;
    viewReturn = null;
    lineup = shown;
  }
  showPlayClock();
  $('prompt').textContent = `At the line: they show ${frontName}`;
  $('panel').innerHTML = `<div class="wide line"><button class="act on" data-act="snap">Snap it: ${called.name} <kbd>[S]</kbd><small>${frontDesc || 'Run the play you called.'}</small></button></div>`
    + (others.length ? `<div class="fronts"><span class="lbl">Audible</span><span class="hint">Same formation. Changing the play risks a false start.</span></div>` : '')
    + others.map((p, i) => playCard(p, `a:${p.id}`, ` <kbd>[${i + 1}]</kbd>`)).join('');
  const acts: Record<string, () => void> = { snap: () => go(null) };
  for (const p of others) acts[`a:${p.id}`] = () => go(p.id);
  bind(acts, (k) => {
    const n = Number(k);
    if (n >= 1 && n <= others.length) return `a:${others[n - 1].id}`;
    return k === 's' ? 'snap' : null;
  });
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
    return `<div class="sl-row${i < STARTERS[sidelineGroup] ? ' start' : ''}"><span class="rk">${i + 1}</span><span>#${p.number} ${p.name}${p.year ? ` <span class="cls c${p.year}">${['Fr', 'So', 'Jr', 'Sr'][p.year - 1]}</span>` : ''}</span><span>${overall(p)}</span>`
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
  $('bookSummary').textContent = `Choose your plays and draw up your own. ${runs} runs, ${book.length - runs} passes${starter ? ' (starter book)' : ''}${own ? `, ${own} of your own` : ''}${myDefs.length ? ` \u00b7 ${myDefs.length} designed ${myDefs.length === 1 ? 'defense' : 'defenses'}` : ''}`;
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
    edit: async (code, school, identity) => (await online.leagueEdit(session!.token, code, school, identity)).league,
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

type SetupPage = 'menu' | 'exhibition' | 'online' | 'saves';
let setupPage: SetupPage = 'menu';
/** Shows one page of the front end: the main menu, the exhibition setup, or the online desk. */
function setupGo(page: SetupPage): void {
  setupPage = page;
  $('setup').dataset.page = page;
  // Quarter length and weather are shared by an exhibition and a hosted online game: show them wherever you are.
  const slot = $('setup').querySelector(`.page[data-page="${page}"] .opts-slot`);
  if (slot) slot.appendChild($('gameOpts'));
  if (page === 'saves') renderSaves();
  if (page === 'menu') $('savesLine').textContent = savesLine();
  if (page === 'menu') $('onlineLine').textContent = session ? `Signed in as ${session.name}. Host or join a game, or open your league.` : 'Coach against a friend with a game PIN, or run a league together.';
}

function showSetup(fresh = true, page: SetupPage = setupPage): void {
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
  $('dynastyName').textContent = dynasty.active ? 'Continue dynasty' : 'Dynasty';
  const qb = (t: Team) => t.roster.find((p) => p.id === t.depth.QB[0])!;
  $('teams').innerHTML = teams.map((t, i) => `<button class="team-card" data-team="${i}"><div class="swatch" style="background:linear-gradient(90deg, ${css(t.colors.jersey)} 0 60%, ${css(t.colors.trim)} 60% 80%, ${css(t.colors.helmet)} 80%)"></div><div class="nm">${t.name} ${t.mascot}</div><div class="sub">${i === 0 ? 'Home' : 'Visitors'} · QB ${qb(t).name} #${qb(t).number}</div></button>`).join('');
  $('teams').querySelectorAll<HTMLElement>('[data-team]').forEach((el) => el.addEventListener('click', () => startGame(Number(el.dataset.team) as 0 | 1)));
  ($('clockToggle') as HTMLInputElement).checked = useClock;
  bookSummary();
  // Back at the menu with something not yet matched to the server: settle it now.
  if (session && !cloudBusy && !cloudOther && !synced()) void syncSaves();
  renderOnlineBox();
  setupGo(page);
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
  startAtmosphere();
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
  const opening = showCutins && speed !== 0 ? cutinFor(null, 'opening', 0, { homecoming: occasion === 'homecoming', home: user === 0 }) : null;
  if (opening) {
    const cutEl = $('cutin') as HTMLImageElement;
    cutEl.src = opening.url;
    cutEl.alt = opening.alt;
    cutEl.classList.remove('hidden');
  }
  timer = opening ? 3200 : 2200;
  mode = 'post';
}

/** Rain, snow, wind or heat over the field, and a small tag naming it. */
function showWeather(): void {
  const w = game.setup.weather;
  $('wx').className = w === 'clear' ? '' : w;
  // Rain, snow and blowing leaves from the weather sheet, with a drift of mist behind the rain and the snow.
  const sheet = w === 'rain' ? wxRainUrl : w === 'snow' ? wxSnowUrl : w === 'wind' ? wxLeavesUrl : '';
  $('wx').style.backgroundImage = sheet ? `url(${sheet})` : '';
  $('wx').style.setProperty('--mist', w === 'rain' || w === 'snow' ? `url(${wxFogUrl})` : 'none');
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
  $('finalRecords').innerHTML = '';
  // The night's leaders for each team, from the box score.
  const box = boxScore(game.events);
  const leaders = ([0, 1] as const).map((t) => {
    const lines = Object.entries(box.players[t]);
    const name = (id: string): string => teams[t].roster.find((p) => p.id === id)?.name ?? '';
    const best = (key: keyof StatLine): [string, StatLine] | null => lines.filter(([, l]) => l[key] > 0).sort((x, y) => y[1][key] - x[1][key])[0] ?? null;
    const parts: string[] = [];
    const p = best('passAtt');
    if (p) parts.push(`${name(p[0])} ${p[1].passComp}/${p[1].passAtt} for ${p[1].passYds}${p[1].passTd ? `, ${p[1].passTd} TD` : ''}${p[1].passInt ? `, ${p[1].passInt} int` : ''}`);
    const r = best('rushYds');
    if (r) parts.push(`${name(r[0])} ${r[1].rushAtt} carries for ${r[1].rushYds}${r[1].rushTd ? `, ${r[1].rushTd} TD` : ''}`);
    const c = best('recYds');
    if (c) parts.push(`${name(c[0])} ${c[1].rec} catches for ${c[1].recYds}${c[1].recTd ? `, ${c[1].recTd} TD` : ''}`);
    const d = best('tackles');
    if (d) parts.push(`${name(d[0])} ${d[1].tackles} tackles${d[1].sacks ? `, ${d[1].sacks} ${d[1].sacks === 1 ? 'sack' : 'sacks'}` : ''}${d[1].ints ? `, ${d[1].ints} int` : ''}`);
    return `<div><b>${teams[t].abbr}</b> ${parts.join(' · ')}</div>`;
  });
  $('finalLeaders').innerHTML = leaders.join('');
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
      const done = dynasty.finishGame(g, score, boxScore(game.events));
      $('finalCareer').textContent = done.text;
      $('finalRecords').innerHTML = done.records.map((r) => `<div>${r}</div>`).join('');
      if (done.records.length && !quiet()) announce(`A new school record. ${done.records[0]}`);
      ($('again') as HTMLButtonElement).disabled = false;
    }, 60);
  }
  $('log').innerHTML = game.events.filter((e) => e.points[0] + e.points[1] > 0).map((e) => `<div><b>${e.quarter > 4 ? (e.quarter > 5 ? `${e.quarter - 4}OT` : 'OT') : `Q${e.quarter} ${Math.floor(e.clock / 60)}:${String(e.clock % 60).padStart(2, '0')}`}</b> ${e.text} <b>${e.scoreAfter[0]}–${e.scoreAfter[1]}</b></div>`).join('') || '<div>No scoring.</div>';
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

async function signIn(from: 'o' | 'sv' = 'o'): Promise<void> {
  const name = ($(`${from}Name`) as HTMLInputElement).value;
  const pin = ($(`${from}Pin`) as HTMLInputElement).value;
  try {
    const r = await online.enter(name, pin);
    career = null;
    session = { token: r.token, name: r.coach.name };
    store.set('fnd.session.v1', session);
    renderOnlineBox();
    renderSaves();
    void syncSaves();
  } catch (e) {
    if (from === 'sv') $('svMsg').textContent = e instanceof OnlineError ? e.message : 'Something went wrong.';
    else onlineMessage('oMsg', e);
  }
}

// ---- Permanent saves: a copy on the server under the coach name, and a file to keep. ----

/** The server save this browser last matched: whose it was and which revision. */
let cloud = store.get<{ name: string; rev: number; at: number } | null>('fnd.cloud.v1', null);
/** True when this browser holds changes the server has not been given. */
let unsaved = store.get<boolean>('fnd.unsaved.v1', true);
/** A save on the server that is not the one this browser last saw: the coach has to choose. */
let cloudOther: SaveMeta | null = null;
let cloudBusy = false;
let cloudTimer = 0;
let cloudError = '';
let askYes: (() => void) | null = null;
/** Counts changes, so one made while a save is on its way up is not mistaken for saved. */
let changeSeq = 0;

const contents = (): SaveContents => ({ dynasty: dynasty.active, plays: myPlays, defs: myDefs, book });
const hasLocal = (): boolean => !!dynasty.active || myPlays.length + myDefs.length > 0;
const whenText = (at: number): string => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const synced = (): boolean => !!session && !!cloud && cloud.name === session.name && !unsaved && !cloudOther;

savedChanged = () => {
  if (applyingSave) return;
  changeSeq++;
  unsaved = true;
  try { localStorage.setItem('fnd.unsaved.v1', 'true'); } catch { /* this visit only */ }
  if (!session || cloudOther) return;
  // A few saves in a row (a week of games, a run of edits) go up as one.
  window.clearTimeout(cloudTimer);
  cloudTimer = window.setTimeout(() => void pushSave(), turbo ? 150 : 2500);
};

function setCloud(meta: SaveMeta): void {
  cloud = { name: session!.name, rev: meta.rev, at: meta.at };
  unsaved = false;
  cloudOther = null;
  cloudError = '';
  store.set('fnd.cloud.v1', cloud);
  store.set('fnd.unsaved.v1', false);
}

function saveProblem(e: unknown): void {
  signedOutCheck(e);
  cloudError = e instanceof OnlineError ? e.message : 'Something went wrong.';
}

/** Sends this browser's save up. An older copy never overwrites a newer one unless the coach says so (`force`). */
async function pushSave(force = false): Promise<void> {
  if (!session || cloudBusy) return;
  cloudBusy = true;
  try {
    const file = makeSave(contents(), Date.now());
    const base = cloud && cloud.name === session.name ? cloud.rev : null;
    const seq = changeSeq;
    const r = await online.saveStore(session.token, file, file.label, base, force);
    if (r.conflict) cloudOther = r.save;
    else if (session) {
      setCloud(r.save);
      if (seq !== changeSeq) {
        // Something changed while that one was on its way: it goes up next.
        unsaved = true;
        store.set('fnd.unsaved.v1', true);
        window.clearTimeout(cloudTimer);
        cloudTimer = window.setTimeout(() => void pushSave(), 1200);
      }
    }
  } catch (e) {
    saveProblem(e);
  }
  cloudBusy = false;
  refreshSaves();
}

/** Writes a save into this browser and into the running game. */
function applySave(c: SaveContents): void {
  applyingSave = true;
  store.set('fnd.dynasty.v1', c.dynasty);
  store.set('fnd.plays.v1', c.plays);
  store.set('fnd.defs.v1', c.defs);
  store.set('fnd.book.v2', c.book);
  applyingSave = false;
  myPlays = c.plays;
  myDefs = c.defs;
  book = c.book;
  dynasty.reload();
  if (!$('setup').classList.contains('hidden')) {
    $('dynastyLine').textContent = dynasty.summary();
    $('dynastyName').textContent = dynasty.active ? 'Continue dynasty' : 'Dynasty';
    bookSummary();
  }
}

/** True on the title screen and the menus: the only places a save may be swapped in under the coach. */
const atFront = (): boolean => !net && (!$('title').classList.contains('hidden') || !$('setup').classList.contains('hidden'));

/** Brings the server save down over what is in this browser. */
async function pullSave(): Promise<void> {
  if (!session || cloudBusy || !atFront()) return;
  cloudBusy = true;
  try {
    const r = await online.saveLoad(session.token);
    const c = r.save ? readSave(r.data) : null;
    if (!r.save) cloudError = 'There is no save on the server yet.';
    else if (!c) cloudError = 'The save on the server could not be read by this version of the game.';
    else if (!atFront()) { /* The coach went into a game while it was on its way: it is fetched the next time he is at the menu. */ }
    else {
      applySave(c);
      setCloud(r.save);
    }
  } catch (e) {
    saveProblem(e);
  }
  cloudBusy = false;
  refreshSaves();
}

/** After signing in, or on opening the game signed in: works out whether to send, fetch, or ask. */
async function syncSaves(): Promise<void> {
  if (!session || cloudBusy) return;
  let meta: SaveMeta | null;
  try {
    meta = (await online.saveInfo(session.token)).save;
  } catch (e) {
    saveProblem(e);
    return refreshSaves();
  }
  if (!session) return;
  cloudError = '';
  const mine = !!cloud && cloud.name === session.name;
  if (!meta) {
    cloudOther = null;
    if (hasLocal()) await pushSave();
  } else if (mine && cloud!.rev === meta.rev) {
    cloudOther = null;
    if (unsaved) await pushSave();
  } else if (!hasLocal() || (mine && !unsaved)) {
    // Nothing here to lose: this browser is empty, or holds an untouched older copy of the same save.
    await pullSave();
  } else cloudOther = meta;
  refreshSaves();
}

function savesLine(): string {
  if (cloudOther) return 'The server has a different save from this browser. Open to choose which to keep.';
  if (!session) return hasLocal() ? 'Saved in this browser only. Sign in to keep it on the server too.' : 'Keep your dynasty and playbook safe, and take them to another device.';
  if (synced()) return `Saved to the server as ${session.name}, ${whenText(cloud!.at)}.`;
  return cloudError ? `Not saved to the server: ${cloudError}` : hasLocal() ? `Signed in as ${session.name}. Saving to the server.` : `Signed in as ${session.name}. Nothing to save yet.`;
}

function ask(text: string, yes: string, no: string, onYes: () => void): void {
  $('svAskText').textContent = text;
  $('svYes').textContent = yes;
  $('svNo').textContent = no;
  askYes = onYes;
  delete $('svNo').dataset.keep;
  $('svAsk').classList.remove('hidden');
}

function renderSaves(): void {
  $('svLocal').textContent = hasLocal() ? `${saveLabel(contents())}.` : 'Nothing yet. Start a dynasty or design a play and it is kept here as you go.';
  $('svOut').classList.toggle('hidden', !!session);
  $('svIn').classList.toggle('hidden', !session);
  $('svCloud').textContent = !session
    ? 'Sign in with a coach name and a four-digit PIN and your save is kept on the server every time it changes. Sign in with the same name on another device and it is there. The same name and PIN you use to play online.'
    : cloudOther ? `Signed in as ${session.name}. The server holds a different save: ${cloudOther.label}, saved ${whenText(cloudOther.at)}.`
      : synced() ? `Signed in as ${session.name}. Saved ${whenText(cloud!.at)}. It saves again by itself whenever something changes.`
        : cloudError ? `Signed in as ${session.name}. Not saved: ${cloudError}`
          : `Signed in as ${session.name}. ${hasLocal() ? 'Not saved to the server yet.' : 'Nothing to save yet.'}`;
  // While a choice is waiting, the two buttons in the question are the only way to send or fetch.
  ($('svPush') as HTMLButtonElement).disabled = !!cloudOther;
  ($('svPull') as HTMLButtonElement).disabled = !!cloudOther || !cloud;
  ($('svDown') as HTMLButtonElement).disabled = !hasLocal();
  if (cloudOther && !askYes) {
    ask(`Which one do you want to keep? The server: ${cloudOther.label}. This browser: ${saveLabel(contents())}. The other one is replaced.`, 'Use the server save', 'Keep this browser\u2019s', () => void pullSave());
    $('svNo').dataset.keep = '1';
  }
}

/** Redraws whatever is showing a save status. */
function refreshSaves(): void {
  if ($('setup').classList.contains('hidden')) return;
  if (setupPage === 'saves') renderSaves();
  if (setupPage === 'menu') $('savesLine').textContent = savesLine();
}

function closeAsk(): void {
  askYes = null;
  delete $('svNo').dataset.keep;
  $('svAsk').classList.add('hidden');
}

function downloadSave(): void {
  const file = makeSave(contents(), Date.now());
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = saveFileName(file.label);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('svMsg').textContent = `Downloaded ${a.download}. Keep it somewhere safe.`;
}

async function loadSaveFile(f: File): Promise<void> {
  let c: SaveContents | null = null;
  try {
    if (f.size <= 3_000_000) c = readSave(JSON.parse(await f.text()));
  } catch { /* not a save */ }
  if (!c) {
    $('svMsg').textContent = 'That file is not a Friday Night Dynasty save.';
    return;
  }
  const loaded = c;
  const use = (): void => {
    applySave(loaded);
    // The file is now the save: it goes up over whatever the server had.
    unsaved = true;
    store.set('fnd.unsaved.v1', true);
    cloudOther = null;
    $('svMsg').textContent = `Loaded: ${saveLabel(loaded)}.`;
    if (session) void pushSave(true);
    renderSaves();
  };
  if (hasLocal()) ask(`The file holds: ${saveLabel(loaded)}. Loading it replaces what is in this browser${session ? ' and on the server' : ''}: ${saveLabel(contents())}.`, 'Load the file', 'Cancel', use);
  else use();
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
  startAtmosphere();
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
  stAuto = true;
  if (offTab === '@st') offTab = FORMATIONS[0].id;
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
  if (v.line) {
    const mine = v.mine as OffDecision | null;
    if (game.state.possession === user && mine && 'kind' in mine && mine.kind === 'play' && v.line.front !== null) {
      const lib = v.line.front === CUSTOM_FRONT ? null : frontById(v.line.front);
      showLinePanel(mine.playId, lib ? lib.name : 'a defense of their own design', lib ? lib.desc : '', lib, (to) => void sendCall((to ? { kind: 'audible', playId: to } : { kind: 'snap' }) as unknown as OffDecision, to ? 'Audible called. Here comes the snap…' : 'Here comes the snap…'));
    } else {
      mode = 'wait';
      setPanelWaiting(game.state.possession === user ? 'Here comes the snap…' : 'The offense is at the line…');
    }
    return;
  }
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

async function sendCall(call: OffDecision | DefDecision, waiting = 'Your call is in. Waiting for the other sideline…'): Promise<void> {
  if (!net) return;
  const mine = net;
  mode = 'wait';
  keyHandler = null;
  $('pclock').classList.add('hidden');
  setPanelWaiting(waiting);
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
($('menuArt') as HTMLImageElement).src = menuArtUrl;
// Pixel faces for the menu, carried inside the page like everything else.
for (const [family, url, weight] of [['Press Start 2P', pressStartUrl, '400'], ['Jersey 15', jerseyUrl, '400']] as const) {
  try { void new FontFace(family, `url(${url}) format('woff2')`, { weight }).load().then((f) => document.fonts.add(f)); } catch { /* the fallback face is fine */ }
}
$('version').textContent = `v${devnotes.notes[0].version} · ${devnotes.notes[0].title}`;
$('title').addEventListener('click', () => showSetup(true, 'menu'));
$('goExhibition').addEventListener('click', () => { sfx.select(); setupGo('exhibition'); });
$('goOnline').addEventListener('click', () => { sfx.select(); setupGo('online'); });
$('setup').querySelectorAll<HTMLElement>('[data-menu]').forEach((el) => el.addEventListener('click', () => setupGo('menu')));
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
$('goSaves').addEventListener('click', () => { sfx.select(); $('svMsg').textContent = ''; setupGo('saves'); });
$('svEnter').addEventListener('click', () => void signIn('sv'));
$('svPin').addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter') void signIn('sv'); });
$('svPush').addEventListener('click', () => { $('svMsg').textContent = ''; void pushSave(); });
$('svPull').addEventListener('click', () => {
  $('svMsg').textContent = '';
  if (hasLocal() && unsaved) ask(`Loading the server save replaces what is in this browser: ${saveLabel(contents())}.`, 'Load the server save', 'Cancel', () => void pullSave());
  else void pullSave();
});
$('svYes').addEventListener('click', () => { const go = askYes; closeAsk(); go?.(); });
$('svNo').addEventListener('click', () => {
  // Turning down the server's save in a conflict means this browser's goes up over it.
  const keepMine = $('svNo').dataset.keep === '1';
  closeAsk();
  if (keepMine) { cloudOther = null; void pushSave(true); }
});
$('svSignOut').addEventListener('click', () => { closeAsk(); $('oOut').click(); renderSaves(); });
$('svDown').addEventListener('click', downloadSave);
$('svUp').addEventListener('click', () => ($('svFile') as HTMLInputElement).click());
$('svFile').addEventListener('change', () => {
  const input = $('svFile') as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (f) void loadSaveFile(f);
});
if (session) void syncSaves();
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
$('oOut').addEventListener('click', () => { session = null; career = null; cloudOther = null; cloudError = ''; store.set('fnd.session.v1', null); renderOnlineBox(); });
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
  refreshAtmosphere();
  $('mute').textContent = muted ? 'Sound off' : 'Sound on';
});
let paOn = true;
try { paOn = localStorage.getItem('fnd.pa') !== 'off'; } catch { /* private mode */ }
const showPa = (): void => {
  setPa(paOn);
  $('pa').textContent = paOn ? 'Announcer on' : 'Announcer off';
  $('pa').classList.toggle('on', paOn);
};
showPa();
$('pa').addEventListener('click', () => {
  paOn = !paOn;
  try { localStorage.setItem('fnd.pa', paOn ? 'on' : 'off'); } catch { /* private mode */ }
  showPa();
});
window.addEventListener('keydown', (ev) => {
  if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (!$('title').classList.contains('hidden')) {
    if (k === 'enter' || k === ' ') {
      ev.preventDefault();
      showSetup(true, 'menu');
    }
    return;
  }
  if (!$('setup').classList.contains('hidden')) {
    const typing = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement;
    if (k === 'escape' && setupPage !== 'menu') setupGo('menu');
    else if (setupPage === 'menu' && !typing && k >= '1' && k <= '6') ($('mainMenu').querySelectorAll('.mi')[Number(k) - 1] as HTMLElement).click();
    return;
  }
  if ($('game').classList.contains('hidden')) return;
  if (k === 'escape' && sidelineOpen) return closeSideline();
  if (k === 's') return sidelineOpen ? closeSideline() : openSideline();
  if (mode === 'choose' && keyHandler && !sidelineOpen) keyHandler(k);
});

/** Debug hooks used by the browser checks. */
(window as unknown as Record<string, unknown>).__fnd = {
  /** Sends the band out or brings it off. For the automated checks. */
  band: (on: boolean, court = false) => scene.showBand(on, court),
  /** Throws the penalty flags. For the automated checks. */
  flag: (seq = 4) => flagDrop({ seq } as PlayEvent),
  /** Shows the crowd's reaction to a made-up play. For the automated checks. */
  crowd: (e: Partial<PlayEvent>) => crowdFeels({ seq: 7, offense: 0, down: 1, yards: 0, type: 'run', flags: {}, ...e } as PlayEvent),
  /** Where every drawn player is right now, in field yards. For the automated checks. */
  view: () => (game && mode !== 'menu' ? buildView().players.map((p) => ({ team: p.team, x: p.x, y: p.y, pose: p.pose ?? null, back: !!p.back, ball: p.hasBall })) : null),
  selftest: (s: number): string => gameHash(simulateGame(s, exhibitionTeams(s))),
  state: () => ({ mode, league: shared.current ? { code: shared.current.code, state: shared.current.state, year: shared.current.year, week: shared.current.week, you: shared.current.you, over: shared.current.over, played: shared.current.games.filter((g) => g.score).length } : null, dynasty: dynasty.active ? { year: dynasty.active.year, week: dynasty.active.week, user: dynasty.active.user, results: dynasty.active.results.length, history: dynasty.active.history.length } : null, cutin: $('cutin').classList.contains('hidden') ? null : ($('cutin') as HTMLImageElement).alt, setup: game?.setup ?? setup, myPlays: myPlays.length, myDefs: myDefs.length, career, practice: practiceRun ? { n: practiceRun.n, done: !!viewSim?.done } : null, phase: game?.state.phase, score: game?.state.score, quarter: game?.state.quarter, clock: game?.state.clock, sidelineOpen, playClock: clockOn ? Math.ceil(clockLeft / 1000) : null, book,
    online: net ? { pin: net.pin, state: net.view.state, turn: net.view.turn, you: net.view.you, sync: net.sync, serverHash: net.view.hash, localHash: game ? gameHash(game) : '', queued: net.queue.length, serverScore: net.view.score, mine: !!net.view.mine, voice: voice.state, peer: voice.peerState(String(net.view.you === 0 ? 1 : 0)), voiceSeen: net.view.voice } : null }),
  setSpeed: (n: number) => { speed = n; },
  setTurbo: (on: boolean) => { turbo = on; },
  setPlayClock: (on: boolean) => { useClock = on; clockOn = clockOn && on; },
};
