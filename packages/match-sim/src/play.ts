import {
  FIELD_W, U, clamp, defAssignment, dist, yd,
  type DefAssign, type DefFront, type DefScheme, type OffAssign, type OffFormation, type OffPlay, type Player, type Rng,
} from '@fnd/core';
import { carrierTarget, contestDistance, matchCoverage, qbRead, type CoverDefender, type CoverReceiver, type FieldDefender, type ReadReceiver } from '@fnd/football-ai';

/**
 * One scrimmage play, simulated on a fixed 60 Hz step with integer positions.
 * The offense always attacks +x. x is measured from the offense's own goal line.
 */

const CY = FIELD_W >> 1;
const MAX_TICKS = 900;

export interface SimPlayer {
  idx: number;
  side: 0 | 1;
  pos: string;
  player: Player;
  x: number;
  y: number;
  px: number;
  py: number;
  sx: number;
  sy: number;
  spd: number;
  /** Index of the player this one is locked up with, or -1. */
  engaged: number;
  beatenUntil: number;
  stunUntil: number;
  stumbleUntil: number;
  tackleCd: number;
  wp: number;
  mode: 'off' | 'rush' | 'man' | 'zone' | 'read' | 'pursue';
  manIdx: number;
  cushion: number;
  /** Where the defender ends up relative to his man once the cushion is gone. Negative means he trails. */
  cushionFloor: number;
  zx: number;
  zy: number;
  deep: boolean;
  lag: number;
  recog: number;
  /** Distance covered this play, in field units. Drives fatigue. */
  moved: number;
  /** Heavy contact this play: carried the ball, made or took a tackle. */
  contact: boolean;
}

export interface Ball {
  state: 'held' | 'air' | 'dead';
  holder: number;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  T: number;
}

export interface PlayResult {
  kind: 'run' | 'pass';
  endYard: number;
  yards: number;
  touchdown: boolean;
  safety: boolean;
  turnover: 'interception' | 'fumble' | null;
  complete: boolean;
  incomplete: boolean;
  thrown: boolean;
  sack: boolean;
  outOfBounds: boolean;
  passer?: Player;
  rusher?: Player;
  receiver?: Player;
  tackler?: Player;
  ticks: number;
}

export interface PlayContext {
  play: OffPlay;
  formation: OffFormation;
  front: DefFront;
  scheme: DefScheme;
  /** The eleven on the field, in the order of the formation's and the front's slots. */
  offPlayers: readonly Player[];
  defPlayers: readonly Player[];
  /** Energy 0 to 100 for each of those players. Tired players are slower. */
  offEnergy: readonly number[];
  defEnergy: readonly number[];
  /** Line of scrimmage, yards from the offense's own goal line (1 to 99). */
  los: number;
  rng: Rng;
}

const BLOCK: OffAssign = { t: 'block' };

/** Top speed in field units per tick. A fully tired player loses 15 percent. */
export const speedOf = (p: Player, energy = 100): number =>
  Math.round(((5.2 + p.ratings.speed * 0.04) * U * (85 + (15 * clamp(energy, 0, 100)) / 100)) / 6000);

export class PlaySim {
  readonly players: SimPlayer[] = [];
  readonly ball: Ball;
  readonly los: number;
  readonly losYard: number;
  tick = 0;
  done = false;
  result: PlayResult | null = null;

  private readonly play: OffPlay;
  private readonly scheme: DefScheme;
  private readonly rng: Rng;
  private readonly assigns: OffAssign[] = [];
  private readonly qbIdx: number;
  private readonly carrierIdx: number;
  private readonly hx: number[][] = [];
  private readonly hy: number[][] = [];
  private readonly qb: SimPlayer;
  /** +1 when the defensive call guessed the play type, -1 when it guessed wrong, else 0. */
  private readonly edge: number;
  private thrown = false;
  private throwTick = 0;
  private hurried = false;
  private target = -1;
  private targetSettled = false;
  private caught = false;
  private catchTick = 0;
  private handedOff = false;
  private readEvery: number;

  constructor(ctx: PlayContext) {
    this.play = ctx.play;
    this.scheme = ctx.scheme;
    this.rng = ctx.rng;
    this.losYard = ctx.los;
    this.los = yd(ctx.los);

    ctx.formation.slots.forEach((slot, i) => {
      this.assigns.push(ctx.play.assign[slot.id] ?? BLOCK);
      this.players.push(this.makePlayer(i, 0, slot.id, ctx.offPlayers[i], ctx.offEnergy[i], this.los + yd(slot.at[0]), CY + yd(slot.at[1])));
    });
    this.qbIdx = ctx.formation.slots.findIndex((x) => x.id === 'QB');
    this.carrierIdx = this.assigns.findIndex((a) => a.t === 'carry');

    const manDefenders: CoverDefender[] = [];
    ctx.front.slots.forEach((slot, i) => {
      const p = this.makePlayer(11 + i, 1, slot.id, ctx.defPlayers[i], ctx.defEnergy[i], Math.min(this.los + yd(slot.at[0]), yd(109)), CY + yd(slot.at[1]));
      const a = defAssignment(slot, ctx.scheme.id);
      this.assignDefender(p, a);
      if (a.t === 'man') manDefenders.push({ idx: p.idx, x: p.x, y: p.y, role: slot.role });
      this.players.push(p);
    });

    // Man coverage is matched to the formation in front of it, and defensive backs line up over their man.
    const receivers: CoverReceiver[] = [];
    ctx.formation.slots.forEach((slot, i) => {
      if (slot.group === 'WR' || slot.group === 'TE' || slot.group === 'RB') receivers.push({ idx: i, x: this.players[i].x, y: this.players[i].y, group: slot.group });
    });
    const pairs = matchCoverage(receivers, manDefenders);
    for (const md of manDefenders) {
      const dP = this.players[md.idx];
      const r = pairs.get(md.idx);
      if (r === undefined) {
        dP.mode = 'read';
        continue;
      }
      dP.manIdx = r;
      if (md.role === 'CB' || md.role === 'NB') {
        dP.y = this.players[r].y;
        dP.py = dP.sy = dP.y;
      }
    }

    for (let i = 0; i < 11; i++) {
      this.hx.push([this.players[i].x]);
      this.hy.push([this.players[i].y]);
    }
    this.qb = this.players[this.qbIdx];
    this.ball = { state: 'held', holder: this.qbIdx, x: this.qb.x, y: this.qb.y, fromX: 0, fromY: 0, toX: 0, toY: 0, t: 0, T: 0 };
    if (ctx.play.kind === 'run' && this.carrierIdx === this.qbIdx) this.handedOff = true;

    const pk = ctx.play.kind;
    const ck = ctx.scheme.kind;
    this.edge = ck === pk ? 1 : (ck === 'run' && pk === 'pass') || (ck === 'pass' && pk === 'run') ? -1 : 0;
    this.readEvery = 5 + Math.trunc((100 - this.qb.player.ratings.awareness) / 12);
  }

  private makePlayer(idx: number, side: 0 | 1, pos: string, player: Player, energy: number, x: number, y: number): SimPlayer {
    return {
      idx, side, pos, player, x, y, px: x, py: y, sx: x, sy: y, spd: speedOf(player, energy),
      engaged: -1, beatenUntil: 0, stunUntil: 0, stumbleUntil: 0, tackleCd: 0, wp: 0,
      mode: 'off', manIdx: -1, cushion: 0, cushionFloor: 0, zx: x, zy: y, deep: false, lag: 0, recog: 0, moved: 0, contact: false,
    };
  }

  private assignDefender(p: SimPlayer, a: DefAssign): void {
    const r = p.player.ratings;
    const kindDelay = { run: 0, balanced: 16, blitz: 16, pass: 24 }[this.scheme.kind];
    p.recog = kindDelay + Math.trunc((100 - r.awareness) / 5);
    p.lag = clamp(8 + Math.trunc((100 - r.coverage) / 8), 4, 24);
    p.mode = a.t;
    if (a.t === 'man') {
      p.cushion = yd(a.cushion);
      p.cushionFloor = yd(this.rng.range(-1.6, 1.4) + (r.coverage - 60) * 0.03);
    } else if (a.t === 'zone') {
      p.zx = Math.min(this.los + yd(a.at[0]), yd(108));
      p.zy = CY + yd(a.at[1]);
      p.deep = a.at[0] >= 12;
    }
  }

  // ---------------------------------------------------------------- stepping

  step(): void {
    if (this.done) return;
    this.tick++;
    const P = this.players;
    for (const p of P) {
      p.px = p.x;
      p.py = p.y;
    }

    for (let i = 0; i < 11; i++) this.moveOffense(P[i]);
    for (let i = 0; i < 11; i++) {
      this.hx[i].push(P[i].x);
      this.hy[i].push(P[i].y);
    }

    this.ballLogic();
    if (this.done) return;

    for (let i = 11; i < 22; i++) this.moveDefense(P[i]);
    this.engagements();
    this.tackles();
    if (this.done) return;

    if (this.ball.state === 'held') {
      const c = P[this.ball.holder];
      this.ball.x = c.x;
      this.ball.y = c.y;
      if (c.x >= yd(100)) return this.finish(c, null, { touchdown: true });
      if (c.y <= 0 || c.y >= FIELD_W) return this.finish(c, null, { outOfBounds: true });
    }
    if (this.tick >= MAX_TICKS) {
      if (this.ball.state === 'held') this.finish(P[this.ball.holder], null, {});
      else this.finishIncomplete();
    }
  }

  private moveTo(p: SimPlayer, tx: number, ty: number, spd: number, stop = 0): boolean {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = dist(tx, ty, p.x, p.y);
    if (d <= stop) return true;
    if (d <= spd) {
      p.x = tx;
      p.y = ty;
      p.moved += d;
      return true;
    }
    p.x += Math.trunc((dx * spd) / d);
    p.y += Math.trunc((dy * spd) / d);
    p.moved += spd;
    return false;
  }

  private get passPro(): boolean {
    return this.play.kind === 'pass' && !this.caught;
  }

  private defenderView(): FieldDefender[] {
    const out: FieldDefender[] = [];
    for (let i = 11; i < 22; i++) {
      const d = this.players[i];
      out.push({ x: d.x, y: d.y, engaged: d.engaged >= 0, out: this.tick < d.stunUntil });
    }
    return out;
  }

  // ----------------------------------------------------------------- offense

  private moveOffense(o: SimPlayer): void {
    const P = this.players;
    if (o.engaged >= 0) {
      const d = P[o.engaged];
      this.moveTo(o, d.x, d.y, o.spd, yd(0.6));
      return;
    }
    const a: OffAssign = this.assigns[o.idx];
    const holding = this.ball.state === 'held' && this.ball.holder === o.idx;

    if (a.t === 'qb') {
      if (this.play.kind === 'pass' && !this.thrown) {
        this.moveTo(o, o.sx - yd(this.play.dropDepth ?? 3), o.sy, Math.trunc((o.spd * 85) / 100));
      }
      return;
    }
    if (holding) return this.moveCarrier(o, a);
    if (a.t === 'lead' && o.wp < a.pts.length && !this.defenderNear(o, yd(3))) {
      this.followCarry(o, a.pts, o.spd);
      return;
    }
    if (a.t === 'carry') {
      if (!this.handedOff) this.followCarry(o, a.pts, o.spd);
      return;
    }
    if (a.t === 'route' && !this.caught) {
      if (this.ball.state === 'air' && this.target === o.idx) {
        this.moveTo(o, this.ball.toX, this.ball.toY, o.spd);
        return;
      }
      this.runRoute(o, a);
      return;
    }
    this.block(o);
  }

  private defenderNear(o: SimPlayer, radius: number): boolean {
    for (let i = 11; i < 22; i++) {
      const d = this.players[i];
      if (d.engaged < 0 && this.tick >= d.stunUntil && dist(o.x, o.y, d.x, d.y) < radius) return true;
    }
    return false;
  }

  private followCarry(o: SimPlayer, pts: readonly (readonly [number, number])[], spd: number): boolean {
    if (o.wp >= pts.length) return false;
    const [dx, dy] = pts[o.wp];
    if (this.moveTo(o, this.los + yd(dx), CY + yd(dy), spd, yd(0.25))) o.wp++;
    return true;
  }

  private moveCarrier(o: SimPlayer, a: OffAssign): void {
    let spd = Math.trunc((o.spd * (this.play.kind === 'run' ? 93 : 86)) / 100);
    if (this.tick < o.stumbleUntil) spd = Math.trunc((spd * 55) / 100);
    if (a.t === 'carry' && this.followCarry(o, a.pts, spd)) return;
    const t = carrierTarget(o, this.defenderView());
    this.moveTo(o, t.x, t.y, spd);
  }

  private runRoute(o: SimPlayer, a: { pts: readonly (readonly [number, number])[]; go?: boolean }): void {
    if (o.wp < a.pts.length) {
      const [dx, dy] = a.pts[o.wp];
      if (this.moveTo(o, o.sx + yd(dx), clamp(o.sy + yd(dy), U, FIELD_W - U), o.spd, yd(0.2))) o.wp++;
      return;
    }
    if (!a.go) return;
    const last = a.pts[a.pts.length - 1];
    const prev = a.pts.length > 1 ? a.pts[a.pts.length - 2] : ([0, 0] as const);
    const tx = clamp(o.x + yd(last[0] - prev[0]) * 4, 0, yd(108));
    const ty = clamp(o.y + yd(last[1] - prev[1]) * 4, yd(1.5), FIELD_W - yd(1.5));
    this.moveTo(o, tx, ty, o.spd);
  }

  private block(o: SimPlayer): void {
    if (this.tick < o.beatenUntil) return;
    const P = this.players;
    const passPro = this.passPro;
    let best = -1;
    let bd = yd(passPro ? 6 : 8);
    for (let i = 11; i < 22; i++) {
      const d = P[i];
      if (d.engaged >= 0 || this.tick < d.stunUntil) continue;
      if (passPro && d.mode !== 'rush') continue;
      const dd = dist(o.x, o.y, d.x, d.y);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    if (best >= 0) {
      this.moveTo(o, P[best].x, P[best].y, o.spd, yd(0.5));
    } else if (passPro) {
      this.moveTo(o, o.sx - yd(1.2), o.sy, o.spd);
    } else {
      const lead = this.ball.state === 'held' ? P[this.ball.holder].x + yd(8) : o.x;
      if (o.x < lead) this.moveTo(o, o.x + yd(4), o.y, o.spd);
    }
  }

  // -------------------------------------------------------------------- ball

  private ballLogic(): void {
    const P = this.players;
    const b = this.ball;
    if (this.play.kind === 'run') {
      if (!this.handedOff && this.tick >= (this.play.handoffTick ?? 24)) {
        this.handedOff = true;
        b.holder = this.carrierIdx >= 0 ? this.carrierIdx : this.qbIdx;
      }
      return;
    }
    if (b.state === 'air') {
      b.t++;
      b.x = b.fromX + Math.trunc(((b.toX - b.fromX) * b.t) / b.T);
      b.y = b.fromY + Math.trunc(((b.toY - b.fromY) * b.t) / b.T);
      if (b.t >= b.T) this.resolveCatch();
      return;
    }
    if (this.thrown || b.state !== 'held') return;

    const start = this.play.readStart ?? 60;
    const elapsed = this.tick - start;
    let pressure = false;
    for (let i = 11; i < 22; i++) {
      const d = P[i];
      if (d.engaged < 0 && this.tick >= d.stunUntil && dist(d.x, d.y, this.qb.x, this.qb.y) < yd(1.9)) pressure = true;
    }
    const forced = this.hurried || pressure || elapsed >= 150;
    if (elapsed < 0 && !this.hurried && !(pressure && this.tick > 24)) return;
    if (!this.hurried && elapsed % this.readEvery !== 0) return;

    const receivers: ReadReceiver[] = [];
    for (let i = 0; i < 11; i++) {
      const o = P[i];
      const a = this.assigns[o.idx];
      if (a.t === 'route' && o.engaged < 0) receivers.push({ idx: i, x: o.x, y: o.y, settled: this.settled(o) });
    }
    const maxThrow = 22 + this.qb.player.ratings.throwPower * 0.3;
    const choice = qbRead(this.qb, receivers, this.defenderView(), this.los, Math.max(0, elapsed), forced, maxThrow);
    if (choice === -1) return;
    this.throwBall(choice);
  }

  private settled(o: SimPlayer): boolean {
    return (o.x - o.px) * 2 < o.spd;
  }

  private throwBall(targetIdx: number): void {
    const P = this.players;
    const b = this.ball;
    const q = this.qb.player.ratings;
    const ballSpd = Math.round(((17 + q.throwPower * 0.09) * U) / 60);
    this.thrown = true;
    this.throwTick = this.tick;
    b.state = 'air';
    b.fromX = this.qb.x;
    b.fromY = this.qb.y;
    b.t = 0;
    if (targetIdx < 0) {
      this.target = -1;
      b.toX = this.qb.x + yd(10);
      b.toY = this.qb.y < CY ? -yd(2) : FIELD_W + yd(2);
      b.T = 36;
      return;
    }
    const r = P[targetIdx];
    this.target = targetIdx;
    this.targetSettled = this.settled(r);
    // The quarterback knows the route: lead the receiver to where the route takes him.
    const route = this.assigns[r.idx];
    let ax = r.x;
    let ay = r.y;
    let T = 1;
    for (let i = 0; i < 3; i++) {
      T = Math.max(6, Math.trunc(dist(this.qb.x, this.qb.y, ax, ay) / ballSpd));
      const ghost = { ...r };
      if (route.t === 'route') for (let k = 0; k < T; k++) this.runRoute(ghost, route);
      ax = ghost.x;
      ay = ghost.y;
    }
    const d = dist(this.qb.x, this.qb.y, ax, ay);
    const deep = Math.max(0, d - yd(18));
    const err = Math.trunc(d * (0.03 + ((100 - q.throwAccuracy) / 100) * 0.13) + deep * 0.14) + (this.hurried ? yd(1.4) : 0);
    ax += Math.trunc(this.rng.range(-err, err));
    ay += Math.trunc(this.rng.range(-err, err));
    b.toX = clamp(ax, yd(-8), yd(112));
    b.toY = clamp(ay, -yd(3), FIELD_W + yd(3));
    b.T = T;
  }

  private resolveCatch(): void {
    const P = this.players;
    const b = this.ball;
    if (this.target < 0 || b.toX > yd(110) || b.toX < yd(-10) || b.toY < 0 || b.toY > FIELD_W) return this.finishIncomplete();
    const r = P[this.target];
    const dR = dist(r.x, r.y, b.toX, b.toY) / U;
    const wasSettled = this.targetSettled;
    let nearest: SimPlayer | null = null;
    let dD = 99;
    for (let i = 11; i < 22; i++) {
      const d = P[i];
      if (this.tick < d.stunUntil || d.engaged >= 0) continue;
      const dd = contestDistance(dist(d.x, d.y, b.toX, b.toY), d.x - b.toX, wasSettled) / U;
      if (dd < dD) {
        dD = dd;
        nearest = d;
      }
    }
    const cov = nearest ? nearest.player.ratings.coverage : 0;
    const blitzCov = this.scheme.kind === 'blitz' ? -0.04 : 0;
    let pInt = 0;
    if (nearest && dD < 1.6) pInt = ((1.6 - dD) / 1.6) * (0.02 + cov * 0.0006 + 0.02 * this.edge);
    if (nearest && dR > 2 && dD < 1) pInt = 0.15;
    const throwDist = dist(b.fromX, b.fromY, b.toX, b.toY) / U;
    let pCatch = 0.6 + r.player.ratings.hands * 0.0033 - dR * 0.09;
    if (dD < 2.2) pCatch -= (2.2 - dD) * (0.1 + cov * 0.0012 + blitzCov) * (1 + 0.25 * this.edge);
    if (throwDist > 25) pCatch -= (throwDist - 25) * 0.006;
    if (dR > 2) pCatch = 0;
    pCatch = clamp(pCatch, 0, 0.97);

    const intercepted = this.rng.chance(clamp(pInt, 0, 0.5));
    const caught = this.rng.chance(pCatch);
    if (intercepted && nearest) {
      this.end({
        kind: 'pass', endYard: clamp(Math.floor(nearest.x / U), -9, 109), yards: 0, touchdown: false, safety: false,
        turnover: 'interception', complete: false, incomplete: false, thrown: true, sack: false, outOfBounds: false,
        passer: this.qb.player, receiver: r.player, tackler: nearest.player, ticks: this.tick,
      });
      return;
    }
    if (!caught) return this.finishIncomplete();
    this.caught = true;
    this.catchTick = this.tick;
    b.state = 'held';
    b.holder = r.idx;
    r.x = clamp(b.toX, yd(-9), yd(109));
    r.y = clamp(b.toY, 1, FIELD_W - 1);
    r.stumbleUntil = this.tick + 20;
    for (let i = 11; i < 22; i++) {
      const d = P[i];
      d.recog = 4 + Math.trunc((100 - d.player.ratings.awareness) / 12);
    }
    if (r.x >= yd(100)) this.finish(r, null, { touchdown: true });
  }

  // ----------------------------------------------------------------- defense

  private moveDefense(d: SimPlayer): void {
    if (this.tick < d.stunUntil) return;
    const P = this.players;
    const b = this.ball;
    const carrier = b.state === 'held' ? P[b.holder] : null;
    const runLive = this.play.kind === 'run' && this.handedOff;

    if (d.mode !== 'rush' && d.mode !== 'pursue') {
      if (runLive && this.tick >= (this.play.handoffTick ?? 24) + d.recog) d.mode = 'pursue';
      else if (this.caught && this.tick >= this.catchTick + d.recog) d.mode = 'pursue';
    }

    let tx = d.x;
    let ty = d.y;
    if (b.state === 'air') {
      const breaking = d.mode === 'rush' || d.mode === 'pursue' ||
        (this.tick >= this.throwTick + 6 + Math.trunc(d.lag / 2) && dist(d.x, d.y, b.toX, b.toY) < yd(7));
      if (d.mode === 'man' && d.manIdx === this.target) [tx, ty] = this.manSpot(d);
      else if (breaking) {
        tx = b.toX;
        ty = b.toY;
      } else [tx, ty] = this.coverSpot(d);
    } else if (carrier && (d.mode === 'rush' || d.mode === 'pursue')) {
      const dd = dist(d.x, d.y, carrier.x, carrier.y);
      const lead = Math.min(24, Math.trunc(dd / (d.spd * 2)));
      tx = carrier.x + (carrier.x - carrier.px) * lead;
      ty = carrier.y + (carrier.y - carrier.py) * lead;
    } else {
      [tx, ty] = this.coverSpot(d);
    }

    let spd = d.spd;
    if (d.engaged >= 0) {
      spd = Math.trunc((spd * (this.passPro ? 24 : 10)) / 100);
      if (!this.passPro) {
        const push = clamp(5 + Math.trunc((P[d.engaged].player.ratings.runBlock - d.player.ratings.power) / 8), 0, 9);
        d.x = Math.min(d.x + push, yd(109));
      }
    }
    this.moveTo(d, tx, clamp(ty, 0, FIELD_W), spd);
  }

  private lagged(idx: number, lag: number): [number, number] {
    const t = Math.max(0, this.tick - lag);
    const t0 = Math.max(0, t - 1);
    const x = this.hx[idx][t];
    const y = this.hy[idx][t];
    return [x + (x - this.hx[idx][t0]) * lag, y + (y - this.hy[idx][t0]) * lag];
  }

  private manSpot(d: SimPlayer): [number, number] {
    const lag = Math.max(2, d.lag - 4 * this.edge + (this.scheme.kind === 'blitz' ? 2 : 0));
    const [x, y] = this.lagged(d.manIdx, lag);
    const cushion = Math.max(d.cushionFloor + yd(0.4) * this.edge, d.cushion - Math.trunc((this.tick * U) / 24));
    return [Math.max(x + cushion, this.los + yd(1)), y];
  }

  private coverSpot(d: SimPlayer): [number, number] {
    if (d.mode === 'man') return this.manSpot(d);
    const P = this.players;
    const zx = d.mode === 'zone' ? d.zx : d.sx;
    const zy = d.mode === 'zone' ? d.zy : d.sy;
    let pick = -1;
    let best = d.deep ? -1e9 : yd(10);
    for (let i = 0; i < 11; i++) {
      const o = P[i];
      const a = this.assigns[o.idx];
      if (a.t !== 'route') continue;
      if (d.deep) {
        if (Math.abs(o.y - zy) < yd(13) && o.x > zx - yd(7) && o.x > best) {
          best = o.x;
          pick = i;
        }
      } else {
        const dd = dist(o.x, o.y, zx, zy);
        if (dd < best) {
          best = dd;
          pick = i;
        }
      }
    }
    if (pick < 0) return [zx, zy];
    const [x, y] = this.lagged(pick, Math.max(2, d.lag + 4 - 4 * this.edge));
    return d.deep ? [Math.max(zx, x + yd(2.5)), y] : [x + yd(0.8), y];
  }

  // --------------------------------------------------------------- contact

  private isBlocking(o: SimPlayer): boolean {
    if (o.engaged >= 0 || this.tick < o.beatenUntil) return false;
    if (this.ball.state === 'held' && this.ball.holder === o.idx) return false;
    const a = this.assigns[o.idx];
    if (a.t === 'block' || a.t === 'lead') return true;
    if (a.t === 'route') return this.caught;
    return false;
  }

  private engagements(): void {
    const P = this.players;
    const passPro = this.passPro;
    for (let i = 0; i < 11; i++) {
      const o = P[i];
      if (!this.isBlocking(o)) continue;
      for (let j = 11; j < 22; j++) {
        const d = P[j];
        if (d.engaged >= 0 || this.tick < d.stunUntil) continue;
        if (passPro && d.mode !== 'rush') continue;
        if (dist(o.x, o.y, d.x, d.y) < yd(1.0)) {
          o.engaged = j;
          d.engaged = i;
          break;
        }
      }
    }
    const carrier = this.ball.state === 'held' ? P[this.ball.holder] : null;
    for (let j = 11; j < 22; j++) {
      const d = P[j];
      if (d.engaged < 0 || (this.tick + j) % 10 !== 0) continue;
      const bl = P[d.engaged];
      const dr = d.player.ratings;
      const br = bl.player.ratings;
      let p: number;
      if (passPro) {
        p = 0.074 + (((dr.power + dr.agility) / 2 - br.passBlock) / 100) * 0.12 + (this.scheme.kind === 'blitz' ? 0.02 : 0);
      } else {
        p = 0.022 + (((dr.tackling + dr.power) / 2 - br.runBlock) / 100) * 0.1;
        if (carrier && dist(carrier.x, carrier.y, d.x, d.y) < yd(3)) p *= 1.5;
      }
      p = clamp(p + 0.03 * this.edge, 0.02, 0.5);
      if (this.rng.chance(p)) {
        d.engaged = -1;
        bl.engaged = -1;
        bl.beatenUntil = this.tick + 90;
      }
    }
  }

  private tackles(): void {
    if (this.ball.state !== 'held') return;
    const P = this.players;
    const c = P[this.ball.holder];
    const inPocket = this.play.kind === 'pass' && !this.thrown && c.idx === this.qbIdx;
    for (let j = 11; j < 22; j++) {
      const d = P[j];
      if (this.tick < d.stunUntil || this.tick < d.tackleCd) continue;
      const reach = d.engaged >= 0 ? yd(0.6) : yd(1.4);
      if (dist(c.x, c.y, d.x, d.y) > reach) continue;
      d.tackleCd = this.tick + 30;
      d.contact = true;
      c.contact = true;
      const dr = d.player.ratings;
      const cr = c.player.ratings;
      let p = inPocket
        ? 0.72 + ((dr.tackling - cr.agility) / 100) * 0.3
        : 0.6 + ((dr.tackling - (cr.power + cr.agility) / 2) / 100) * 0.55;
      if (d.engaged >= 0) p *= 0.3;
      p = clamp(p + 0.06 * this.edge, 0.15, 0.95);
      const made = this.rng.chance(p);
      // A carrier moving forward falls forward: stronger runners drag the tackle further.
      const fall = Math.trunc(this.rng.range(0, 2.6 + cr.power / 25) * U);
      if (made) {
        if (!inPocket && c.x > c.px) c.x += fall;
        if (c.x >= yd(100)) return this.finish(c, null, { touchdown: true });
        const fumble = !inPocket && this.rng.chance(0.012) && this.rng.chance(0.5);
        this.finish(c, d, { sack: inPocket, fumble });
        return;
      }
      d.stunUntil = this.tick + 36;
      c.stumbleUntil = this.tick + 16;
      if (inPocket) this.hurried = true;
    }
  }

  // ------------------------------------------------------------------ ending

  private finish(c: SimPlayer, tackler: SimPlayer | null, f: { touchdown?: boolean; outOfBounds?: boolean; sack?: boolean; fumble?: boolean }): void {
    const isPass = this.play.kind === 'pass';
    const endYard = f.touchdown ? 100 : clamp(Math.floor(c.x / U), -9, 99);
    const safety = !f.touchdown && c.x <= 0;
    const completed = isPass && this.caught;
    this.end({
      kind: this.play.kind,
      endYard,
      yards: endYard - this.losYard,
      touchdown: !!f.touchdown,
      safety,
      turnover: f.fumble && !safety ? 'fumble' : null,
      complete: completed,
      incomplete: false,
      thrown: this.thrown,
      sack: !!f.sack,
      outOfBounds: !!f.outOfBounds,
      passer: isPass ? this.qb.player : undefined,
      rusher: completed ? undefined : c.player,
      receiver: completed ? c.player : undefined,
      tackler: tackler?.player,
      ticks: this.tick,
    });
  }

  private finishIncomplete(): void {
    this.end({
      kind: 'pass', endYard: this.losYard, yards: 0, touchdown: false, safety: false, turnover: null,
      complete: false, incomplete: true, thrown: true, sack: false, outOfBounds: false,
      passer: this.qb.player, receiver: this.target >= 0 ? this.players[this.target].player : undefined, ticks: this.tick,
    });
  }

  private end(r: PlayResult): void {
    this.result = r;
    this.done = true;
    this.ball.state = 'dead';
  }
}
