/**
 * The game book on screen: four tabs over one game's play-by-play. Summary (points by quarter, scoring plays, team
 * totals), the box score for every player, the drive chart and the full play-by-play.
 */
import type { PlayEvent, Team } from '@fnd/core';
import { boxScore, clockText, driveChart, gameTotals, periodName, periodScores, scoringPlays, situation, type StatLine } from '@fnd/league';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
type Tab = 'summary' | 'box' | 'drives' | 'plays';
const TABS: [Tab, string][] = [['summary', 'Summary'], ['box', 'Box score'], ['drives', 'Drives'], ['plays', 'Play-by-play']];

function summaryHtml(events: readonly PlayEvent[], teams: readonly [Team, Team]): string {
  const periods = periodScores(events);
  const n = periods[0].length;
  const heads = Array.from({ length: n }, (_, i) => `<th>${periodName(i + 1).replace('Q', '')}</th>`).join('');
  const line = (t: 0 | 1): string => `<tr><td>${esc(teams[t].name)}</td>${periods[t].map((p) => `<td>${p}</td>`).join('')}<td><b>${periods[t].reduce((a, b) => a + b, 0)}</b></td></tr>`;
  const scores = scoringPlays(events);
  const [a, b] = gameTotals(events);
  const row = (label: string, x: string | number, y: string | number): string => `<tr><td>${label}</td><td>${x}</td><td>${y}</td></tr>`;
  const of = (d: [number, number]): string => `${d[0]} of ${d[1]}`;
  return `<table class="gb-line"><tr><th></th>${heads}<th>Final</th></tr>${line(0)}${line(1)}</table>
    <h4>Scoring</h4>
    ${scores.length ? scores.map((s) => `<div class="gb-play"><span class="gb-when">${periodName(s.quarter)}${s.quarter <= 4 ? ` ${clockText(s.clock)}` : ''}</span><span><b>${esc(teams[s.team].abbr)}</b> ${esc(s.text)}</span><b>${s.scoreAfter[0]}–${s.scoreAfter[1]}</b></div>`).join('') : '<p>No scoring.</p>'}
    <h4>Team totals</h4>
    <table class="gb-totals"><tr><th></th><th>${esc(teams[0].abbr)}</th><th>${esc(teams[1].abbr)}</th></tr>
    ${row('First downs', a.firstDowns, b.firstDowns)}${row('Total yards', a.yards, b.yards)}${row('Plays', a.plays, b.plays)}
    ${row('Rushing', `${a.rushAtt} for ${a.rushYds}`, `${b.rushAtt} for ${b.rushYds}`)}
    ${row('Passing', `${a.passComp} of ${a.passAtt} for ${a.passYds}`, `${b.passComp} of ${b.passAtt} for ${b.passYds}`)}
    ${row('Sacked', a.sacked, b.sacked)}${row('Third downs', of(a.thirdDowns), of(b.thirdDowns))}${row('Fourth downs', of(a.fourthDowns), of(b.fourthDowns))}
    ${row('Turnovers', a.interceptions + a.fumblesLost, b.interceptions + b.fumblesLost)}
    ${row('Penalties', `${a.penalties} for ${a.penaltyYds}`, `${b.penalties} for ${b.penaltyYds}`)}
    ${row('Punts', a.punts ? `${a.punts}, ${(a.puntYds / a.punts).toFixed(1)} avg` : '0', b.punts ? `${b.punts}, ${(b.puntYds / b.punts).toFixed(1)} avg` : '0')}
    ${row('Time of possession', clockText(a.possession), clockText(b.possession))}</table>`;
}

function boxHtml(events: readonly PlayEvent[], teams: readonly [Team, Team]): string {
  const box = boxScore(events);
  const team = (t: 0 | 1): string => {
    const who = (id: string): string => {
      const p = teams[t].roster.find((x) => x.id === id);
      return p ? `${esc(p.name)} <small>${p.pos}</small>` : 'Unknown';
    };
    const lines = Object.entries(box.players[t]);
    const table = (title: string, heads: string[], keep: (l: StatLine) => boolean, sort: (l: StatLine) => number, cells: (l: StatLine) => (string | number)[]): string => {
      const rows = lines.filter(([, l]) => keep(l)).sort((x, y) => sort(y[1]) - sort(x[1]));
      if (!rows.length) return '';
      return `<table class="gb-box"><tr><th>${title}</th>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map(([id, l]) => `<tr><td>${who(id)}</td>${cells(l).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
    };
    const avg = (yds: number, n: number): string => (n ? (yds / n).toFixed(1) : '0.0');
    return `<div><h4>${esc(teams[t].name)} ${esc(teams[t].mascot)}</h4>
      ${table('Passing', ['C/A', 'Yds', 'TD', 'Int'], (l) => l.passAtt > 0, (l) => l.passAtt, (l) => [`${l.passComp}/${l.passAtt}`, l.passYds, l.passTd, l.passInt])}
      ${table('Rushing', ['Att', 'Yds', 'Avg', 'TD'], (l) => l.rushAtt > 0, (l) => l.rushYds, (l) => [l.rushAtt, l.rushYds, avg(l.rushYds, l.rushAtt), l.rushTd])}
      ${table('Receiving', ['Rec', 'Yds', 'Avg', 'TD'], (l) => l.rec > 0, (l) => l.recYds, (l) => [l.rec, l.recYds, avg(l.recYds, l.rec), l.recTd])}
      ${table('Defense', ['Tkl', 'Sacks', 'Int'], (l) => l.tackles + l.sacks + l.ints > 0, (l) => l.tackles * 10 + l.sacks + l.ints, (l) => [l.tackles, l.sacks, l.ints])}
      ${table('Kicking', ['FG', 'XP'], (l) => l.fgAtt + l.xpMade > 0, (l) => l.fgAtt, (l) => [`${l.fgMade}/${l.fgAtt}`, l.xpMade])}
      ${table('Returns', ['Yds'], (l) => l.retYds > 0, (l) => l.retYds, (l) => [l.retYds])}</div>`;
  };
  return `<div class="gb-cols">${team(0)}${team(1)}</div>`;
}

function drivesHtml(events: readonly PlayEvent[], teams: readonly [Team, Team]): string {
  const abbr = [teams[0].abbr, teams[1].abbr] as const;
  const spot = (t: 0 | 1, from: number): string => (from === 50 ? 'the 50' : from < 50 ? `${abbr[t]} ${from}` : `${abbr[1 - t]} ${100 - from}`);
  const rows = driveChart(events).map((d) => `<tr class="${d.result === 'Touchdown' || d.result === 'Field goal' ? 'gb-score' : ''}"><td><b>${esc(abbr[d.team])}</b></td><td>${periodName(d.quarter)}${d.quarter <= 4 ? ` ${clockText(d.clock)}` : ''}</td><td>${esc(spot(d.team, d.from))}</td><td>${d.plays}</td><td>${d.yards}</td><td>${d.quarter <= 4 ? clockText(d.seconds) : ''}</td><td>${d.result}</td></tr>`);
  return `<table class="gb-drives"><tr><th>Team</th><th>Start</th><th>From</th><th>Plays</th><th>Yards</th><th>Time</th><th>Result</th></tr>${rows.join('')}</table>`;
}

function playsHtml(events: readonly PlayEvent[], teams: readonly [Team, Team]): string {
  const abbr = [teams[0].abbr, teams[1].abbr] as const;
  let out = '';
  let quarter = 0;
  let side = -1;
  for (const e of events) {
    if (e.quarter !== quarter) {
      quarter = e.quarter;
      side = -1;
      out += `<h4>${quarter <= 4 ? `${['First', 'Second', 'Third', 'Fourth'][quarter - 1]} quarter` : quarter === 5 ? 'Overtime' : `Overtime ${quarter - 4}`}</h4>`;
    }
    if (e.offense !== side && e.type !== 'kickoff') {
      side = e.offense;
      out += `<div class="gb-ball">${esc(teams[side].name)} ball</div>`;
    }
    if (e.type === 'kickoff') side = -1;
    const big = e.points[0] + e.points[1] > 0 || e.flags.interception || e.flags.fumbleLost;
    out += `<div class="gb-play${big ? ' gb-big' : ''}"><span class="gb-when">${e.quarter <= 4 ? clockText(e.clock) : ''}</span><span><small>${esc(situation(e, abbr))}</small> ${esc(e.text)}</span>${e.points[0] + e.points[1] > 0 ? `<b>${e.scoreAfter[0]}–${e.scoreAfter[1]}</b>` : ''}</div>`;
  }
  return out;
}

/** Draws the game book into `root`. The tab that is open is remembered on the element, so a redraw keeps it. */
export function renderGamebook(root: HTMLElement, events: readonly PlayEvent[], teams: readonly [Team, Team], open: Tab = (root.dataset.tab as Tab | undefined) ?? 'summary'): void {
  root.dataset.tab = open;
  const body = open === 'summary' ? summaryHtml(events, teams) : open === 'box' ? boxHtml(events, teams) : open === 'drives' ? drivesHtml(events, teams) : playsHtml(events, teams);
  root.innerHTML = `<div class="gb-tabs" role="tablist">${TABS.map(([id, name]) => `<button class="seg${id === open ? ' on' : ''}" role="tab" aria-selected="${id === open}" data-gb="${id}">${name}</button>`).join('')}</div><div class="gb-body" role="tabpanel">${body}</div>`;
  root.querySelectorAll<HTMLElement>('[data-gb]').forEach((el) => el.addEventListener('click', () => renderGamebook(root, events, teams, el.dataset.gb as Tab)));
}
