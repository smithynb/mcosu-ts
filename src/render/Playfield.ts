import {
  approachTimeMS,
  fadeInProgress,
  getPlayfieldTransform,
  osuCoords2Pixels,
  rawCircleRadius,
  type Point,
} from '../core/GameRules.ts'
import type { GameplayBeatmap, GameplayObject, GameplaySlider } from '../data/GameplayLoader.ts'
import { DEFAULT_COMBO_COLORS, type LoadedSkin, type SkinFrame } from '../skin/Skin.ts'

export interface PlayfieldRenderer {
  render(positionMS: number): void
  dispose(): void
}

export class CanvasPlayfield implements PlayfieldRenderer {
  readonly #canvas: HTMLCanvasElement
  readonly #context: CanvasRenderingContext2D
  readonly #beatmap: GameplayBeatmap
  readonly #skin: LoadedSkin | null

  constructor(canvas: HTMLCanvasElement, beatmap: GameplayBeatmap, skin: LoadedSkin | null) {
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Canvas 2D is unavailable in this browser.')
    this.#canvas = canvas
    this.#context = context
    this.#beatmap = beatmap
    this.#skin = skin
  }

  render(positionMS: number): void {
    const { width, height } = this.#resizeCanvas()
    const context = this.#context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height)
    const dpr = this.#canvas.width / width
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.fillStyle = '#070910'
    context.fillRect(0, 0, width, height)

    const transform = getPlayfieldTransform(width, height)
    const approachMS = approachTimeMS(this.#beatmap.approachRate)
    const radius = rawCircleRadius(this.#beatmap.circleSize) * transform.scale

    for (const object of this.#beatmap.objects) {
      if (object.time > positionMS + approachMS) break
      const endTime = object.kind === 'circle' ? object.time : object.endTime
      if (positionMS < object.time - approachMS || positionMS >= endTime) continue
      const alpha = fadeInProgress(positionMS, object.time, approachMS)
      const color = this.#comboColor(object.comboColorIndex)
      if (object.kind === 'slider') this.#drawSliderPath(object, transform, color, alpha)
      if (object.kind === 'spinner') this.#drawSpinner(transform.center, radius, alpha)
    }

    // Hit circles render after bodies. Future objects render first so imminent ones stay legible.
    for (let index = this.#beatmap.objects.length - 1; index >= 0; index -= 1) {
      const object = this.#beatmap.objects[index]!
      if (object.kind === 'spinner') continue
      if (positionMS < object.time - approachMS || positionMS >= object.time) continue
      const alpha = fadeInProgress(positionMS, object.time, approachMS)
      this.#drawCircle(object, positionMS, approachMS, transform, radius, alpha)
    }
  }

  dispose(): void {
    this.#skin?.dispose()
  }

  #drawSliderPath(
    slider: GameplaySlider,
    transform: ReturnType<typeof getPlayfieldTransform>,
    color: string,
    alpha: number,
  ): void {
    const context = this.#context
    context.save()
    context.globalAlpha = alpha * 0.72
    context.strokeStyle = color
    context.lineWidth = Math.max(1.5, transform.scale * 1.5)
    context.lineJoin = 'round'
    context.beginPath()
    for (const [index, point] of slider.controlPoints.entries()) {
      const pixel = osuCoords2Pixels(
        { x: slider.position.x + point.x, y: slider.position.y + point.y },
        transform,
      )
      if (index === 0) context.moveTo(pixel.x, pixel.y)
      else context.lineTo(pixel.x, pixel.y)
    }
    context.stroke()
    context.restore()
  }

  #drawCircle(
    object: Exclude<GameplayObject, { kind: 'spinner' }>,
    positionMS: number,
    approachMS: number,
    transform: ReturnType<typeof getPlayfieldTransform>,
    radius: number,
    alpha: number,
  ): void {
    const center = osuCoords2Pixels(object.position, transform)
    const color = this.#comboColor(object.comboColorIndex)
    const timeUntilHit = Math.max(0, object.time - positionMS)
    const approachScale = 1 + 3 * (timeUntilHit / approachMS)
    const approachFrame = this.#skin?.frame(this.#skin.approachcircle, positionMS)

    this.#context.save()
    this.#context.globalAlpha = alpha
    if (approachFrame !== undefined) {
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

  #comboColor(index: number): string {
    const colors = this.#skin?.config.comboColors ?? DEFAULT_COMBO_COLORS
    return colors[((index % colors.length) + colors.length) % colors.length]!
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
