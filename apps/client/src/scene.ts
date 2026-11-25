import Phaser from 'phaser';
import type { Team, TeamColors } from '@fnd/core';

/** Draws the field and players. It holds no game rules: it renders whatever view it is given. */

export const VIEW_W = 480;
export const VIEW_H = 270;
const WORLD_W = 960;
const FIELD_TOP = 16;
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
}
export interface FieldView {
  players: ViewPlayer[];
  ball: { x: number; y: number; z: number; visible: boolean };
  los: number | null;
  toGain: number | null;
  focusX: number;
  frame: number;
}

const FRAME_A = [
  '...hhhh...', '..hhhhhh..', '..hhhhss..', '..hhhhkk..', '...jjjj...', '.sjjjjjjs.', '.sjjttjjs.',
  '..jjjjjj..', '..pppppp..', '..pp..pp..', '..pp..pp..', '..ss..ss..', '..kk..kk..', '..........',
];
const FRAME_B = [
  '...hhhh...', '..hhhhhh..', '..hhhhss..', '..hhhhkk..', '...jjjj...', 'sjjjjjjjs.', '.sjttjjs..',
  '..jjjjjj..', '..pppppp..', '.ppp..pp..', '.pp....pp.', '.ss....ss.', '.kk....kk.', '..........',
];
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

  constructor() {
    super('field');
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, WORLD_W, VIEW_H);
    this.field = this.add.graphics().setDepth(-100);
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
    teams.forEach((t, i) => {
      this.makePlayerTexture(`p${i}a`, FRAME_A, t.colors);
      this.makePlayerTexture(`p${i}b`, FRAME_B, t.colors);
    });
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    for (let i = 0; i < 22; i++) this.sprites.push(this.add.image(0, 0, 'p0a').setOrigin(0.5, 1).setVisible(false));
    this.drawField(teams);
  }

  private makePlayerTexture(key: string, rows: string[], c: TeamColors): void {
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, 10, 14)!;
    const ctx = tex.getContext();
    const pal: Record<string, string> = { h: css(c.helmet), j: css(c.jersey), p: css(c.pants), t: css(c.trim), s: '#d9a066', k: '#15151c' };
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        ctx.fillStyle = pal[ch];
        ctx.fillRect(x, y, 1, 1);
      }
    });
    tex.refresh();
  }

  private drawField(teams: readonly [Team, Team]): void {
    const g = this.field;
    g.clear();
    // Stands and crowd.
    g.fillStyle(0x15182b).fillRect(0, 0, WORLD_W, FIELD_TOP);
    let seed = 12345;
    const crowd = [0xe8c547, 0xd8262c, 0xf3f1e7, 0x5aa0e0, 0x27307f, 0x8a8fb5];
    for (let x = 2; x < WORLD_W; x += 3) for (let y = 1; y < FIELD_TOP - 3; y += 3) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 5 === 0) continue;
      g.fillStyle(crowd[seed % crowd.length]).fillRect(x, y, 2, 2);
    }
    g.fillStyle(0x3a3f5c).fillRect(0, FIELD_TOP - 2, WORLD_W, 2);
    // Grass.
    for (let i = 0; i < 20; i++) g.fillStyle(i % 2 ? 0x2f8a3b : 0x2a7f35).fillRect(80 + i * 40, FIELD_TOP, 40, 240);
    // End zones in team colours.
    ([[0, teams[0]], [880, teams[1]]] as const).forEach(([x0, t]) => {
      g.fillStyle(shade(t.colors.jersey, 0.85)).fillRect(x0, FIELD_TOP, 80, 240);
      g.fillStyle(t.colors.trim, 0.55);
      for (let k = -240; k < 80; k += 16) for (let y = 0; y < 240; y += 2) {
        const x = x0 + k + y;
        if (x >= x0 && x < x0 + 78) g.fillRect(x, FIELD_TOP + y, 3, 2);
      }
    });
    // Sideline apron.
    g.fillStyle(0x1f5a29).fillRect(0, 256, WORLD_W, 14);
    g.fillStyle(0x8a8fb5).fillRect(300, 261, 120, 3).fillRect(540, 261, 120, 3);
    // Lines.
    g.fillStyle(0xf3f1e7, 0.85);
    for (let yd = 0; yd <= 100; yd += 5) g.fillRect(wx(yd) - (yd % 100 === 0 ? 1 : 0), FIELD_TOP, yd % 100 === 0 ? 2 : 1, 240);
    g.fillRect(0, FIELD_TOP, WORLD_W, 2).fillRect(0, 254, WORLD_W, 2).fillRect(0, FIELD_TOP, 2, 240).fillRect(WORLD_W - 2, FIELD_TOP, 2, 240);
    g.fillStyle(0xf3f1e7, 0.6);
    for (let yd = 1; yd < 100; yd++) {
      if (yd % 5 === 0) continue;
      g.fillRect(wx(yd), wy(FIELD_WIDTH_YD / 3), 1, 2).fillRect(wx(yd), wy((FIELD_WIDTH_YD * 2) / 3), 1, 2);
    }
    // Yard numbers.
    g.fillStyle(0xf3f1e7, 0.8);
    for (let yd = 10; yd <= 90; yd += 10) {
      const label = String(Math.min(yd, 100 - yd));
      for (const top of [38, 222]) {
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
    for (const x of [3, WORLD_W - 5]) g.fillRect(x, 120, 2, 32).fillRect(x - 2, 120, 6, 2).fillRect(x - 2, 150, 6, 2);
  }

  update(_time: number, delta: number): void {
    const view = this.onFrame(delta);
    if (!view || this.sprites.length === 0) return;
    const g = this.fx;
    g.clear();
    if (view.los !== null) g.fillStyle(0x4f8ef7, 0.9).fillRect(wx(view.los), FIELD_TOP + 2, 1, 236);
    if (view.toGain !== null && view.toGain < 100) g.fillStyle(0xf2c14e, 0.95).fillRect(wx(view.toGain), FIELD_TOP + 2, 1, 236);

    const alt = Math.floor(view.frame / 7) % 2 === 1;
    this.sprites.forEach((s, i) => {
      const p = view.players[i];
      if (!p) {
        s.setVisible(false);
        return;
      }
      const x = Math.round(wx(p.x));
      const y = Math.round(wy(p.y));
      g.fillStyle(0x000000, 0.28).fillEllipse(x, y, 10, 4);
      s.setVisible(true).setTexture(`p${p.team}${p.moving && alt ? 'b' : 'a'}`).setFlipX(p.team === 1).setDepth(y);
      if (p.down) s.setAngle(p.team === 1 ? -90 : 90).setPosition(x, y - 3);
      else s.setAngle(0).setPosition(x, y + 2);
      if (p.hasBall) g.fillStyle(0xf2c14e).fillTriangle(x - 3, y - 19, x + 3, y - 19, x, y - 15);
    });

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
    this.cameras.main.scrollX = Math.round(this.camX);
  }

  snapCamera(focusX: number): void {
    this.camX = Phaser.Math.Clamp(wx(focusX) - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  }
}

export function createGame(parent: string, scene: FieldScene): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    pixelArt: true,
    backgroundColor: '#0e1020',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
    audio: { noAudio: true },
    banner: false,
    scene,
  });
}
