/** Thirty seasons of one league: who wins the titles, and how each school's prestige moved. Usage: npx tsx tools/parity.ts [state] [seed] [seasons] */
import { createDynasty, nextSeason, playWeek, seasonOver, standings } from '@fnd/league';
const state = process.argv[2] ?? 'TX';
const seed = Number(process.argv[3] ?? 2026);
const N = Number(process.argv[4] ?? 30);
let d = createDynasty(state, seed, 0, { quarterMinutes: 6 });
const titles = Array(8).fill(0); const wins = Array(8).fill(0); const pres: number[][] = [];
let streak = 0, best = 0, last = -1;
for (let y = 1; y <= N; y++) {
  pres.push(d.league.schools.map((s) => s.prestige));
  while (!seasonOver(d)) d = playWeek(d);
  for (const r of standings(d.results)) wins[r.school] += r.wins;
  const c = d.history[y - 1].champion;
  titles[c]++;
  streak = c === last ? streak + 1 : 1; best = Math.max(best, streak); last = c;
  d = nextSeason(d);
}
const avg = (i: number) => (pres.reduce((a, p) => a + p[i], 0) / pres.length).toFixed(1);
console.log(state, seed, 'titles', titles.join(' '), '| wins', wins.join(' '), '| longest title streak', best, '| mean prestige', [0,1,2,3,4,5,6,7].map(avg).join(' '));
