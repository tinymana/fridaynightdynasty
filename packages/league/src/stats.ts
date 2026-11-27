import type { PlayEvent } from '@fnd/core';

/** One player's numbers, for a game, a season or a career. Every field adds, so lines can be summed. */
export interface StatLine {
  games: number;
  passAtt: number;
  passComp: number;
  passYds: number;
  passTd: number;
  passInt: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  rec: number;
  recYds: number;
  recTd: number;
  tackles: number;
  sacks: number;
  ints: number;
  fgMade: number;
  fgAtt: number;
  xpMade: number;
  retYds: number;
}
export type StatKey = keyof StatLine;
export const STAT_KEYS: readonly StatKey[] = ['games', 'passAtt', 'passComp', 'passYds', 'passTd', 'passInt', 'rushAtt', 'rushYds', 'rushTd', 'rec', 'recYds', 'recTd', 'tackles', 'sacks', 'ints', 'fgMade', 'fgAtt', 'xpMade', 'retYds'];
export const emptyLine = (): StatLine => ({ games: 0, passAtt: 0, passComp: 0, passYds: 0, passTd: 0, passInt: 0, rushAtt: 0, rushYds: 0, rushTd: 0, rec: 0, recYds: 0, recTd: 0, tackles: 0, sacks: 0, ints: 0, fgMade: 0, fgAtt: 0, xpMade: 0, retYds: 0 });
export function addLine(a: StatLine, b: StatLine): StatLine {
  const out = emptyLine();
  for (const k of STAT_KEYS) out[k] = a[k] + b[k];
  return out;
}

export interface TeamLine {
  points: number;
  yards: number;
}

/** A game's box score: a line for every player who did something, by player id, and each team's totals. */
export interface BoxScore {
  players: [Record<string, StatLine>, Record<string, StatLine>];
  teams: [TeamLine, TeamLine];
}

/**
 * Adds up a game from its play-by-play. Counted the way a high school scorer does: a sack is a rushing
 * attempt for the quarterback, kneel-downs count as carries, and a penalty play counts for nobody.
 */
export function boxScore(events: readonly PlayEvent[]): BoxScore {
  const players: [Record<string, StatLine>, Record<string, StatLine>] = [{}, {}];
  const teams: [TeamLine, TeamLine] = [{ points: 0, yards: 0 }, { points: 0, yards: 0 }];
  const line = (team: 0 | 1, id: string | undefined): StatLine | null => {
    if (!id) return null;
    return (players[team][id] ??= { ...emptyLine(), games: 1 });
  };
  for (const e of events) {
    const off = e.offense;
    const def = (1 - off) as 0 | 1;
    teams[0].points += e.points[0];
    teams[1].points += e.points[1];
    const f = e.flags;
    if (e.type === 'run' || e.type === 'kneel') {
      const r = line(off, e.rusher);
      if (r) {
        r.rushAtt++;
        r.rushYds += e.yards;
        if (f.touchdown) r.rushTd++;
      }
      teams[off].yards += e.yards;
      const t = line(def, e.tackler);
      if (t && !f.touchdown) t.tackles++;
    } else if (e.type === 'pass') {
      const p = line(off, e.passer);
      if (f.sack) {
        if (p) {
          p.rushAtt++;
          p.rushYds += e.yards;
        }
        teams[off].yards += e.yards;
        const t = line(def, e.tackler);
        if (t) {
          t.sacks++;
          t.tackles++;
        }
      } else {
        if (p) {
          p.passAtt++;
          if (f.interception) p.passInt++;
        }
        if (f.complete) {
          if (p) {
            p.passComp++;
            p.passYds += e.yards;
            if (f.touchdown) p.passTd++;
          }
          const c = line(off, e.receiver);
          if (c) {
            c.rec++;
            c.recYds += e.yards;
            if (f.touchdown) c.recTd++;
          }
          teams[off].yards += e.yards;
          const t = line(def, e.tackler);
          if (t && !f.touchdown) t.tackles++;
        } else if (f.interception) {
          const t = line(def, e.tackler);
          if (t) t.ints++;
        }
      }
    } else if (e.type === 'fieldGoal' && !f.roughing) {
      const k = line(off, e.kicker);
      if (k) {
        k.fgAtt++;
        if (f.good) k.fgMade++;
      }
    } else if (e.type === 'pat') {
      const k = line(off, e.kicker);
      if (k && f.good) k.xpMade++;
    } else if (e.type === 'kickoff' && e.receiver && e.returnYards) {
      const r = line(def, e.receiver);
      if (r) r.retYds += e.returnYards;
    }
  }
  return { players, teams };
}
