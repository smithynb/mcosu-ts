export type HitResult = '300' | '100' | '50' | 'miss'

export interface ScoreDifficulty {
  readonly circleSize: number
  readonly drainRate: number
  readonly overallDifficulty: number
  readonly objectCount: number
  readonly playableLengthMS: number
  readonly breakLengthMS?: number
  readonly modMultiplier?: number
}

export interface ScoreSnapshot {
  readonly score: number
  readonly combo: number
  readonly maxCombo: number
  readonly accuracy: number
  readonly count300: number
  readonly count100: number
  readonly count50: number
  readonly countMiss: number
}

export class Score {
  readonly difficultyMultiplier: number
  readonly #modMultiplier: number
  #score = 0
  #combo = 0
  #maxCombo = 0
  #count300 = 0
  #count100 = 0
  #count50 = 0
  #countMiss = 0

  constructor(difficulty: ScoreDifficulty) {
    const playable = Math.max(0, difficulty.playableLengthMS)
    const breaks = Math.min(Math.max(0, difficulty.breakLengthMS ?? 0), playable)
    const drainLengthSeconds = Math.max(playable - breaks, 1_000) / 1_000
    // OsuScore.cpp:178-182. All values are positive, so Math.round matches std::round.
    this.difficultyMultiplier = Math.round(
      ((difficulty.circleSize +
        difficulty.drainRate +
        difficulty.overallDifficulty +
        clamp((difficulty.objectCount / drainLengthSeconds) * 8, 0, 16)) /
        38) *
        5,
    )
    this.#modMultiplier = difficulty.modMultiplier ?? 1
  }

  addJudgment(result: HitResult, options: { increaseCombo?: boolean; score?: boolean } = {}): void {
    // OsuScore.cpp:114-182: score combo excludes the result currently being added.
    const scoreComboMultiplier = Math.max(this.#combo - 1, 0)
    const increaseCombo = options.increaseCombo ?? true
    if (result === 'miss') {
      this.#combo = 0
      this.#countMiss += 1
    } else {
      if (increaseCombo) this.#incrementCombo()
      if (result === '300') this.#count300 += 1
      else if (result === '100') this.#count100 += 1
      else this.#count50 += 1
    }

    if (options.score === false) return
    const hitValue = result === '300' ? 300 : result === '100' ? 100 : result === '50' ? 50 : 0
    // The C++ expression performs integer division after multiplying by the mod multiplier.
    this.#score += hitValue + Math.floor((hitValue * scoreComboMultiplier * this.difficultyMultiplier * this.#modMultiplier) / 25)
  }

  addSliderElement(points: 10 | 30, successful: boolean): void {
    // OsuSlider.cpp:2031-2065, 2101-2155, 2160+: successful heads/repeats
    // are +30, ticks are +10, and each successful element increases combo.
    if (successful) {
      this.#incrementCombo()
      this.#score += points
    } else {
      this.sliderBreak()
    }
  }

  sliderBreak(): void {
    this.#combo = 0
  }

  addSpinnerRotation(bonus: boolean): void {
    // OsuSpinner.cpp:501-517.
    this.#score += bonus ? 1_100 : 100
  }

  snapshot(): ScoreSnapshot {
    const total = this.#count300 + this.#count100 + this.#count50 + this.#countMiss
    const accuracy = total === 0
      ? 1
      : (this.#count300 + this.#count100 * (2 / 6) + this.#count50 * (1 / 6)) / total
    return {
      score: this.#score,
      combo: this.#combo,
      maxCombo: this.#maxCombo,
      accuracy,
      count300: this.#count300,
      count100: this.#count100,
      count50: this.#count50,
      countMiss: this.#countMiss,
    }
  }

  #incrementCombo(): void {
    this.#combo += 1
    this.#maxCombo = Math.max(this.#maxCombo, this.#combo)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
