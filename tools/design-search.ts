/**
 * Balance guard for the play designer: generates random legal offensive designs, runs each against every library
 * front and call, and reports the best ones against the library's own average.
 * Usage: npx tsx tools/design-search.ts [candidates] [seed]
 */
import {
  DEFENSE_FRONTS, DEFENSE_SCHEMES, FORMATIONS, OFFENSE_PLAYS, Rng, exhibitionTeams, formationOf, playFromDraft, validateOffPlay,
  type Group, type OffAssign, type OffDraft, type OffPlay, type Pt,
} from '@fnd/core';
import { Game, PlaySim } from '@fnd/match-sim';

const N = Number(process.argv[2] ?? 300);
const rng = new Rng(Number(process.argv[3] ?? 1));
const teams = exhibitionTeams(1);
const g = new Game(1, teams);

function average(play: OffPlay, sims: number, seed0: number): number {
  const formation = formationOf(play);
  let total = 0;
  let n = 0;
  for (const front of DEFENSE_FRONTS) for (const scheme of DEFENSE_SCHEMES) for (let s = 0; s < sims; s++) {
    const off = g.lineup(0, formation.slots);
    const def = g.lineup(1, front.slots);
    const sim = new PlaySim({ play, formation, front, scheme, offPlayers: off, defPlayers: def, offEnergy: off.map(() => 100), defEnergy: def.map(() => 100), los: 30, rng: new Rng(seed0 + s * 7919 + n) });
    while (!sim.done) sim.step();
    total += sim.result!.yards;
    n++;
  }
  return total / n;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
function randomDraft(i: number): OffDraft {
  const base = rng.pick(FORMATIONS);
  const slots = base.slots.map((s) => ({ group: s.group as Group, at: [s.at[0], s.at[1]] as Pt }));
  // Shuffle the skill players around, keeping the line and quarterback where they are.
  for (const s of slots) {
    if (s.group === 'OL' || s.group === 'QB') continue;
    if (rng.chance(0.6)) s.at = [s.at[0] >= -1 ? -0.6 : r1(rng.range(-7, -1.5)), r1(rng.range(-24, 24))];
  }
  const isRun = rng.chance(0.4);
  const skill = slots.map((s, k) => k).filter((k) => slots[k].group !== 'OL' && slots[k].group !== 'QB');
  const jobs: OffAssign[] = slots.map((s) => (s.group === 'QB' ? { t: 'qb' } : { t: 'block' }));
  if (isRun) {
    const backs = skill.filter((k) => slots[k].at[0] < -1.2);
    const c = rng.chance(0.15) ? slots.findIndex((s) => s.group === 'QB') : rng.pick(backs.length ? backs : skill);
    const lat = r1(rng.range(-16, 16));
    jobs[c] = { t: 'carry', pts: [[r1(rng.range(-5, -1)), r1(lat * 0.6)], [r1(rng.range(0.5, 4)), lat]] };
    for (const k of skill) if (k !== c && rng.chance(0.25)) jobs[k] = { t: 'lead', pts: [[r1(rng.range(-2, 1)), r1(lat * 0.7)], [r1(rng.range(2, 5)), lat]] };
  } else {
    for (const k of skill) {
      if (rng.chance(0.15)) continue;
      const depth = r1(rng.range(2, 30));
      const pts: Pt[] = [[depth, 0]];
      if (rng.chance(0.7)) pts.push([r1(depth + rng.range(-3, 12)), r1(rng.range(-14, 14))]);
      jobs[k] = { t: 'route', pts, go: rng.chance(0.6) };
    }
  }
  return { id: `c_search${String(i).padStart(5, '0')}`, name: `Search ${i}`, slots, jobs, dropDepth: rng.int(1, 8), readStart: rng.int(20, 100) };
}

let lib = 0;
for (const p of OFFENSE_PLAYS) lib += average(p, 6, 1000);
lib /= OFFENSE_PLAYS.length;
console.log(`library average ${lib.toFixed(2)} yards per play (same test)`);

const found: { play: OffPlay; avg: number }[] = [];
let legal = 0;
for (let i = 0; i < N; i++) {
  const r = validateOffPlay(playFromDraft(randomDraft(i)));
  if (!r.ok) continue;
  legal++;
  found.push({ play: r.value, avg: average(r.value, 3, 5000 + i) });
}
found.sort((a, b) => b.avg - a.avg);
console.log(`${legal} legal designs of ${N} generated`);
const top = found.slice(0, 8).map((f) => ({ play: f.play, avg: average(f.play, 25, 90000) })).sort((a, b) => b.avg - a.avg);
for (const t of top) {
  const jobs = Object.entries(t.play.assign).filter(([, a]) => a.t !== 'block' && a.t !== 'qb').map(([k, a]) => `${k}:${a.t}${'pts' in a ? JSON.stringify(a.pts) : ''}${a.t === 'route' && a.go ? '+' : ''}`).join(' ');
  console.log(`${t.play.kind.padEnd(4)} ${t.avg.toFixed(2)} yds  x${(t.avg / lib).toFixed(2)}  ${jobs}`);
}
if (process.argv[4] === 'dump') for (const t of top.slice(0, 2)) {
  console.log(JSON.stringify(t.play.slots!.map((s) => [s.id, s.at])));
  const formation = formationOf(t.play);
  for (const front of DEFENSE_FRONTS) for (const scheme of DEFENSE_SCHEMES) {
    let tot = 0;
    const who: Record<string, number> = {};
    for (let s = 0; s < 40; s++) {
      const off = g.lineup(0, formation.slots); const def = g.lineup(1, front.slots);
      const sim = new PlaySim({ play: t.play, formation, front, scheme, offPlayers: off, defPlayers: def, offEnergy: off.map(() => 100), defEnergy: def.map(() => 100), los: 30, rng: new Rng(s + 1) });
      while (!sim.done) sim.step();
      tot += sim.result!.yards;
      const k = sim.result!.receiver ? sim.players.find((p) => p.player === sim.result!.receiver)!.pos : sim.result!.sack ? 'sack' : sim.result!.incomplete ? 'inc' : 'run';
      who[k] = (who[k] ?? 0) + 1;
    }
    console.log(`  ${front.id.padEnd(6)} ${scheme.id.padEnd(9)} ${(tot / 40).toFixed(1).padStart(5)} ${JSON.stringify(who)}`);
  }
}
console.log(`best design is ${(top[0].avg / lib).toFixed(2)} times the library average`);
