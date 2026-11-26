import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOK, OFFENSE_PLAYS, exhibitionTeams } from '@fnd/core';
import { simulateGame } from '@fnd/match-sim';

/** Milestone 2 acceptance: balance over 200 AI-versus-AI games between equal teams. */

type Acc = [number, number];
const add = (m: Map<string, Acc>, k: string, y: number): void => {
  const c = m.get(k) ?? [0, 0];
  c[0]++;
  c[1] += y;
  m.set(k, c);
};
const avg = (m: Map<string, Acc>, k: string): number => {
  const c = m.get(k);
  return c ? c[1] / c[0] : NaN;
};

/** Rotates through the library so that all 40 plays are measured. */
function rotatingBook(game: number, team: number): string[] {
  const runs = OFFENSE_PLAYS.filter((p) => p.kind === 'run');
  const passes = OFFENSE_PLAYS.filter((p) => p.kind === 'pass');
  const pick = <T,>(a: readonly T[], n: number, o: number): T[] => Array.from({ length: n }, (_, i) => a[(o + i) % a.length]);
  return [...pick(runs, 4, game * 3 + team * 5), ...pick(passes, 4, game * 5 + team * 7)].map((p) => p.id);
}

describe('balance over 200 games', () => {
  const GAMES = 200;
  const wins = [0, 0];
  // 400 games for the win share: at 200 the 45-55 band is narrower than ordinary chance for two equal teams.
  for (let g = 1; g <= GAMES * 2; g++) {
    const s = simulateGame(g, exhibitionTeams(g), { books: [DEFAULT_BOOK, DEFAULT_BOOK] }).state.score;
    if (s[0] > s[1]) wins[0]++;
    else if (s[1] > s[0]) wins[1]++;
  }

  const byPlay = new Map<string, Acc>();
  const byKindCall = new Map<string, Acc>();
  const byPlayCall = new Map<string, Acc>();
  let total = 0;
  let count = 0;
  for (let g = 1; g <= GAMES; g++) {
    const game = simulateGame(g, exhibitionTeams(g), { books: [rotatingBook(g, 0), rotatingBook(g, 1)] });
    for (const e of game.events) {
      if (e.type !== 'run' && e.type !== 'pass') continue;
      add(byPlay, e.offCall!, e.yards);
      add(byKindCall, `${e.type}|${e.defCall}`, e.yards);
      add(byPlayCall, `${e.offCall}|${e.defCall}`, e.yards);
      total += e.yards;
      count++;
    }
  }
  const playbookAverage = total / count;

  it('each side wins 45 to 55 percent of decided games', () => {
    const share = wins[0] / (wins[0] + wins[1]);
    expect(share).toBeGreaterThanOrEqual(0.45);
    expect(share).toBeLessThanOrEqual(0.55);
  });

  it('every play in the library gets measured', () => {
    for (const p of OFFENSE_PLAYS) expect(byPlay.get(p.id)?.[0] ?? 0, p.id).toBeGreaterThan(150);
  });

  it('no play averages more than 1.5 times the playbook average', () => {
    for (const p of OFFENSE_PLAYS) expect(avg(byPlay, p.id) / playbookAverage, p.id).toBeLessThanOrEqual(1.5);
  });

  it('a correct defensive read measurably lowers the gain', () => {
    expect(avg(byKindCall, 'run|runStuff')).toBeLessThan(avg(byKindCall, 'run|base') - 1);
    expect(avg(byKindCall, 'pass|coverZone')).toBeLessThan(avg(byKindCall, 'pass|base') - 1);
    expect(avg(byKindCall, 'pass|runStuff')).toBeGreaterThan(avg(byKindCall, 'pass|base'));
    expect(avg(byKindCall, 'run|coverZone')).toBeGreaterThan(avg(byKindCall, 'run|base'));
  });

  it('no defensive call is the best answer to every play', () => {
    const calls = ['base', 'runStuff', 'coverZone', 'blitz'];
    const best = new Set<string>();
    for (const p of OFFENSE_PLAYS) {
      let pick = calls[0];
      for (const c of calls) if (avg(byPlayCall, `${p.id}|${c}`) < avg(byPlayCall, `${p.id}|${pick}`)) pick = c;
      best.add(pick);
    }
    expect(best.size).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      const beaten = OFFENSE_PLAYS.some((p) => calls.some((o) => o !== c && avg(byPlayCall, `${p.id}|${o}`) < avg(byPlayCall, `${p.id}|${c}`)));
      expect(beaten, c).toBe(true);
    }
  });

  it('scoring and play counts stay in a believable range', () => {
    let pts = 0;
    for (let g = 300; g < 360; g++) {
      const s = simulateGame(g, exhibitionTeams(g)).state.score;
      pts += s[0] + s[1];
    }
    expect(pts / 120).toBeGreaterThan(10);
    expect(pts / 120).toBeLessThan(35);
    expect(count / (GAMES * 2)).toBeGreaterThan(40);
    expect(count / (GAMES * 2)).toBeLessThan(70);
  });
});
