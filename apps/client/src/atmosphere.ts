import { Rng, type Team } from '@fnd/core';
import type { Occasion } from '@fnd/league';

/**
 * Friday night atmosphere, the part that is pure data: how loud the crowd should be, each school's fight
 * song, and what happens at half time. No sound and no page here, so it can be tested. `audio.ts` plays it.
 */

export interface Note {
  /** Frequency in hertz. */
  f: number;
  /** Start and length in seconds. */
  t: number;
  d: number;
}

/** B-flat major, where school bands live. Scale degrees run from the B-flat below middle C. */
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const pitch = (degree: number): number => {
  const octave = Math.floor(degree / 7);
  const semis = SCALE[((degree % 7) + 7) % 7] + 12 * octave;
  return 233.08 * Math.pow(2, semis / 12);
};
/** Rhythms for one bar of march time, in beats. Each adds up to four. */
const BARS: readonly (readonly number[])[] = [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 2], [0.5, 0.5, 1, 2], [2, 1, 1], [1, 1, 2], [0.5, 0.5, 0.5, 0.5, 2]];
export const FIGHT_SONG_BEAT = 60 / 138;

/**
 * A school's fight song: four bars, made up from the school's own seed so every school has its own tune
 * and always the same one. It starts on the home note or the fifth, moves by step with the odd leap, and
 * finishes on a long high home note.
 */
export function fightSong(seed: number): Note[] {
  const rng = Rng.stream(seed, 'fight-song');
  const notes: Note[] = [];
  let degree = rng.chance(0.5) ? 0 : 4;
  let t = 0;
  // The first two bars are answered by the same rhythm: that is what makes it sound like a song.
  const first = BARS[rng.int(0, BARS.length - 1)];
  const second = BARS[rng.int(0, BARS.length - 1)];
  const bars = [first, second, first, [1, 1, 2] as const];
  bars.forEach((bar, b) => {
    bar.forEach((beats, i) => {
      const last = b === 3 && i === bar.length - 1;
      if (last) degree = 7;
      else if (b === 3) degree = i === 0 ? 4 : 6;
      else if (!(b === 0 && i === 0)) {
        const step = rng.chance(0.22) ? rng.pick([-3, 3, 4]) : rng.pick([-2, -1, -1, 1, 1, 2]);
        degree = Math.max(-1, Math.min(9, degree + step));
      }
      notes.push({ f: pitch(degree), t: t * FIGHT_SONG_BEAT, d: beats * FIGHT_SONG_BEAT * (last ? 1 : 0.86) });
      t += beats;
    });
  });
  return notes;
}

export interface CrowdInput {
  /** Team 0 is at home; the stands are theirs. */
  possession: 0 | 1;
  down: number;
  yardLine: number;
  quarter: number;
  /** Home score minus visitors' score. */
  homeLead: number;
  occasion: Occasion;
}

/** How loud the stands are before the snap, 0 (a murmur) to 1 (the roof is coming off). */
export function crowdLevel(c: CrowdInput): number {
  let level = 0.28;
  const homeBall = c.possession === 0;
  // A home crowd gets loud when the visitors have to convert.
  if (!homeBall && c.down >= 3) level += 0.22;
  // And when its own team is knocking on the door, or backed up against its goal.
  if (homeBall && c.yardLine >= 80) level += 0.16;
  if (!homeBall && c.yardLine >= 90) level += 0.12;
  const margin = Math.abs(c.homeLead);
  if (c.quarter >= 4 && margin <= 8) level += 0.2;
  if (c.quarter > 4) level += 0.1;
  if (margin >= 22) level -= c.homeLead < 0 ? 0.16 : 0.06;
  if (c.occasion === 'homecoming' || c.occasion === 'championship') level += 0.1;
  if (c.occasion === 'seniorNight' || c.occasion === 'opener') level += 0.05;
  return Math.max(0.08, Math.min(1, level));
}

/** The chant, if any, for this snap. `n` is the snap number: chants come and go, they do not run on every play. */
export function chantFor(c: CrowdInput, n: number): 'defense' | 'letsGo' | null {
  const homeBall = c.possession === 0;
  if (!homeBall && c.down >= 3) return n % 3 !== 1 ? 'defense' : null;
  if (homeBall && c.down === 1 && n % 4 === 0) return 'letsGo';
  if (homeBall && c.yardLine >= 85 && n % 2 === 0) return 'letsGo';
  return null;
}

const THEMES = ['a big band swing set', 'a disco medley', 'songs of the open road', 'a salute to the armed forces', 'a night at the symphony', 'a rock and roll revue', 'music from the silent movies', 'a Latin jazz set', 'a tribute to the space race', 'songs of the county fair'];
const SIDE = [
  'The 50-50 raffle winner takes home $%N.',
  'The youth league Mighty Mites scrimmage at midfield, and nobody is tackled on purpose.',
  'The cheer squad lands the pyramid.',
  'The mascot wins the tricycle race against the vice principal.',
  'The booster club says the new scoreboard fund is %P percent of the way there.',
  'The dance team performs to a standing ovation from the student section.',
  'Elementary schoolers line up for the punt, pass and kick contest.',
  'The band parents sell out of walking tacos.',
  'Last year\'s seniors are back from college and loud about it.',
];
const QUEENS = ['Maya', 'Sofia', 'Hannah', 'Jasmine', 'Abigail', 'Camila', 'Brooke', 'Naomi', 'Lena', 'Priya', 'Tessa', 'Aaliyah', 'Grace', 'Marisol', 'Kiana', 'Ruby'];
const SURNAMES = ['Alder', 'Calloway', 'Esparza', 'Fenwick', 'Hartsock', 'Jessup', 'Lindqvist', 'Nakamura', 'Okafor', 'Pruitt', 'Sandoval', 'Whitlock', 'Yarbrough', 'Beaumont', 'Delacroix', 'Greer'];

export interface HalftimeShow {
  title: string;
  lines: string[];
}

/** What happens on the field at half time. The same game always gets the same show. */
export function halftimeShow(seed: number, occasion: Occasion, home: Team, away: Team): HalftimeShow {
  const rng = Rng.stream(seed, 'halftime');
  const theme = rng.pick(THEMES);
  const side = rng.pick(SIDE).replace('%N', String(rng.int(18, 62) * 10 + rng.int(0, 9))).replace('%P', String(rng.int(35, 90)));
  const seniors = home.roster.filter((p) => p.year === 4);
  const band = `The ${home.name} marching band`;
  if (occasion === 'championship') {
    return { title: 'State championship half-time', lines: [`The ${home.name} and ${away.name} bands take the field together for ${theme}.`, 'Both student sections try to out-shout each other the whole way through.'] };
  }
  if (occasion === 'homecoming') {
    const lines = [`${band} plays the fight song as the homecoming court walks out to midfield.`];
    const queen = `${rng.pick(QUEENS)} ${rng.pick(SURNAMES)}`;
    if (seniors.length) {
      const king = rng.pick(seniors);
      lines.push(`Homecoming king: senior ${king.pos} ${king.name}, still in his pads. Homecoming queen: ${queen}.`);
    } else lines.push(`Homecoming queen: ${queen}. The king is announced to a roar from the student section.`);
    lines.push('The alumni section is on its feet.');
    return { title: 'Homecoming', lines };
  }
  if (occasion === 'seniorNight') {
    const named = [...seniors].sort((a, b) => a.number - b.number).slice(0, 4).map((p) => `#${p.number} ${p.name}`);
    return {
      title: 'Senior night',
      lines: [seniors.length ? `${seniors.length} seniors are honored at midfield with their families: ${named.join(', ')}${seniors.length > named.length ? ' and the rest of the class' : ''}.` : 'The seniors are honored at midfield with their families.', `${band} plays them off with ${theme}.`],
    };
  }
  if (occasion === 'opener') return { title: 'Home opener', lines: [`${band} shows off this year's half-time show for the first time: ${theme}.`, side] };
  return { title: 'Half-time show', lines: [`${band} plays ${theme}.`, side] };
}
