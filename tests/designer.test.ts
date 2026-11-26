import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FRONT, DEFAULT_BOOK, DEFENSE_FRONTS, DEFENSE_SCHEMES, OFFENSE_PLAYS, Rng, defKindRules, draftFromFront, draftFromPlay, exhibitionTeams,
  formationOf, playById, playFromDraft, validateBook, validateDefPlay, validateOffPlay, type DefDraft, type OffDraft, type OffPlay, type DefPlay,
} from '@fnd/core';
import { Game, PlaySim, gameHash, replayGame, simulateGame } from '@fnd/match-sim';

/** Milestone 2c acceptance: coach-designed plays are validated, run in the engine, and cannot break the rules. */

const offDraft = (from = 'curls', id = 'c_testplay01', name = 'My Play'): OffDraft => draftFromPlay(playById(from), id, name);
const checkOff = (d: OffDraft) => validateOffPlay(playFromDraft(d));
const okOff = (d: OffDraft): OffPlay => {
  const r = checkOff(d);
  if (!r.ok) throw new Error(r.problems.join(' | '));
  return r.value;
};
const problems = (r: { ok: boolean; problems?: string[] }): string => (r.ok ? '' : (r.problems ?? []).join(' | '));
const defDraft = (front = '43', scheme = 'base', id = 'c_testdef001', name = 'My D'): DefDraft =>
  draftFromFront(DEFENSE_FRONTS.find((f) => f.id === front)!, DEFENSE_SCHEMES.find((s) => s.id === scheme)!, id, name);
const okDef = (d: DefDraft): DefPlay => {
  const r = validateDefPlay(d);
  if (!r.ok) throw new Error(r.problems.join(' | '));
  return r.value;
};

describe('designed offensive plays', () => {
  it('every library play is itself a legal design', () => {
    OFFENSE_PLAYS.forEach((p, i) => {
      const r = checkOff(draftFromPlay(p, `c_lib${String(i).padStart(6, '0')}`, p.name.replace(/[^A-Za-z0-9 ]/g, '')));
      expect(problems(r), p.id).toBe('');
      if (r.ok) {
        expect(r.value.kind).toBe(p.kind);
        expect(formationOf(r.value).slots.length).toBe(11);
      }
    });
  });
  it('names the kind from what the play does, and derives tags and timing', () => {
    const pass = okOff(offDraft('verticals'));
    expect(pass.kind).toBe('pass');
    expect(pass.tags).toContain('deep');
    const run = okOff(offDraft('toss'));
    expect(run.kind).toBe('run');
    expect(run.tags).toContain('outside');
    expect(run.handoffTick).toBeGreaterThan(0);
    expect(okOff(offDraft('sneak')).handoffTick).toBe(0);
  });
  const bad: [string, (d: OffDraft) => void, RegExp][] = [
    ['ten players', (d) => { d.slots.pop(); d.jobs.pop(); }, /eleven/],
    ['two quarterbacks', (d) => { d.slots[1].group = 'QB'; }, /one quarterback/],
    ['four linemen', (d) => { const i = d.slots.findIndex((s) => s.group === 'OL'); d.slots[i].group = 'WR'; }, /five offensive linemen/],
    ['six receivers', (d) => { d.slots.forEach((s) => { if (s.group === 'RB' || s.group === 'TE') s.group = 'WR'; }); d.slots.find((s) => s.group === 'QB')!.group = 'WR'; }, /quarterback|roster only has/],
    ['a defender on offense', (d) => { d.slots[1].group = 'LB'; }, /offensive position/],
    ['a player beyond the ball', (d) => { d.slots[1].at = [2, 0.5]; }, /behind the ball/],
    ['a player off the field', (d) => { d.slots[1].at = [-3, 30]; }, /off the field/],
    ['fewer than seven on the line', (d) => { d.slots.forEach((s) => { if (s.group === 'WR' || s.group === 'TE') s.at = [-3, s.at[1]]; }); }, /seven players/],
    ['a lineman in the backfield', (d) => { const s = d.slots.find((x) => x.group === 'OL')!; s.at = [-4, s.at[1]]; }, /Linemen must be on the line/],
    ['a quarterback out wide', (d) => { d.slots.find((s) => s.group === 'QB')!.at = [-5, 12]; }, /quarterback lines up/],
    ['two players in one spot', (d) => { d.slots[1].at = [d.slots[2].at[0], d.slots[2].at[1] + 0.2]; }, /on top of each other/],
    ['a lineman running a route', (d) => { const i = d.slots.findIndex((s) => s.group === 'OL'); d.jobs[i] = { t: 'route', pts: [[5, 0]] }; }, /Linemen can only block/],
    ['two ball carriers', (d) => { d.jobs.forEach((j, i) => { if (j.t === 'route') d.jobs[i] = { t: 'carry', pts: [[2, 0]] }; }); }, /Only one player can carry/],
    ['a pass with no routes', (d) => { d.jobs.forEach((j, i) => { if (j.t === 'route') d.jobs[i] = { t: 'block' }; }); }, /at least one receiver/],
    ['a route off the field', (d) => { const i = d.jobs.findIndex((j) => j.t === 'route'); d.jobs[i] = { t: 'route', pts: [[5, 60]] }; }, /stay on the field/],
    ['a route with too many points', (d) => { const i = d.jobs.findIndex((j) => j.t === 'route'); d.jobs[i] = { t: 'route', pts: [[2, 0], [4, 0], [6, 0], [8, 0], [10, 0]] }; }, /1 to 4 points/],
    ['a route 60 yards deep', (d) => { const i = d.jobs.findIndex((j) => j.t === 'route'); d.jobs[i] = { t: 'route', pts: [[60, 0]] }; }, /stay on the field/],
    ['not-a-number coordinates', (d) => { d.slots[1].at = [Number.NaN, 0]; }, /spot on the field/],
    ['an empty name', (d) => { d.name = '   '; }, /name/],
    ['a name with markup', (d) => { d.name = '<b>hi</b>'; }, /name/],
    ['a library play id', (d) => { d.id = 'dive'; }, /valid id/],
  ];
  for (const [name, mutate, want] of bad) {
    it(`refuses ${name}`, () => {
      const d = offDraft();
      mutate(d);
      const r = checkOff(d);
      expect(r.ok).toBe(false);
      expect(problems(r)).toMatch(want);
    });
  }
  it('refuses routes on a run and lead blocks on a pass', () => {
    const run = offDraft('dive');
    const wr = run.slots.findIndex((s) => s.group === 'WR');
    run.jobs[wr] = { t: 'route', pts: [[20, 0]], go: true };
    expect(problems(checkOff(run))).toMatch(/everyone without the ball blocks/);
    const pass = offDraft('curls');
    const rb = pass.slots.findIndex((s) => s.group === 'RB');
    pass.jobs[rb] = { t: 'lead', pts: [[1, 0]] };
    expect(problems(checkOff(pass))).toMatch(/Lead blocks are for runs/);
  });
  it('clamps timing values and ignores fields it does not know', () => {
    const raw = playFromDraft(offDraft()) as Record<string, unknown>;
    const r = validateOffPlay({ ...raw, dropDepth: 500, readStart: -4, edge: 99, kind: 'run', tags: ['power'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.dropDepth).toBe(8);
      expect(r.value.readStart).toBe(20);
      expect(r.value.kind).toBe('pass');
      expect(r.value.tags).not.toContain('power');
      expect('edge' in r.value).toBe(false);
    }
  });
});

describe('designed defenses', () => {
  it('every library front and call is itself a legal design', () => {
    for (const f of DEFENSE_FRONTS) for (const s of DEFENSE_SCHEMES) {
      const r = validateDefPlay(defDraft(f.id, s.id));
      expect(problems(r), `${f.id} ${s.id}`).toBe('');
    }
  });
  it('only lets a defense claim a focus its alignment supports', () => {
    const d = defDraft('43', 'base');
    const rules = defKindRules(d.slots);
    expect(rules.balanced).toBeNull();
    expect(rules.blitz).not.toBeNull();
    d.kind = 'blitz';
    expect(problems(validateDefPlay(d))).toMatch(/pressure defense/);
    const zone = defDraft('43', 'coverZone');
    zone.kind = 'run';
    expect(problems(validateDefPlay(zone))).toMatch(/run defense/);
  });
  const bad: [string, (d: DefDraft) => void, RegExp][] = [
    ['ten defenders', (d) => { d.slots.pop(); }, /eleven/],
    ['an offensive player', (d) => { d.slots[0].group = 'WR'; }, /defensive position/],
    ['seven linemen', (d) => { d.slots.forEach((s) => { if (s.group === 'LB') s.group = 'DL'; }); }, /roster only has 6 DLs/],
    ['a defender in the backfield', (d) => { d.slots[0].at = [-2, 0]; }, /own side of the ball/],
    ['a defender off the field', (d) => { d.slots[8].at = [10, 40]; }, /off the field/],
    ['stacked defenders', (d) => { d.slots[1].at = [d.slots[0].at[0], d.slots[0].at[1] + 0.3]; }, /on top of each other/],
    ['nobody rushing', (d) => { d.slots.forEach((s) => { s.assign = { t: 'read' }; }); }, /at least three rushers/],
    ['everybody rushing', (d) => { d.slots.forEach((s) => { s.assign = { t: 'rush' }; }); }, /at most eight rushers/],
    ['a zone in the offensive backfield', (d) => { d.slots[9].assign = { t: 'zone', at: [-5, 0] }; }, /zone must be placed/],
  ];
  for (const [name, mutate, want] of bad) {
    it(`refuses ${name}`, () => {
      const d = defDraft();
      mutate(d);
      const r = validateDefPlay(d);
      expect(r.ok).toBe(false);
      expect(problems(r)).toMatch(want);
    });
  }
});

describe('designed plays in a game', () => {
  const teams = exhibitionTeams(77);
  const myPlay = okOff((() => {
    const d = offDraft('curls', 'c_gameplay01', 'Sideline Shot');
    const wr = d.slots.findIndex((s) => s.group === 'WR');
    d.jobs[wr] = { t: 'route', pts: [[8, 0], [14, -4]], go: true };
    return d;
  })());
  const myDef = okDef((() => {
    const d = defDraft('43', 'base', 'c_gamedef001', 'Bear');
    d.slots[9].at = [7, -3];
    return d;
  })());
  const book = [...DEFAULT_BOOK.slice(0, 7), myPlay.id];

  it('a designed play can be put in the book and is run by the engine', () => {
    expect(validateBook(book, [myPlay])).toBeNull();
    expect(validateBook(book)).not.toBeNull();
    const g = new Game(77, teams, { books: [book, DEFAULT_BOOK], plays: [[myPlay], []] });
    g.begin(null, null);
    g.tick();
    let ran = false;
    for (let i = 0; i < 200 && !ran && g.state.phase !== 'final'; i++) {
      if (g.state.phase === 'kickoff') g.begin(null, null);
      else if (g.state.phase === 'conversion') g.begin({ kind: 'patKick' }, { frontId: '43', callId: 'base' });
      else if (g.state.possession === 0) {
        g.begin({ kind: 'play', playId: myPlay.id }, { frontId: '43', callId: 'base' });
        ran = true;
      } else g.begin({ kind: 'punt' }, { frontId: '43', callId: 'base' });
      while (!g.tick()) { /* step */ }
    }
    expect(ran).toBe(true);
    expect(g.events.some((e) => e.offCall === myPlay.id && e.type === 'pass')).toBe(true);
  });
  it('a coach cannot call the other team\'s design, or a design that was never registered', () => {
    const g = new Game(77, teams, { books: [book, DEFAULT_BOOK], plays: [[myPlay], []], defenses: [[myDef], []] });
    g.begin(null, null);
    g.tick();
    const offense = g.state.possession;
    if (offense === 1) expect(() => g.begin({ kind: 'play', playId: myPlay.id }, { frontId: '43', callId: 'base' })).toThrow(/playbook/);
    else expect(() => g.begin({ kind: 'play', playId: 'dive' }, { frontId: CUSTOM_FRONT, callId: myDef.id })).toThrow(/designs/);
    expect(() => g.begin({ kind: 'play', playId: DEFAULT_BOOK[0] }, { frontId: CUSTOM_FRONT, callId: 'c_nothere0001' })).toThrow();
  });
  it('the game refuses an illegal design at the door', () => {
    const cheat = { ...myPlay, slots: myPlay.slots!.map((s, i) => (i === 1 ? { ...s, at: [5, 0] } : s)) };
    expect(() => new Game(1, teams, { books: [book, DEFAULT_BOOK], plays: [[cheat as never], []] })).toThrow(/behind the ball/);
    const blitzClaim = { ...myDef, kind: 'blitz' };
    expect(() => new Game(1, teams, { defenses: [[blitzClaim as never], []] })).toThrow(/pressure/);
  });
  it('a designed defense lines up and plays as drawn', () => {
    const g = new Game(5, teams, { defenses: [[myDef], [myDef]] });
    const { front, scheme } = g.defenseOf(0, { frontId: CUSTOM_FRONT, callId: myDef.id });
    const play = playById('dive');
    const sim = new PlaySim({
      play, formation: formationOf(play), front, scheme, offPlayers: g.lineup(1, formationOf(play).slots), defPlayers: g.lineup(0, front.slots),
      offEnergy: Array(11).fill(100), defEnergy: Array(11).fill(100), los: 30, rng: new Rng(3),
    });
    const moved = sim.players[11 + 9];
    expect(moved.x).toBe((30 + 7) * 256);
    while (!sim.done) sim.step();
    expect(sim.result).not.toBeNull();
  });
  it('games with designed plays and defenses replay exactly', () => {
    const opts = { books: [book, DEFAULT_BOOK] as [string[], readonly string[]], plays: [[myPlay], []] as [OffPlay[], OffPlay[]], defenses: [[myDef], [myDef]] as [DefPlay[], DefPlay[]] };
    const g = simulateGame(123, teams, opts);
    expect(g.events.some((e) => e.offCall === myPlay.id)).toBe(true);
    expect(gameHash(replayGame(123, teams, g.log, opts))).toBe(gameHash(g));
  });
});
