import { describe, expect, it } from 'vitest';
import { LEAGUE_SIZE, REGULAR_WEEKS, createDynasty, occasionFor, schedule, teamFor } from '@fnd/league';
import { exhibitionTeams } from '@fnd/core';
import { FIGHT_SONG_BEAT, chantFor, fightSong, halftimeShow, type CrowdInput } from '../apps/client/src/atmosphere';

const base: CrowdInput = { possession: 0, down: 1, yardLine: 40, quarter: 2, homeLead: 0, occasion: null };

describe('the season calendar', () => {
  it('gives every school one home opener, one homecoming and one senior night, all at home and in that order', () => {
    const weeks = schedule();
    for (let school = 0; school < LEAGUE_SIZE; school++) {
      const nights = weeks.map((games, w) => ({ w, home: games.some(([h]) => h === school) })).filter((x) => x.home).map((x) => ({ w: x.w, o: occasionFor(x.w, school) }));
      const of = (o: string): number[] => nights.filter((n) => n.o === o).map((n) => n.w);
      expect(of('opener').length).toBe(1);
      expect(of('homecoming').length).toBe(1);
      expect(of('seniorNight').length).toBe(1);
      expect(of('opener')[0]).toBeLessThan(of('homecoming')[0]);
      expect(of('homecoming')[0]).toBeLessThan(of('seniorNight')[0]);
      // Away games are nobody's occasion for the visitors.
      weeks.forEach((games, w) => { if (!games.some(([h]) => h === school)) expect(occasionFor(w, school)).toBeNull(); });
    }
    expect(occasionFor(REGULAR_WEEKS, 3)).toBe('championship');
  });
});

describe('chants', () => {
  it('chants defense only when the visitors must convert, and not on every snap', () => {
    let defense = 0;
    for (let n = 0; n < 30; n++) {
      expect(chantFor({ ...base, possession: 1, down: 1 }, n)).toBeNull();
      expect(chantFor({ ...base, possession: 0, down: 3 }, n)).not.toBe('defense');
      if (chantFor({ ...base, possession: 1, down: 3 }, n) === 'defense') defense++;
    }
    expect(defense).toBeGreaterThan(10);
    expect(defense).toBeLessThan(30);
  });
});

describe('fight songs', () => {
  it('are four bars long, in tune, end on a long high home note, and are the same every time', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const song = fightSong(seed);
      expect(JSON.stringify(fightSong(seed))).toBe(JSON.stringify(song));
      const last = song[song.length - 1];
      expect(last.t + last.d).toBeLessThanOrEqual(16 * FIGHT_SONG_BEAT + 1e-9);
      expect(last.t).toBeCloseTo(14 * FIGHT_SONG_BEAT, 6);
      expect(last.f).toBeCloseTo(466.16, 1);
      expect(song.length).toBeGreaterThanOrEqual(10);
      for (let i = 0; i < song.length; i++) {
        expect(song[i].f).toBeGreaterThan(200);
        expect(song[i].f).toBeLessThan(620);
        if (i) expect(song[i].t).toBeGreaterThanOrEqual(song[i - 1].t + song[i - 1].d - 1e-9);
      }
    }
  });
  it('differ from school to school', () => {
    const tunes = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) tunes.add(fightSong(seed).map((n) => Math.round(n.f)).join(','));
    expect(tunes.size).toBeGreaterThan(35);
  });
});

describe('half time', () => {
  const d = createDynasty('TX', 9, 0);
  const home = teamFor(d, 0);
  const away = teamFor(d, 1);
  it('is the same show for the same game', () => {
    expect(halftimeShow(77, null, home, away)).toEqual(halftimeShow(77, null, home, away));
    const shows = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) shows.add(halftimeShow(seed, null, home, away).lines.join(' '));
    expect(shows.size).toBeGreaterThan(15);
  });
  it('crowns a homecoming king from the senior class and names a queen', () => {
    const seniors = home.roster.filter((p) => p.year === 4).map((p) => p.name);
    for (let seed = 1; seed <= 20; seed++) {
      const show = halftimeShow(seed, 'homecoming', home, away);
      expect(show.title).toBe('Homecoming');
      const line = show.lines.find((l) => l.includes('Homecoming king'))!;
      expect(seniors.some((n) => line.includes(n))).toBe(true);
      expect(line).toMatch(/Homecoming queen: [A-Z][a-z]+ [A-Z][a-z]+\./);
    }
  });
  it('honors the seniors on senior night and has both bands at the championship', () => {
    const seniors = home.roster.filter((p) => p.year === 4);
    const night = halftimeShow(5, 'seniorNight', home, away);
    expect(night.title).toBe('Senior night');
    expect(night.lines[0]).toContain(`${seniors.length} seniors`);
    expect(halftimeShow(5, 'championship', home, away).lines[0]).toContain(away.name);
    expect(halftimeShow(5, 'opener', home, away).title).toBe('Home opener');
  });
  it('still works for exhibition teams, which have no classes', () => {
    const [a, b] = exhibitionTeams(3);
    const show = halftimeShow(3, 'homecoming', a, b);
    expect(show.lines.join(' ')).toContain('Homecoming queen');
    expect(halftimeShow(3, 'seniorNight', a, b).lines[0]).toContain('seniors are honored');
  });
});
