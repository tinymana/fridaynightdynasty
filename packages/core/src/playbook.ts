import type { DefAssign, DefFront, DefScheme, DefSlot, Group, OffAssign, OffFormation, OffPlay, PlayTag, Pt, Slot } from './types';

/**
 * The play library. Plays, formations and fronts are data: the engine has no play-specific code.
 * This is the same shape a coach-designed play will use.
 */

const s = (id: string, group: Group, rank: number, at: Pt): Slot => ({ id, group, rank, at });

const LINE: Slot[] = [
  s('LT', 'OL', 1, [-0.6, -3]), s('LG', 'OL', 2, [-0.6, -1.5]), s('C', 'OL', 3, [-0.6, 0]),
  s('RG', 'OL', 4, [-0.6, 1.5]), s('RT', 'OL', 5, [-0.6, 3]),
];

export const FORMATIONS: readonly OffFormation[] = [
  {
    id: 'single', name: 'Singleback',
    slots: [s('QB', 'QB', 1, [-1.6, 0]), s('RB', 'RB', 1, [-6, 0]), s('TE', 'TE', 1, [-0.6, 4.6]),
      s('WR1', 'WR', 1, [-0.6, -19]), s('WR2', 'WR', 2, [-0.6, 19]), s('WR3', 'WR', 3, [-1.5, -11]), ...LINE],
  },
  {
    id: 'iform', name: 'I-Form',
    slots: [s('QB', 'QB', 1, [-1.6, 0]), s('RB', 'RB', 1, [-7, 0]), s('FB', 'RB', 2, [-4, 0]), s('TE', 'TE', 1, [-0.6, 4.6]),
      s('WR1', 'WR', 1, [-0.6, -19]), s('WR2', 'WR', 2, [-0.6, 19]), ...LINE],
  },
  {
    id: 'gun', name: 'Shotgun',
    slots: [s('QB', 'QB', 1, [-5, 0]), s('RB', 'RB', 1, [-5, 2]), s('TE', 'TE', 1, [-0.6, 4.6]),
      s('WR1', 'WR', 1, [-0.6, -19]), s('WR2', 'WR', 2, [-0.6, 19]), s('WR3', 'WR', 3, [-1.5, -11]), ...LINE],
  },
  {
    id: 'spread', name: 'Spread',
    slots: [s('QB', 'QB', 1, [-5, 0]), s('RB', 'RB', 1, [-5, -2]),
      s('WR1', 'WR', 1, [-0.6, -19]), s('WR2', 'WR', 2, [-0.6, 19]), s('WR3', 'WR', 3, [-1.5, -11]), s('WR4', 'WR', 4, [-1.5, 11]), ...LINE],
  },
  {
    id: 'heavy', name: 'Heavy',
    slots: [s('QB', 'QB', 1, [-1.6, 0]), s('RB', 'RB', 1, [-7, 0]), s('FB', 'RB', 2, [-4, 0]),
      s('TE', 'TE', 1, [-0.6, 4.6]), s('TE2', 'TE', 2, [-0.6, -4.6]), s('WR1', 'WR', 1, [-0.6, 16]), ...LINE],
  },
];

const QB: OffAssign = { t: 'qb' };
const BLOCK: OffAssign = { t: 'block' };
const route = (pts: Pt[], go = false): OffAssign => ({ t: 'route', pts, go });
const carry = (pts: Pt[]): OffAssign => ({ t: 'carry', pts });
const lead = (pts: Pt[]): OffAssign => ({ t: 'lead', pts });

const run = (id: string, name: string, formation: string, desc: string, tags: PlayTag[], handoffTick: number, assign: Record<string, OffAssign>): OffPlay =>
  ({ id, name, kind: 'run', formation, desc, tags, handoffTick, assign: { QB, ...assign } });
const pass = (id: string, name: string, formation: string, desc: string, tags: PlayTag[], dropDepth: number, readStart: number, assign: Record<string, OffAssign>): OffPlay =>
  ({ id, name, kind: 'pass', formation, desc, tags, dropDepth, readStart, assign: { QB, ...assign } });

export const OFFENSE_PLAYS: readonly OffPlay[] = [
  // Singleback
  run('dive', 'Dive', 'single', 'Straight up the middle. Safe yards.', ['inside', 'power'], 22, { RB: carry([[-2, 0], [2, 0]]) }),
  run('offTackle', 'Off Tackle', 'single', 'Behind the tight end on the right.', ['inside'], 26, { RB: carry([[-3, 3], [1, 5.6], [4, 6.5]]) }),
  run('counter', 'Counter', 'single', 'Step right, cut back left.', ['inside'], 28, { RB: carry([[-5, 1.5], [-3, -1], [2, -3.2]]) }),
  pass('slants', 'Quick Slants', 'single', 'Fast throws inside. Beats the blitz.', ['quick', 'short'], 3, 50, {
    WR1: route([[2, 0], [5, 8]], true), WR2: route([[2, 0], [5, -8]], true), WR3: route([[16, 0]], true), TE: route([[4, 0], [7, 4]], true),
  }),
  pass('curls', 'Curl and Out', 'single', 'Sticks routes at ten yards.', ['mid'], 5, 66, {
    WR1: route([[11, 0], [9.5, 1]]), WR2: route([[8, 0], [9, 5]]), WR3: route([[6, 0], [9, 14]], true), TE: route([[9, 0], [10, -3]]),
  }),
  pass('flood', 'Flood Right', 'single', 'Three receivers to one side.', ['mid'], 4, 58, {
    WR2: route([[30, 0]], true), TE: route([[9, 0], [13, 8]], true), RB: route([[-1, 6], [2, 13]]), WR1: route([[5, 0], [7, 12]], true), WR3: route([[13, 0], [14, 6]]),
  }),
  pass('post', 'Deep Post', 'single', 'A shot over the middle. Needs protection.', ['deep'], 6, 78, {
    WR1: route([[12, 0], [24, 9]], true), WR2: route([[12, 0], [11, 3]]), WR3: route([[6, 0], [8, 9]], true), TE: route([[5, 0], [6, 4]]),
  }),
  // I-Form
  run('iso', 'Iso', 'iform', 'Fullback leads through the middle.', ['inside', 'power'], 26, { FB: lead([[1, 0.8], [4, 0.8]]), RB: carry([[-3, 0.6], [2, 0.6]]) }),
  run('power', 'Power Right', 'iform', 'Fullback kicks out, tailback follows.', ['inside', 'power'], 28, { FB: lead([[-1, 4], [3, 6]]), RB: carry([[-4, 3], [0, 5.5], [4, 6.5]]) }),
  run('toss', 'Toss Sweep', 'iform', 'Pitch to the wide side. Boom or bust.', ['outside'], 14, { FB: lead([[-3, -7], [1, -10]]), RB: carry([[-5.5, -6], [-2.5, -10.5], [3, -12.5]]) }),
  pass('paFlood', 'Play-Action Flood', 'iform', 'Run look, then three levels right.', ['mid'], 6, 74, {
    TE: route([[8, 0], [12, 7]], true), WR2: route([[26, 0]], true), FB: route([[0, 5], [2, 10]]), WR1: route([[10, 0], [12, 8]], true),
  }),
  pass('teCross', 'Tight End Cross', 'iform', 'Tight end drags across the field.', ['short', 'mid'], 5, 62, {
    TE: route([[7, 0], [9, -12]], true), WR1: route([[13, 0], [12, 2]]), WR2: route([[9, 0], [18, -8]], true), RB: route([[-1, -5], [2, -9]]),
  }),
  // Shotgun
  pass('verticals', 'Four Verticals', 'gun', 'Everyone deep. Needs time to throw.', ['deep'], 2, 72, {
    WR1: route([[40, 0]], true), WR2: route([[40, 0]], true), WR3: route([[12, 0], [26, 5]], true), TE: route([[10, 0], [11, -8]], true), RB: route([[0, 6], [3, 10]]),
  }),
  pass('mesh', 'Mesh', 'gun', 'Crossing routes underneath. Beats man.', ['short'], 2, 60, {
    WR1: route([[2.5, 0], [3.2, 22]], true), WR2: route([[3.5, 0], [4.2, -22]], true), WR3: route([[12, 0], [13, 5]]), TE: route([[10, 0], [16, 6]], true), RB: route([[1, 5], [3, 9]]),
  }),
  run('draw', 'Draw', 'gun', 'Show pass, then hand it off late.', ['inside'], 40, { RB: carry([[-4, 1], [-1, 0.5], [3, 0.5]]) }),
  pass('swing', 'Back Swing', 'gun', 'Dump it to the back in space.', ['quick'], 1, 36, {
    RB: route([[-2, -6], [-1.5, -12]]), WR1: route([[6, 0], [5, 1]]), WR3: route([[14, 0]], true), WR2: route([[10, 0], [9, -3]]),
  }),
  pass('stick', 'Stick', 'gun', 'Short and safe. Take what is there.', ['quick', 'short'], 2, 40, {
    TE: route([[5, 0], [5.5, 3]]), WR2: route([[5, 0], [6, 4]]), WR3: route([[5, 0], [4, 1]]), WR1: route([[14, 0]], true), RB: route([[0, 5], [1, 10]]),
  }),
  // Spread
  run('zone', 'Inside Zone', 'spread', 'Run at a light box.', ['inside'], 20, { RB: carry([[-3, -0.8], [2, -0.8]]) }),
  pass('bubble', 'Bubble', 'spread', 'Quick flip to the slot outside.', ['quick'], 1, 26, {
    WR3: route([[-1, -5]]), WR1: route([[12, 0]], true), WR4: route([[5, 0], [6, -4]], true), WR2: route([[6, 0], [5, -1]]),
  }),
  pass('smash', 'Smash', 'spread', 'Hitch underneath, corner over the top.', ['mid'], 3, 60, {
    WR1: route([[5, 0], [4, 1]]), WR3: route([[9, 0], [16, -7]], true), WR2: route([[5, 0], [4, -1]]), WR4: route([[9, 0], [16, 7]], true), RB: route([[1, 0], [4, 0]]),
  }),
  pass('deepCross', 'Deep Cross', 'spread', 'Slots cross at fifteen. Big play or nothing.', ['deep'], 3, 74, {
    WR3: route([[12, 0], [16, 18]], true), WR4: route([[8, 0], [10, -16]], true), WR1: route([[30, 0]], true), WR2: route([[30, 0]], true),
  }),
  run('qbDraw', 'Quarterback Draw', 'spread', 'The quarterback keeps it up the middle.', ['inside'], 0, { QB: carry([[-3, 0], [2, 0.5]]) }),
  // Heavy
  run('sneak', 'Quarterback Sneak', 'heavy', 'One yard, straight ahead.', ['power'], 0, { QB: carry([[1, 0]]) }),
  run('blast', 'Blast', 'heavy', 'Everyone in. Short yardage and goal line.', ['inside', 'power'], 26, { FB: lead([[1, -0.8], [3, -0.8]]), RB: carry([[-3, -0.6], [2, -0.6]]) }),
];

/** The eight plays a team carries when its coach has not built a book. */
export const DEFAULT_BOOK: readonly string[] = ['dive', 'power', 'toss', 'counter', 'slants', 'curls', 'flood', 'verticals'];
export const BOOK_SIZE = 8;

// ------------------------------------------------------------------ defense

const d = (id: string, group: Group, rank: number, at: Pt, role: DefSlot['role'], zone: Pt, flags: Partial<DefSlot> = {}): DefSlot =>
  ({ id, group, rank, at, role, zone, ...flags });
const dl = (id: string, rank: number, lateral: number): DefSlot => d(id, 'DL', rank, [0.9, lateral], 'DL', [0.9, lateral]);
const CORNERS: DefSlot[] = [d('CB1', 'CB', 1, [6, -19], 'CB', [14, -19], { cover: true }), d('CB2', 'CB', 2, [6, 19], 'CB', [14, 19], { cover: true })];

export const DEFENSE_FRONTS: readonly DefFront[] = [
  {
    id: '43', name: '4-3', desc: 'Four linemen, three linebackers. Balanced.',
    slots: [dl('DE1', 1, -4.4), dl('DT1', 2, -1.4), dl('DT2', 3, 1.4), dl('DE2', 4, 4.4),
      d('OLB1', 'LB', 2, [4.5, -8], 'LB', [8, -10], { cover: true, stuff: true }),
      d('MLB', 'LB', 1, [4.5, 0], 'LB', [9, 0], { blitz: true }),
      d('OLB2', 'LB', 3, [4.5, 5.5], 'LB', [8, 10], { cover: true, stuff: true }),
      ...CORNERS,
      d('FS', 'S', 1, [13, -4], 'S', [17, -9], { deep: true }),
      d('SS', 'S', 2, [10, 7], 'S', [17, 9], { cover: true, blitz: true })],
  },
  {
    id: '52', name: '5-2', desc: 'Five linemen. Built to stop the run.',
    slots: [dl('DE1', 1, -5.2), dl('DT1', 2, -2.6), dl('NG', 5, 0), dl('DT2', 3, 2.6), dl('DE2', 4, 5.2),
      d('ILB1', 'LB', 1, [4.2, -2.4], 'LB', [8, -7], { cover: true, blitz: true }),
      d('ILB2', 'LB', 2, [4.2, 2.4], 'LB', [8, 7], { cover: true, stuff: true }),
      ...CORNERS,
      d('FS', 'S', 1, [12, 0], 'S', [16, -9], { deep: true }),
      d('SS', 'S', 2, [8, 6], 'S', [16, 9], { cover: true, stuff: true })],
  },
  {
    id: 'nickel', name: 'Nickel', desc: 'Five defensive backs. Built to stop the pass.',
    slots: [dl('DE1', 1, -4.4), dl('DT1', 2, -1.4), dl('DT2', 3, 1.4), dl('DE2', 4, 4.4),
      d('LB1', 'LB', 1, [4.5, -2.5], 'LB', [9, -5], { cover: true, blitz: true }),
      d('LB2', 'LB', 2, [4.5, 2.5], 'LB', [9, 5], { cover: true, stuff: true }),
      ...CORNERS,
      d('NB', 'CB', 3, [5, -11], 'NB', [7, -12], { cover: true }),
      d('FS', 'S', 1, [14, -5], 'S', [17, -9], { deep: true }),
      d('SS', 'S', 2, [12, 6], 'S', [17, 9], { cover: true })],
  },
  {
    id: '34', name: '3-4', desc: 'Three linemen, four linebackers. Disguised pressure.',
    slots: [dl('DE1', 1, -3.2), dl('NG', 2, 0), dl('DE2', 3, 3.2),
      d('OLB1', 'LB', 3, [1.2, -6], 'LB', [7, -11], { rushBase: true, stuff: true, blitz: true }),
      d('OLB2', 'LB', 4, [1.2, 6], 'LB', [7, 11], { cover: true, stuff: true, blitz: true }),
      d('ILB1', 'LB', 1, [4.5, -2], 'LB', [9, -4], { cover: true }),
      d('ILB2', 'LB', 2, [4.5, 2], 'LB', [9, 4], { blitz: true }),
      ...CORNERS,
      d('FS', 'S', 1, [13, -3], 'S', [17, -9], { deep: true }),
      d('SS', 'S', 2, [10, 6], 'S', [17, 9], { cover: true })],
  },
];

export const DEFENSE_SCHEMES: readonly DefScheme[] = [
  { id: 'base', name: 'Base', kind: 'balanced', desc: 'Sound against everything. No bonus, no risk.' },
  { id: 'runStuff', name: 'Run Stuff', kind: 'run', desc: 'Linebackers crash the line. Exposed to the pass.' },
  { id: 'coverZone', name: 'Cover Zone', kind: 'pass', desc: 'Drop into zones. Soft against the run.' },
  { id: 'blitz', name: 'Blitz', kind: 'blitz', desc: 'Send extra rushers. Sack or big play.' },
];

/** Combines a front with a call: what each of the eleven defenders does on this snap. */
export function defAssignment(slot: DefSlot, scheme: string): DefAssign {
  if (slot.assign) return slot.assign;
  if (slot.role === 'DL') return { t: 'rush' };
  const isDb = slot.role === 'CB' || slot.role === 'NB';
  switch (scheme) {
    case 'runStuff':
      if (slot.stuff) return { t: 'rush' };
      if (slot.deep) return { t: 'zone', at: [12, slot.at[1]] };
      if (isDb) return { t: 'man', cushion: slot.role === 'CB' ? 4 : 3 };
      if (slot.role === 'S') return { t: 'man', cushion: 2 };
      return { t: 'read' };
    case 'coverZone':
      if (slot.rushBase) return { t: 'rush' };
      if (slot.role === 'CB') return { t: 'man', cushion: 5.5 };
      return { t: 'zone', at: slot.zone };
    case 'blitz':
      if (slot.blitz || slot.rushBase) return { t: 'rush' };
      if (slot.deep) return { t: 'zone', at: [13, 0] };
      return { t: 'man', cushion: 3 };
    default:
      if (slot.rushBase) return { t: 'rush' };
      if (slot.deep) return { t: 'zone', at: [14, 0] };
      if (slot.role === 'CB') return { t: 'man', cushion: 5 };
      if (slot.cover) return { t: 'man', cushion: slot.role === 'LB' ? 3.5 : 4 };
      return { t: 'read' };
  }
}

const byId = <T extends { id: string }>(items: readonly T[], what: string) => (id: string): T => {
  const x = items.find((i) => i.id === id);
  if (!x) throw new Error(`unknown ${what} ${id}`);
  return x;
};
export const playById = byId(OFFENSE_PLAYS, 'play');
export const formationById = byId(FORMATIONS, 'formation');
export const frontById = byId(DEFENSE_FRONTS, 'front');
export const schemeById = byId(DEFENSE_SCHEMES, 'defensive call');

/** A book is valid when it has exactly eight distinct plays (library or the coach's own designs) with at least one run and one pass. */
export function validateBook(ids: readonly string[], designed: readonly OffPlay[] = []): string | null {
  if (ids.length !== BOOK_SIZE) return `A playbook needs exactly ${BOOK_SIZE} plays.`;
  if (new Set(ids).size !== ids.length) return 'A play can only be in the book once.';
  const plays = ids.map((id) => designed.find((p) => p.id === id) ?? OFFENSE_PLAYS.find((p) => p.id === id));
  if (plays.some((p) => !p)) return 'Unknown play in the book.';
  if (!plays.some((p) => p!.kind === 'run') || !plays.some((p) => p!.kind === 'pass')) return 'Carry at least one run and one pass.';
  return null;
}
