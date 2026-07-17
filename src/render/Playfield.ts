import {
  approachTimeMS,
  fadeInProgress,
  getPlayfieldTransform,
  osuCoords2Pixels,
  rawCircleRadius,
  type Point,
} from '../core/GameRules.ts'
import { createSliderCurve, type SliderCurve } from '../core/SliderCurves.ts'
import type { GameplaySnapshot, JudgmentEvent } from '../core/GameplaySession.ts'
import type { HitResult } from '../core/Score.ts'
import type { GameplayBeatmap, GameplayCircle, GameplaySlider } from '../data/GameplayLoader.ts'
import { DEFAULT_COMBO_COLORS, type LoadedSkin, type SkinFrame } from '../skin/Skin.ts'
import { createSliderBodyRenderer, type SliderBodyRenderer } from './SliderRenderer.ts'
import { osuShowApproachCircleOnFirstHiddenObject, osuSliderFollowCircleSizeMultiplier, osuSnakingSliders } from '../core/ConVars.ts'
import { hiddenAlpha, type ModdedGameplayBeatmap } from '../core/Mods.ts'

export interface PlayfieldRenderer {
  render(positionMS: number, gameplay?: GameplayRenderState): void
  dispose(): void
}

export interface GameplayRenderState {
  readonly snapshot: GameplaySnapshot
  readonly cursor: Point
}

interface ResultAnimation {
  readonly event: JudgmentEvent
  readonly startedAt: number
}

export class CanvasPlayfield implements PlayfieldRenderer {
  readonly #canvas: HTMLCanvasElement
  readonly #context: CanvasRenderingContext2D
  readonly #beatmap: GameplayBeatmap
  readonly #skin: LoadedSkin | null
  readonly #sliderBodyRenderer: SliderBodyRenderer
  readonly #sliderCurves = new Map<GameplaySlider, SliderCurve>()
  readonly #sliderPixelPoints = new Map<GameplaySlider, readonly Point[]>()
  readonly #resultAnimations: ResultAnimation[] = []
  #sliderTransformKey = ''
  #lastPositionMS = Number.NEGATIVE_INFINITY

  constructor(
    canvas: HTMLCanvasElement,
    sliderCanvas: HTMLCanvasElement,
    beatmap: GameplayBeatmap,
    skin: LoadedSkin | null,
  ) {
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Canvas 2D is unavailable in this browser.')
    this.#canvas = canvas
    this.#context = context
    this.#beatmap = beatmap
    this.#skin = skin
    this.#sliderBodyRenderer = createSliderBodyRenderer(sliderCanvas)
    for (const slider of beatmap.sliders) {
      this.#sliderCurves.set(
        slider,
        createSliderCurve(slider.curveType, slider.absoluteControlPoints, slider.pixelLength),
      )
    }
  }

  render(positionMS: number, gameplay?: GameplayRenderState): void {
    if (positionMS + 5 < this.#lastPositionMS) this.#resultAnimations.length = 0
    this.#lastPositionMS = positionMS
    if (gameplay !== undefined) {
      for (const event of gameplay.snapshot.events) {
        if (event.type === 'judgment') this.#resultAnimations.push({ event, startedAt: positionMS })
      }
    }
    const { width, height } = this.#resizeCanvas()
    const context = this.#context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height)
    const dpr = this.#canvas.width / width
    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    const transform = getPlayfieldTransform(width, height)
    const transformKey = `${transform.scale}:${transform.offset.x}:${transform.offset.y}`
    if (transformKey !== this.#sliderTransformKey) {
      this.#sliderTransformKey = transformKey
      this.#sliderPixelPoints.clear()
    }
    const approachMS = approachTimeMS(this.#beatmap.approachRate)
    const radius = rawCircleRadius(this.#beatmap.circleSize) * transform.scale
    this.#sliderBodyRenderer.beginFrame(width, height, window.devicePixelRatio || 1)

    for (const object of this.#beatmap.objects) {
      if (object.time > positionMS + approachMS) break
      const endTime = object.kind === 'circle' ? object.time : object.endTime
      if (positionMS < object.time - approachMS || positionMS >= endTime) continue
      const alpha = this.#alpha(positionMS, object.time, approachMS)
      const color = this.#comboColor(object.comboColorIndex)
      if (object.kind === 'slider') this.#drawSliderBody(object, positionMS, approachMS, transform, radius, color, alpha)
      if (object.kind === 'spinner') this.#drawSpinner(transform.center, radius, alpha)
    }
    this.#sliderBodyRenderer.endFrame()

    // Sprite furniture renders above the dedicated body canvas.
    for (let index = this.#beatmap.objects.length - 1; index >= 0; index -= 1) {
      const object = this.#beatmap.objects[index]!
      if (object.kind === 'spinner') continue
      if (gameplay?.snapshot.objectResults[index] !== null && object.kind === 'circle') continue
      const endTime = object.kind === 'slider' ? object.endTime : object.time
      if (positionMS < object.time - approachMS || positionMS >= endTime) continue
      const alpha = this.#alpha(positionMS, object.time, approachMS)
      const showApproach = !this.#hidden || (index === 0 && osuShowApproachCircleOnFirstHiddenObject.getBool())
      if (object.kind === 'slider') {
        this.#drawSliderFurniture(object, positionMS, approachMS, transform, radius, alpha, showApproach)
      } else {
        this.#drawCircle(object, positionMS, approachMS, transform, radius, alpha, showApproach)
      }
    }
    if (gameplay !== undefined) this.#drawGameplayOverlay(positionMS, transform, radius, gameplay)
  }

  dispose(): void {
    this.#sliderBodyRenderer.dispose()
    this.#skin?.dispose()
  }

  #drawSliderBody(
    slider: GameplaySlider,
    positionMS: number,
    approachMS: number,
    transform: ReturnType<typeof getPlayfieldTransform>,
    radius: number,
    color: string,
    alpha: number,
  ): void {
    const curve = this.#sliderCurves.get(slider)
    if (curve === undefined) return
    const snake = osuSnakingSliders.getBool() ? sliderSnakePercent(positionMS, slider.time, approachMS) : 1
    let points = this.#sliderPixelPoints.get(slider)
    if (points === undefined) {
      points = curve.equalDistancePoints.map((point) => osuCoords2Pixels(point, transform))
      this.#sliderPixelPoints.set(slider, points)
    }
    const borderColor = this.#skin?.config.sliderBorderColor ?? '#ffffff'
    const bodyColor = this.#skin?.config.sliderTrackOverride ?? color
    this.#sliderBodyRenderer.drawBody(points, radius * 2, 0, snake, {
      style: 0,
      bodyAlphaMultiplier: 1,
      bodyColorSaturation: 1,
      borderSizeMultiplier: 1,
      borderFeather: 0,
      borderColor,
      bodyColor,
      alpha,
    })
  }

  #drawSliderFurniture(
    slider: GameplaySlider,
    positionMS: number,
    approachMS: number,
    transform: ReturnType<typeof getPlayfieldTransform>,
    radius: number,
    alpha: number,
    showApproach: boolean,
  ): void {
    const curve = this.#sliderCurves.get(slider)
    if (curve === undefined) return
    const snake = osuSnakingSliders.getBool() ? sliderSnakePercent(positionMS, slider.time, approachMS) : 1
    const color = this.#comboColor(slider.comboColorIndex)
    const start = osuCoords2Pixels(curve.getPointAt(0), transform)
    const visibleEnd = osuCoords2Pixels(curve.getPointAt(snake), transform)
    const actualEnd = osuCoords2Pixels(curve.getPointAt(1), transform)

    this.#context.save()
    this.#context.globalAlpha = alpha
    for (const percentage of slider.tickPercentages) {
      if (percentage > snake) continue
      const position = osuCoords2Pixels(curve.getPointAt(percentage), transform)
      const frame = this.#skin?.frame(this.#skin.sliderScorePoint, positionMS)
      if (frame !== undefined) drawFrame(this.#context, frame, position, radius * 0.25)
      else drawTick(this.#context, position, Math.max(2, radius * 0.1))
    }

    this.#drawSliderEndpoint(visibleEnd, false, radius, color, positionMS)
    this.#drawSliderEndpoint(start, true, radius, color, positionMS, positionMS < slider.time ? slider.comboNumber : undefined)

    if (showApproach && positionMS < slider.time) {
      const timeUntilHit = Math.max(0, slider.time - positionMS)
      const approachScale = 1 + 3 * (timeUntilHit / approachMS)
      this.#drawApproachCircle(start, radius, approachScale, color, positionMS)
    }

    if (slider.spans > 1) {
      const arrowAlpha = reverseArrowAlpha(positionMS, slider.time, approachMS)
      this.#context.globalAlpha = alpha * arrowAlpha
      const target = repeatArrowTarget(slider, positionMS)
      if (target === 'end' || target === 'both') {
        this.#drawRepeatArrow(actualEnd, curve.endAngle, radius, color, positionMS)
      }
      if (target === 'start' || target === 'both') {
        this.#drawRepeatArrow(start, curve.startAngle, radius, color, positionMS)
      }
    }

    if (positionMS >= slider.time && positionMS < slider.endTime) {
      const progress = sliderProgress(slider, positionMS)
      const ballPoint = osuCoords2Pixels(curve.getPointAt(progress), transform)
      this.#context.globalAlpha = 1
      this.#drawFollowCircle(ballPoint, radius, color, positionMS)
      this.#drawSliderBall(ballPoint, radius, color, positionMS)
    }
    this.#context.restore()
  }

  #drawSliderEndpoint(
    center: Point,
    start: boolean,
    radius: number,
    color: string,
    positionMS: number,
    comboNumber?: number,
  ): void {
    const baseAsset = start ? this.#skin?.sliderStartCircle : this.#skin?.sliderEndCircle
    const overlayAsset = start ? this.#skin?.sliderStartCircleOverlay : this.#skin?.sliderEndCircleOverlay
    const baseFrame = this.#skin?.frame(baseAsset ?? this.#skin.hitcircle, positionMS)
    if (baseFrame !== undefined) drawFrame(this.#context, baseFrame, center, radius * 2)
    else drawProceduralCircle(this.#context, center, radius, color)
    if (comboNumber !== undefined) this.#drawComboNumber(comboNumber, center, radius, positionMS)
    const overlayFrame = this.#skin?.frame(overlayAsset ?? this.#skin.hitcircleoverlay, positionMS)
    if (overlayFrame !== undefined) drawFrame(this.#context, overlayFrame, center, radius * 2)
  }

  #drawApproachCircle(center: Point, radius: number, scale: number, color: string, positionMS: number): void {
    const frame = this.#skin?.frame(this.#skin.approachcircle, positionMS)
    if (frame !== undefined) drawFrame(this.#context, frame, center, radius * 2 * scale)
    else {
      this.#context.strokeStyle = color
      this.#context.lineWidth = Math.max(2, radius * 0.08)
      this.#context.beginPath()
      this.#context.arc(center.x, center.y, radius * scale, 0, Math.PI * 2)
      this.#context.stroke()
    }
  }

  #drawRepeatArrow(center: Point, angle: number, radius: number, color: string, positionMS: number): void {
    const frame = this.#skin?.frame(this.#skin.reverseArrow, positionMS)
    this.#context.save()
    this.#context.translate(center.x, center.y)
    this.#context.rotate((angle * Math.PI) / 180)
    if (frame !== undefined) {
      drawFrame(this.#context, frame, { x: 0, y: 0 }, radius * 2)
    } else {
      this.#context.strokeStyle = color
      this.#context.lineWidth = Math.max(3, radius * 0.14)
      this.#context.lineCap = 'round'
      this.#context.beginPath()
      this.#context.moveTo(-radius * 0.28, -radius * 0.38)
      this.#context.lineTo(radius * 0.18, 0)
      this.#context.lineTo(-radius * 0.28, radius * 0.38)
      this.#context.stroke()
    }
    this.#context.restore()
  }

  #drawFollowCircle(center: Point, radius: number, color: string, positionMS: number): void {
    const frame = this.#skin?.frame(this.#skin.sliderFollowCircle, positionMS)
    const diameter = radius * 2 * osuSliderFollowCircleSizeMultiplier.getFloat() * 0.85
    if (frame !== undefined) drawFrame(this.#context, frame, center, diameter)
    else {
      this.#context.strokeStyle = color
      this.#context.globalAlpha = 0.58
      this.#context.lineWidth = Math.max(3, radius * 0.12)
      this.#context.beginPath()
      this.#context.arc(center.x, center.y, diameter / 2, 0, Math.PI * 2)
      this.#context.stroke()
      this.#context.globalAlpha = 1
    }
  }

  #drawSliderBall(center: Point, radius: number, color: string, positionMS: number): void {
    const frame = this.#skin?.frame(this.#skin.sliderBall, positionMS)
    if (frame !== undefined) drawFrame(this.#context, frame, center, radius * 2)
    else drawProceduralCircle(this.#context, center, radius * 0.72, color)
  }

  #drawCircle(
    object: GameplayCircle,
    positionMS: number,
    approachMS: number,
    transform: ReturnType<typeof getPlayfieldTransform>,
    radius: number,
    alpha: number,
    showApproach: boolean,
  ): void {
    const center = osuCoords2Pixels(object.position, transform)
    const color = this.#comboColor(object.comboColorIndex)
    const timeUntilHit = Math.max(0, object.time - positionMS)
    const approachScale = 1 + 3 * (timeUntilHit / approachMS)
    const approachFrame = this.#skin?.frame(this.#skin.approachcircle, positionMS)

    this.#context.save()
    this.#context.globalAlpha = alpha
    if (!showApproach) {
      // Hidden suppresses approach circles except for the configured first object.
    } else if (approachFrame !== undefined) {
      drawFrame(this.#context, approachFrame, center, radius * 2 * approachScale)
    } else {
      this.#context.strokeStyle = color
      this.#context.lineWidth = Math.max(2, transform.scale * 2)
      this.#context.beginPath()
      this.#context.arc(center.x, center.y, radius * approachScale, 0, Math.PI * 2)
      this.#context.stroke()
    }

    const circleFrame = this.#skin?.frame(this.#skin.hitcircle, positionMS)
    if (circleFrame !== undefined) {
      drawFrame(this.#context, circleFrame, center, radius * 2)
    } else {
      this.#context.fillStyle = color
      this.#context.strokeStyle = '#f8f7fb'
      this.#context.lineWidth = Math.max(2, radius * 0.09)
      this.#context.beginPath()
      this.#context.arc(center.x, center.y, radius, 0, Math.PI * 2)
      this.#context.fill()
      this.#context.stroke()
    }

    this.#drawComboNumber(object.comboNumber, center, radius, positionMS)
    const overlayFrame = this.#skin?.frame(this.#skin.hitcircleoverlay, positionMS)
    if (overlayFrame !== undefined) drawFrame(this.#context, overlayFrame, center, radius * 2)
    this.#context.restore()
  }

  #drawComboNumber(number: number, center: Point, radius: number, positionMS: number): void {
    const text = String(number)
    const frames = Array.from(text, (digit) => {
      const image = this.#skin?.numbers[Number(digit)]
      return this.#skin?.frame(image, positionMS)
    })
    if (frames.every((frame): frame is SkinFrame => frame !== undefined)) {
      const height = radius * 0.86
      const widths = frames.map((frame) => {
        const logicalWidth = frame.image.naturalWidth / frame.sourceScale
        const logicalHeight = frame.image.naturalHeight / frame.sourceScale
        return height * (logicalWidth / Math.max(1, logicalHeight))
      })
      const overlap = height * 0.08
      const totalWidth = widths.reduce((sum, width) => sum + width, 0) - overlap * (widths.length - 1)
      let x = center.x - totalWidth / 2
      for (const [index, frame] of frames.entries()) {
        const width = widths[index]!
        this.#context.drawImage(frame.image, x, center.y - height / 2, width, height)
        x += width - overlap
      }
      return
    }

    this.#context.fillStyle = '#fff'
    this.#context.font = `700 ${Math.max(11, radius * 0.82)}px Inter, sans-serif`
    this.#context.textAlign = 'center'
    this.#context.textBaseline = 'middle'
    this.#context.fillText(text, center.x, center.y + radius * 0.03)
  }

  #drawSpinner(center: Point, radius: number, alpha: number): void {
    const spinnerRadius = radius * 3.35
    this.#context.save()
    this.#context.globalAlpha = alpha * 0.78
    this.#context.strokeStyle = '#f1a0c4'
    this.#context.lineWidth = Math.max(3, radius * 0.12)
    this.#context.beginPath()
    this.#context.arc(center.x, center.y, spinnerRadius, 0, Math.PI * 2)
    this.#context.stroke()
    this.#context.font = `600 ${Math.max(12, radius * 0.42)}px Inter, sans-serif`
    this.#context.fillStyle = '#f3f1f7'
    this.#context.textAlign = 'center'
    this.#context.textBaseline = 'middle'
    this.#context.fillText('SPIN', center.x, center.y)
    this.#context.restore()
  }

  #drawGameplayOverlay(
    positionMS: number,
    transform: ReturnType<typeof getPlayfieldTransform>,
    radius: number,
    gameplay: GameplayRenderState,
  ): void {
    for (let index = this.#resultAnimations.length - 1; index >= 0; index -= 1) {
      const animation = this.#resultAnimations[index]!
      const elapsed = positionMS - animation.startedAt
      if (elapsed >= 1_100) {
        this.#resultAnimations.splice(index, 1)
        continue
      }
      this.#drawResult(animation.event.result, osuCoords2Pixels(animation.event.position, transform), radius, elapsed, positionMS)
    }

    const score = gameplay.snapshot.score
    this.#context.save()
    this.#context.fillStyle = '#fff'
    this.#context.textBaseline = 'bottom'
    this.#context.shadowColor = 'rgba(0,0,0,.75)'
    this.#context.shadowBlur = 8
    const comboDrawn = this.#drawHudNumber(String(score.combo), 24, this.#canvas.clientHeight - 20, radius * 1.05, positionMS)
    if (!comboDrawn) {
      this.#context.font = `800 ${Math.max(24, radius * 1.05)}px Inter, sans-serif`
      this.#context.textAlign = 'left'
      this.#context.fillText(`${score.combo}×`, 24, this.#canvas.clientHeight - 20)
    }
    this.#context.font = `700 ${Math.max(17, radius * 0.58)}px Inter, sans-serif`
    this.#context.textAlign = 'right'
    this.#context.fillText(`${(score.accuracy * 100).toFixed(2)}%`, this.#canvas.clientWidth - 24, 42)
    this.#context.font = `650 ${Math.max(12, radius * 0.4)}px Inter, sans-serif`
    this.#context.fillText(String(score.score).padStart(8, '0'), this.#canvas.clientWidth - 24, 66)
    this.#context.restore()

    const cursor = osuCoords2Pixels(gameplay.cursor, transform)
    const frame = this.#skin?.frame(this.#skin.cursor, positionMS)
    if (frame !== undefined) {
      const logicalWidth = frame.image.naturalWidth / frame.sourceScale
      drawFrame(this.#context, frame, cursor, logicalWidth * transform.scale)
    } else {
      this.#context.save()
      this.#context.strokeStyle = '#fff'
      this.#context.lineWidth = 2
      this.#context.beginPath()
      this.#context.arc(cursor.x, cursor.y, Math.max(6, radius * 0.24), 0, Math.PI * 2)
      this.#context.stroke()
      this.#context.restore()
    }
  }

  #drawHudNumber(text: string, x: number, baseline: number, height: number, positionMS: number): boolean {
    const frames = Array.from(text, (digit) => this.#skin?.frame(this.#skin.scoreNumbers[Number(digit)], positionMS))
    if (frames.length === 0 || !frames.every((frame): frame is SkinFrame => frame !== undefined)) return false
    let cursorX = x
    for (const frame of frames) {
      const logicalWidth = frame.image.naturalWidth / frame.sourceScale
      const logicalHeight = frame.image.naturalHeight / frame.sourceScale
      const width = height * (logicalWidth / Math.max(1, logicalHeight))
      this.#context.drawImage(frame.image, cursorX, baseline - height, width, height)
      cursorX += width - height * 0.06
    }
    return true
  }

  #drawResult(result: HitResult, center: Point, radius: number, elapsed: number, positionMS: number): void {
    // OsuHitObject.cpp:27-33, 97-132: 1.1s total, 120ms fade-in,
    // fade-out begins at 500ms and lasts 600ms; misses enter at 2x scale.
    const alpha = elapsed < 120 ? elapsed / 120 : clamp(1 - (elapsed - 500) / 600, 0, 1)
    const scale = result === 'miss'
      ? 1 + clamp(1 - elapsed / 120, 0, 1)
      : 0.9 + 0.15 * clamp(elapsed / 1_100, 0, 1)
    const down = result === 'miss' ? -5 + 45 * clamp((elapsed / 1_100) ** 3, 0, 1) : 0
    const image = result === '300'
      ? this.#skin?.hit300
      : result === '100'
        ? this.#skin?.hit100
        : result === '50'
          ? this.#skin?.hit50
          : this.#skin?.hit0
    const frame = this.#skin?.frame(image, positionMS)
    this.#context.save()
    this.#context.globalAlpha = alpha
    if (frame !== undefined) drawFrame(this.#context, frame, { x: center.x, y: center.y + down }, radius * 2 * scale)
    else {
      this.#context.fillStyle = result === 'miss' ? '#ef4f62' : result === '50' ? '#f2c14e' : '#8fdcff'
      this.#context.font = `900 ${Math.max(18, radius * scale)}px Inter, sans-serif`
      this.#context.textAlign = 'center'
      this.#context.textBaseline = 'middle'
      this.#context.fillText(result === 'miss' ? '×' : result, center.x, center.y + down)
    }
    this.#context.restore()
  }

  #comboColor(index: number): string {
    const colors = this.#skin?.config.comboColors ?? DEFAULT_COMBO_COLORS
    return colors[((index % colors.length) + colors.length) % colors.length]!
  }

  get #hidden(): boolean {
    return (this.#beatmap as Partial<ModdedGameplayBeatmap>).mods?.HD === true
  }

  #alpha(positionMS: number, objectTimeMS: number, approachMS: number): number {
    return this.#hidden
      ? hiddenAlpha(positionMS, objectTimeMS, approachMS)
      : fadeInProgress(positionMS, objectTimeMS, approachMS)
  }

  #resizeCanvas(): { width: number; height: number } {
    const width = Math.max(1, this.#canvas.clientWidth)
    const height = Math.max(1, this.#canvas.clientHeight)
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const backingWidth = Math.round(width * dpr)
    const backingHeight = Math.round(height * dpr)
    if (this.#canvas.width !== backingWidth || this.#canvas.height !== backingHeight) {
      this.#canvas.width = backingWidth
      this.#canvas.height = backingHeight
    }
    return { width, height }
  }
}

function drawFrame(
  context: CanvasRenderingContext2D,
  frame: SkinFrame,
  center: Point,
  targetWidth: number,
): void {
  const logicalWidth = frame.image.naturalWidth / frame.sourceScale
  const logicalHeight = frame.image.naturalHeight / frame.sourceScale
  const targetHeight = targetWidth * (logicalHeight / Math.max(1, logicalWidth))
  context.drawImage(
    frame.image,
    center.x - targetWidth / 2,
    center.y - targetHeight / 2,
    targetWidth,
    targetHeight,
  )
}

function sliderSnakePercent(positionMS: number, startTimeMS: number, approachMS: number): number {
  // OsuSlider.cpp:1434-1435: default snake duration is one third of approach time.
  const duration = approachMS / 3
  return clamp((positionMS - (startTimeMS - approachMS)) / duration, 0, 1)
}

function reverseArrowAlpha(positionMS: number, startTimeMS: number, approachMS: number): number {
  // OsuSlider.cpp:1437-1440; default reverse-arrow fade duration is 150 ms.
  const snakeDuration = approachMS / 3
  const fadeStart = startTimeMS - (approachMS - snakeDuration)
  return clamp((positionMS - fadeStart) / 150, 0, 1)
}

function sliderProgress(slider: GameplaySlider, positionMS: number): number {
  const total = clamp((positionMS - slider.time) / Math.max(1, slider.endTime - slider.time), 0, 1)
  const spanFloat = total * slider.spans
  const span = Math.min(slider.spans - 1, Math.floor(spanFloat))
  const local = spanFloat - span
  return span % 2 === 0 ? local : 1 - local
}

function repeatArrowTarget(slider: GameplaySlider, positionMS: number): 'start' | 'end' | 'both' | 'none' {
  if (positionMS < slider.time) return slider.spans > 2 ? 'both' : 'end'
  const elapsed = Math.max(0, positionMS - slider.time)
  const span = Math.min(slider.spans - 1, Math.floor(elapsed / Math.max(1, slider.spanDuration)))
  if (span >= slider.spans - 1) return 'none'
  return span % 2 === 0 ? 'end' : 'start'
}

function drawTick(context: CanvasRenderingContext2D, center: Point, radius: number): void {
  context.fillStyle = '#ffffff'
  context.strokeStyle = '#9296a8'
  context.lineWidth = Math.max(1, radius * 0.35)
  context.beginPath()
  context.arc(center.x, center.y, radius, 0, Math.PI * 2)
  context.fill()
  context.stroke()
}

function drawProceduralCircle(
  context: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  color: string,
): void {
  context.fillStyle = color
  context.strokeStyle = '#f8f7fb'
  context.lineWidth = Math.max(2, radius * 0.09)
  context.beginPath()
  context.arc(center.x, center.y, radius, 0, Math.PI * 2)
  context.fill()
  context.stroke()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
