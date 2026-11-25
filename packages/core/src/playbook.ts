import type { DefCall, DefPos, OffAssign, OffPlay, OffPos, Pt } from './types';

/** Starter playbook for Milestone 1. Plays are data: the engine has no play-specific code. */

const BLOCK: OffAssign = { t: 'block' };
const QB: OffAssign = { t: 'qb' };

const UNDER_CENTER: Record<OffPos, Pt> = {
  LT: [-0.6, -3], LG: [-0.6, -1.5], C: [-0.6, 0], RG: [-0.6, 1.5], RT: [-0.6, 3],
  TE: [-0.6, 4.6], WR1: [-0.6, -19], WR2: [-0.6, 19], WR3: [-1.5, -11],
  QB: [-1.6, 0], RB: [-6, 0],
};
const SHOTGUN: Record<OffPos, Pt> = { ...UNDER_CENTER, QB: [-5, 0], RB: [-5, 2] };

const line = { LT: BLOCK, LG: BLOCK, C: BLOCK, RG: BLOCK, RT: BLOCK } as const;

const run = (id: string, name: string, desc: string, handoffTick: number, pts: Pt[]): OffPlay => ({
  id, name, desc, kind: 'run', formation: UNDER_CENTER, handoffTick,
  assign: { ...line, QB, RB: { t: 'carry', pts }, TE: BLOCK, WR1: BLOCK, WR2: BLOCK, WR3: BLOCK },
});

export const OFFENSE_PLAYS: readonly OffPlay[] = [
  run('dive', 'Dive', 'Straight up the middle. Safe yards.', 22, [[-2, 0], [2, 0]]),
  run('offTackle', 'Off Tackle', 'Behind the tight end on the right.', 26, [[-3, 3], [1, 5.6], [4, 6.5]]),
  run('sweep', 'Sweep Left', 'Outside to the wide side. Boom or bust.', 28, [[-5, -8], [-2, -14], [3, -17]]),
  run('counter', 'Counter', 'Step right, cut back left.', 32, [[-5, 2], [-3, -1], [2, -3.8]]),
  {
    id: 'slants', name: 'Quick Slants', kind: 'pass', desc: 'Fast throws inside. Beats the blitz.',
    formation: UNDER_CENTER, dropDepth: 3, readStart: 42,
    assign: {
      ...line, QB, RB: BLOCK,
      WR1: { t: 'route', pts: [[3, 0], [9, 6]], go: true },
      WR2: { t: 'route', pts: [[3, 0], [9, -6]], go: true },
      WR3: { t: 'route', pts: [[5, 0], [6, -7]] },
      TE: { t: 'route', pts: [[2, 0], [3, 6]], go: true },
    },
  },
  {
    id: 'verticals', name: 'Four Verticals', kind: 'pass', desc: 'Everyone deep. Needs time to throw.',
    formation: SHOTGUN, dropDepth: 2, readStart: 84,
    assign: {
      ...line, QB,
      WR1: { t: 'route', pts: [[40, 0]], go: true },
      WR2: { t: 'route', pts: [[40, 0]], go: true },
      WR3: { t: 'route', pts: [[12, 0], [26, 5]], go: true },
      TE: { t: 'route', pts: [[5, 0], [7, -10]], go: true },
      RB: { t: 'route', pts: [[0, 6], [3, 10]] },
    },
  },
  {
    id: 'curls', name: 'Curl and Out', kind: 'pass', desc: 'Sticks routes at ten yards.',
    formation: UNDER_CENTER, dropDepth: 5, readStart: 66,
    assign: {
      ...line, QB, RB: BLOCK,
      WR1: { t: 'route', pts: [[11, 0], [9.5, 1]] },
      WR2: { t: 'route', pts: [[8, 0], [9, 5]] },
      WR3: { t: 'route', pts: [[6, 0], [9, 14]], go: true },
      TE: { t: 'route', pts: [[9, 0], [10, -3]] },
    },
  },
  {
    id: 'flood', name: 'Flood Right', kind: 'pass', desc: 'Three receivers to one side.',
    formation: UNDER_CENTER, dropDepth: 4, readStart: 58,
    assign: {
      ...line, QB,
      WR2: { t: 'route', pts: [[30, 0]], go: true },
      TE: { t: 'route', pts: [[9, 0], [13, 8]], go: true },
      RB: { t: 'route', pts: [[-1, 6], [2, 13]] },
      WR1: { t: 'route', pts: [[5, 0], [7, 12]], go: true },
      WR3: { t: 'route', pts: [[13, 0], [14, 6]] },
    },
  },
];

const BASE_43: Record<DefPos, Pt> = {
  DE1: [0.9, -4.4], DT1: [0.9, -1.4], DT2: [0.9, 1.4], DE2: [0.9, 4.4],
  OLB1: [4.5, -8], MLB: [4.5, 0], OLB2: [4.5, 5.5],
  CB1: [6, -19], CB2: [6, 19], FS: [13, -4], SS: [10, 7],
};
const dline = { DE1: { t: 'rush' }, DT1: { t: 'rush' }, DT2: { t: 'rush' }, DE2: { t: 'rush' } } as const;

export const DEFENSE_CALLS: readonly DefCall[] = [
  {
    id: 'base', name: 'Base 4-3', kind: 'balanced', desc: 'Sound against everything. No bonus, no risk.',
    formation: BASE_43,
    assign: {
      ...dline,
      OLB1: { t: 'man', target: 'WR3', cushion: 3 }, MLB: { t: 'read' }, OLB2: { t: 'man', target: 'RB', cushion: 4 },
      CB1: { t: 'man', target: 'WR1', cushion: 5 }, CB2: { t: 'man', target: 'WR2', cushion: 5 },
      FS: { t: 'zone', at: [14, 0] }, SS: { t: 'man', target: 'TE', cushion: 4 },
    },
  },
  {
    id: 'runStuff', name: 'Run Stuff', kind: 'run', desc: 'Linebackers crash the line. Exposed to the pass.',
    formation: { ...BASE_43, OLB1: [3, -6], MLB: [3, 0], OLB2: [3, 5.5], SS: [6, 6], FS: [10, 0] },
    assign: {
      ...dline,
      OLB1: { t: 'rush' }, MLB: { t: 'read' }, OLB2: { t: 'rush' },
      CB1: { t: 'man', target: 'WR1', cushion: 4 }, CB2: { t: 'man', target: 'WR2', cushion: 4 },
      FS: { t: 'zone', at: [13, -4] }, SS: { t: 'man', target: 'TE', cushion: 2 },
    },
  },
  {
    id: 'coverZone', name: 'Cover Zone', kind: 'pass', desc: 'Seven drop into coverage. Soft against the run.',
    formation: { ...BASE_43, FS: [15, -9], SS: [15, 9], OLB1: [5, -9], OLB2: [5, 9] },
    assign: {
      ...dline,
      OLB1: { t: 'zone', at: [8, -10] }, MLB: { t: 'zone', at: [9, 0] }, OLB2: { t: 'zone', at: [8, 10] },
      CB1: { t: 'man', target: 'WR1', cushion: 5.5 }, CB2: { t: 'man', target: 'WR2', cushion: 5.5 },
      FS: { t: 'zone', at: [17, -9] }, SS: { t: 'zone', at: [17, 9] },
    },
  },
  {
    id: 'blitz', name: 'Blitz', kind: 'blitz', desc: 'Six rushers. Sack or big play.',
    formation: { ...BASE_43, MLB: [2.5, 0.6], SS: [3, 6.5] },
    assign: {
      ...dline,
      MLB: { t: 'rush' }, SS: { t: 'rush' },
      OLB1: { t: 'man', target: 'WR3', cushion: 3 }, OLB2: { t: 'man', target: 'TE', cushion: 3 },
      CB1: { t: 'man', target: 'WR1', cushion: 3 }, CB2: { t: 'man', target: 'WR2', cushion: 3 },
      FS: { t: 'zone', at: [13, 0] },
    },
  },
];

export const playById = (id: string): OffPlay => {
  const p = OFFENSE_PLAYS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown play ${id}`);
  return p;
};
export const callById = (id: string): DefCall => {
  const c = DEFENSE_CALLS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown defensive call ${id}`);
  return c;
};
