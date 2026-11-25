/** Plays AI-versus-AI games with no rendering and prints balance metrics. Usage: npm run sim -- [games] [seed] */
import { exhibitionTeams } from '@fnd/core';
import { gameHash, simulateGame, summarize } from '@fnd/match-sim';

const games = Number(process.argv[2] ?? 100);
const seed0 = Number(process.argv[3] ?? 1);
const tot = { pts: 0, plays: 0, rushAtt: 0, rushYds: 0, passAtt: 0, comp: 0, passYds: 0, sacks: 0, to: 0, ints: 0, fg: 0, fgGood: 0, punts: 0, td: 0, homeWins: 0, ties: 0, long: 0, callEdge: {} as Record<string, [number, number]> };
const hist: Record<string, number[]> = { run: [], pass: [] };
const started = performance.now();
let slowest = 0;
for (let g = 0; g < games; g++) {
  const t0 = performance.now();
  const game = simulateGame(seed0 + g, exhibitionTeams(seed0 + g));
  slowest = Math.max(slowest, performance.now() - t0);
  const [a, b] = summarize(game.events);
  for (const s of [a, b]) {
    tot.plays += s.plays; tot.rushAtt += s.rushAtt; tot.rushYds += s.rushYds; tot.passAtt += s.passAtt;
    tot.comp += s.passComp; tot.passYds += s.passYds; tot.sacks += s.sacksTaken; tot.to += s.turnovers;
  }
  for (const e of game.events) {
    if (e.flags.interception) tot.ints++;
    if (e.type === 'fieldGoal') { tot.fg++; if (e.flags.good) tot.fgGood++; }
    if (e.type === 'punt') tot.punts++;
    if (e.flags.touchdown) tot.td++;
    if ((e.type === 'run' || e.type === 'pass') && e.yards >= 20) tot.long++;
    if (e.type === 'run') hist.run.push(e.yards);
    if (e.type === 'pass' && e.flags.complete) hist.pass.push(e.yards);
    if ((e.type === 'run' || e.type === 'pass') && e.offCall && e.defCall) {
      const k = `${e.type} vs ${e.defCall}`;
      const c = (tot.callEdge[k] ??= [0, 0]);
      c[0]++; c[1] += e.yards;
    }
  }
  tot.pts += game.state.score[0] + game.state.score[1];
  if (game.state.score[0] > game.state.score[1]) tot.homeWins++;
  if (game.state.score[0] === game.state.score[1]) tot.ties++;
  if (g === 0) console.log(`game 1: ${game.state.score.join('-')} hash ${gameHash(game)} events ${game.events.length}`);
}
const tg = games * 2;
const f = (n: number) => n.toFixed(2);
console.log(`games ${games}  avg ${(f((performance.now() - started) / games))} ms  slowest ${f(slowest)} ms`);
console.log(`points/team ${f(tot.pts / tg)}  plays/team ${f(tot.plays / tg)}  TD/team ${f(tot.td / tg)}`);
console.log(`rush ${f(tot.rushAtt / tg)} att  ${f(tot.rushYds / tot.rushAtt)} ypc | pass ${f(tot.passAtt / tg)} att  ${f((100 * tot.comp) / tot.passAtt)}%  ${f(tot.passYds / tot.passAtt)} ypa`);
console.log(`sacks/team ${f(tot.sacks / tg)}  turnovers/team ${f(tot.to / tg)}  int% ${f((100 * tot.ints) / tot.passAtt)}  20+ plays/team ${f(tot.long / tg)}`);
console.log(`FG ${tot.fgGood}/${tot.fg}  punts/team ${f(tot.punts / tg)}  home wins ${tot.homeWins} ties ${tot.ties}`);
for (const [k, [n, y]] of Object.entries(tot.callEdge).sort()) console.log(`  ${k.padEnd(22)} ${String(n).padStart(6)} plays  ${f(y / n)} yds/play`);
for (const k of ['run', 'pass']) {
  const v = hist[k].sort((a, b) => a - b);
  const q = (p: number) => v[Math.floor((v.length - 1) * p)];
  console.log(`  ${k} yards p10 ${q(0.1)} p25 ${q(0.25)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} p99 ${q(0.99)}`);
}
