export const SLIDER_MAX_TICKS = 2_048

export interface SliderTickParameters {
  readonly beatmapVersion: number
  readonly pixelLength: number
  readonly sliderMultiplier: number
  readonly sliderTickRate: number
  /** Decoded slider velocity in osu pixels per millisecond. */
  readonly velocity: number
  readonly baseBeatLength: number
  readonly generateTicks?: boolean
}

/** Port of OsuDatabaseBeatmap.cpp:576-645. Returns positions within one span. */
export function generateSliderTickPercentages(parameters: SliderTickParameters): number[] {
  const {
    beatmapVersion,
    pixelLength,
    sliderMultiplier,
    sliderTickRate,
    velocity,
    baseBeatLength,
    generateTicks = true,
  } = parameters
  if (
    !generateTicks ||
    !(pixelLength > 0) ||
    !(sliderMultiplier > 0) ||
    !(sliderTickRate > 0) ||
    !Number.isFinite(velocity) ||
    !Number.isFinite(baseBeatLength)
  ) return []

  const baseTickDistance = (100 * sliderMultiplier) / sliderTickRate
  // For v8+, McOsu divides by effectiveBeatLength/baseBeatLength. Since
  // osu-parsers already applies SV, velocity*baseBeatLength is equivalent.
  const tickPixelLength = beatmapVersion < 8
    ? baseTickDistance
    : (velocity * baseBeatLength) / sliderTickRate
  if (!(tickPixelLength > 0) || !Number.isFinite(tickPixelLength)) return []

  const minimumDistanceFromEnd = 0.01 * (velocity * 1_000)
  const tickCount = Math.min(Math.ceil(pixelLength / tickPixelLength) - 1, SLIDER_MAX_TICKS)
  const percentages: number[] = []
  let distanceToEnd = pixelLength
  for (let index = 0; index < tickCount; index += 1) {
    distanceToEnd -= tickPixelLength
    if (distanceToEnd <= minimumDistanceFromEnd) break
    percentages.push(((index + 1) * tickPixelLength) / pixelLength)
  }
  return percentages
}
