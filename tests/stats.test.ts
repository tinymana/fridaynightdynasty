import { describe, expect, it } from 'vitest';
import { exhibitionTeams } from '@fnd/core';
import { simulateGame, summarize } from '@fnd/match-sim';
import {
  RECORD_DEFS, REGULAR_WEEKS, seasonOver, boxScore, createDynasty, emptyLine, enrolledIn, historicBook, loadDynasty, newsText, nextSeason, playWeek, recordGame, schoolOfPlayer, seasonYear, statsOf,
  type BoxScore, type Dynasty, type StatLine,
} from '@fnd/league';

const sum = (lines: Record<string, StatLine>, k: keyof StatLine): number => Object.values(lines).reduce((s, l) => s + l[k], 0);
function season(d: Dynasty): Dynasty {
  let x = d;
  while (!seasonOver(x)) x = playWeek(x);
  return x;
}

describe('the box score', () => {
  it('adds up: points match the scoreboard, receiving matches passing, and yards match the team totals', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const g = simulateGame(seed, exhibitionTeams(seed));
      const box = boxScore(g.events);
      const totals = summarize(g.events);
      for (const t of [0, 1] as const) {
        expect(box.teams[t].points).toBe(g.state.score[t]);
        expect(sum(box.players[t], 'recYds')).toBe(sum(box.players[t], 'passYds'));
        expect(sum(box.players[t], 'rec')).toBe(sum(box.players[t], 'passComp'));
        expect(sum(box.players[t], 'recTd')).toBe(sum(box.players[t], 'passTd'));
        expect(sum(box.players[t], 'passYds')).toBe(totals[t].passYds);
        expect(sum(box.players[t], 'passAtt')).toBe(totals[t].passAtt);
        // Kneel-downs are carries in the box score and not in the old team summary.
        const kneels = g.events.filter((e) => e.type === 'kneel' && e.offense === t).length;
        expect(sum(box.players[t], 'rushYds')).toBe(totals[t].rushYds - kneels);
        expect(sum(box.players[t], 'passInt')).toBe(sum(box.players[1 - t], 'ints'));
        expect(sum(box.players[t], 'sacks')).toBe(totals[1 - t].sacksTaken);
      }
    }
  });
});

describe('record books', () => {
  it('every school starts with a full book of old names, the same every time, smaller for shorter quarters', () => {
    const a = historicBook(5, 'sch_x', 58, 12);
    expect(historicBook(5, 'sch_x', 58, 12)).toEqual(a);
    expect(Object.keys(a).length).toBe(RECORD_DEFS.length * 3 + 1);
    for (const e of Object.values(a)) {
      expect(e.value).toBeGreaterThan(0);
      expect(e.year).toBeGreaterThanOrEqual(1976);
      expect(e.year).toBeLessThanOrEqual(2026);
    }
    for (const def of RECORD_DEFS) {
      expect(a[`season:${def.key}`].value).toBeGreaterThan(a[`game:${def.key}`].value);
      expect(a[`career:${def.key}`].value).toBeGreaterThan(a[`season:${def.key}`].value);
    }
    const short = historicBook(5, 'sch_x', 58, 4);
    expect(short['season:rushYds'].value).toBeLessThan(a['season:rushYds'].value * 0.5);
    expect(historicBook(5, 'sch_y', 58, 12)).not.toEqual(a);
  });

  it('a bigger game takes the record and names the man it was taken from; a tie does not', () => {
    const d = createDynasty('OH', 31, 2);
    const stats = statsOf(d);
    const old = stats.books[2]['game:rushYds'];
    const line = (yards: number): BoxScore => ({ players: [{ kid: { ...emptyLine(), games: 1, rushAtt: 30, rushYds: yards } }, {}], teams: [{ points: 7, yards }, { points: 0, yards: 0 }] });
    const tie = recordGame(stats, line(old.value), [2, 5], ['Us', 'Them'], () => 'Jo Runner', 1, 3);
    expect(tie.fell.length).toBe(0);
    const beat = recordGame(stats, line(old.value + 1), [2, 5], ['Us', 'Them'], () => 'Jo Runner', 1, 3);
    expect(beat.fell.length).toBe(1);
    expect(beat.fell[0]).toMatchObject({ school: 2, scope: 'game', key: 'rushYds', value: old.value + 1, name: 'Jo Runner', year: seasonYear(1), old, week: 3 });
    expect(beat.stats.books[2]['game:rushYds']).toEqual({ value: old.value + 1, name: 'Jo Runner', year: 2026 });
    expect(stats.books[2]['game:rushYds']).toEqual(old);
    expect(beat.stats.season['kid'].rushYds).toBe(old.value + 1);
    expect(newsText(beat.fell[0], 'Us')).toBe(`Jo Runner set the Us record for rushing yards in a game with ${old.value + 1}, passing ${old.name}'s ${old.value} from ${old.year}.`);
  });
});

describe('statistics through a dynasty', () => {
  it('keeps a season line for players at every school, with no more games than were played', () => {
    const d = playWeek(playWeek(createDynasty('OH', 31, 2)));
    const lines = Object.entries(d.stats!.season);
    expect(lines.length).toBeGreaterThan(120);
    const schools = new Set(lines.map(([id]) => schoolOfPlayer(d, id)));
    expect(schools.size).toBe(8);
    expect(schools.has(-1)).toBe(false);
    for (const [, l] of lines) expect(l.games).toBeLessThanOrEqual(2);
    // The league's points on the scoreboard are the points in the books.
    expect(d.results.reduce((s, g) => s + g.score[0] + g.score[1], 0)).toBeGreaterThan(0);
  });

  it('the coach\'s own game counts when its box score is handed in, and a week is never counted twice', () => {
    const d = createDynasty('OH', 31, 2);
    const auto = playWeek(d);
    const own = auto.results.find((g) => g.home === 2 || g.away === 2)!;
    const box: BoxScore = { players: [{}, {}], teams: [{ points: own.score[0], yards: 0 }, { points: own.score[1], yards: 0 }] };
    const mine = playWeek(d, own, box);
    const ids = Object.keys(mine.stats!.season);
    expect(ids.some((id) => schoolOfPlayer(d, id) === 2)).toBe(false);
    expect(ids.length).toBeLessThan(Object.keys(auto.stats!.season).length);
  });

  it('turns the page each year: careers build, seniors leave the books, and records only ever go up', () => {
    let d = season(createDynasty('OH', 31, 2));
    const start = statsOf(createDynasty('OH', 31, 2)).books;
    expect(Object.keys(d.stats!.season).length).toBeGreaterThan(150);
    let fell = d.stats!.news.length;
    for (let y = 0; y < 3; y++) {
      const before = d;
      d = nextSeason(d);
      expect(d.stats!.season).toEqual({});
      for (const id of Object.keys(d.stats!.career)) expect(d.year - enrolledIn(id)! + 1).toBeLessThanOrEqual(4);
      // Whoever had numbers last year and is back has them in his career line.
      for (const [id, l] of Object.entries(before.stats!.season)) {
        if (before.year - enrolledIn(id)! + 1 < 4) expect(d.stats!.career[id].games).toBeGreaterThanOrEqual(l.games);
        else expect(d.stats!.career[id]).toBeUndefined();
      }
      d = season(d);
      fell = Math.max(fell, d.stats!.news.length);
    }
    for (let i = 0; i < 8; i++) for (const k of Object.keys(start[i])) expect(d.stats!.books[i][k].value).toBeGreaterThanOrEqual(start[i][k].value);
    // Four seasons across eight schools: somebody, somewhere, breaks something. But not everything.
    expect(fell).toBeGreaterThan(0);
    const changed = start.flatMap((b, i) => Object.keys(b).filter((k) => d.stats!.books[i][k].value !== b[k].value)).length;
    expect(changed).toBeLessThan(8 * 31 * 0.35);
  });

  it('survives a save, and a tampered book is repaired', () => {
    const d = season(createDynasty('OH', 31, 2));
    expect(loadDynasty(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const bad = JSON.parse(JSON.stringify(d));
    bad.stats.books[2]['game:rushYds'] = { value: 'lots', name: '<b>me</b>', year: 3 };
    bad.stats.season.someone = { rushYds: 1e12, passYds: 'x' };
    bad.stats.news.push({ nonsense: true });
    const back = loadDynasty(bad)!;
    expect(back.stats!.books[2]['game:rushYds']).toEqual(statsOf(createDynasty('OH', 31, 2)).books[2]['game:rushYds']);
    expect(back.stats!.season.someone.rushYds).toBe(99999);
    expect(back.stats!.season.someone.passYds).toBe(0);
    expect(back.stats!.news.length).toBe(d.stats!.news.length);
  });
});

describe('season awards', () => {
  it('are voted once the title game is played, from players who really played, and survive a save', async () => {
    const { programOf, standings } = await import('@fnd/league');
    let d = createDynasty('OH', 31, 2);
    while (d.week < REGULAR_WEEKS + 1) d = playWeek(d);
    expect(d.awards ?? []).toEqual([]);
    d = playWeek(d);
    expect(d.awards!.length).toBe(1);
    const a = d.awards![0];
    expect(a.year).toBe(1);
    for (const h of [a.player!, a.defender!, a.newcomer!]) {
      const p = programOf(d, h.school).find((x) => x.id === h.id)!;
      expect(p.name).toBe(h.name);
      expect(d.stats!.season[h.id].games).toBeGreaterThan(0);
      expect(h.line.length).toBeGreaterThan(5);
    }
    expect(['QB', 'RB', 'WR', 'TE']).toContain(a.player!.pos);
    expect(['DL', 'LB', 'CB', 'S']).toContain(a.defender!.pos);
    expect(a.newcomer!.year).toBeLessThanOrEqual(2);
    // One quarterback, two backs, three receivers, nine defenders and a kicker.
    const count = (pos: string[]): number => a.allLeague.filter((h) => pos.includes(h.pos)).length;
    expect([count(['QB']), count(['RB']), count(['WR', 'TE']), count(['DL']), count(['LB']), count(['CB', 'S']), count(['K'])]).toEqual([1, 2, 3, 3, 3, 3, 1]);
    expect(new Set(a.allLeague.map((h) => h.id)).size).toBe(16);
    // The coach of the year did not finish last.
    const table = standings(d.results);
    expect(table.findIndex((r) => r.school === a.coach)).toBeLessThan(7);
    expect(loadDynasty(JSON.parse(JSON.stringify(d)))).toEqual(d);
    // A second season adds a second set and leaves the first alone.
    let e = nextSeason(d);
    while (!seasonOver(e)) e = playWeek(e);
    expect(e.awards!.map((x) => x.year)).toEqual([1, 2]);
    expect(e.awards![0]).toEqual(a);
  });

  it('drops anything in a save that is not a well-formed award', () => {
    let d = createDynasty('OH', 31, 2);
    while (!seasonOver(d)) d = playWeek(d);
    const bad = JSON.parse(JSON.stringify(d));
    bad.awards.push({ year: 'x' }, null, { year: 3, coach: 99 });
    bad.awards[0].player.name = '<img src=x>';
    bad.awards[0].allLeague.push({ id: 5 });
    const back = loadDynasty(bad)!;
    expect(back.awards!.length).toBe(1);
    expect(back.awards![0].player!.name).toBe('img src=x');
    expect(back.awards![0].allLeague.length).toBe(16);
  });
});
