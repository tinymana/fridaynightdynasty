/** Rules constants for the high school rule set (decision D4). */
export const RULES = {
  quarterSeconds: 720,
  quarters: 4,
  timeoutsPerHalf: 3,
  kickoffFrom: 40,
  safetyKickFrom: 20,
  touchbackAt: 20,
  twoPointFrom: 97,
  /** Seconds run off between plays while the clock is running. Tuned for 50 to 60 plays a team. */
  runoffSeconds: 32,
  /** Chance of each foul. Before the snap: per snap. Holding: per play the offense gained on. Interference: per incomplete pass. */
  falseStartChance: 0.03,
  /** Changing the play at the line is noisy: this much more chance of a false start. */
  audibleFalseStart: 0.025,
  offsideChance: 0.02,
  holdingChance: 0.035,
  interferenceChance: 0.05,
  /** Overtime: each team gets a series from the opponent's ten. First and goal. */
  overtimeFrom: 90,
  /** After this many overtime periods a game still level ends as a tie. */
  overtimePeriods: 4,
} as const;

/** Quarter lengths a game can be played with, in minutes. Twelve is the high school standard. */
export const QUARTER_MINUTES = [4, 6, 8, 10, 12] as const;
export type QuarterMinutes = (typeof QUARTER_MINUTES)[number];

export type Weather = 'clear' | 'rain' | 'wind' | 'snow' | 'heat';

/** What each kind of weather does. Every number is a small push on a roll the engine already makes. */
export interface WeatherEffect {
  name: string;
  desc: string;
  /** Added to the chance of catching a pass. */
  catching: number;
  /** Multiplies how far off target a throw can land. */
  throwError: number;
  /** Extra multiplier on throws of 15 yards or more. */
  deepError: number;
  /** Multiplies the chance of a fumble. */
  fumble: number;
  /** Added to the chance of making a field goal or extra point. */
  kicking: number;
  /** Multiplies punt distance. */
  puntDistance: number;
  /** Multiplies how fast players tire. */
  drain: number;
}
export const WEATHER: Record<Weather, WeatherEffect> = {
  clear: { name: 'Clear', desc: 'A perfect night for football.', catching: 0, throwError: 1, deepError: 1, fumble: 1, kicking: 0, puntDistance: 1, drain: 1 },
  rain: { name: 'Rain', desc: 'Wet ball: more drops and fumbles, shakier kicks.', catching: -0.05, throwError: 1.1, deepError: 1, fumble: 1.8, kicking: -0.06, puntDistance: 0.95, drain: 1 },
  wind: { name: 'Wind', desc: 'Deep throws sail and kicks drift.', catching: -0.01, throwError: 1, deepError: 1.5, fumble: 1, kicking: -0.1, puntDistance: 0.88, drain: 1 },
  snow: { name: 'Snow', desc: 'Cold hands and a slick ball. Hard to throw, hard to kick.', catching: -0.04, throwError: 1.15, deepError: 1.1, fumble: 1.4, kicking: -0.1, puntDistance: 0.9, drain: 1 },
  heat: { name: 'Heat', desc: 'Players tire half again as fast. Depth matters.', catching: 0, throwError: 1, deepError: 1, fumble: 1, kicking: 0, puntDistance: 1, drain: 1.5 },
};
export const WEATHERS = Object.keys(WEATHER) as Weather[];

/** The conditions a game is played under. Part of what identifies a game, with its seed. */
export interface GameSetup {
  quarterMinutes: QuarterMinutes;
  weather: Weather;
}
export const DEFAULT_SETUP: GameSetup = { quarterMinutes: 12, weather: 'clear' };

/** Anything that is not a known quarter length or weather falls back to the default. */
export function cleanSetup(raw: unknown): GameSetup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const q = QUARTER_MINUTES.find((m) => m === r['quarterMinutes']) ?? DEFAULT_SETUP.quarterMinutes;
  const w = WEATHERS.find((x) => x === r['weather']) ?? DEFAULT_SETUP.weather;
  return { quarterMinutes: q, weather: w };
}
