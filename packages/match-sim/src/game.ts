import {
  CUSTOM_FRONT, DEFAULT_BOOK, DEFAULT_SETUP, DEFENSE_FRONTS, DEFENSE_SCHEMES, GROUPS, MAX_CUSTOM_DEFENSES, MAX_CUSTOM_PLAYS, OFFENSE_PLAYS, RULES, Rng, U, WEATHER, clamp, cleanSetup, formationOf, frontById, hashString,
  schemeById, toFront, toScheme, validateBook, validateDefPlay, validateOffPlay,
  type DefFront, type DefPlay, type DefScheme, type OffPlay,
  type DefDecision, type GamePlan, type GameSetup, type Group, type KickStyle, type PenaltyKind, type ManageAction, type OffDecision, type PlayEvent, type PlayFlags, type PlayType,
  type Player, type Situation, type Slot, type Team,
} from '@fnd/core';
import { DEFAULT_PLAN, aiDefense, aiKickoff, aiOffense, fieldGoalDistance } from '@fnd/football-ai';
import { PlaySim, type PlayContext, type PlayResult } from './play';
import { blockOutcome, fieldGoalChance, patChance, resolvePunt, resolveStyledKickoff } from './special';

/** Game rules: downs, clock, scoring, possession, fatigue and substitutions. Turns coaching decisions into play events. */

export type Phase = 'kickoff' | 'scrimmage' | 'conversion' | 'final';

export interface GameState {
  quarter: number;
  clock: number;
  score: [number, number];
  possession: 0 | 1;
  down: number;
  distance: number;
  yardLine: number;
  phase: Phase;
  kicking: 0 | 1;
  kickFrom: number;
  timeouts: [number, number];
  /** True when the clock will run off before the next snap unless a timeout is called. */
  clockRunning: boolean;
  openingReceiver: 0 | 1;
}

export type LoggedDecision =
  | { off: OffDecision | null; def: DefDecision | null }
  | { manage: ManageAction };

export interface GameOptions {
  /** The eight offensive plays each team carries. Defaults to the starter book. */
  books?: readonly [readonly string[], readonly string[]];
  /** Each coach's own designed plays and defenses. Re-validated here: nothing illegal reaches the field. */
  plays?: readonly [readonly OffPlay[], readonly OffPlay[]];
  defenses?: readonly [readonly DefPlay[], readonly DefPlay[]];
  /** Quarter length and weather. Twelve-minute quarters on a clear night when absent. */
  setup?: Partial<GameSetup>;
}

/** A substitution made because a starter is resting. */
export interface SubNotice {
  team: 0 | 1;
  slot: string;
  out: Player;
  in: Player;
}

export const DEFAULT_SUB_THRESHOLD = 55;
/** A resting player comes back once he has recovered this much above the threshold. */
const RETURN_MARGIN = 20;

const short = (p: Player | undefined): string => {
  if (!p) return '';
  const [first, ...rest] = p.name.split(' ');
  return `${first[0]}. ${rest.join(' ')}`;
};
const other = (t: 0 | 1): 0 | 1 => (t === 0 ? 1 : 0);
const yds = (n: number): string => `${n} yard${n === 1 ? '' : 's'}`;

export class Game {
  readonly state: GameState;
  readonly events: PlayEvent[] = [];
  /** Every decision submitted, in order. With the seed, this reproduces the game exactly. */
  readonly log: LoggedDecision[] = [];
  readonly books: readonly [readonly string[], readonly string[]];
  readonly designed: readonly [readonly OffPlay[], readonly OffPlay[]];
  readonly defenses: readonly [readonly DefPlay[], readonly DefPlay[]];
  /** Depth charts for this game. Changed only through `manage`. */
  readonly depth: [Record<Group, string[]>, Record<Group, string[]>];
  /** Energy 0 to 100 per player ID. */
  readonly energy: Record<string, number> = {};
  readonly subThreshold: [number, number] = [DEFAULT_SUB_THRESHOLD, DEFAULT_SUB_THRESHOLD];
  live: PlaySim | null = null;
  lastEvent: PlayEvent | null = null;
  /** Set when a timeout was used on the most recent `begin`. */
  lastTimeoutBy: 0 | 1 | null = null;
  /** Substitutions for fatigue on the most recent snap. */
  lastSubs: SubNotice[] = [];

  private readonly byId = new Map<string, Player>();
  private readonly resting = new Set<string>();
  private instant = false;
  private twoPoint = false;
  /** The log position of the snap being played: the officials' random stream is keyed to it. */
  private snapN = 0;
  /** Overtime: which period, who had the ball first in it, and whether the first (0) or second (1) series is being played. */
  private ot: { period: number; first: 0 | 1; turn: 0 | 1 } | null = null;
  /** The defense went for the block on the last snap and the offense ran a real play. */
  caughtBlocking = false;
  private calls: { off?: string; front?: string; def?: string } = {};
  private lastSnap: { offense: 0 | 1; n: number; ctx: Omit<PlayContext, 'rng'> } | null = null;

  readonly setup: GameSetup;
  private readonly quarterSeconds: number;

  constructor(readonly seed: number, readonly teams: readonly [Team, Team], opts: GameOptions = {}) {
    this.setup = cleanSetup({ ...DEFAULT_SETUP, ...opts.setup });
    this.quarterSeconds = this.setup.quarterMinutes * 60;
    const receiver = Rng.stream(seed, 'toss').int(0, 1) as 0 | 1;
    this.state = {
      quarter: 1, clock: this.quarterSeconds, score: [0, 0], possession: receiver, down: 1, distance: 10, yardLine: 20,
      phase: 'kickoff', kicking: other(receiver), kickFrom: RULES.kickoffFrom,
      timeouts: [RULES.timeoutsPerHalf, RULES.timeoutsPerHalf], clockRunning: false, openingReceiver: receiver,
    };
    const checkAll = <T>(list: readonly unknown[], max: number, check: (x: unknown) => { ok: true; value: T } | { ok: false; problems: string[] }): T[] => {
      if (list.length > max) throw new Error('too many designed plays');
      const out = list.map((x) => {
        const r = check(x);
        if (!r.ok) throw new Error(r.problems[0]);
        return r.value;
      });
      if (new Set(out.map((x) => (x as { id: string }).id)).size !== out.length) throw new Error('two designs share an id');
      return out;
    };
    this.designed = [checkAll(opts.plays?.[0] ?? [], MAX_CUSTOM_PLAYS, validateOffPlay), checkAll(opts.plays?.[1] ?? [], MAX_CUSTOM_PLAYS, validateOffPlay)];
    this.defenses = [checkAll(opts.defenses?.[0] ?? [], MAX_CUSTOM_DEFENSES, validateDefPlay), checkAll(opts.defenses?.[1] ?? [], MAX_CUSTOM_DEFENSES, validateDefPlay)];
    this.books = opts.books ?? [DEFAULT_BOOK, DEFAULT_BOOK];
    this.books.forEach((book, t) => {
      const problem = validateBook(book, this.designed[t]);
      if (problem) throw new Error(problem);
    });
    const copy = (t: Team): Record<Group, string[]> => {
      const out = {} as Record<Group, string[]>;
      for (const g of GROUPS) out[g] = [...t.depth[g]];
      return out;
    };
    this.depth = [copy(teams[0]), copy(teams[1])];
    for (const t of teams) for (const p of t.roster) {
      this.byId.set(p.id, p);
      this.energy[p.id] = 100;
    }
  }

  /** Which team is on offense (or kicking off) for the next decision. */
  get offense(): 0 | 1 {
    return this.state.phase === 'kickoff' ? this.state.kicking : this.state.possession;
  }

  /** A play by id for one team: its coach's designs first, then the library. */
  playOf(team: 0 | 1, id: string): OffPlay {
    const p = this.designed[team].find((x) => x.id === id) ?? OFFENSE_PLAYS.find((x) => x.id === id);
    if (!p) throw new Error(`unknown play ${id}`);
    return p;
  }

  /** The plays in a team's book. */
  bookPlays(team: 0 | 1): OffPlay[] {
    return this.books[team].map((id) => this.playOf(team, id));
  }

  /** The front and call a defensive decision stands for. */
  defenseOf(team: 0 | 1, def: DefDecision): { front: DefFront; scheme: DefScheme } {
    if (def.frontId === CUSTOM_FRONT) {
      const d = this.defenses[team].find((x) => x.id === def.callId);
      if (!d) throw new Error('that defense is not one of this team\'s designs');
      return { front: toFront(d), scheme: toScheme(d) };
    }
    return { front: frontById(def.frontId), scheme: schemeById(def.callId) };
  }

  player(id: string): Player {
    const p = this.byId.get(id);
    if (!p) throw new Error(`unknown player ${id}`);
    return p;
  }

  situation(team: 0 | 1): Situation {
    const s = this.state;
    return {
      phase: s.phase === 'conversion' ? 'conversion' : 'scrimmage',
      quarter: s.quarter, clock: s.clock, down: s.down, distance: s.distance, yardLine: s.yardLine,
      scoreDiff: s.score[team] - s.score[other(team)], timeouts: s.timeouts[team], oppTimeouts: s.timeouts[other(team)],
      clockRunning: s.clockRunning, kicking: this.starter(team, 'K').ratings.kicking,
    };
  }

  starter(team: 0 | 1, group: Group, rank = 1): Player {
    const ids = this.depth[team][group];
    return this.player(ids[Math.min(rank, ids.length) - 1]);
  }

  /** Between-play management: reorder a depth chart or change the substitution threshold. */
  manage(action: ManageAction): void {
    if (this.state.phase === 'final') throw new Error('game is over');
    if (action.kind === 'depth') {
      const current = this.depth[action.team][action.group];
      const same = action.order.length === current.length && new Set(action.order).size === current.length && action.order.every((id) => current.includes(id));
      if (!same) throw new Error('a depth chart must list the same players');
      this.depth[action.team][action.group] = [...action.order];
    } else {
      this.subThreshold[action.team] = clamp(Math.round(action.value), 0, 90);
    }
    this.log.push({ manage: action });
  }

  /** The players who would take the field for these slots right now, with tired starters resting. */
  lineup(team: 0 | 1, slots: readonly Slot[], notices?: SubNotice[]): Player[] {
    const threshold = this.subThreshold[team];
    const orderFor = new Map<Group, string[]>();
    const out: Player[] = [];
    for (const slot of slots) {
      let order = orderFor.get(slot.group);
      const chart = this.depth[team][slot.group];
      if (!order) {
        for (const id of chart) {
          if (this.energy[id] < threshold) this.resting.add(id);
          else if (this.resting.has(id) && this.energy[id] >= Math.min(100, threshold + RETURN_MARGIN)) this.resting.delete(id);
        }
        order = [...chart.filter((id) => !this.resting.has(id)), ...chart.filter((id) => this.resting.has(id))];
        orderFor.set(slot.group, order);
      }
      const pick = this.player(order[Math.min(slot.rank, order.length) - 1]);
      const nominal = this.player(chart[Math.min(slot.rank, chart.length) - 1]);
      if (notices && pick.id !== nominal.id && this.resting.has(nominal.id)) notices.push({ team, slot: slot.id, out: nominal, in: pick });
      out.push(pick);
    }
    return out;
  }

  /** Starts the next play. Kickoffs need no decisions. Call `tick` until it returns true. */
  begin(off: OffDecision | null, def: DefDecision | null): void {
    const s = this.state;
    if (s.phase === 'final') throw new Error('game is over');
    this.log.push({ off, def });
    const n = this.log.length;
    this.live = null;
    this.lastEvent = null;
    this.lastTimeoutBy = null;
    this.lastSubs = [];
    this.instant = false;
    this.twoPoint = false;
    this.caughtBlocking = false;
    this.calls = {};

    if (s.phase === 'kickoff') {
      this.kickoff(Rng.stream(this.seed, `special:${n}`), off?.kind === 'kickoff' ? off.style : 'deep');
      this.instant = true;
      return;
    }
    if (!off) throw new Error('offense decision required');
    const offTeam = s.possession;

    // A call that is not allowed is refused whatever the officials do.
    if (off.kind === 'play' && !this.books[offTeam].includes(off.playId)) throw new Error(`play ${off.playId} is not in this team's playbook`);
    this.snapN = n;
    // A flag before the snap: the call is thrown away and the down is replayed.
    if (s.phase === 'scrimmage' && off.kind !== 'kneel') {
      const roll = Rng.stream(this.seed, `flag:${n}`).range(0, 1);
      if (roll < RULES.falseStartChance + RULES.offsideChance) {
        this.deadBallFoul(roll < RULES.falseStartChance ? 'falseStart' : 'offside');
        this.instant = true;
        return;
      }
    }

    if (s.phase === 'scrimmage' && s.clockRunning) {
      if ((off.kind === 'play' || off.kind === 'punt' || off.kind === 'fieldGoal') && off.timeout && s.timeouts[offTeam] > 0) {
        s.timeouts[offTeam]--;
        this.lastTimeoutBy = offTeam;
      } else if (def?.timeout && s.timeouts[other(offTeam)] > 0) {
        s.timeouts[other(offTeam)]--;
        this.lastTimeoutBy = other(offTeam);
      } else {
        s.clock -= RULES.runoffSeconds;
        if (s.clock <= 0) {
          this.endQuarter();
          // The quarter ended before the snap. If that started overtime, the call just made belongs to no one.
          if (s.phase !== 'scrimmage' || this.ot) {
            this.instant = true;
            return;
          }
        }
      }
      s.clockRunning = false;
    }

    if (s.phase === 'conversion') {
      if (off.kind === 'patKick') {
        this.pat(Rng.stream(this.seed, `special:${n}`));
        this.instant = true;
        return;
      }
      this.twoPoint = true;
    } else if (off.kind === 'punt') {
      this.punt(Rng.stream(this.seed, `special:${n}`), def?.block === true && s.down === 4);
      this.instant = true;
      return;
    } else if (off.kind === 'fieldGoal') {
      this.fieldGoal(Rng.stream(this.seed, `special:${n}`), def?.block === true && s.down === 4);
      this.instant = true;
      return;
    } else if (off.kind === 'kneel') {
      this.kneel();
      this.instant = true;
      return;
    }
    if (off.kind !== 'play') throw new Error(`invalid offensive decision ${off.kind}`);
    if (!def) throw new Error('defense decision required');
    if (!this.books[offTeam].includes(off.playId)) throw new Error(`play ${off.playId} is not in this team's playbook`);

    const play = this.playOf(offTeam, off.playId);
    const formation = formationOf(play);
    const called = this.defenseOf(other(offTeam), def);
    const front = called.front;
    // A defense that sold out for the block and got a real play is out of position: it plays as if it guessed wrong.
    this.caughtBlocking = def.block === true && s.phase === 'scrimmage' && s.down === 4;
    const scheme = this.caughtBlocking ? { ...called.scheme, kind: play.kind === 'run' ? 'pass' as const : 'run' as const } : called.scheme;
    const offPlayers = this.lineup(offTeam, formation.slots, this.lastSubs);
    const defPlayers = this.lineup(other(offTeam), front.slots, this.lastSubs);
    const ctx: Omit<PlayContext, 'rng'> = {
      play, formation, front, scheme, offPlayers, defPlayers,
      offEnergy: offPlayers.map((p) => this.energy[p.id]),
      defEnergy: defPlayers.map((p) => this.energy[p.id]),
      los: this.twoPoint ? RULES.twoPointFrom : s.yardLine,
      weather: this.setup.weather,
    };
    this.calls = { off: play.id, front: front.id, def: scheme.id };
    this.lastSnap = { offense: offTeam, n, ctx };
    this.live = new PlaySim({ ...ctx, rng: Rng.stream(this.seed, `play:${n}`) });
  }

  /** A fresh copy of the most recent scrimmage play, for instant replay. It reproduces the play exactly. */
  replayLast(): { sim: PlaySim; offense: 0 | 1 } | null {
    const snap = this.lastSnap;
    if (!snap) return null;
    return { sim: new PlaySim({ ...snap.ctx, rng: Rng.stream(this.seed, `play:${snap.n}`) }), offense: snap.offense };
  }

  /** Advances the current play one step. Returns true when the play is over and the state is updated. */
  tick(): boolean {
    if (this.instant) {
      this.instant = false;
      return true;
    }
    if (!this.live) return true;
    if (!this.live.done) {
      this.live.step();
      if (!this.live.done) return false;
    }
    if (this.lastEvent === null && this.live.result) {
      this.applyFatigue(this.live);
      this.applyPlay(this.live.result);
    }
    return true;
  }

  // ------------------------------------------------------------- internals

  private applyFatigue(sim: PlaySim): void {
    const played = new Set<string>();
    for (const p of sim.players) {
      const id = p.player.id;
      played.add(id);
      const work = 1 + p.moved / (U * 14) + (p.contact ? 2.5 : 0) + (p.engaged >= 0 ? 0.5 : 0);
      this.energy[id] = Math.max(0, this.energy[id] - ((work * (140 - p.player.ratings.stamina)) / 80) * WEATHER[this.setup.weather].drain);
    }
    for (const id of Object.keys(this.energy)) {
      if (!played.has(id)) this.energy[id] = Math.min(100, this.energy[id] + 1.5);
    }
  }

  private rest(amount: number): void {
    for (const id of Object.keys(this.energy)) this.energy[id] = Math.min(100, this.energy[id] + amount);
  }

  private emit(type: PlayType, offense: 0 | 1, before: { down: number; distance: number; yardLine: number; quarter: number; clock: number },
    yards: number, flags: PlayFlags, points: [number, number], seconds: number, text: string, who: Partial<PlayEvent> = {}): void {
    const e: PlayEvent = {
      seq: this.events.length + 1, quarter: before.quarter, clock: before.clock, offense,
      down: before.down, distance: before.distance, yardLine: before.yardLine, type,
      offCall: this.calls.off, defFront: this.calls.front, defCall: this.calls.def, yards, flags, points,
      scoreAfter: [this.state.score[0], this.state.score[1]], seconds, text, ...who,
    };
    this.events.push(e);
    this.lastEvent = e;
  }

  private snapshot() {
    const s = this.state;
    return { down: s.down, distance: s.distance, yardLine: s.yardLine, quarter: s.quarter, clock: s.clock };
  }

  private runClock(seconds: number): void {
    this.state.clock = Math.max(0, this.state.clock - seconds);
  }

  private setKickoff(kicking: 0 | 1, from: number): void {
    const s = this.state;
    s.phase = 'kickoff';
    s.kicking = kicking;
    s.kickFrom = from;
    s.clockRunning = false;
  }

  private firstDownAt(team: 0 | 1, yardLine: number): void {
    const s = this.state;
    s.possession = team;
    s.yardLine = clamp(yardLine, 1, 99);
    s.down = 1;
    s.distance = Math.min(10, 100 - s.yardLine);
    s.phase = 'scrimmage';
  }

  private endQuarter(): void {
    const s = this.state;
    s.clockRunning = false;
    if (s.quarter === 2) {
      s.quarter = 3;
      s.clock = this.quarterSeconds;
      s.timeouts = [RULES.timeoutsPerHalf, RULES.timeoutsPerHalf];
      this.setKickoff(s.openingReceiver, RULES.kickoffFrom);
      this.rest(40);
    } else if (s.quarter >= RULES.quarters) {
      s.clock = 0;
      if (s.score[0] === s.score[1]) this.startOvertime();
      else s.phase = 'final';
    } else {
      s.quarter++;
      s.clock = this.quarterSeconds;
      this.rest(10);
    }
  }

  /** A foul before the snap: five yards, replay the down. */
  private deadBallFoul(kind: 'falseStart' | 'offside'): void {
    const s = this.state;
    const off = s.possession;
    const text = kind === 'falseStart' ? `Flag: false start, ${this.teams[off].name}. Five yards, replay the down.` : `Flag: offside, ${this.teams[other(off)].name}. Five yards.`;
    this.foul(kind, off, kind === 'falseStart' ? -5 : 5, this.snapshot(), 0, text, {});
  }

  /**
   * Marks off a penalty from the line of scrimmage. `yards` is from the offense's point of view. Half the distance
   * to the goal when the full penalty would be more than that. The down is replayed unless it gives a first down.
   */
  private foul(kind: PenaltyKind, off: 0 | 1, yards: number, before: ReturnType<Game['snapshot']>, seconds: number, text: string, who: Partial<PlayEvent>, automaticFirst = false): void {
    const s = this.state;
    const flags: PlayFlags = { foul: kind };
    let moved: number;
    if (yards < 0) {
      moved = -Math.min(-yards, Math.max(1, Math.trunc(s.yardLine / 2)));
      if (s.yardLine + moved < 1) moved = 1 - s.yardLine;
      s.yardLine += moved;
      s.distance -= moved;
    } else {
      moved = Math.min(yards, Math.max(1, Math.trunc((100 - s.yardLine) / 2)));
      if (s.yardLine + moved > 99) moved = 99 - s.yardLine;
      if (automaticFirst || moved >= s.distance) {
        flags.firstDown = true;
        this.firstDownAt(off, s.yardLine + moved);
        text += automaticFirst ? '' : ' First down.';
      } else {
        s.yardLine += moved;
        s.distance -= moved;
      }
    }
    s.clockRunning = false;
    this.emit('penalty', off, before, moved, flags, [0, 0], seconds, text, who);
    this.afterPlayClock();
  }

  /** 0 in regulation, otherwise the overtime period being played. */
  get overtime(): number {
    return this.ot?.period ?? 0;
  }

  private startOvertime(): void {
    const s = this.state;
    this.ot = { period: 1, first: Rng.stream(this.seed, 'overtime').int(0, 1) as 0 | 1, turn: 0 };
    s.quarter = RULES.quarters + 1;
    s.timeouts = [1, 1];
    this.rest(20);
    this.overtimeSeries(this.ot.first);
  }

  private overtimeSeries(team: 0 | 1): void {
    const s = this.state;
    this.firstDownAt(team, RULES.overtimeFrom);
    s.clock = 0;
    s.clockRunning = false;
  }

  /** After every overtime play: carry on the series, hand the ball to the other team, or end the period. */
  private overtimeAfterPlay(): void {
    const s = this.state;
    const ot = this.ot!;
    s.clock = 0;
    s.clockRunning = false;
    if (s.phase === 'conversion') return;
    const team = ot.turn === 0 ? ot.first : other(ot.first);
    // A series ends with a score (the next thing would be a kickoff) or when the ball changes hands.
    if (s.phase === 'scrimmage' && s.possession === team) return;
    if (ot.turn === 0) {
      ot.turn = 1;
      this.overtimeSeries(other(ot.first));
      return;
    }
    if (s.score[0] !== s.score[1] || ot.period >= RULES.overtimePeriods) {
      s.phase = 'final';
      return;
    }
    // Still level: another period, and the team that went second now goes first.
    this.ot = { period: ot.period + 1, first: other(ot.first), turn: 0 };
    s.quarter++;
    s.timeouts = [1, 1];
    this.rest(10);
    this.overtimeSeries(this.ot.first);
  }

  private afterPlayClock(): void {
    const s = this.state;
    if (this.ot) return this.overtimeAfterPlay();
    if (s.clock <= 0 && s.phase !== 'conversion' && s.phase !== 'final') this.endQuarter();
  }

  /** The receivers expect an onside kick when the kicking team is behind late in the game. */
  onsideExpected(): boolean {
    const s = this.state;
    return s.quarter >= RULES.quarters && s.clock <= 300 && s.score[s.kicking] < s.score[other(s.kicking)];
  }

  private kickoff(rng: Rng, style: KickStyle): void {
    const s = this.state;
    const before = { down: 0, distance: 0, yardLine: s.kickFrom, quarter: s.quarter, clock: s.clock };
    const kick = s.kicking;
    const recv = other(kick);
    const kicker = this.starter(kick, 'K');
    const returner = this.starter(recv, 'WR', 3);
    const r = resolveStyledKickoff(rng, kicker, returner, s.kickFrom, style, this.onsideExpected());
    this.runClock(r.touchback ? 0 : style === 'onside' ? 3 : 6);
    const points: [number, number] = [0, 0];
    let text: string;
    if (style === 'onside') {
      this.firstDownAt(r.recovered ? kick : recv, r.startYard);
      text = r.recovered ? `Onside kick! ${this.teams[kick].name} recover it.` : `Onside kick by ${short(kicker)}. ${this.teams[recv].name} fall on it.`;
      s.clockRunning = false;
      this.emit('kickoff', kick, before, r.kickYards, { onside: true, recovered: r.recovered }, points, 3, text, { kicker: kicker.id });
      this.afterPlayClock();
      return;
    }
    if (r.touchdown) {
      s.score[recv] += 6;
      points[recv] = 6;
      s.possession = recv;
      s.phase = 'conversion';
      s.yardLine = RULES.twoPointFrom;
      text = `Kickoff returned ${yds(r.returnYards)} by ${short(returner)} for a TOUCHDOWN!`;
    } else {
      this.firstDownAt(recv, r.startYard);
      text = r.touchback ? `${short(kicker)} kicks off. Touchback.`
        : `${short(kicker)} ${style === 'squib' ? 'squibs it' : 'kicks off'}. ${short(returner)} returns it ${yds(r.returnYards)}.`;
    }
    s.clockRunning = false;
    this.emit('kickoff', kick, before, r.kickYards, { touchback: r.touchback, touchdown: r.touchdown }, points, r.touchback ? 0 : 6, text,
      { kicker: kicker.id, receiver: returner.id, returnYards: r.touchback ? 0 : r.returnYards });
    this.afterPlayClock();
  }

  /** Fifteen yards and a first down for running into the kicker. */
  private roughing(off: 0 | 1): void {
    const s = this.state;
    this.firstDownAt(off, s.yardLine + 15 >= 100 ? s.yardLine + Math.max(1, Math.trunc((100 - s.yardLine) / 2)) : s.yardLine + 15);
    s.clockRunning = false;
  }

  private punt(rng: Rng, rushed: boolean): void {
    const s = this.state;
    const before = this.snapshot();
    const off = s.possession;
    const punter = this.starter(off, 'P');
    const r = resolvePunt(rng, punter, s.yardLine, WEATHER[this.setup.weather].puntDistance);
    const fate = rushed ? blockOutcome(rng.range(0, 1)) : 'none';
    this.runClock(8);
    if (fate === 'blocked') {
      this.firstDownAt(other(off), clamp(100 - (s.yardLine - 6), 1, 99));
      s.clockRunning = false;
      this.emit('punt', off, before, 0, { blocked: true }, [0, 0], 8, `BLOCKED! ${this.teams[other(off)].name} get to ${short(punter)}'s punt.`, { kicker: punter.id });
    } else if (fate === 'roughing') {
      this.roughing(off);
      this.emit('punt', off, before, 15, { roughing: true, firstDown: true }, [0, 0], 8, `Flag: running into the kicker. First down, ${this.teams[off].name}.`, { kicker: punter.id });
    } else {
      // A defense that came after the punt has nobody back to return it.
      const startYard = rushed && !r.touchback ? clamp(r.startYard - r.returnYards, 1, 99) : r.startYard;
      const returned = rushed ? 0 : r.returnYards;
      this.firstDownAt(other(off), startYard);
      s.clockRunning = false;
      const text = r.touchback ? `${short(punter)} punts into the end zone. Touchback.`
        : `${short(punter)} punts ${yds(r.grossYards)}${returned ? `, returned ${yds(returned)}` : rushed ? ', no return' : ', fair catch'}.`;
      this.emit('punt', off, before, r.grossYards, { touchback: r.touchback }, [0, 0], 8, text, { kicker: punter.id, returnYards: r.touchback ? 0 : returned });
    }
    this.afterPlayClock();
  }

  private fieldGoal(rng: Rng, rushed: boolean): void {
    const s = this.state;
    const before = this.snapshot();
    const off = s.possession;
    const kicker = this.starter(off, 'K');
    const dist = fieldGoalDistance(s.yardLine);
    const made = rng.chance(clamp(fieldGoalChance(kicker, s.yardLine) + WEATHER[this.setup.weather].kicking, 0.01, 0.97));
    const fate = rushed ? blockOutcome(rng.range(0, 1)) : 'none';
    const good = made && fate !== 'blocked';
    this.runClock(5);
    const points: [number, number] = [0, 0];
    if (fate === 'roughing' && !made) {
      this.roughing(off);
      this.emit('fieldGoal', off, before, dist, { good: false, roughing: true, firstDown: true }, points, 5, `${short(kicker)} misses from ${dist}, but there is a flag: running into the kicker. First down.`, { kicker: kicker.id });
      this.afterPlayClock();
      return;
    }
    if (fate === 'blocked') {
      this.firstDownAt(other(off), Math.max(RULES.touchbackAt, 100 - s.yardLine));
      s.clockRunning = false;
      this.emit('fieldGoal', off, before, dist, { good: false, blocked: true }, points, 5, `BLOCKED! ${short(kicker)}'s ${dist}-yard field goal never gets off the ground.`, { kicker: kicker.id });
      this.afterPlayClock();
      return;
    }
    if (good) {
      s.score[off] += 3;
      points[off] = 3;
      this.setKickoff(off, RULES.kickoffFrom);
    } else {
      this.firstDownAt(other(off), Math.max(RULES.touchbackAt, 100 - s.yardLine));
      s.clockRunning = false;
    }
    this.emit('fieldGoal', off, before, dist, { good }, points, 5, `${short(kicker)} ${dist}-yard field goal is ${good ? 'GOOD!' : 'no good.'}`, { kicker: kicker.id });
    this.afterPlayClock();
  }

  private pat(rng: Rng): void {
    const s = this.state;
    const before = this.snapshot();
    const off = s.possession;
    const kicker = this.starter(off, 'K');
    const good = rng.chance(clamp(patChance(kicker) + WEATHER[this.setup.weather].kicking / 2, 0.3, 0.98));
    const points: [number, number] = [0, 0];
    if (good) {
      s.score[off] += 1;
      points[off] = 1;
    }
    this.setKickoff(off, RULES.kickoffFrom);
    this.emit('pat', off, before, 0, { good }, points, 0, `Extra point by ${short(kicker)} is ${good ? 'good.' : 'NO GOOD.'}`, { kicker: kicker.id });
    this.afterPlayClock();
  }

  private kneel(): void {
    const s = this.state;
    const before = this.snapshot();
    const off = s.possession;
    const qb = this.starter(off, 'QB');
    this.runClock(3);
    const flags: PlayFlags = {};
    this.advanceDown(off, Math.max(1, s.yardLine - 1), flags);
    s.clockRunning = !flags.turnoverOnDowns && s.phase === 'scrimmage';
    this.emit('kneel', off, before, -1, flags, [0, 0], 3, `${short(qb)} takes a knee.${flags.turnoverOnDowns ? ' Turnover on downs.' : ''}`, { rusher: qb.id });
    this.afterPlayClock();
  }

  private applyPlay(r: PlayResult): void {
    const s = this.state;
    const off = s.possession;
    const def = other(off);
    const before = this.snapshot();
    const who: Partial<PlayEvent> = { passer: r.passer?.id, rusher: r.rusher?.id, receiver: r.receiver?.id, tackler: r.tackler?.id };
    const points: [number, number] = [0, 0];

    if (this.twoPoint) {
      before.down = 0;
      before.distance = 3;
      before.yardLine = RULES.twoPointFrom;
      if (r.touchdown) {
        s.score[off] += 2;
        points[off] = 2;
      }
      this.setKickoff(off, RULES.kickoffFrom);
      this.emit('twoPoint', off, before, 0, { good: r.touchdown }, points, 0, `Two-point try is ${r.touchdown ? 'GOOD!' : 'no good.'}`, who);
      this.afterPlayClock();
      return;
    }

    const seconds = Math.ceil(r.ticks / 60);
    this.runClock(seconds);
    // A flag on the play. The team it helps takes it whenever the penalty beats what the play gave them.
    const flagRoll = Rng.stream(this.seed, `flag:${this.snapN}`).range(0, 1);
    if (!r.turnover && !r.safety && !r.sack && (r.touchdown || r.yards > 0) && flagRoll > 1 - RULES.holdingChance) {
      this.foul('holding', off, -10, before, seconds, `Flag on the play: holding, ${this.teams[off].name}. ${r.touchdown ? 'The touchdown comes back.' : `The ${yds(r.yards)} gain comes back.`} Ten yards, replay the down.`, who);
      return;
    }
    if (r.incomplete && r.thrown && flagRoll > 1 - RULES.interferenceChance) {
      this.foul('interference', off, 15, before, seconds, `Flag on the play: pass interference, ${this.teams[def].name}. Fifteen yards and a first down.`, who, true);
      return;
    }
    const flags: PlayFlags = {};
    let yards = r.yards;
    let text: string;
    const base = r.kind === 'pass'
      ? (r.sack ? `${short(r.passer)} is SACKED by ${short(r.tackler)} for a loss of ${yds(-r.yards)}`
        : r.complete ? `${short(r.passer)} pass to ${short(r.receiver)} for ${r.yards < 0 ? `a loss of ${yds(-r.yards)}` : yds(r.yards)}`
          : `${short(r.passer)} pass ${r.receiver ? `intended for ${short(r.receiver)} ` : ''}falls incomplete`)
      : `${short(r.rusher)} runs for ${r.yards === 0 ? 'no gain' : r.yards < 0 ? `a loss of ${yds(-r.yards)}` : yds(r.yards)}`;
    if (r.sack) flags.sack = true;
    if (r.complete) flags.complete = true;
    if (r.outOfBounds) flags.outOfBounds = true;
    let stop = r.outOfBounds;

    if (r.turnover === 'interception') {
      flags.interception = true;
      yards = 0;
      const touchback = r.endYard >= 100;
      this.firstDownAt(def, touchback ? RULES.touchbackAt : 100 - Math.max(r.endYard, 1));
      text = `${short(r.passer)} pass is INTERCEPTED by ${short(r.tackler)}!`;
      stop = true;
    } else if (r.touchdown) {
      flags.touchdown = true;
      flags.firstDown = true;
      s.score[off] += 6;
      points[off] = 6;
      s.phase = 'conversion';
      s.yardLine = RULES.twoPointFrom;
      text = `${base}. TOUCHDOWN ${this.teams[off].name}!`;
      stop = true;
    } else if (r.safety) {
      flags.safety = true;
      s.score[def] += 2;
      points[def] = 2;
      this.setKickoff(off, RULES.safetyKickFrom);
      text = `${base}. SAFETY!`;
      stop = true;
    } else if (r.turnover === 'fumble') {
      flags.fumbleLost = true;
      this.firstDownAt(def, 100 - clamp(r.endYard, 1, 99));
      text = `${base}. FUMBLE, recovered by ${this.teams[def].name}!`;
      stop = true;
    } else if (r.incomplete) {
      flags.incomplete = true;
      text = `${base}.`;
      stop = true;
      this.advanceDown(off, s.yardLine, flags);
      if (flags.turnoverOnDowns) text += ' Turnover on downs.';
    } else {
      const spot = clamp(r.endYard, 1, 99);
      text = `${base}.`;
      this.advanceDown(off, spot, flags);
      if (flags.firstDown) text += ' First down.';
      if (flags.turnoverOnDowns) {
        text += ' Turnover on downs.';
        stop = true;
      }
    }
    s.clockRunning = !stop && s.phase === 'scrimmage';
    this.emit(r.kind, off, before, yards, flags, points, seconds, text, who);
    this.afterPlayClock();
  }

  private advanceDown(off: 0 | 1, spot: number, flags: PlayFlags): void {
    const s = this.state;
    const gained = spot - s.yardLine;
    if (gained >= s.distance) {
      flags.firstDown = true;
      this.firstDownAt(off, spot);
    } else if (s.down >= 4) {
      flags.turnoverOnDowns = true;
      this.firstDownAt(other(off), 100 - spot);
    } else {
      s.down++;
      s.distance -= gained;
      s.yardLine = spot;
    }
  }
}

/** A stable fingerprint of a finished (or in-progress) game: the score plus every play event. */
export function gameHash(game: Game): string {
  return hashString(JSON.stringify([game.state.score, game.events])).toString(16).padStart(8, '0');
}

/** AI decisions for either sideline. Each team has its own random stream and its own game plan. */
export class AutoCoach {
  private readonly rng: [Rng, Rng];
  readonly plans: [GamePlan, GamePlan];
  constructor(seed: number, plans?: readonly [GamePlan, GamePlan]) {
    this.rng = [Rng.stream(seed, 'coach:0'), Rng.stream(seed, 'coach:1')];
    this.plans = plans ? [{ ...plans[0] }, { ...plans[1] }] : [{ ...DEFAULT_PLAN }, { ...DEFAULT_PLAN }];
  }
  offense(game: Game): OffDecision | null {
    const s = game.state;
    if (s.phase === 'kickoff') return { kind: 'kickoff', style: aiKickoff(s.quarter, s.clock, s.score[s.kicking] - s.score[other(s.kicking)]) };
    const t = s.possession;
    return aiOffense(game.situation(t), game.bookPlays(t), this.rng[t], this.plans[t]);
  }
  defense(game: Game): DefDecision | null {
    if (game.state.phase === 'kickoff') return null;
    const t = other(game.state.possession);
    return aiDefense(game.situation(t), DEFENSE_FRONTS, DEFENSE_SCHEMES, this.rng[t]);
  }
}

/** Plays a whole game with AI coaches on both sides and no rendering. */
export function simulateGame(seed: number, teams: readonly [Team, Team], opts: GameOptions & { plans?: readonly [GamePlan, GamePlan] } = {}): Game {
  const game = new Game(seed, teams, opts);
  const coach = new AutoCoach(seed, opts.plans);
  while (game.state.phase !== 'final') {
    game.begin(coach.offense(game), coach.defense(game));
    while (!game.tick()) { /* step */ }
  }
  return game;
}

/** Re-runs a game from its seed and recorded decisions. */
export function replayGame(seed: number, teams: readonly [Team, Team], log: readonly LoggedDecision[], opts: GameOptions = {}): Game {
  const game = new Game(seed, teams, opts);
  for (const d of log) {
    if (game.state.phase === 'final') break;
    if ('manage' in d) {
      game.manage(d.manage);
      continue;
    }
    game.begin(d.off, d.def);
    while (!game.tick()) { /* step */ }
  }
  return game;
}
