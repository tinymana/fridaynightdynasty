import { GRADES, gradeOf, gradeStep, reportCard, type Player } from '@fnd/core';

/** Green for A+ through yellow and orange to red for F-. */
export function gradeColor(rating: number): string {
  const hue = Math.round(130 - (130 * gradeStep(rating)) / (GRADES.length - 1));
  return `hsl(${hue} 78% 48%)`;
}

/** A coloured letter grade. */
export function gradeChip(rating: number, title = ''): string {
  return `<b class="gr" style="background:${gradeColor(rating)}"${title ? ` title="${title}"` : ''}>${gradeOf(rating)}</b>`;
}

/** The line of ability grades under a player's name: "Arm power B+  Accuracy A  Speed D+". */
export function gradeLine(p: Player): string {
  return `<span class="gr-line">${reportCard(p).attrs.map((a) => `<span class="gr-a">${a.label} ${gradeChip(a.rating)}</span>`).join('')}</span>`;
}

/** Every grade in order, for the key under a roster. */
export function gradeKey(): string {
  return `<div class="gr-key" aria-label="Grades from best to worst">${GRADES.map((g, i) => `<b class="gr" style="background:${gradeColor(80 - i * 4)}">${g}</b>`).join('')}</div>`;
}
