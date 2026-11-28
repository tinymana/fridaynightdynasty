import { describe, expect, it } from 'vitest';
import { EXHIBITION_TEAMS, exhibitionTeams, overall } from '@fnd/core';
import { Game, gameHash, simulateGame, tossWinner } from '@fnd/match-sim';
import { STATES, cleanPick, matchupTeams, pickableSchools } from '@fnd/league';
import { MemoryStore, createApi, type RoomView } from '@fnd/online';

/** Coaches choose their school for an exhibition or a game against a friend; the coin toss opens the game. */

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('choosing a school', () => {
  it('offers eight schools in every state, the same every time', () => {
    for (const s of STATES) {
      const a = pickableSchools(s.code);
      expect(a).toHaveLength(8);
      expect(pickableSchools(s.code).map((x) => x.name)).toEqual(a.map((x) => x.name));
    }
  });

  it('throws out picks that are not a real state and school', () => {
    const st = STATES[0].code;
    expect(cleanPick({ state: st, school: 3 })).toEqual({ state: st, school: 3 });
    for (const bad of [null, 7, 'x', {}, { state: 'ZZ', school: 0 }, { state: st, school: 8 }, { state: st, school: -1 }, { state: st, school: 1.5 }]) expect(cleanPick(bad)).toBeNull();
  });

  it('plays the classic matchup when nobody picks', () => {
    for (const seed of [1, 99, 123456]) {
      expect(gameHash(simulateGame(seed, matchupTeams(seed)))).toBe(gameHash(simulateGame(seed, exhibitionTeams(seed))));
    }
  });

  it('changes the name and colours but never the players', () => {
    const st = STATES[4].code;
    const picked = matchupTeams(77, [{ state: st, school: 2 }, { state: st, school: 5 }]);
    const stock = exhibitionTeams(77);
    const schools = pickableSchools(st);
    expect(picked[0].name).toBe(schools[2].name);
    expect(picked[1].name).toBe(schools[5].name);
    for (const i of [0, 1] as const) {
      expect(picked[i].roster.map((p) => overall(p))).toEqual(stock[i].roster.map((p) => overall(p)));
      expect(picked[i].id).toBe(stock[i].id);
    }
    expect(Math.abs(mean(picked[0].roster.map((p) => overall(p))) - mean(picked[1].roster.map((p) => overall(p))))).toBeLessThan(3);
  });

  it('gives the second coach the classic school when both pick the same one', () => {
    const pick = { state: STATES[0].code, school: 0 };
    const t = matchupTeams(5, [pick, pick]);
    expect(t[0].name).toBe(pickableSchools(pick.state)[0].name);
    expect(t[1].name).toBe(EXHIBITION_TEAMS[1].name);
  });

  it('carries each coach’s school through hosting and joining', async () => {
    const api = createApi(new MemoryStore(), () => 1_000_000);
    const call = async (body: Record<string, unknown>) => (await api(body)).data as { ok: boolean; room?: RoomView; token?: string };
    const a = (await call({ action: 'enter', name: 'COACH A', pin: '1234' })).token;
    const b = (await call({ action: 'enter', name: 'COACH B', pin: '1234' })).token;
    const st = STATES[1].code;
    const hosted = await call({ action: 'host', token: a, team: 0, school: { state: st, school: 4 } });
    expect(hosted.room!.picks).toEqual([{ state: st, school: 4 }, null]);
    const joined = await call({ action: 'join', token: b, pin: hosted.room!.pin, school: { state: 'ZZ', school: 1 } });
    expect(joined.room!.picks).toEqual([{ state: st, school: 4 }, null]);
    const again = await call({ action: 'host', token: b, team: 0, school: 'nonsense' });
    expect(again.room!.picks).toEqual([null, null]);
  });
});

describe('the coin toss', () => {
  it('is decided by the seed and the winner receives unless he chooses to kick', () => {
    let zero = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = tossWinner(seed);
      if (w === 0) zero++;
      const teams = exhibitionTeams(seed);
      expect(new Game(seed, teams).state.kicking).toBe(w === 0 ? 1 : 0);
      expect(new Game(seed, teams, { receiver: w === 0 ? 1 : 0 }).state.kicking).toBe(w);
    }
    expect(zero).toBeGreaterThan(70);
    expect(zero).toBeLessThan(130);
  });
});
