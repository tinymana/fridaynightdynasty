/** Measures simulated kick and punt returns. Usage: npx tsx tools/probe-returns.ts */
import { Rng, exhibitionTeams } from '@fnd/core';
import { kickoffReturnSetup, puntReturnSetup, runReturn } from '@fnd/match-sim';
const N = 1500;
for (const [name, make] of [
  ['kickoff deep (lands at the 8)', (t: ReturnType<typeof exhibitionTeams>, r: Rng) => kickoffReturnSetup(t[0], t[1], t[1].roster.find((p) => p.pos === 'WR')!, 40, 92, 0.6, r)],
  ['kickoff squib (lands at the 28)', (t: ReturnType<typeof exhibitionTeams>, r: Rng) => kickoffReturnSetup(t[0], t[1], t[1].roster.find((p) => p.pos === 'WR')!, 40, 72, 0.8, r, true)],
  ['punt 38 yards', (t: ReturnType<typeof exhibitionTeams>, r: Rng) => puntReturnSetup(t[0], t[1], t[1].roster.find((p) => p.pos === 'WR')!, 30, 68, r)],
] as const) {
  const ys: number[] = []; let td = 0, ticks = 0;
  for (let i = 0; i < N; i++) { const t = exhibitionTeams(1 + (i % 40)); const r = runReturn(make(t, new Rng(i * 7 + 3))); ys.push(r.yards); if (r.touchdown) td++; ticks += r.ticks; }
  ys.sort((a, b) => a - b);
  console.log(`${name.padEnd(34)} avg ${(ys.reduce((a, b) => a + b, 0) / N).toFixed(1)}  median ${ys[N >> 1]}  10% ${ys[Math.trunc(N * 0.1)]}  90% ${ys[Math.trunc(N * 0.9)]}  max ${ys[N - 1]}  TD ${(100 * td / N).toFixed(1)}%  avg seconds ${(ticks / N / 60).toFixed(1)}`);
}
