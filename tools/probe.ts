/** Runs one play against every front and call many times and prints outcome rates. Usage: npx tsx tools/probe.ts <playId> [n] */
import { DEFENSE_FRONTS, DEFENSE_SCHEMES, Rng, exhibitionTeams, formationById, playById } from '@fnd/core';
import { Game, PlaySim } from '@fnd/match-sim';
const play = playById(process.argv[2] ?? 'slants');
const n = Number(process.argv[3] ?? 300);
const teams = exhibitionTeams(1);
const g = new Game(1, teams);
const formation = formationById(play.formation);
for (const front of DEFENSE_FRONTS) for (const scheme of DEFENSE_SCHEMES) {
  const o = { comp: 0, inc: 0, sack: 0, int: 0, yds: 0, cy: 0, t: 0, away: 0, who: {} as Record<string, number> };
  for (let s = 0; s < n; s++) {
    const off = g.lineup(0, formation.slots); const def = g.lineup(1, front.slots);
    const sim = new PlaySim({ play, formation, front, scheme, offPlayers: off, defPlayers: def, offEnergy: off.map(() => 100), defEnergy: def.map(() => 100), los: 30, rng: new Rng(s + 1) });
    while (!sim.done) sim.step();
    const r = sim.result!; o.t += r.ticks; o.yds += r.yards;
    if (r.complete) { o.comp++; o.cy += r.yards; }
    if (r.incomplete) { o.inc++; if (!r.receiver) o.away++; }
    if (r.sack) o.sack++; if (r.turnover === 'interception') o.int++;
    const tgt = r.receiver ? sim.players.find((p) => p.player === r.receiver)?.pos ?? '?' : r.rusher ? 'run' : '-';
    o.who[tgt] = (o.who[tgt] ?? 0) + 1;
  }
  const pc = (x: number) => `${Math.round((100 * x) / n)}%`.padStart(4);
  console.log(`${front.id.padEnd(6)} ${scheme.id.padEnd(9)} ypp ${(o.yds / n).toFixed(1).padStart(5)} comp ${pc(o.comp)} inc ${pc(o.inc)} away ${pc(o.away)} sack ${pc(o.sack)} int ${pc(o.int)} y/c ${(o.cy / Math.max(1, o.comp)).toFixed(1).padStart(5)} secs ${(o.t / n / 60).toFixed(1)} ${JSON.stringify(o.who)}`);
}
