import type { PlayEvent } from '@fnd/core';
import crowd from './assets/cutins/crowd.webp';
import fgGood from './assets/cutins/fg-good.webp';
import fgMiss from './assets/cutins/fg-miss.webp';
import final from './assets/cutins/final.webp';
import halftime from './assets/cutins/halftime.webp';
import intercepted from './assets/cutins/intercepted.webp';
import kickoff from './assets/cutins/kickoff.webp';
import patGood from './assets/cutins/pat-good.webp';
import sack from './assets/cutins/sack.webp';
import safety from './assets/cutins/safety.webp';
import scoreboardTd from './assets/cutins/scoreboard-td.webp';
import tdBanner from './assets/cutins/td-banner.webp';
import tdBurst from './assets/cutins/td-burst.webp';
import tdDive from './assets/cutins/td-dive.webp';

/** Broadcast-style cut-in panels. Art by the creative director; cut from the sheets in art/source by tools/cut-art.py. */
export interface Cutin {
  url: string;
  alt: string;
}

const TOUCHDOWNS = [tdDive, tdBurst, tdBanner, scoreboardTd, crowd];

/** The panel for what just happened, or null for an ordinary play. `n` varies the touchdown art from score to score. */
export function cutinFor(e: PlayEvent | null, period: 'half' | 'final' | null, n: number): Cutin | null {
  if (e) {
    if (e.flags.touchdown) return { url: TOUCHDOWNS[n % TOUCHDOWNS.length], alt: 'Touchdown' };
    if (e.flags.safety) return { url: safety, alt: 'Safety' };
    if (e.flags.interception) return { url: intercepted, alt: 'Intercepted' };
    if (e.type === 'fieldGoal' && !e.flags.roughing) return e.flags.good ? { url: fgGood, alt: 'The field goal is good' } : { url: fgMiss, alt: 'The field goal is no good' };
    if (e.type === 'pat') return e.flags.good ? { url: patGood, alt: 'The extra point is good' } : { url: fgMiss, alt: 'The extra point is no good' };
    if (e.flags.sack) return { url: sack, alt: 'Sack' };
    if (e.type === 'kickoff' && e.flags.onside) return { url: kickoff, alt: 'Onside kick' };
  }
  if (period === 'final') return { url: final, alt: 'Game over' };
  if (period === 'half') return { url: halftime, alt: 'Half time' };
  return null;
}
