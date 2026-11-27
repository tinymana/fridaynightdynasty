import Phaser from 'phaser';
import type { Team, TeamColors } from '@fnd/core';

/** Draws the field and players. It holds no game rules: it renders whatever view it is given. */

import playersBaseUrl from './assets/players-base.png';
import playersMaskUrl from './assets/players-mask.png';
import stadiumUrl from './assets/stadium.png';
import sidelineBaseUrl from './assets/sideline-base.png';
import sidelineMaskUrl from './assets/sideline-mask.png';
import turfUrl from './assets/turf.png';
import { PLAYER_CELL, PLAYER_FRAMES, SIDELINE, STADIUM, TURF } from './art-atlas';

/** The scene is laid out in world units and drawn at two screen pixels to the unit, so sprites carry twice the detail. */
// `?lowres` draws at one pixel to the unit: the automated checks use it, because a headless browser paints in software.
const ZOOM = typeof location !== 'undefined' && /[?&]lowres\b/.test(location.search) ? 1 : 2;
export const VIEW_W = 480;
export const VIEW_H = 336;
const WORLD_W = 960;
/** Above the field: the stands, then the wall with the sponsors' boards. */
const WALL_H = 14;
const FIELD_TOP = 64;
const FIELD_H = 240;
/** Below the field: the near sideline, where the benches, the coaches and the chain crew stand. */
const APRON_H = 32;
/** Players are drawn a little over life size against the field, as they always have been in games like this, so they read. */
const PLAYER_SCALE = 0.62;
type FrameName = (typeof PLAYER_FRAMES)[number];
const RUN: readonly FrameName[] = ['run0', 'run1', 'run2', 'run3'];
const PX_X = 8;
const PX_Y = 4.5;
const FIELD_WIDTH_YD = 53.333;

export const wx = (yard: number): number => 80 + yard * PX_X;
export const wy = (lateralYd: number): number => FIELD_TOP + lateralYd * PX_Y;

export interface ViewPlayer {
  team: 0 | 1;
  x: number;
  y: number;
  moving: boolean;
  down: boolean;
  hasBall: boolean;
  /** A pose to show in place of the usual stance, stride or fall: a throw, a stiff arm, a kick, a celebration. */
  pose?: FrameName;
}
export interface FieldView {
  players: ViewPlayer[];
  ball: { x: number; y: number; z: number; visible: boolean };
  los: number | null;
  toGain: number | null;
  focusX: number;
  frame: number;
  /** The down, for the box on the sideline. */
  down?: number;
}

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
};
const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const shade = (n: number, f: number): number => {
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return (r << 16) | (g << 8) | b;
};

export class FieldScene extends Phaser.Scene {
  onFrame: (deltaMs: number) => FieldView | null = () => null;
  private sprites: Phaser.GameObjects.Image[] = [];
  private ball!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Graphics;
  private field!: Phaser.GameObjects.Graphics;
  private camX = 240;
  private ready = false;
  private crew: Phaser.GameObjects.Image[] = [];
  private bench: Phaser.GameObjects.Image[] = [];
  private paint: Phaser.GameObjects.Text[] = [];
  /** Mud, torn turf and puddles, stamped where the plays go. */
  private wear!: Phaser.GameObjects.RenderTexture;
  /** Snow or frost lying on the field, trampled away where the players have been. */
  private cover!: Phaser.GameObjects.RenderTexture;
  private stamp!: Phaser.GameObjects.Image;
  private ground: 'grass' | 'snow' | 'frost' = 'grass';

  constructor() {
    super('field');
  }

  preload(): void {
    this.load.image('players-base', playersBaseUrl);
    this.load.image('players-mask', playersMaskUrl);
    this.load.image('stadium', stadiumUrl);
    this.load.image('sideline-base', sidelineBaseUrl);
    this.load.image('sideline-mask', sidelineMaskUrl);
    this.load.image('turf', turfUrl);
  }

  create(): void {
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.scrollY = -(VIEW_H * ZOOM - VIEW_H) / 2;
    // Stands and sponsors' boards, cut from the supplied sheets.
    const tex = this.textures.get('stadium');
    STADIUM.ads.forEach((r, i) => tex.add(`ad${i}`, 0, r[0], r[1], r[2], r[3]));
    STADIUM.stands.forEach((r, i) => tex.add(`stand${i}`, 0, r[0], r[1], r[2], r[3]));
    // The stands, seen square on: one long bleacher with the visitors thin at one end, the home crowd and the band in
    // the middle, the press tower at midfield and the scoreboard at the far end. Tiles butt together; nothing overlaps.
    const room = FIELD_TOP - WALL_H - 6;
    const tallest = Math.max(...STADIUM.stands.map((r) => r[3]));
    const scale = Math.min(1 / ZOOM, room / tallest);
    const [SPARSE, PACKED_A, PACKED_B, BAND, TOWER, BOARD] = [1, 2, 3, 4, 5, 6];
    const order = [SPARSE, PACKED_A, PACKED_B, BAND, PACKED_A, TOWER, PACKED_B, PACKED_A, PACKED_B, SPARSE, BOARD];
    const widths = order.map((k) => STADIUM.stands[k][2] * scale);
    let at = (WORLD_W - widths.reduce((sum, w) => sum + w, 0)) / 2;
    order.forEach((k, i) => {
      this.add.image(Math.round(at), FIELD_TOP - WALL_H - 4, 'stadium', `stand${k}`).setOrigin(0, 1).setScale(scale).setDepth(-95);
      at += widths[i];
    });
    for (let i = 0, x = 26; x < WORLD_W - 20; i++, x += 58) {
      this.add.image(x, FIELD_TOP - WALL_H / 2 - 1, 'stadium', `ad${i % STADIUM.ads.length}`).setOrigin(0.5, 0.5).setScale(1 / ZOOM).setDepth(-90);
    }
    this.field = this.add.graphics().setDepth(-100);
    const turf = this.textures.get('turf');
    for (const [name, r] of Object.entries(TURF)) turf.add(name, 0, r[0], r[1], r[2], r[3]);
    // Both layers cover the playing field and the end zones, a world unit to the pixel.
    this.cover = this.add.renderTexture(0, FIELD_TOP, WORLD_W, FIELD_H).setOrigin(0, 0).setDepth(-98);
    this.wear = this.add.renderTexture(0, FIELD_TOP, WORLD_W, FIELD_H).setOrigin(0, 0).setDepth(-97);
    this.stamp = this.make.image({ key: 'turf', frame: 'mud0', add: false }).setOrigin(0.5, 0.5);
    this.fx = this.add.graphics().setDepth(-50);
    const b = this.textures.createCanvas('ball', 5, 3)!;
    const c = b.getContext();
    c.fillStyle = '#7a4a21';
    c.fillRect(1, 0, 3, 3);
    c.fillRect(0, 1, 5, 1);
    c.fillStyle = '#f3f1e7';
    c.fillRect(2, 1, 1, 1);
    b.refresh();
    this.ball = this.add.image(0, 0, 'ball').setDepth(9999).setVisible(false);
    this.ready = true;
    this.events.emit('ready');
  }

  setTeams(teams: readonly [Team, Team]): void {
    if (!this.ready) {
      this.events.once('ready', () => this.setTeams(teams));
      return;
    }
    teams.forEach((t, i) => this.makePlayerTextures(i, t.colors));
    // The near sideline: each team's bench, a few players standing, a coach, all in the school's colours.
    for (const o of this.bench) o.destroy();
    this.bench = [];
    const ground = FIELD_TOP + FIELD_H + APRON_H - 3;
    teams.forEach((t, i) => {
      const key = `side${i}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      const img = this.repaint('sideline-base', 'sideline-mask', t.colors);
      const tex = this.textures.createCanvas(key, img.width, img.height)!;
      tex.getContext().putImageData(img, 0, 0);
      tex.refresh();
      for (const [name, r] of Object.entries(SIDELINE)) tex.add(name, 0, r[0], r[1], r[2], r[3]);
      const x0 = i === 0 ? 250 : 520;
      const row: [string, number][] = [['coach0', 0], ['stand0', 16], ['stand1', 30], ['bench', 66], ['stand3', 104], ['bench', 138], ['stand2', 174], ['coach1', 190]];
      for (const [name, dx] of row) this.bench.push(this.add.image(x0 + dx, ground, key, name).setOrigin(0.5, 1).setScale(1 / ZOOM * 1.15).setDepth(9000));
    });
    // Paint on the grass: each school's name in its end zone and the home team's letters at midfield.
    for (const o of this.paint) o.destroy();
    this.paint = [];
    const font = '"Press Start 2P", monospace';
    teams.forEach((t, i) => {
      const name = t.name.toUpperCase();
      const size = Math.min(22, Math.floor(214 / Math.max(6, name.length)));
      const zone = this.add.text(i === 0 ? 40 : WORLD_W - 40, FIELD_TOP + FIELD_H / 2, name, { fontFamily: font, fontSize: `${size * ZOOM}px`, color: '#f3f1e7' })
        .setOrigin(0.5, 0.5).setScale(1 / ZOOM).setAngle(i === 0 ? -90 : 90).setDepth(-99).setAlpha(0.92);
      zone.setStroke(`#${shade(t.colors.jersey, 0.45).toString(16).padStart(6, '0')}`, 4 * ZOOM);
      this.paint.push(zone);
    });
    const mid = this.add.text(wx(50), FIELD_TOP + FIELD_H / 2, teams[0].abbr, { fontFamily: font, fontSize: `${26 * ZOOM}px`, color: `#${teams[0].colors.jersey.toString(16).padStart(6, '0')}` })
      .setOrigin(0.5, 0.5).setScale(1 / ZOOM).setDepth(-99).setAlpha(0.55);
    mid.setStroke('#f3f1e7', 3 * ZOOM);
    this.paint.push(mid);
    // The chain crew: two sticks ten yards apart and the down box at the ball.
    for (const o of this.crew) o.destroy();
    this.crew = ['stick', 'stick', 'box1'].map((name) => this.add.image(0, FIELD_TOP + FIELD_H + 13, 'side0', name).setOrigin(0.5, 1).setScale(1 / ZOOM * 1.3).setDepth(9001).setVisible(false));
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    for (let i = 0; i < 22; i++) this.sprites.push(this.add.image(0, 0, 'p0_stance0').setOrigin(0.5, 1).setScale(PLAYER_SCALE).setVisible(false));
    this.drawField(teams);
  }

  /**
   * Paints the player frames in a school's colours. The colour layer holds skin, outline, ball and shoes; the
   * mask says which pixels are jersey, helmet or pants and how light each is, and those are repainted.
   */
  private makePlayerTextures(team: number, c: TeamColors): void {
    const base = this.repaint('players-base', 'players-mask', c);
    PLAYER_FRAMES.forEach((name, n) => {
      const key = `p${team}_${name}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      const tex = this.textures.createCanvas(key, PLAYER_CELL.w, PLAYER_CELL.h)!;
      tex.getContext().putImageData(base, -n * PLAYER_CELL.w, 0, n * PLAYER_CELL.w, 0, PLAYER_CELL.w, PLAYER_CELL.h);
      tex.refresh();
    });
  }

  /** Returns an atlas with its jersey, helmet and pants pixels repainted in a school's colours. */
  private repaint(baseKey: string, maskKey: string, c: TeamColors): ImageData {
    const read = (key: string): ImageData => {
      const img = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const cx = cv.getContext('2d')!;
      cx.drawImage(img, 0, 0);
      return cx.getImageData(0, 0, img.width, img.height);
    };
    const base = read(baseKey);
    const mask = read(maskKey);
    const colours = [0, c.jersey, c.helmet, c.pants];
    for (let i = 0; i < base.data.length; i += 4) {
      const mat = Math.round(mask.data[i] / 60);
      if (mask.data[i + 3] < 128 || mat < 1 || mat > 3) continue;
      // The sheet's shading carries over: mid-tone is the school colour, lighter pixels lift toward white.
      const f = mask.data[i + 1] / 255 / 0.72;
      const col = colours[mat];
      const lift = Math.max(0, f - 1) * 0.6;
      const dark = Math.min(1, Math.max(0.4, f));
      for (let k = 0; k < 3; k++) {
        const v = (col >> (16 - 8 * k)) & 255;
        base.data[i + k] = Math.round(v * dark + (255 - v * dark) * lift);
      }
    }
    return base;
  }

  private drawField(teams: readonly [Team, Team]): void {
    const g = this.field;
    g.clear();
    // Night sky behind the stands, the track they stand on, and the wall the sponsors' boards hang on.
    g.fillStyle(0x0b0e24).fillRect(0, 0, WORLD_W, FIELD_TOP);
    g.fillStyle(0x7a3b2a).fillRect(0, FIELD_TOP - WALL_H - 5, WORLD_W, 5);
    g.fillStyle(0x23284a).fillRect(0, FIELD_TOP - WALL_H, WORLD_W, WALL_H);
    g.fillStyle(0x3a3f5c).fillRect(0, FIELD_TOP - WALL_H, WORLD_W, 1).fillRect(0, FIELD_TOP - 1, WORLD_W, 1);
    // Grass.
    for (let i = 0; i < 20; i++) g.fillStyle(i % 2 ? 0x2f8a3b : 0x2a7f35).fillRect(80 + i * 40, FIELD_TOP, 40, FIELD_H);
    // End zones in team colours.
    ([[0, teams[0]], [880, teams[1]]] as const).forEach(([x0, t]) => {
      g.fillStyle(shade(t.colors.jersey, 0.85)).fillRect(x0, FIELD_TOP, 80, FIELD_H);
      g.fillStyle(t.colors.trim, 0.55);
      for (let k = -240; k < 80; k += 16) for (let y = 0; y < 240; y += 2) {
        const x = x0 + k + y;
        if (x >= x0 && x < x0 + 78) g.fillRect(x, FIELD_TOP + y, 3, 2);
      }
    });
    // Sideline apron.
    g.fillStyle(0x1f5a29).fillRect(0, FIELD_TOP + FIELD_H, WORLD_W, APRON_H);
    g.fillStyle(0x7a3b2a).fillRect(0, FIELD_TOP + FIELD_H + APRON_H - 5, WORLD_W, 5);
    // Lines.
    g.fillStyle(0xf3f1e7, 0.85);
    for (let yd = 0; yd <= 100; yd += 5) g.fillRect(wx(yd) - (yd % 100 === 0 ? 1 : 0), FIELD_TOP, yd % 100 === 0 ? 2 : 1, FIELD_H);
    g.fillRect(0, FIELD_TOP, WORLD_W, 2).fillRect(0, FIELD_TOP + 238, WORLD_W, 2).fillRect(0, FIELD_TOP, 2, FIELD_H).fillRect(WORLD_W - 2, FIELD_TOP, 2, FIELD_H);
    g.fillStyle(0xf3f1e7, 0.6);
    for (let yd = 1; yd < 100; yd++) {
      if (yd % 5 === 0) continue;
      g.fillRect(wx(yd), wy(FIELD_WIDTH_YD / 3), 1, 2).fillRect(wx(yd), wy((FIELD_WIDTH_YD * 2) / 3), 1, 2);
    }
    // Yard numbers.
    g.fillStyle(0xf3f1e7, 0.8);
    for (let yd = 10; yd <= 90; yd += 10) {
      const label = String(Math.min(yd, 100 - yd));
      for (const top of [FIELD_TOP + 22, FIELD_TOP + 206]) {
        label.split('').forEach((ch, i) => {
          const gx = wx(yd) + (i === 0 ? -9 : 3);
          DIGITS[ch].forEach((row, ry) => {
            for (let rx = 0; rx < 3; rx++) if (row[rx] === '1') g.fillRect(gx + rx * 2, top + ry * 2, 2, 2);
          });
        });
      }
    }
    // Goal posts.
    g.fillStyle(0xf2c14e);
    for (const x of [3, WORLD_W - 5]) g.fillRect(x, FIELD_TOP + 104, 2, 32).fillRect(x - 2, FIELD_TOP + 104, 6, 2).fillRect(x - 2, FIELD_TOP + 134, 6, 2);
  }

  update(_time: number, delta: number): void {
    const view = this.onFrame(delta);
    if (!view || this.sprites.length === 0) return;
    const g = this.fx;
    g.clear();
    if (view.los !== null) g.fillStyle(0x4f8ef7, 0.9).fillRect(wx(view.los), FIELD_TOP + 2, 1, 236);
    if (view.toGain !== null && view.toGain < 100) g.fillStyle(0xf2c14e, 0.95).fillRect(wx(view.toGain), FIELD_TOP + 2, 1, 236);

    const step = Math.floor(view.frame / 6) % RUN.length;
    this.sprites.forEach((s, i) => {
      const p = view.players[i];
      if (!p) {
        s.setVisible(false);
        return;
      }
      const x = Math.round(wx(p.x));
      const y = Math.round(wy(p.y));
      g.fillStyle(0x000000, 0.28).fillEllipse(x, y + 1, 13, 4);
      // Every man runs on his own beat, so a line of players is not a chorus line.
      const frame: FrameName = p.down ? 'down' : p.pose ?? (p.moving ? RUN[(step + i) % RUN.length] : 'stance0');
      s.setVisible(true).setTexture(`p${p.team}_${frame}`).setFlipX(p.team === 1).setDepth(y).setPosition(x, y + 2);
      if (p.hasBall) g.fillStyle(0xf2c14e).fillTriangle(x - 3, y - 26, x + 3, y - 26, x, y - 22);
    });

    // The sticks stand at the start of the series and ten yards on; the box follows the ball.
    const dir = view.toGain !== null && view.los !== null && view.toGain < view.los ? -1 : 1;
    const marks = [view.toGain === null ? null : view.toGain - dir * 10, view.toGain, view.los];
    this.crew.forEach((o, k) => {
      const at = marks[k];
      const show = at !== null && at !== undefined && view.los !== null && at >= 0 && at <= 100;
      o.setVisible(show);
      if (show) o.setX(Math.round(wx(at!)) + (k === 2 ? 3 : 0));
    });
    if (this.crew[2] && view.down) this.crew[2].setFrame(`box${Math.min(4, Math.max(1, view.down))}`);

    const b = view.ball;
    this.ball.setVisible(b.visible);
    if (b.visible) {
      const bx = Math.round(wx(b.x));
      const by = Math.round(wy(b.y));
      if (b.z > 0) g.fillStyle(0x000000, 0.3).fillEllipse(bx, by, 5, 2);
      this.ball.setPosition(bx, by - 7 - b.z);
    }

    const target = Phaser.Math.Clamp(wx(view.focusX) - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    this.camX += (target - this.camX) * Math.min(1, delta / 180);
    // With the camera zoomed, scroll is measured from the centre of the view.
    this.cameras.main.scrollX = Math.round(this.camX * ZOOM) / ZOOM - (VIEW_W * ZOOM - VIEW_W) / 2;
  }

  /** A fresh field for a new game: clean grass, or lying snow, or a morning frost. */
  resetTurf(ground: 'grass' | 'snow' | 'frost'): void {
    if (!this.ready) {
      this.events.once('ready', () => this.resetTurf(ground));
      return;
    }
    this.ground = ground;
    this.wear.clear();
    this.cover.clear();
    if (ground === 'grass') return;
    this.stamp.setFrame(ground).setScale(1).setAngle(0).setAlpha(ground === 'snow' ? 0.82 : 0.6);
    for (let x = 16; x < WORLD_W + 16; x += 32) for (let y = 16; y < FIELD_H + 16; y += 32) this.cover.draw(this.stamp, x, y);
  }

  /**
   * Marks the field where a play went. `x` is in yards from the left goal line and `y` in yards from the far
   * sideline; `kind` is what the weather leaves there; `n` picks the mark so the same play always leaves the same one.
   */
  addWear(x: number, y: number, kind: 'scuff' | 'mud' | 'puddle', n: number): void {
    if (!this.ready) return;
    const px = Math.round(wx(x));
    const py = Math.round(y * PX_Y);
    if (this.ground !== 'grass') {
      // Boots take the snow or frost off before they take the grass off.
      this.stamp.setFrame('blob').setScale(0.7 + (n % 3) * 0.2).setAngle(0).setAlpha(0.55);
      this.cover.erase(this.stamp, px, py);
    }
    if (kind === 'puddle') this.stamp.setFrame(`puddle${n % 3}`).setScale(0.5).setAngle(0).setAlpha(0.85);
    else this.stamp.setFrame(`mud${n % 5}`).setScale(kind === 'mud' ? 0.42 : 0.36).setAngle((n % 4) * 90).setAlpha(kind === 'mud' ? 0.72 : 0.34);
    this.wear.draw(this.stamp, px, py);
  }

  snapCamera(focusX: number): void {
    this.camX = Phaser.Math.Clamp(wx(focusX) - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  }
}

export function createGame(parent: string, scene: FieldScene): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W * ZOOM,
    height: VIEW_H * ZOOM,
    pixelArt: true,
    backgroundColor: '#0e1020',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
    audio: { noAudio: true },
    banner: false,
    scene,
  });
}
