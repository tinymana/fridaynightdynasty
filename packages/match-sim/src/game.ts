import {
  DEFENSE_CALLS, OFFENSE_PLAYS, RULES, Rng, callById, clamp, hashString, playById,
  type DefDecision, type OffDecision, type PlayEvent, type PlayFlags, type PlayType, type Player, type Situation, type Team,
} from '@fnd/core';
import { aiDefense, aiOffense, fieldGoalDistance } from '@fnd/football-ai';
import { PlaySim, type PlayResult } from './play';
import { fieldGoalChance, patChance, resolveKickoff, resolvePunt } from './special';

/** Game rules: downs, clock, scoring, possession. Turns coaching decisions into play events. */

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

export interface LoggedDecision {
  off: OffDecision | null;
  def: DefDecision | null;
}

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
  live: PlaySim | null = null;
  lastEvent: PlayEvent | null = null;
  /** Set when a timeout was used on the most recent `begin`. */
  lastTimeoutBy: 0 | 1 | null = null;

  private instant = false;
  private twoPoint = false;
  private calls: { off?: string; def?: string } = {};
  private lastSnap: { offense: 0 | 1; los: number; n: number } | null = null;

  constructor(readonly seed: number, readonly teams: readonly [Team, Team]) {
    const receiver = Rng.stream(seed, 'toss').int(0, 1) as 0 | 1;
    this.state = {
      quarter: 1, clock: RULES.quarterSeconds, score: [0, 0], possession: receiver, down: 1, distance: 10, yardLine: 20,
      phase: 'kickoff', kicking: other(receiver), kickFrom: RULES.kickoffFrom,
      timeouts: [RULES.timeoutsPerHalf, RULES.timeoutsPerHalf], clockRunning: false, openingReceiver: receiver,
    };
  }

  /** Which team is on offense (or kicking off) for the next decision. */
  get offense(): 0 | 1 {
    return this.state.phase === 'kickoff' ? this.state.kicking : this.state.possession;
  }

  situation(team: 0 | 1): Situation {
    const s = this.state;
    return {
      phase: s.phase === 'conversion' ? 'conversion' : 'scrimmage',
      quarter: s.quarter, clock: s.clock, down: s.down, distance: s.distance, yardLine: s.yardLine,
      scoreDiff: s.score[team] - s.score[other(team)], timeouts: s.timeouts[team], clockRunning: s.clockRunning,
      kicking: this.teams[team].kicker.ratings.kicking,
    };
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
    this.instant = false;
    this.twoPoint = false;
    this.calls = {};

    if (s.phase === 'kickoff') {
      this.kickoff(Rng.stream(this.seed, `special:${n}`));
      this.instant = true;
      return;
    }
    if (!off) throw new Error('offense decision required');
    const offTeam = s.possession;

    if (s.phase === 'scrimmage' && s.clockRunning) {
      if (off.kind !== 'patKick' && off.timeout && s.timeouts[offTeam] > 0) {
        s.timeouts[offTeam]--;
        this.lastTimeoutBy = offTeam;
      } else if (def?.timeout && s.timeouts[other(offTeam)] > 0) {
        s.timeouts[other(offTeam)]--;
        this.lastTimeoutBy = other(offTeam);
      } else {
        s.clock -= RULES.runoffSeconds;
        if (s.clock <= 0) {
          this.endQuarter();
          if (s.phase !== 'scrimmage') {
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
      this.punt(Rng.stream(this.seed, `special:${n}`));
      this.instant = true;
      return;
    } else if (off.kind === 'fieldGoal') {
      this.fieldGoal(Rng.stream(this.seed, `special:${n}`));
      this.instant = true;
      return;
    }
    if (off.kind !== 'play') throw new Error(`invalid offensive decision ${off.kind}`);
    if (!def) throw new Error('defense decision required');
    this.calls = { off: off.playId, def: def.callId };
    this.lastSnap = { offense: offTeam, los: this.twoPoint ? RULES.twoPointFrom : s.yardLine, n };
    this.live = new PlaySim({
      offense: this.teams[offTeam], defense: this.teams[other(offTeam)],
      play: playById(off.playId), call: callById(def.callId),
      los: this.twoPoint ? RULES.twoPointFrom : s.yardLine,
      rng: Rng.stream(this.seed, `play:${n}`),
    });
  }

  /** A fresh copy of the most recent scrimmage play, for instant replay. It reproduces the play exactly. */
  replayLast(): { sim: PlaySim; offense: 0 | 1 } | null {
    const snap = this.lastSnap;
    if (!snap || !this.calls.off || !this.calls.def) return null;
    const sim = new PlaySim({
      offense: this.teams[snap.offense], defense: this.teams[other(snap.offense)],
      play: playById(this.calls.off), call: callById(this.calls.def), los: snap.los,
      rng: Rng.stream(this.seed, `play:${snap.n}`),
    });
    return { sim, offense: snap.offense };
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
    if (this.lastEvent === null && this.live.result) this.applyPlay(this.live.result);
    return true;
  }

  // ------------------------------------------------------------- internals

  private emit(type: PlayType, offense: 0 | 1, before: { down: number; distance: number; yardLine: number; quarter: number; clock: number },
    yards: number, flags: PlayFlags, points: [number, number], seconds: number, text: string, who: Partial<PlayEvent> = {}): void {
    const e: PlayEvent = {
      seq: this.events.length + 1, quarter: before.quarter, clock: before.clock, offense,
      down: before.down, distance: before.distance, yardLine: before.yardLine, type,
      offCall: this.calls.off, defCall: this.calls.def, yards, flags, points,
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
      s.clock = RULES.quarterSeconds;
      s.timeouts = [RULES.timeoutsPerHalf, RULES.timeoutsPerHalf];
      this.setKickoff(s.openingReceiver, RULES.kickoffFrom);
    } else if (s.quarter >= RULES.quarters) {
      s.clock = 0;
      s.phase = 'final';
    } else {
      s.quarter++;
      s.clock = RULES.quarterSeconds;
    }
  }

  private afterPlayClock(): void {
    const s = this.state;
    if (s.clock <= 0 && s.phase !== 'conversion' && s.phase !== 'final') this.endQuarter();
  }

  private kickoff(rng: Rng): void {
    const s = this.state;
    const before = { down: 0, distance: 0, yardLine: s.kickFrom, quarter: s.quarter, clock: s.clock };
    const kick = s.kicking;
    const recv = other(kick);
    const kicker = this.teams[kick].kicker;
    const returner = this.teams[recv].offense.WR3;
    const r = resolveKickoff(rng, kicker, returner, s.kickFrom);
    this.runClock(r.touchback ? 0 : 6);
    const points: [number, number] = [0, 0];
    let text: string;
    if (r.touchdown) {
      s.score[recv] += 6;
      points[recv] = 6;
      s.possession = recv;
      s.phase = 'conversion';
      s.yardLine = RULES.twoPointFrom;
      text = `Kickoff returned ${yds(r.returnYards)} by ${short(returner)} for a TOUCHDOWN!`;
    } else {
      this.firstDownAt(recv, r.startYard);
      text = r.touchback ? `${short(kicker)} kicks off. Touchback.` : `${short(kicker)} kicks off. ${short(returner)} returns it ${yds(r.returnYards)}.`;
    }
    s.clockRunning = false;
    this.emit('kickoff', kick, before, r.kickYards, { touchback: r.touchback, touchdown: r.touchdown }, points, r.touchback ? 0 : 6, text,
      { kicker: kicker.id, receiver: returner.id });
    this.afterPlayClock();
  }

  private punt(rng: Rng): void {
    const s = this.state;
    const before = this.snapshot();
    const off = s.possession;
    const punter = this.teams[off].punter;
    const r = resolvePunt(rng, punter, s.yardLine);
    this.runClock(8);
    this.firstDownAt(other(off), r.startYard);
    s.clockRunning = false;
    const text = r.touchback ? `${short(punter)} punts into the end zone. Touchback.`
      : `${short(punter)} punts ${yds(r.grossYards)}${r.returnYards ? `, returned ${yds(r.returnYards)}` : ', fair catch'}.`;
    this.emit('punt', off, before, r.grossYards, { touchback: r.touchback }, [0, 0], 8, text, { kicker: punter.id });
    this.afterPlayClock();
  }

  private fieldGoal(rng: Rng): void {
    const s = this.state;
    const before = this.snapshot();
    const off = s.possession;
    const kicker = this.teams[off].kicker;
    const d = fieldGoalDistance(s.yardLine);
    const good = rng.chance(fieldGoalChance(kicker, s.yardLine));
    this.runClock(5);
    const points: [number, number] = [0, 0];
    if (good) {
      s.score[off] += 3;
      points[off] = 3;
      this.setKickoff(off, RULES.kickoffFrom);
    } else {
      this.firstDownAt(other(off), Math.max(RULES.touchbackAt, 100 - s.yardLine));
      s.clockRunning = false;
    }
    this.emit('fieldGoal', off, before, d, { good }, points, 5, `${short(kicker)} ${d}-yard field goal is ${good ? 'GOOD!' : 'no good.'}`, { kicker: kicker.id });
    this.afterPlayClock();
  }

  private pat(rng: Rng): void {
    const s = this.state;
    const before = this.snapshot();
    const off = s.possession;
    const kicker = this.teams[off].kicker;
    const good = rng.chance(patChance(kicker));
    const points: [number, number] = [0, 0];
    if (good) {
      s.score[off] += 1;
      points[off] = 1;
    }
    this.setKickoff(off, RULES.kickoffFrom);
    this.emit('pat', off, before, 0, { good }, points, 0, `Extra point by ${short(kicker)} is ${good ? 'good.' : 'NO GOOD.'}`, { kicker: kicker.id });
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

/** AI decisions for whichever sides are passed in `sides`. Each side has its own random stream. */
export class AutoCoach {
  private readonly rng: [Rng, Rng];
  constructor(seed: number) {
    this.rng = [Rng.stream(seed, 'coach:0'), Rng.stream(seed, 'coach:1')];
  }
  offense(game: Game): OffDecision | null {
    if (game.state.phase === 'kickoff') return null;
    const t = game.state.possession;
    return aiOffense(game.situation(t), OFFENSE_PLAYS, this.rng[t]);
  }
  defense(game: Game): DefDecision | null {
    if (game.state.phase === 'kickoff') return null;
    const t = other(game.state.possession);
    return aiDefense(game.situation(t), DEFENSE_CALLS, this.rng[t]);
  }
}

/** Plays a whole game with AI coaches on both sides and no rendering. */
export function simulateGame(seed: number, teams: readonly [Team, Team]): Game {
  const game = new Game(seed, teams);
  const coach = new AutoCoach(seed);
  while (game.state.phase !== 'final') {
    game.begin(coach.offense(game), coach.defense(game));
    while (!game.tick()) { /* step */ }
  }
  return game;
}

/** Re-runs a game from its seed and recorded decisions. */
export function replayGame(seed: number, teams: readonly [Team, Team], log: readonly LoggedDecision[]): Game {
  const game = new Game(seed, teams);
  for (const d of log) {
    if (game.state.phase === 'final') break;
    game.begin(d.off, d.def);
    while (!game.tick()) { /* step */ }
  }
  return game;
}
