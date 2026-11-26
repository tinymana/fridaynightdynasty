import { DEFENSE_FRONTS, DEFENSE_SCHEMES, OFFENSE_PLAYS, Rng, exhibitionTeams, formationById } from '@fnd/core';
import { Game, PlaySim } from '@fnd/match-sim';
const g = new Game(1, exhibitionTeams(1));
const n = Number(process.argv[2] ?? 40);
const only = process.argv.slice(3);
for (const play of OFFENSE_PLAYS) {
  if (only.length && !only.includes(play.id)) continue;
  const formation = formationById(play.formation);
  let y = 0, c = 0, sk = 0, it = 0, big = 0, N = 0; const per: string[] = [];
  for (const scheme of DEFENSE_SCHEMES) { let ys = 0, ns = 0;
    for (const front of DEFENSE_FRONTS) for (let s = 0; s < n; s++) {
      const off = g.lineup(0, formation.slots); const def = g.lineup(1, front.slots);
      const sim = new PlaySim({ play, formation, front, scheme, offPlayers: off, defPlayers: def, offEnergy: off.map(() => 100), defEnergy: def.map(() => 100), los: 30, rng: new Rng(s * 31 + 7) });
      while (!sim.done) sim.step();
      const r = sim.result!; y += r.yards; ys += r.yards; ns++; N++; if (r.complete) c++; if (r.sack) sk++; if (r.turnover) it++; if (r.yards >= 20) big++;
    }
    per.push(`${scheme.id.slice(0, 4)} ${(ys / ns).toFixed(1).padStart(5)}`);
  }
  const pc = (x: number) => `${Math.round(100 * x / N)}%`.padStart(4);
  console.log(`${play.id.padEnd(11)} ${play.kind.padEnd(4)} ypp ${(y / N).toFixed(1).padStart(5)} comp ${pc(c)} sack ${pc(sk)} to ${pc(it)} 20+ ${pc(big)} | ${per.join('  ')}`);
}
