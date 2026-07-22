export type Grade = 'XH' | 'SH' | 'X' | 'S' | 'A' | 'B' | 'C' | 'D'

export interface GradeCounts {
  readonly count300: number
  readonly count100: number
  readonly count50: number
  readonly countMiss: number
}

/** Exact port of McOsu `OsuScore.cpp:644-668`. */
export function calculateGrade(
  counts: GradeCounts,
  mods: { readonly hidden?: boolean; readonly flashlight?: boolean } = {},
): Grade {
  const total = counts.countMiss + counts.count50 + counts.count100 + counts.count300
  const percent300 = total > 0 ? counts.count300 / total : 0
  const percent50 = total > 0 ? counts.count50 / total : 0

  let grade: Grade = 'D'
  if (percent300 > 0.6) grade = 'C'
  if ((percent300 > 0.7 && counts.countMiss === 0) || percent300 > 0.8) grade = 'B'
  if ((percent300 > 0.8 && counts.countMiss === 0) || percent300 > 0.9) grade = 'A'
  if (percent300 > 0.9 && percent50 <= 0.01 && counts.countMiss === 0) {
    grade = mods.hidden || mods.flashlight ? 'SH' : 'S'
  }
  if (counts.countMiss === 0 && counts.count50 === 0 && counts.count100 === 0) {
    grade = mods.hidden || mods.flashlight ? 'XH' : 'X'
  }
  return grade
}
