/**
 * Measures league football (unequal schools, home and away) for comparing with real high school results:
 * about 25 points a team, the home side winning 54 to 55 percent, more than half of games decided by 21 or more.
 * Usage: npx tsx tools/league-realism.ts [seasons] [gap] [homeEdge] [runoffSeconds] [homeEvery]
 */
import { RULES } from '@fnd/core';
import { LEAGUE_TUNING, seasonOver, createDynasty, playWeek } from '@fnd/league';
const SEASONS = Number(process.argv[2] ?? 6);
if (process.argv[3]) LEAGUE_TUNING.gap = Number(process.argv[3]);
if (process.argv[4]) LEAGUE_TUNING.homeEdge = Number(process.argv[4]);
if (process.argv[5]) (RULES as { runoffSeconds: number }).runoffSeconds = Number(process.argv[5]);
if (process.argv[6]) LEAGUE_TUNING.homeEvery = Number(process.argv[6]);
const STATES = ['OH', 'TX', 'GA', 'FL', 'CA', 'PA'];
let games = 0, pts = 0, home = 0, away = 0, big = 0, close = 0, shut = 0, huge = 0;
for (let s = 0; s < SEASONS; s++) {
  let d = createDynasty(STATES[s % STATES.length], 100 + s * 7, 0, { quarterMinutes: 12 });
  while (!seasonOver(d)) d = playWeek(d);
  for (const g of d.results) {
    games++;
    pts += g.score[0] + g.score[1];
    if (g.score[0] > g.score[1]) home++; else if (g.score[1] > g.score[0]) away++;
    const m = Math.abs(g.score[0] - g.score[1]);
    if (m >= 21) big++;
    if (m >= 35) huge++;
    if (m <= 8) close++;
    if (g.score[0] === 0 || g.score[1] === 0) shut++;
  }
}
const pct = (n: number): string => `${Math.round((100 * n) / games)}%`;
console.log(`gap ${LEAGUE_TUNING.gap} home ${LEAGUE_TUNING.homeEdge}/${LEAGUE_TUNING.homeEvery} runoff ${RULES.runoffSeconds}: ${games} games, ${(pts / games / 2).toFixed(1)} points a team, home wins ${Math.round((100 * home) / (home + away))}%, within 8 ${pct(close)}, by 21+ ${pct(big)}, by 35+ ${pct(huge)}, shutouts ${pct(shut)}`);
