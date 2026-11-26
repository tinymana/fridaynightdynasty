import { FORMATIONS, OFFENSE_PLAYS } from './playbook';
import type { DefAssign, DefFront, DefRole, DefScheme, DefSlot, Group, OffAssign, OffFormation, OffPlay, PlayTag, Pt, SchemeKind, Slot } from './types';

/**
 * Coach-designed plays. A designed play is the same data as a library play, plus its own alignment.
 * Everything here is validation: the server runs it on every design it is sent, so an illegal or
 * malformed play can never reach the field.
 */

/** A coach-designed defense: eleven defenders, each with his own alignment and job. */
export interface DefPlay {
  id: string;
  name: string;
  kind: SchemeKind;
  slots: readonly (DefSlot & { assign: DefAssign })[];
}

/** `frontId` used in a defensive decision when the call is a designed defense (its id goes in `callId`). */
export const CUSTOM_FRONT = '@custom';
export const MAX_CUSTOM_PLAYS = 12;
export const MAX_CUSTOM_DEFENSES = 6;

const OFF_LIMIT: Partial<Record<Group, number>> = { QB: 1, RB: 3, WR: 5, TE: 2, OL: 5 };
const DEF_LIMIT: Partial<Record<Group, number>> = { DL: 6, LB: 5, CB: 4, S: 3 };
const OFF_IDS: Partial<Record<Group, string[]>> = { QB: ['QB'], RB: ['RB', 'FB', 'RB3'], WR: ['WR1', 'WR2', 'WR3', 'WR4', 'WR5'], TE: ['TE', 'TE2'], OL: ['LT', 'LG', 'C', 'RG', 'RT'] };
const MIN_GAP = 0.9;
const ID_RE = /^c_[a-z0-9]{6,16}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-]{0,23}$/;

const r1 = (n: number): number => Math.round(n * 10) / 10;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pt = (v: unknown): Pt | null => (Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) ? [r1(v[0]), r1(v[1])] : null);

/** Gives slots their standard names and depth-chart ranks: the first receiver listed is WR1, and so on. Linemen are named left to right. */
export function namedSlots(list: readonly { group: Group; at: Pt }[]): Slot[] {
  const seen: Partial<Record<Group, number>> = {};
  const line = list.filter((s) => s.group === 'OL').map((s) => s.at[1]).sort((a, b) => a - b);
  return list.map((s) => {
    if (s.group === 'OL') {
      const rank = line.indexOf(s.at[1]) + 1;
      line[rank - 1] = NaN;
      return { id: OFF_IDS.OL![rank - 1] ?? `OL${rank}`, group: s.group, rank, at: s.at };
    }
    const rank = (seen[s.group] = (seen[s.group] ?? 0) + 1);
    return { id: OFF_IDS[s.group]?.[rank - 1] ?? `${s.group}${rank}`, group: s.group, rank, at: s.at };
  });
}

export function namedDefSlots(list: readonly { group: Group; at: Pt; assign: DefAssign }[]): (DefSlot & { assign: DefAssign })[] {
  const seen: Partial<Record<Group, number>> = {};
  return list.map((s) => {
    const rank = (seen[s.group] = (seen[s.group] ?? 0) + 1);
    const role: DefRole = s.group === 'DL' ? 'DL' : s.group === 'LB' ? 'LB' : s.group === 'S' ? 'S' : rank <= 2 ? 'CB' : 'NB';
    return { id: `${s.group}${rank}`, group: s.group, rank, at: s.at, role, zone: s.assign.t === 'zone' ? s.assign.at : s.at, assign: s.assign };
  });
}

/** The alignment a play lines up in: its own if it was designed, otherwise its library formation. */
export function formationOf(play: OffPlay): OffFormation {
  if (play.slots) return { id: play.id, name: 'Custom', slots: play.slots };
  const f = FORMATIONS.find((x) => x.id === play.formation);
  if (!f) throw new Error(`unknown formation ${play.formation}`);
  return f;
}

export const toFront = (d: DefPlay): DefFront => ({ id: CUSTOM_FRONT, name: d.name, desc: 'Designed defense', slots: d.slots });
export const toScheme = (d: DefPlay): DefScheme => ({ id: d.id, name: d.name, kind: d.kind, desc: 'Designed defense' });

function tooClose(slots: readonly { at: Pt }[]): boolean {
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const dx = slots[i].at[0] - slots[j].at[0];
    const dy = slots[i].at[1] - slots[j].at[1];
    if (dx * dx + dy * dy < MIN_GAP * MIN_GAP) return true;
  }
  return false;
}

function path(raw: unknown, max: number, dMin: number, dMax: number, lMin: number, lMax: number, from: Pt): Pt[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > max) return null;
  const out: Pt[] = [];
  let prev = from;
  for (const v of raw) {
    const p = pt(v);
    if (!p || p[0] < dMin || p[0] > dMax || p[1] < lMin || p[1] > lMax) return null;
    const dx = p[0] - prev[0];
    const dy = p[1] - prev[1];
    if (dx * dx + dy * dy < 1) return null;
    out.push(p);
    prev = p;
  }
  return out;
}

/** When the ball is handed off: about when the carrier reaches his first waypoint. */
export function autoHandoff(carrierAt: Pt, firstPoint: Pt): number {
  const dx = firstPoint[0] - carrierAt[0];
  const dy = firstPoint[1] - carrierAt[1];
  return Math.max(10, Math.min(50, Math.round((Math.sqrt(dx * dx + dy * dy) / 7.2) * 60)));
}

function deriveTags(kind: 'run' | 'pass', assign: Record<string, OffAssign>, slots: readonly Slot[]): PlayTag[] {
  const tags = new Set<PlayTag>();
  if (kind === 'run') {
    const c = Object.values(assign).find((a) => a.t === 'carry') as { pts: readonly Pt[] } | undefined;
    const wide = c ? Math.max(...c.pts.map((p) => Math.abs(p[1]))) : 0;
    tags.add(wide >= 8 ? 'outside' : 'inside');
    if (Object.values(assign).some((a) => a.t === 'lead') || slots.filter((s) => s.group === 'TE' || s.group === 'RB').length >= 4) tags.add('power');
  } else {
    let deepest = 0;
    for (const a of Object.values(assign)) if (a.t === 'route') deepest = Math.max(deepest, ...a.pts.map((p) => p[0]));
    tags.add(deepest >= 18 ? 'deep' : deepest >= 9 ? 'mid' : 'short');
    if (deepest < 7) tags.add('quick');
  }
  return [...tags];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/**
 * Checks a designed offensive play against the rules of the game and returns a clean copy.
 * Anything not understood is dropped; anything illegal is reported in plain words.
 */
export function validateOffPlay(raw: unknown): Checked<OffPlay> {
  const problems: string[] = [];
  const p = (raw ?? {}) as Record<string, unknown>;
  const id = typeof p['id'] === 'string' && ID_RE.test(p['id']) ? p['id'] : '';
  if (!id) problems.push('The play has no valid id.');
  if (id && OFFENSE_PLAYS.some((x) => x.id === id)) problems.push('That id belongs to a library play.');
  const name = typeof p['name'] === 'string' ? p['name'].trim() : '';
  if (!NAME_RE.test(name)) problems.push('Give the play a name of up to 24 letters, numbers and spaces.');
  const rawSlots = Array.isArray(p['slots']) ? (p['slots'] as Record<string, unknown>[]) : [];
  if (rawSlots.length !== 11) return { ok: false, problems: [...problems, 'A play needs exactly eleven players.'] };

  const list: { group: Group; at: Pt }[] = [];
  for (const s of rawSlots) {
    const at = pt(s?.['at']);
    const group = s?.['group'] as Group;
    if (!at || !(group in OFF_LIMIT)) return { ok: false, problems: [...problems, 'Every player needs an offensive position and a spot on the field.'] };
    list.push({ group, at });
  }
  const count = (g: Group): number => list.filter((s) => s.group === g).length;
  if (count('QB') !== 1) problems.push('A play needs exactly one quarterback.');
  if (count('OL') !== 5) problems.push('A play needs exactly five offensive linemen.');
  for (const g of ['RB', 'WR', 'TE'] as const) if (count(g) > OFF_LIMIT[g]!) problems.push(`The roster only has ${OFF_LIMIT[g]} ${g}s.`);
  for (const s of list) {
    if (s.at[0] > -0.5) problems.push('Everyone must line up behind the ball.');
    if (s.at[0] < -12 || Math.abs(s.at[1]) > 25) problems.push('A player is lined up off the field or too deep in the backfield.');
    if (s.group === 'OL' && (s.at[0] < -1 || Math.abs(s.at[1]) > 7)) problems.push('Linemen must be on the line of scrimmage, inside the tackles\' area.');
    if (s.group === 'QB' && (Math.abs(s.at[1]) > 4 || s.at[0] > -1 || s.at[0] < -8)) problems.push('The quarterback lines up behind the center, between 1 and 8 yards deep.');
  }
  if (list.filter((s) => s.at[0] >= -1).length < 7) problems.push('At least seven players must be on the line of scrimmage.');
  if (tooClose(list)) problems.push('Two players are standing on top of each other.');

  const slots = namedSlots(list);
  // The design may arrive with slot ids already set; they must be the standard ones.
  rawSlots.forEach((s, i) => {
    if (typeof s['id'] === 'string' && s['id'] !== slots[i].id) problems.push('Player names are out of order.');
  });
  const rawAssign = (p['assign'] ?? {}) as Record<string, unknown>;
  const assign: Record<string, OffAssign> = {};
  let carrier: Slot | null = null;
  let routes = 0;
  for (const slot of slots) {
    const a = (rawAssign[slot.id] ?? {}) as Record<string, unknown>;
    const t = a['t'];
    const skill = slot.group === 'RB' || slot.group === 'WR' || slot.group === 'TE';
    if (slot.group === 'OL') {
      if (t !== undefined && t !== 'block') problems.push('Linemen can only block.');
      assign[slot.id] = { t: 'block' };
    } else if (t === 'carry' && (skill || slot.group === 'QB')) {
      const pts = path(a['pts'], 4, -9, 6, -24, 24, slot.at);
      if (!pts) problems.push(`${slot.id}: a run path needs 1 to 4 points near the line of scrimmage.`);
      if (carrier) problems.push('Only one player can carry the ball.');
      carrier = slot;
      const qbAt = list.find((x) => x.group === 'QB')?.at;
      if (slot.group !== 'QB' && qbAt) {
        const gx = slot.at[0] - qbAt[0];
        const gy = slot.at[1] - qbAt[1];
        if (slot.at[0] > -1.5 || gx * gx + gy * gy > 6.5 * 6.5) problems.push('The ball carrier must start in the backfield, within reach of a handoff or pitch from the quarterback.');
      }
      assign[slot.id] = { t: 'carry', pts: pts ?? [[1, 0]] };
    } else if (slot.group === 'QB') {
      assign[slot.id] = { t: 'qb' };
    } else if (t === 'route') {
      // Route points are relative to where the player lines up.
      const lMin = -25.5 - slot.at[1];
      const lMax = 25.5 - slot.at[1];
      const pts = path(a['pts'], 4, -3, 40, lMin, lMax, [0, 0]);
      if (!pts) problems.push(`${slot.id}: a route needs 1 to 4 points that stay on the field.`);
      routes++;
      assign[slot.id] = { t: 'route', pts: pts ?? [[5, 0]], go: a['go'] === true };
    } else if (t === 'lead') {
      const pts = path(a['pts'], 3, -9, 6, -24, 24, slot.at);
      if (!pts) problems.push(`${slot.id}: a lead block needs 1 to 3 points near the line of scrimmage.`);
      assign[slot.id] = { t: 'lead', pts: pts ?? [[1, 0]] };
    } else {
      assign[slot.id] = { t: 'block' };
    }
  }
  const kind: 'run' | 'pass' = carrier ? 'run' : 'pass';
  if (kind === 'run') {
    if (routes) problems.push('On a run, everyone without the ball blocks.');
  } else {
    if (routes < 1) problems.push('A pass needs at least one receiver running a route, or give someone the ball to make it a run.');
    if (Object.values(assign).some((a) => a.t === 'lead')) problems.push('Lead blocks are for runs.');
  }
  const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number => (num(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback);
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  const play: OffPlay = {
    id, name, kind, formation: 'custom', slots, assign, desc: typeof p['desc'] === 'string' ? p['desc'].slice(0, 60) : 'Your design.',
    tags: deriveTags(kind, assign, slots),
  };
  if (kind === 'run') {
    const c = carrier as unknown as Slot;
    const first = (assign[c.id] as { pts: readonly Pt[] }).pts[0];
    play.handoffTick = c.group === 'QB' ? 0 : clampNum(p['handoffTick'], 0, 60, autoHandoff(c.at, first));
  } else {
    play.dropDepth = clampNum(p['dropDepth'], 1, 8, 4);
    play.readStart = clampNum(p['readStart'], 20, 100, 60);
  }
  return { ok: true, value: play };
}

/** Which focus a designed defense may claim, given how it is actually built. A null reason means allowed. */
export function defKindRules(slots: readonly { at: Pt; assign: DefAssign }[]): Record<SchemeKind, string | null> {
  const rushers = slots.filter((s) => s.assign.t === 'rush').length;
  const zones = slots.filter((s) => s.assign.t === 'zone').length;
  const box = slots.filter((s) => s.at[0] <= 5).length;
  return {
    balanced: null,
    pass: rushers <= 5 && zones >= 3 ? null : 'Needs five rushers or fewer and at least three in zone.',
    run: rushers >= 5 && box >= 6 ? null : 'Needs at least five rushers and six within 5 yards of the ball.',
    blitz: rushers >= 5 ? null : 'Needs at least five rushers.',
  };
}

export function validateDefPlay(raw: unknown): Checked<DefPlay> {
  const problems: string[] = [];
  const p = (raw ?? {}) as Record<string, unknown>;
  const id = typeof p['id'] === 'string' && ID_RE.test(p['id']) ? p['id'] : '';
  if (!id) problems.push('The defense has no valid id.');
  const name = typeof p['name'] === 'string' ? p['name'].trim() : '';
  if (!NAME_RE.test(name)) problems.push('Give the defense a name of up to 24 letters, numbers and spaces.');
  const rawSlots = Array.isArray(p['slots']) ? (p['slots'] as Record<string, unknown>[]) : [];
  if (rawSlots.length !== 11) return { ok: false, problems: [...problems, 'A defense needs exactly eleven players.'] };

  const list: { group: Group; at: Pt; assign: DefAssign }[] = [];
  for (const s of rawSlots) {
    const at = pt(s?.['at']);
    const group = s?.['group'] as Group;
    if (!at || !(group in DEF_LIMIT)) return { ok: false, problems: [...problems, 'Every defender needs a defensive position and a spot on the field.'] };
    const a = (s['assign'] ?? {}) as Record<string, unknown>;
    let assign: DefAssign;
    if (a['t'] === 'rush') assign = { t: 'rush' };
    else if (a['t'] === 'man') assign = { t: 'man', cushion: num(a['cushion']) ? Math.max(1, Math.min(8, r1(a['cushion']))) : 4 };
    else if (a['t'] === 'zone') {
      const z = pt(a['at']);
      if (!z || z[0] < 1 || z[0] > 25 || Math.abs(z[1]) > 24) {
        problems.push('A zone must be placed on the defense\'s side of the field.');
        assign = { t: 'read' };
      } else assign = { t: 'zone', at: z };
    } else assign = { t: 'read' };
    list.push({ group, at, assign });
  }
  for (const g of ['DL', 'LB', 'CB', 'S'] as const) if (list.filter((s) => s.group === g).length > DEF_LIMIT[g]!) problems.push(`The roster only has ${DEF_LIMIT[g]} ${g}s.`);
  for (const s of list) {
    if (s.at[0] < 0.8) problems.push('Defenders must line up on their own side of the ball.');
    if (s.at[0] > 25 || Math.abs(s.at[1]) > 25) problems.push('A defender is lined up off the field or too deep.');
  }
  if (tooClose(list)) problems.push('Two defenders are standing on top of each other.');
  const rushers = list.filter((s) => s.assign.t === 'rush').length;
  if (rushers < 3) problems.push('Send at least three rushers.');
  if (rushers > 8) problems.push('Send at most eight rushers.');
  const kind = (['balanced', 'run', 'pass', 'blitz'] as const).find((k) => k === p['kind']) ?? 'balanced';
  const why = defKindRules(list)[kind];
  if (why) problems.push(`This defense cannot be called a ${kind === 'blitz' ? 'pressure' : kind} defense. ${why}`);
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, value: { id, name, kind, slots: namedDefSlots(list) } };
}

// ------------------------------------------------------------------ drafts

import { defAssignment } from './playbook';

export interface OffDraft {
  id: string;
  name: string;
  slots: { group: Group; at: Pt }[];
  /** One job per slot, in slot order. */
  jobs: OffAssign[];
  dropDepth: number;
  readStart: number;
}

export interface DefDraft {
  id: string;
  name: string;
  kind: SchemeKind;
  slots: { group: Group; at: Pt; assign: DefAssign }[];
}

export const newDesignId = (random: () => number): string => {
  let s = 'c_';
  for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
  return s;
};

/** An editable copy of an existing play, to start a design from. */
export function draftFromPlay(play: OffPlay, id: string, name: string): OffDraft {
  const f = formationOf(play);
  return {
    id, name,
    slots: f.slots.map((s) => ({ group: s.group, at: s.at })),
    jobs: f.slots.map((s) => play.assign[s.id] ?? (s.group === 'QB' ? { t: 'qb' } : { t: 'block' })),
    dropDepth: play.dropDepth ?? 4,
    readStart: play.readStart ?? 60,
  };
}

/** Turns an editor draft into the play format, ready for validation. */
export function playFromDraft(d: OffDraft): unknown {
  const slots = namedSlots(d.slots);
  const assign: Record<string, OffAssign> = {};
  slots.forEach((s, i) => {
    assign[s.id] = d.jobs[i];
  });
  return { id: d.id, name: d.name, slots, assign, dropDepth: d.dropDepth, readStart: d.readStart };
}

export function draftFromFront(front: DefFront, scheme: DefScheme, id: string, name: string): DefDraft {
  return { id, name, kind: scheme.kind, slots: front.slots.map((s) => ({ group: s.group, at: s.at, assign: defAssignment(s, scheme.id) })) };
}

export function draftFromDefense(d: DefPlay, id: string, name: string): DefDraft {
  return { id, name, kind: d.kind, slots: d.slots.map((s) => ({ group: s.group, at: s.at, assign: s.assign })) };
}
