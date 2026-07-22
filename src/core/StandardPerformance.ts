import { ScoreInfo, type IBeatmap } from 'osu-classes'
import { BeatmapDecoder } from 'osu-parsers'
import {
  StandardRuleset,
  type StandardDifficultyAttributes,
  type StandardModCombination,
} from 'osu-standard-stable'
import type { ScoreSnapshot } from './Score.ts'
import type { GameplayMods } from './Mods.ts'

export interface PerformanceResult {
  readonly pp: number
  readonly starRating: number
  readonly maxCombo: number
}

export function modsToAcronyms(mods: GameplayMods): string {
  const acronyms: string[] = []
  if (mods.NF) acronyms.push('NF')
  if (mods.EZ) acronyms.push('EZ')
  else if (mods.HR) acronyms.push('HR')
  if (mods.HD) acronyms.push('HD')
  if (mods.NC) acronyms.push('NC')
  else if (mods.DT) acronyms.push('DT')
  else if (mods.HT) acronyms.push('HT')
  return acronyms.join('')
}

export class StandardPerformanceContext {
  readonly starRating: number
  readonly maxCombo: number
  readonly #ruleset: StandardRuleset
  readonly #mods: StandardModCombination
  readonly #attributes: StandardDifficultyAttributes
  readonly #unranked: boolean

  constructor(beatmap: IBeatmap, mods: GameplayMods) {
    this.#ruleset = new StandardRuleset()
    this.#mods = this.#ruleset.createModCombination(modsToAcronyms(mods))
    this.#attributes = this.#ruleset
      .createDifficultyCalculator(beatmap)
      .calculateWithMods(this.#mods)
    this.starRating = finiteNonNegative(this.#attributes.starRating)
    this.maxCombo = Math.max(0, this.#attributes.maxCombo)
    this.#unranked = mods.Auto
  }

  calculate(score: Pick<ScoreSnapshot, 'maxCombo' | 'accuracy' | 'count300' | 'count100' | 'count50' | 'countMiss'>): PerformanceResult {
    const totalHits = score.count300 + score.count100 + score.count50 + score.countMiss
    if (this.#unranked || totalHits === 0) {
      return { pp: 0, starRating: this.starRating, maxCombo: this.maxCombo }
    }

    const scoreInfo = new ScoreInfo({
      maxCombo: Math.max(0, score.maxCombo),
      rulesetId: 0,
      count300: Math.max(0, score.count300),
      count100: Math.max(0, score.count100),
      count50: Math.max(0, score.count50),
      countMiss: Math.max(0, score.countMiss),
      mods: this.#mods,
      passed: true,
    })
    scoreInfo.accuracy = clamp(score.accuracy, 0, 1)
    const pp = this.#ruleset
      .createPerformanceCalculator(this.#attributes, scoreInfo)
      .calculate()
    return {
      pp: finiteNonNegative(pp),
      starRating: this.starRating,
      maxCombo: this.maxCombo,
    }
  }
}

export function createStandardPerformance(text: string, mods: GameplayMods): StandardPerformanceContext {
  const beatmap = new BeatmapDecoder().decodeFromString(text, { parseStoryboard: false })
  return new StandardPerformanceContext(beatmap, mods)
}

export function calculateStarRating(text: string, mods: GameplayMods): number {
  return createStandardPerformance(text, mods).starRating
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
