/** Plays AI-versus-AI games with no rendering and prints balance metrics. Usage: npm run sim -- [games] [seed] [book: default|all] */
import { OFFENSE_PLAYS, exhibitionTeams, playById } from '@fnd/core';
import { gameHash, simulateGame, summarize } from '@fnd/match-sim';

const games = Number(process.argv[2] ?? 100);
const seed0 = Number(process.argv[3] ?? 1);
const mode = process.argv[4] ?? 'default';
type Acc = [number, number];
const add = (m: Record<string, Acc>, k: string, y: number): void => { const c = (m[k] ??= [0, 0]); c[0]++; c[1] += y; };
const tot = { pts: 0, plays: 0, rushAtt: 0, rushYds: 0, passAtt: 0, comp: 0, passYds: 0, sacks: 0, to: 0, ints: 0, fg: 0, fgGood: 0, punts: 0, td: 0, wins: [0, 0], ties: 0, long: 0, kneels: 0 };
const byPlay: Record<string, Acc> = {}; const byMatch: Record<string, Acc> = {}; const byFront: Record<string, Acc> = {}; const byPlayCall: Record<string, Acc> = {};
const hist: Record<string, number[]> = { run: [], pass: [] };
let minEnergy = 100; let subs = 0;
const started = performance.now();
let slowest = 0;
// With "all", every game gives each team a different random-ish slice of the library so all 24 plays get measured.
const bookFor = (g: number, t: number): string[] => {
  if (mode !== 'all') return ['dive', 'power', 'toss', 'counter', 'slants', 'curls', 'flood', 'verticals'];
  const runs = OFFENSE_PLAYS.filter((p) => p.kind === 'run'); const passes = OFFENSE_PLAYS.filter((p) => p.kind === 'pass');
  const pick = <T,>(a: readonly T[], n: number, o: number): T[] => Array.from({ length: n }, (_, i) => a[(o + i) % a.length]);
  return [...pick(runs, 4, g * 3 + t * 5), ...pick(passes, 4, g * 5 + t * 7)].map((p) => p.id);
};
for (let g = 0; g < games; g++) {
  const t0 = performance.now();
  const game = simulateGame(seed0 + g, exhibitionTeams(seed0 + g), { books: [bookFor(g, 0), bookFor(g, 1)] });
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
    if (e.type === 'kneel') tot.kneels++;
    if (e.flags.touchdown) tot.td++;
    if (e.type === 'run' || e.type === 'pass') {
      if (e.yards >= 20) tot.long++;
      add(byPlay, e.offCall!, e.yards); add(byMatch, `${e.type} vs ${e.defCall}`, e.yards); add(byFront, `${e.type} vs ${e.defFront}`, e.yards);
      add(byPlayCall, `${e.offCall}|${e.defCall}`, e.yards);
      if (e.type === 'run') hist.run.push(e.yards);
      if (e.type === 'pass' && e.flags.complete) hist.pass.push(e.yards);
    }
  }
  for (const v of Object.values(game.energy)) minEnergy = Math.min(minEnergy, v);
  tot.pts += game.state.score[0] + game.state.score[1];
  if (game.state.score[0] > game.state.score[1]) tot.wins[0]++; else if (game.state.score[0] < game.state.score[1]) tot.wins[1]++; else tot.ties++;
  if (g === 0) console.log(`game 1: ${game.state.score.join('-')} hash ${gameHash(game)} events ${game.events.length}`);
}
const tg = games * 2;
const f = (n: number) => n.toFixed(2);
console.log(`games ${games}  avg ${(f((performance.now() - started) / games))} ms  slowest ${f(slowest)} ms`);
console.log(`points/team ${f(tot.pts / tg)}  plays/team ${f(tot.plays / tg)}  TD/team ${f(tot.td / tg)}  kneels/game ${f(tot.kneels / games)}`);
console.log(`rush ${f(tot.rushAtt / tg)} att  ${f(tot.rushYds / tot.rushAtt)} ypc | pass ${f(tot.passAtt / tg)} att  ${f((100 * tot.comp) / tot.passAtt)}%  ${f(tot.passYds / tot.passAtt)} ypa`);
console.log(`sacks/team ${f(tot.sacks / tg)}  turnovers/team ${f(tot.to / tg)}  int% ${f((100 * tot.ints) / tot.passAtt)}  20+ plays/team ${f(tot.long / tg)}`);
const decisive = tot.wins[0] + tot.wins[1];
console.log(`FG ${tot.fgGood}/${tot.fg}  punts/team ${f(tot.punts / tg)}  home ${tot.wins[0]} visitors ${tot.wins[1]} ties ${tot.ties}  home share of decisive ${f((100 * tot.wins[0]) / decisive)}%  lowest energy ${f(minEnergy)}`);
const show = (m: Record<string, Acc>): void => { for (const [k, [n, y]] of Object.entries(m).sort()) console.log(`  ${k.padEnd(22)} ${String(n).padStart(6)} plays  ${f(y / n)} yds/play`); };
show(byMatch); show(byFront);
let all = 0, alln = 0; for (const [n, y] of Object.values(byPlay)) { alln += n; all += y; }
const avg = all / alln;
console.log(`playbook average ${f(avg)} yds/play; per play (ratio to average):`);
for (const [k, [n, y]] of Object.entries(byPlay).sort((x, z) => z[1][1] / z[1][0] - x[1][1] / x[1][0])) {
  const calls = ['base', 'runStuff', 'coverZone', 'blitz'].map((c) => { const v = byPlayCall[`${k}|${c}`]; return v ? f(v[1] / v[0]).padStart(6) : '     -'; }).join(' ');
  console.log(`  ${k.padEnd(11)} ${playById(k).kind.padEnd(4)} ${String(n).padStart(5)}  ${f(y / n).padStart(6)}  x${f(y / n / avg)}   base/stuff/zone/blitz ${calls}`);
}
for (const k of ['run', 'pass']) {
  const v = hist[k].sort((a, b) => a - b);
  const q = (p: number) => v[Math.floor((v.length - 1) * p)];
  console.log(`  ${k} yards p10 ${q(0.1)} p25 ${q(0.25)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} p99 ${q(0.99)}`);
}
