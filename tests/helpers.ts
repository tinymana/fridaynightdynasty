import { Rng, exhibitionTeams, formationById, frontById, playById, schemeById, type Situation } from '@fnd/core';
import { Game, PlaySim } from '@fnd/match-sim';

const teams = exhibitionTeams(1);
const lineupGame = new Game(1, teams);

/** A single scrimmage play with fresh starters, for scenario tests. */
export function makeSim(playId: string, frontId: string, schemeId: string, los: number, seed: number): PlaySim {
  const play = playById(playId);
  const formation = formationById(play.formation);
  const front = frontById(frontId);
  const offPlayers = lineupGame.lineup(0, formation.slots);
  const defPlayers = lineupGame.lineup(1, front.slots);
  return new PlaySim({
    play, formation, front, scheme: schemeById(schemeId), offPlayers, defPlayers,
    offEnergy: offPlayers.map(() => 100), defEnergy: defPlayers.map(() => 100), los, rng: new Rng(seed),
  });
}

export function averageYards(playId: string, frontId: string, schemeId: string, n: number): number {
  let total = 0;
  for (let s = 1; s <= n; s++) {
    const sim = makeSim(playId, frontId, schemeId, 30, s);
    while (!sim.done) sim.step();
    total += sim.result!.yards;
  }
  return total / n;
}

export const sit = (o: Partial<Situation> = {}): Situation => ({
  phase: 'scrimmage', quarter: 1, clock: 600, down: 1, distance: 10, yardLine: 30, scoreDiff: 0,
  timeouts: 3, oppTimeouts: 3, clockRunning: false, kicking: 70, ...o,
});
