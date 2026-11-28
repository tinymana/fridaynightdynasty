/** Points, plays and scoring by quarter length, over many AI games. Usage: npx tsx tools/length.ts [games] */
import { cleanSetup, exhibitionTeams } from '@fnd/core';
import { simulateGame } from '@fnd/match-sim';
const N = Number(process.argv[2] ?? 40);
for (const q of [4, 6, 8, 10, 12]) {
  let pts = 0, plays = 0, tds = 0, shut = 0;
  for (let s = 1; s <= N; s++) {
    const g = simulateGame(s * 7919, exhibitionTeams(s * 7919), { setup: cleanSetup({ quarterMinutes: q }) });
    pts += g.state.score[0] + g.state.score[1];
    plays += g.events.length;
    if (g.state.score[0] === 0 || g.state.score[1] === 0) shut++;
  }
  console.log(`${q} min quarters: ${(pts / N).toFixed(1)} points a game (both teams), ${(plays / N).toFixed(0)} plays (kicks included), shutouts ${Math.round((100 * shut) / N)}%`);
}
