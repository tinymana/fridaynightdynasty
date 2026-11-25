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
} as const;
