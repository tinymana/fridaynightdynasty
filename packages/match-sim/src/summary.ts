import type { PlayEvent } from '@fnd/core';

/** Minimal team totals for the Milestone 1 final screen. The full box score arrives with the stats package (M3). */
export interface TeamSummary {
  plays: number;
  rushAtt: number;
  rushYds: number;
  passAtt: number;
  passComp: number;
  passYds: number;
  sacksTaken: number;
  turnovers: number;
  firstDowns: number;
  totalYds: number;
}

export function summarize(events: readonly PlayEvent[]): [TeamSummary, TeamSummary] {
  const mk = (): TeamSummary => ({ plays: 0, rushAtt: 0, rushYds: 0, passAtt: 0, passComp: 0, passYds: 0, sacksTaken: 0, turnovers: 0, firstDowns: 0, totalYds: 0 });
  const out: [TeamSummary, TeamSummary] = [mk(), mk()];
  for (const e of events) {
    if (e.type !== 'run' && e.type !== 'pass') continue;
    const t = out[e.offense];
    t.plays++;
    if (e.flags.firstDown) t.firstDowns++;
    if (e.flags.interception || e.flags.fumbleLost) t.turnovers++;
    // High school and college scoring: sack yardage counts against rushing.
    if (e.type === 'run' || e.flags.sack) {
      t.rushAtt++;
      t.rushYds += e.yards;
      if (e.flags.sack) t.sacksTaken++;
    } else {
      t.passAtt++;
      if (e.flags.complete) {
        t.passComp++;
        t.passYds += e.yards;
      }
    }
    t.totalYds = t.rushYds + t.passYds;
  }
  return out;
}
