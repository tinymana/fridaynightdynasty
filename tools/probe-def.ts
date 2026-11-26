/** Every front and call against the whole library: yards allowed by play type. Usage: npx tsx tools/probe-def.ts [n] */
import { DEFENSE_FRONTS, DEFENSE_SCHEMES, OFFENSE_PLAYS, Rng, exhibitionTeams, formationById } from '@fnd/core';
import { Game, PlaySim } from '@fnd/match-sim';
const g = new Game(1, exhibitionTeams(1));
const n = Number(process.argv[2] ?? 12);
for (const front of DEFENSE_FRONTS) for (const scheme of DEFENSE_SCHEMES) {
  const o = { run: [0, 0], pass: [0, 0] }; let sk = 0, to = 0, big = 0, np = 0, comp = 0;
  for (const play of OFFENSE_PLAYS) { const formation = formationById(play.formation);
    for (let s = 0; s < n; s++) {
      const off = g.lineup(0, formation.slots); const def = g.lineup(1, front.slots);
      const sim = new PlaySim({ play, formation, front, scheme, offPlayers: off, defPlayers: def, offEnergy: off.map(() => 100), defEnergy: def.map(() => 100), los: 30, rng: new Rng(s * 31 + 7) });
      while (!sim.done) sim.step();
      const r = sim.result!; o[play.kind][0] += r.yards; o[play.kind][1]++;
      if (play.kind === 'pass') { np++; if (r.sack) sk++; if (r.complete) comp++; } if (r.turnover) to++; if (r.yards >= 20) big++;
    } }
  const N = o.run[1] + o.pass[1];
  console.log(`${front.id.padEnd(6)} ${scheme.id.padEnd(9)} ${scheme.kind.padEnd(8)} run ${(o.run[0] / o.run[1]).toFixed(1).padStart(5)}  pass ${(o.pass[0] / o.pass[1]).toFixed(1).padStart(5)}  comp ${Math.round(100 * comp / np)}% sack ${Math.round(100 * sk / np)}% to ${(100 * to / N).toFixed(1)}% 20+ ${(100 * big / N).toFixed(1)}%`);
}
