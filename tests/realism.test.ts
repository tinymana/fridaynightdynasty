import { describe, expect, it } from 'vitest';
import { exhibitionTeams } from '@fnd/core';
import { simulateGame } from '@fnd/match-sim';

/**
 * The realism scorecard. AI-versus-AI football between two even teams has to look like high school football.
 * Each range is a target with room for chance; a change that pushes any number outside its range fails here.
 * The ranges are from general knowledge of the high school game, not from a data set.
 */
const N = 150;
const t = { points: 0, plays: 0, rushes: 0, rushYards: 0, passes: 0, completions: 0, passYards: 0, sacks: 0, interceptions: 0, fumbles: 0, punts: 0, fgMade: 0, fgTried: 0, flags: 0, firstDowns: 0, big: 0, fourthTries: 0, falseStarts: 0, holding: 0 };
const margins: number[] = [];
for (let seed = 1; seed <= N; seed++) {
  const g = simulateGame(seed, exhibitionTeams(seed));
  t.points += g.state.score[0] + g.state.score[1];
  margins.push(Math.abs(g.state.score[0] - g.state.score[1]));
  for (const e of g.events) {
    const scrimmage = e.type === 'run' || e.type === 'pass';
    if (e.type === 'run') { t.plays++; t.rushes++; t.rushYards += e.yards; }
    if (e.type === 'pass') {
      t.plays++;
      if (e.flags.sack) t.sacks++;
      else { t.passes++; if (e.flags.complete) { t.completions++; t.passYards += e.yards; } }
      if (e.flags.interception) t.interceptions++;
    }
    if (e.flags.fumbleLost) t.fumbles++;
    if (e.type === 'punt') t.punts++;
    if (e.type === 'fieldGoal') { t.fgTried++; if (e.flags.good) t.fgMade++; }
    if (e.type === 'penalty') { t.flags++; if (e.flags.foul === 'falseStart') t.falseStarts++; if (e.flags.foul === 'holding') t.holding++; }
    if (e.flags.firstDown) t.firstDowns++;
    if (scrimmage && e.yards >= 20) t.big++;
    if (scrimmage && e.down === 4) t.fourthTries++;
  }
}
const per = (x: number): number => x / N / 2;
const card: [string, number, number, number][] = [
  ['points per team', per(t.points), 14, 26],
  ['plays per team', per(t.plays), 50, 66],
  ['share of plays that are runs', t.rushes / t.plays, 0.54, 0.68],
  ['yards per carry', t.rushYards / t.rushes, 3.8, 5.2],
  ['completion rate', t.completions / t.passes, 0.46, 0.6],
  ['yards per completion', t.passYards / t.completions, 10, 15],
  ['sacks per team', per(t.sacks), 0.9, 2.4],
  ['interceptions per team', per(t.interceptions), 0.4, 1.4],
  ['fumbles lost per team', per(t.fumbles), 0.4, 1.3],
  ['punts per team', per(t.punts), 3, 6],
  ['field goals made per team', per(t.fgMade), 0.15, 0.8],
  ['field goal success', t.fgMade / t.fgTried, 0.4, 0.75],
  ['penalties per team', per(t.flags), 4, 8],
  ['first downs per team', per(t.firstDowns), 13, 21],
  ['plays of 20 yards or more per team', per(t.big), 1.5, 4.5],
  ['fourth-down tries per team', per(t.fourthTries), 0.8, 3],
];

describe(`realism scorecard over ${N} AI games`, () => {
  it('prints the card', () => {
    console.log(card.map(([name, v, lo, hi]) => `${v < lo || v > hi ? 'OUT ' : 'ok  '} ${name.padEnd(36)} ${v.toFixed(2).padStart(6)}   (${lo} to ${hi})`).join('\n'));
    expect(card.length).toBeGreaterThan(10);
  });
  for (const [name, value, lo, hi] of card) {
    it(`${name}: ${lo} to ${hi}`, () => {
      expect(value).toBeGreaterThanOrEqual(lo);
      expect(value).toBeLessThanOrEqual(hi);
    });
  }
  it('every kind of flag is thrown', () => {
    expect(t.falseStarts).toBeGreaterThan(N);
    expect(t.holding).toBeGreaterThan(N / 2);
  });
  it('even teams play close games: most within two scores, few blowouts', () => {
    const close = margins.filter((m) => m <= 16).length / N;
    const blowouts = margins.filter((m) => m >= 28).length / N;
    expect(close).toBeGreaterThan(0.6);
    expect(blowouts).toBeLessThan(0.12);
  });
});
