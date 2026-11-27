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
import mBlocked from './assets/cutins/m-blocked.webp';
import mCelebration from './assets/cutins/m-celebration.webp';
import mChampions from './assets/cutins/m-champions.webp';
import mCrowning from './assets/cutins/m-crowning.webp';
import mHalftimeShow from './assets/cutins/m-halftime-show.webp';
import mLooseBall from './assets/cutins/m-loose-ball.webp';
import mNoGood from './assets/cutins/m-no-good.webp';
import mPicked from './assets/cutins/m-picked.webp';
import mTdPylon from './assets/cutins/m-td-pylon.webp';
import mTdSpike from './assets/cutins/m-td-spike.webp';

/** Broadcast-style cut-in panels. Art by the creative director; cut from the sheets in art/source by tools/cut-art.py. */
export interface Cutin {
  url: string;
  alt: string;
}

const TOUCHDOWNS = [mTdSpike, tdDive, mTdPylon, tdBurst, tdBanner, scoreboardTd, crowd];

/** What the night is, for the panels that depend on it. */
export interface CutinContext {
  /** The coach's team won the game that just ended. */
  won?: boolean;
  /** That game was the state final. */
  title?: boolean;
  /** Half time on homecoming night. */
  homecoming?: boolean;
}

/** The panel for what just happened, or null for an ordinary play. `n` varies the touchdown art from score to score. */
export function cutinFor(e: PlayEvent | null, period: 'half' | 'final' | null, n: number, ctx: CutinContext = {}): Cutin | null {
  if (e) {
    if (e.flags.touchdown || e.flags.defensiveTouchdown) return { url: TOUCHDOWNS[n % TOUCHDOWNS.length], alt: 'Touchdown' };
    if (e.flags.safety) return { url: safety, alt: 'Safety' };
    if (e.flags.interception) return { url: n % 2 ? intercepted : mPicked, alt: 'Intercepted' };
    if (e.flags.blocked) return { url: mBlocked, alt: 'Blocked' };
    if (e.flags.fumbleLost) return { url: mLooseBall, alt: 'Fumble' };
    if (e.type === 'fieldGoal' && !e.flags.roughing) return e.flags.good ? { url: fgGood, alt: 'The field goal is good' } : { url: n % 2 ? fgMiss : mNoGood, alt: 'The field goal is no good' };
    if (e.type === 'pat') return e.flags.good ? { url: patGood, alt: 'The extra point is good' } : { url: fgMiss, alt: 'The extra point is no good' };
    if (e.flags.sack) return { url: sack, alt: 'Sack' };
    if (e.type === 'kickoff' && e.flags.onside) return { url: kickoff, alt: 'Onside kick' };
  }
  if (period === 'final') return ctx.won && ctx.title ? { url: mChampions, alt: 'State champions' } : ctx.won ? { url: mCelebration, alt: 'A win' } : { url: final, alt: 'Game over' };
  if (period === 'half') return ctx.homecoming ? { url: mCrowning, alt: 'The homecoming king and queen are crowned' } : { url: n % 2 ? halftime : mHalftimeShow, alt: 'Half time' };
  return null;
}
