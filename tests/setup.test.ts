import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP, QUARTER_MINUTES, WEATHER, WEATHERS, cleanSetup, exhibitionTeams, type Weather } from '@fnd/core';
import { Game, gameHash, replayGame, simulateGame } from '@fnd/match-sim';

const N = 60;
function season(weather: Weather) {
  let att = 0, comp = 0, fum = 0, fga = 0, fgm = 0, pts = 0, plays = 0, puntYards = 0, punts = 0;
  for (let seed = 1; seed <= N; seed++) {
    const g = simulateGame(seed, exhibitionTeams(seed), { setup: { weather } });
    pts += g.state.score[0] + g.state.score[1];
    for (const e of g.events) {
      if (e.type === 'pass' && !e.flags.sack) { att++; if (e.flags.complete) comp++; }
      if (e.type === 'run' || e.type === 'pass') plays++;
      if (e.flags.fumbleLost) fum++;
      if (e.type === 'fieldGoal') { fga++; if (e.flags.good) fgm++; }
      if (e.type === 'punt' && !e.flags.blocked && !e.flags.roughing && !e.flags.touchback) { punts++; puntYards += e.yards; }
    }
  }
  return { comp: comp / att, fumbles: fum / N, fg: fgm / fga, points: pts / N / 2, plays: plays / N, punt: puntYards / punts };
}

describe('game setup', () => {
  it('anything unknown falls back to twelve-minute quarters on a clear night', () => {
    expect(cleanSetup(undefined)).toEqual(DEFAULT_SETUP);
    expect(cleanSetup({ quarterMinutes: 7, weather: 'hail' })).toEqual(DEFAULT_SETUP);
    expect(cleanSetup({ quarterMinutes: 6, weather: 'snow' })).toEqual({ quarterMinutes: 6, weather: 'snow' });
    expect(WEATHERS.length).toBe(5);
  });
  it('a game with no setup is the same game as before setup existed', () => {
    const a = simulateGame(21, exhibitionTeams(21));
    const b = simulateGame(21, exhibitionTeams(21), { setup: { quarterMinutes: 12, weather: 'clear' } });
    expect(gameHash(a)).toBe(gameHash(b));
  });
  it('every quarter length plays four quarters of that length, and shorter games have fewer plays', () => {
    let last = 0;
    for (const m of QUARTER_MINUTES) {
      const fresh = new Game(4, exhibitionTeams(4), { setup: { quarterMinutes: m } });
      expect(fresh.state.clock).toBe(m * 60);
      let plays = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const g = simulateGame(seed, exhibitionTeams(seed), { setup: { quarterMinutes: m } });
        expect(g.state.phase).toBe('final');
        expect(g.state.quarter).toBe(4 + g.overtime);
        expect(Math.max(...g.events.map((e) => e.clock))).toBeLessThanOrEqual(m * 60);
        plays += g.events.length;
      }
      expect(plays).toBeGreaterThan(last);
      last = plays;
    }
  });
  it('a game replays to the same result only under the same setup', () => {
    const setup = { quarterMinutes: 6 as const, weather: 'rain' as const };
    const a = simulateGame(8, exhibitionTeams(8), { setup });
    expect(gameHash(replayGame(8, exhibitionTeams(8), a.log, { setup }))).toBe(gameHash(a));
    expect(a.setup).toEqual(setup);
  });
});

describe(`weather over ${N} games each`, () => {
  const clear = season('clear');
  const rain = season('rain');
  const wind = season('wind');
  const snow = season('snow');
  it('rain: fewer completions, more fumbles, fewer field goals made', () => {
    console.log('clear', clear, '\nrain', rain, '\nwind', wind, '\nsnow', snow);
    expect(rain.comp).toBeLessThan(clear.comp - 0.015);
    expect(rain.fumbles).toBeGreaterThan(clear.fumbles * 1.2);
    expect(rain.fg).toBeLessThan(clear.fg);
  });
  it('wind: kicks suffer most, punts are shorter', () => {
    expect(wind.fg).toBeLessThan(clear.fg - 0.04);
    expect(wind.punt).toBeLessThan(clear.punt - 2);
  });
  it('snow: harder to throw and kick, and scoring drops', () => {
    expect(snow.comp).toBeLessThan(clear.comp - 0.015);
    expect(snow.fg).toBeLessThan(clear.fg - 0.04);
    expect(snow.points).toBeLessThan(clear.points);
  });
  it('bad weather stays football: scoring within 35 percent of a clear night', () => {
    for (const w of [rain, wind, snow]) expect(w.points).toBeGreaterThan(clear.points * 0.65);
  });
  it('heat: players tire faster, so more substitutions', () => {
    const subs = (weather: Weather): number => {
      let n = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const g = new Game(seed, exhibitionTeams(seed), { setup: { weather } });
        const done = simulateGame(seed, exhibitionTeams(seed), { setup: { weather } });
        for (const d of done.log) {
          if ('manage' in d) continue;
          g.begin(d.off, d.def);
          n += g.lastSubs.length;
          while (!g.tick()) { /* step */ }
        }
      }
      return n;
    };
    expect(WEATHER.heat.drain).toBeGreaterThan(1);
    expect(subs('heat')).toBeGreaterThan(subs('clear') * 1.2);
  });
});
