import { kickAccuracy, overall } from './teamgen';
import type { Group, Player, RatingKey } from './types';

/** Letter grades, best first: fifteen steps from A+ down to F-. */
export const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+', 'F', 'F-'] as const;
export type Grade = (typeof GRADES)[number];

/** The lowest rating that earns an A+, and how many rating points each step down is worth. */
const TOP = 80;
const STEP = 4;

/** How far down the scale a rating sits: 0 is A+, 14 is F-. High school players run from the 20s to the high 80s. */
export function gradeStep(rating: number): number {
  if (rating >= TOP) return 0;
  return Math.min(GRADES.length - 1, Math.floor((TOP - 1 - rating) / STEP) + 1);
}

export function gradeOf(rating: number): Grade {
  return GRADES[gradeStep(rating)] as Grade;
}

/** The few abilities worth showing at each position, most important first. */
type Ability = readonly [label: string, rating: RatingKey | ((p: Player) => number)];
const LEG: readonly Ability[] = [['Leg power', 'kicking'], ['Leg accuracy', kickAccuracy], ['Speed', 'speed']];
export const GRADE_ATTRS: Record<Group, readonly Ability[]> = {
  QB: [['Arm power', 'throwPower'], ['Accuracy', 'throwAccuracy'], ['Speed', 'speed'], ['Reads', 'awareness']],
  RB: [['Speed', 'speed'], ['Moves', 'agility'], ['Power', 'power'], ['Hands', 'hands']],
  WR: [['Speed', 'speed'], ['Hands', 'hands'], ['Moves', 'agility']],
  TE: [['Hands', 'hands'], ['Blocking', 'runBlock'], ['Power', 'power'], ['Speed', 'speed']],
  OL: [['Run block', 'runBlock'], ['Pass block', 'passBlock'], ['Strength', 'power']],
  DL: [['Strength', 'power'], ['Tackling', 'tackling'], ['Quickness', 'agility']],
  LB: [['Tackling', 'tackling'], ['Strength', 'power'], ['Speed', 'speed'], ['Coverage', 'coverage']],
  CB: [['Coverage', 'coverage'], ['Speed', 'speed'], ['Tackling', 'tackling']],
  S: [['Coverage', 'coverage'], ['Speed', 'speed'], ['Tackling', 'tackling']],
  K: LEG,
  P: LEG,
};

export interface ReportCard {
  overall: Grade;
  attrs: { label: string; grade: Grade; rating: number }[];
}

/** A player's report card: one overall grade and a grade for each ability that matters at his position. */
export function reportCard(p: Player): ReportCard {
  return { overall: gradeOf(overall(p)), attrs: GRADE_ATTRS[p.pos].map(([label, key]) => { const rating = typeof key === 'function' ? key(p) : p.ratings[key]; return { label, grade: gradeOf(rating), rating }; }) };
}
