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
import aBurst from './assets/cutins/a-burst.webp';
import aCheer from './assets/cutins/a-cheer.webp';
import aFumble from './assets/cutins/a-fumble.webp';
import aIntercepted from './assets/cutins/a-intercepted.webp';
import aLeap from './assets/cutins/a-leap.webp';
import aPile from './assets/cutins/a-pile.webp';
import aRef from './assets/cutins/a-ref.webp';
import aSack from './assets/cutins/a-sack.webp';
import aStiff from './assets/cutins/a-stiff.webp';
import aThrow from './assets/cutins/a-throw.webp';
import aTouchdown from './assets/cutins/a-touchdown.webp';
import nBus from './assets/cutins/n-bus.webp';
import nChalk from './assets/cutins/n-chalk.webp';
import nCointoss from './assets/cutins/n-cointoss.webp';
import nFourth from './assets/cutins/n-fourth.webp';
import nHandshake from './assets/cutins/n-handshake.webp';
import nHomecoming from './assets/cutins/n-homecoming.webp';
import nLocker from './assets/cutins/n-locker.webp';
import nOvertime from './assets/cutins/n-overtime.webp';
import nRunthrough from './assets/cutins/n-runthrough.webp';
import nRivalry from './assets/cutins/n-rivalry.webp';
import nRivalryWin from './assets/cutins/n-rivalry-win.webp';

/** Broadcast-style cut-in panels. Art by the creative director; cut from the sheets in art/source by tools/cut-art.py. */
export interface Cutin {
  url: string;
  alt: string;
}

const TOUCHDOWNS = [mTdSpike, aRef, tdDive, aTouchdown, mTdPylon, tdBurst, tdBanner, scoreboardTd, crowd];
/** A gain this long gets a picture of its own. */
const BIG_PLAY = 20;

/** What the night is, for the panels that depend on it. */
export interface CutinContext {
  /** The coach's team won the game that just ended. */
  won?: boolean;
  /** That game was the state final. */
  title?: boolean;
  /** Half time on homecoming night. */
  homecoming?: boolean;
  /** The coach's team is at home. */
  home?: boolean;
  /** The two schools are rivals and this is their game. */
  rivalry?: boolean;
}

/** A point in the night that gets its own panel: before the kickoff, the half, the start of the fourth, overtime, the end. */
export type CutinPeriod = 'opening' | 'half' | 'fourth' | 'overtime' | 'final' | null;

/** The panel for what just happened, or null for an ordinary play. `n` varies the touchdown art from score to score. */
export function cutinFor(e: PlayEvent | null, period: CutinPeriod, n: number, ctx: CutinContext = {}): Cutin | null {
  if (e) {
    if (e.flags.touchdown || e.flags.defensiveTouchdown) return { url: TOUCHDOWNS[n % TOUCHDOWNS.length], alt: 'Touchdown' };
    if (e.flags.safety) return { url: safety, alt: 'Safety' };
    if (e.flags.interception) return { url: [mPicked, intercepted, aIntercepted][n % 3], alt: 'Intercepted' };
    if (e.flags.blocked) return { url: mBlocked, alt: 'Blocked' };
    if (e.flags.fumbleLost) return { url: [aPile, mLooseBall, aFumble][n % 3], alt: 'Fumble' };
    if (e.type === 'fieldGoal' && !e.flags.roughing) return e.flags.good ? { url: fgGood, alt: 'The field goal is good' } : { url: n % 2 ? fgMiss : mNoGood, alt: 'The field goal is no good' };
    if (e.type === 'pat') return e.flags.good ? { url: n % 2 ? aCheer : patGood, alt: 'The extra point is good' } : { url: fgMiss, alt: 'The extra point is no good' };
    if (e.flags.sack) return { url: n % 2 ? aSack : sack, alt: 'Sack' };
    // The long ones: a runner breaking into the open, a catch down the field.
    if (e.type === 'run' && e.yards >= BIG_PLAY) return { url: (n + e.yards) % 2 ? aBurst : aStiff, alt: 'A long run' };
    if (e.type === 'pass' && e.flags.complete && e.yards >= BIG_PLAY) return { url: (n + e.yards) % 2 ? aLeap : aThrow, alt: 'A long pass' };
    if (e.type === 'kickoff' && e.flags.onside) return { url: kickoff, alt: 'Onside kick' };
  }
  if (period === 'final' && ctx.won && ctx.rivalry) return { url: nRivalryWin, alt: 'A rivalry win' };
  if (period === 'opening' && ctx.rivalry) return { url: nRivalry, alt: 'Rivalry game' };
  if (period === 'final') return ctx.won && ctx.title ? { url: mChampions, alt: 'State champions' } : ctx.won ? { url: mCelebration, alt: 'A win' } : { url: n % 2 ? nHandshake : final, alt: 'Game over' };
  if (period === 'half') return ctx.homecoming ? { url: mCrowning, alt: 'The homecoming king and queen are crowned' } : { url: [halftime, nLocker, mHalftimeShow, nChalk][n % 4], alt: 'Half time' };
  if (period === 'fourth') return { url: nFourth, alt: 'Fourth quarter' };
  if (period === 'overtime') return { url: n % 2 ? nCointoss : nOvertime, alt: 'Overtime' };
  // Before the kickoff: the homecoming banner, the home team through the paper banner, or the bus pulling in on the road.
  if (period === 'opening') return ctx.homecoming ? { url: nHomecoming, alt: 'Homecoming' } : ctx.home ? { url: nRunthrough, alt: 'The home team runs out' } : { url: nBus, alt: 'The bus arrives' };
  return null;
}
