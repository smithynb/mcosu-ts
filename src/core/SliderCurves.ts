export const SLIDER_CURVE_POINT_SEPARATION = 2.5
export const SLIDER_CURVE_MAX_POINTS = 9_999
export const SLIDER_CURVE_MAX_LENGTH = 32_768

export type SliderCurveType = 'B' | 'C' | 'L' | 'P'

export interface SliderPoint {
  readonly x: number
  readonly y: number
}

export interface SliderCurve {
  readonly type: SliderCurveType
  readonly pixelLength: number
  readonly equalDistancePoints: readonly SliderPoint[]
  readonly pointSegments: readonly (readonly SliderPoint[])[]
  readonly startAngle: number
  readonly endAngle: number
  getPointAt(t: number): SliderPoint
}

interface ApproximateCurve {
  readonly points: readonly SliderPoint[]
}

export function relativeControlPointsToAbsolute(
  head: SliderPoint,
  relativePoints: readonly SliderPoint[],
): SliderPoint[] {
  const points = relativePoints.length > 0 ? relativePoints : [{ x: 0, y: 0 }]
  return points.map((point) => ({
    x: Math.trunc(clamp(head.x + point.x, -SLIDER_CURVE_MAX_LENGTH, SLIDER_CURVE_MAX_LENGTH)),
    y: Math.trunc(clamp(head.y + point.y, -SLIDER_CURVE_MAX_LENGTH, SLIDER_CURVE_MAX_LENGTH)),
  }))
}

export function createSliderCurve(
  type: SliderCurveType,
  controlPoints: readonly SliderPoint[],
  pixelLength: number,
  curvePointsSeparation = SLIDER_CURVE_POINT_SEPARATION,
): SliderCurve {
  const safePoints = sanitizeControlPoints(controlPoints)
  const safeLength = clamp(Number.isFinite(pixelLength) ? pixelLength : 0, -SLIDER_CURVE_MAX_LENGTH, SLIDER_CURVE_MAX_LENGTH)
  const usableLength = Math.max(0, safeLength)

  // OsuSliderCurves.cpp:34-56: P is circular only for exactly three non-collinear points.
  if (type === 'P' && safePoints.length === 3 && !areCircleNormalsParallel(safePoints)) {
    return new OsuSliderCurveCircumscribedCircle(safePoints, usableLength, curvePointsSeparation)
  }
  if (type === 'C') return new OsuSliderCurveCatmull(safePoints, usableLength, curvePointsSeparation)
  return new OsuSliderCurveLinearBezier(safePoints, usableLength, type === 'L', curvePointsSeparation, type)
}

abstract class BaseSliderCurve implements SliderCurve {
  abstract readonly type: SliderCurveType
  readonly pixelLength: number
  equalDistancePoints: SliderPoint[] = []
  pointSegments: SliderPoint[][] = []
  startAngle = 0
  endAngle = 0

  constructor(pixelLength: number) {
    this.pixelLength = pixelLength
  }

  abstract getPointAt(t: number): SliderPoint
}

export class OsuSliderCurveEqualDistanceMulti extends BaseSliderCurve {
  readonly type: SliderCurveType
  readonly #sampleCount: number

  constructor(
    type: SliderCurveType,
    pixelLength: number,
    curvePointsSeparation: number,
    curves: readonly ApproximateCurve[],
    fallbackPoint: SliderPoint,
  ) {
    super(pixelLength)
    this.type = type
    const separation = clamp(curvePointsSeparation, 1, 100)
    this.#sampleCount = Math.min(Math.trunc(pixelLength / separation), SLIDER_CURVE_MAX_POINTS)
    this.#initialize(curves, fallbackPoint)
  }

  getPointAt(t: number): SliderPoint {
    if (this.equalDistancePoints.length === 0) return { x: 0, y: 0 }
    if (this.#sampleCount <= 0) return this.equalDistancePoints[0]!
    const indexFloat = clamp(t, 0, 1) * this.#sampleCount
    const index = Math.trunc(indexFloat)
    if (index >= this.#sampleCount) return this.equalDistancePoints[this.#sampleCount] ?? this.equalDistancePoints.at(-1)!
    const first = this.equalDistancePoints[index]!
    const second = this.equalDistancePoints[index + 1] ?? first
    return lerpPoint(first, second, indexFloat - index)
  }

  #initialize(curves: readonly ApproximateCurve[], fallbackPoint: SliderPoint): void {
    const usableCurves = curves.filter((curve) => curve.points.length > 0)
    if (this.#sampleCount <= 0 || usableCurves.length === 0) {
      this.equalDistancePoints = [{ ...fallbackPoint }]
      this.pointSegments = [[{ ...fallbackPoint }]]
      return
    }

    const source: SliderPoint[] = []
    const sourceSegments: SliderPoint[][] = []
    for (const curve of usableCurves) {
      const segment = curve.points.map(copyPoint)
      sourceSegments.push(segment)
      for (const point of segment) {
        if (source.length === 0 || !samePoint(source.at(-1)!, point)) source.push(point)
      }
    }
    if (source.length === 0) source.push(copyPoint(fallbackPoint))

    const cumulative = [0]
    for (let index = 1; index < source.length; index += 1) {
      cumulative.push(cumulative[index - 1]! + distance(source[index - 1]!, source[index]!))
    }
    const totalLength = cumulative.at(-1) ?? 0
    let sourceIndex = 1
    for (let index = 0; index <= this.#sampleCount; index += 1) {
      // OsuSliderCurves.cpp:274 truncates each preferred distance to int.
      const preferredDistance = Math.trunc((index * this.pixelLength) / this.#sampleCount)
      while (sourceIndex < cumulative.length && cumulative[sourceIndex]! < preferredDistance) sourceIndex += 1
      if (sourceIndex >= source.length || preferredDistance >= totalLength) {
        this.equalDistancePoints.push(copyPoint(source.at(-1)!))
        continue
      }
      const previousDistance = cumulative[sourceIndex - 1]!
      const nextDistance = cumulative[sourceIndex]!
      const span = nextDistance - previousDistance
      const amount = span > 1 ? (preferredDistance - previousDistance) / span : 1
      this.equalDistancePoints.push(lerpPoint(source[sourceIndex - 1]!, source[sourceIndex]!, amount))
    }

    // McOsu retains uninterpolated segments for mesh generation. Clamp their tail to
    // the requested pixel length so overlong multi-Beziers do not draw past the end.
    this.pointSegments = trimSegments(sourceSegments, this.pixelLength)
    calculateAngles(this)
  }
}

export class OsuSliderCurveLinearBezier extends OsuSliderCurveEqualDistanceMulti {
  constructor(
    controlPoints: readonly SliderPoint[],
    pixelLength: number,
    line: boolean,
    curvePointsSeparation = SLIDER_CURVE_POINT_SEPARATION,
    reportedType: SliderCurveType = line ? 'L' : 'B',
  ) {
    super(
      reportedType,
      pixelLength,
      curvePointsSeparation,
      buildLinearBezierSegments(controlPoints, line),
      controlPoints[0] ?? { x: 0, y: 0 },
    )
  }
}

export class OsuSliderCurveCatmull extends OsuSliderCurveEqualDistanceMulti {
  constructor(
    controlPoints: readonly SliderPoint[],
    pixelLength: number,
    curvePointsSeparation = SLIDER_CURVE_POINT_SEPARATION,
  ) {
    super(
      'C',
      pixelLength,
      curvePointsSeparation,
      buildCatmullSegments(controlPoints),
      controlPoints[0] ?? { x: 0, y: 0 },
    )
  }
}

export class OsuSliderCurveCircumscribedCircle extends BaseSliderCurve {
  readonly type = 'P' as const
  readonly #center: SliderPoint
  readonly #radius: number
  readonly #calculationStartAngle: number
  readonly #calculationEndAngle: number

  constructor(
    controlPoints: readonly SliderPoint[],
    pixelLength: number,
    curvePointsSeparation = SLIDER_CURVE_POINT_SEPARATION,
  ) {
    super(pixelLength)
    const [start, middle, end] = controlPoints as [SliderPoint, SliderPoint, SliderPoint]
    const midpointA = lerpPoint(start, middle, 0.5)
    const midpointB = lerpPoint(end, middle, 0.5)
    const normalA = { x: -(middle.y - start.y), y: middle.x - start.x }
    const normalB = { x: -(middle.y - end.y), y: middle.x - end.x }
    this.#center = intersect(midpointA, normalA, midpointB, normalB)

    let startAngle = Math.atan2(start.y - this.#center.y, start.x - this.#center.x)
    const middleAngle = Math.atan2(middle.y - this.#center.y, middle.x - this.#center.x)
    let endAngle = Math.atan2(end.y - this.#center.y, end.x - this.#center.x)
    ;[startAngle, endAngle] = anglesPassingThrough(startAngle, middleAngle, endAngle)
    this.#radius = distance(start, this.#center)
    const arcAngle = this.#radius > 0 ? pixelLength / this.#radius : 0
    endAngle = endAngle > startAngle ? startAngle + arcAngle : startAngle - arcAngle
    this.#calculationStartAngle = startAngle
    this.#calculationEndAngle = endAngle
    this.endAngle = radiansToDegrees(endAngle + (startAngle > endAngle ? Math.PI / 2 : -Math.PI / 2))
    this.startAngle = radiansToDegrees(startAngle + (startAngle > endAngle ? -Math.PI / 2 : Math.PI / 2))

    // OsuSliderCurves.cpp:675-691 rounds steps, adds two, and stops at t=1.
    const steps = Math.min(pixelLength / clamp(curvePointsSeparation, 1, 100), SLIDER_CURVE_MAX_POINTS)
    const integerSteps = Math.round(steps) + 2
    for (let index = 0; index < integerSteps; index += 1) {
      const t = steps > 0 ? clamp(index / steps, 0, 1) : 0
      this.equalDistancePoints.push(this.getPointAt(t))
      if (t >= 1) break
    }
    if (this.equalDistancePoints.length === 0) this.equalDistancePoints.push(copyPoint(start))
    this.pointSegments = [this.equalDistancePoints.map(copyPoint)]
  }

  getPointAt(t: number): SliderPoint {
    const angle = lerp(this.#calculationStartAngle, this.#calculationEndAngle, clamp(t, 0, 1))
    return {
      x: clamp(Math.cos(angle) * this.#radius + this.#center.x, -SLIDER_CURVE_MAX_LENGTH, SLIDER_CURVE_MAX_LENGTH),
      y: clamp(Math.sin(angle) * this.#radius + this.#center.y, -SLIDER_CURVE_MAX_LENGTH, SLIDER_CURVE_MAX_LENGTH),
    }
  }
}

function buildLinearBezierSegments(points: readonly SliderPoint[], line: boolean): ApproximateCurve[] {
  if (points.length < 2) return []
  if (line) {
    return points.slice(1).map((point, index) => ({ points: [copyPoint(points[index]!), copyPoint(point)] }))
  }

  const curves: ApproximateCurve[] = []
  let current: SliderPoint[] = []
  let previous: SliderPoint | undefined
  for (const point of points) {
    if (previous !== undefined && samePoint(point, previous)) {
      if (current.length >= 2) curves.push({ points: createBezier(current) })
      current = []
    }
    current.push(copyPoint(point))
    previous = point
  }
  if (current.length >= 2) curves.push({ points: createBezier(current) })
  return curves
}

function buildCatmullSegments(controlPoints: readonly SliderPoint[]): ApproximateCurve[] {
  if (controlPoints.length < 2) return []
  const windows: SliderPoint[][] = []
  const points: SliderPoint[] = []
  if (!samePoint(controlPoints[0]!, controlPoints[1]!)) points.push(copyPoint(controlPoints[0]!))
  for (const point of controlPoints) {
    points.push(copyPoint(point))
    if (points.length >= 4) {
      windows.push(points.slice(0, 4))
      points.shift()
    }
  }
  const last = controlPoints.at(-1)!
  const beforeLast = controlPoints.at(-2)!
  if (!samePoint(last, beforeLast)) points.push(copyPoint(last))
  if (points.length >= 4) windows.push(points.slice(0, 4))
  return windows.map((window) => ({ points: approximateCatmull(window) }))
}

function approximateCatmull(points: readonly SliderPoint[]): SliderPoint[] {
  let approximateLength = 0
  for (let index = 1; index < 4; index += 1) approximateLength += Math.max(0.0001, distance(points[index - 1]!, points[index]!))
  const count = Math.trunc((approximateLength / 2) / 4) + 2
  return Array.from({ length: count }, (_, index) => catmullPoint(points, index / (count - 1)))
}

function catmullPoint(points: readonly SliderPoint[], amount: number): SliderPoint {
  const t = amount + 1
  const a1 = weighted(points[0]!, 1 - t, points[1]!, t)
  const a2 = weighted(points[1]!, 2 - t, points[2]!, t - 1)
  const a3 = weighted(points[2]!, 3 - t, points[3]!, t - 2)
  const b1 = weighted(a1, (2 - t) / 2, a2, t / 2)
  const b2 = weighted(a2, (3 - t) / 2, a3, (t - 1) / 2)
  return weighted(b1, 2 - t, b2, t - 1)
}

// Port of OsuSliderBezierApproximator, OsuSliderCurves.cpp:738-855.
function createBezier(controlPoints: readonly SliderPoint[]): SliderPoint[] {
  if (controlPoints.length === 0) return []
  const output: SliderPoint[] = []
  const pending: SliderPoint[][] = [controlPoints.map(copyPoint)]
  while (pending.length > 0) {
    const parent = pending.pop()!
    if (isFlatEnough(parent)) {
      approximateBezier(parent, output)
      continue
    }
    const [left, right] = subdivideBezier(parent)
    pending.push(right, left)
  }
  output.push(copyPoint(controlPoints.at(-1)!))
  return output
}

function isFlatEnough(points: readonly SliderPoint[]): boolean {
  const toleranceSquaredTimesFour = 0.25 * 0.25 * 4
  for (let index = 1; index < points.length - 1; index += 1) {
    const delta = {
      x: points[index - 1]!.x - 2 * points[index]!.x + points[index + 1]!.x,
      y: points[index - 1]!.y - 2 * points[index]!.y + points[index + 1]!.y,
    }
    if (delta.x * delta.x + delta.y * delta.y > toleranceSquaredTimesFour) return false
  }
  return true
}

function subdivideBezier(points: readonly SliderPoint[]): [SliderPoint[], SliderPoint[]] {
  const count = points.length
  const midpoints = points.map(copyPoint)
  const left = Array<SliderPoint>(count)
  const right = Array<SliderPoint>(count)
  for (let index = 0; index < count; index += 1) {
    left[index] = copyPoint(midpoints[0]!)
    right[count - index - 1] = copyPoint(midpoints[count - index - 1]!)
    for (let inner = 0; inner < count - index - 1; inner += 1) {
      midpoints[inner] = lerpPoint(midpoints[inner]!, midpoints[inner + 1]!, 0.5)
    }
  }
  return [left, right]
}

function approximateBezier(points: readonly SliderPoint[], output: SliderPoint[]): void {
  const [left, right] = subdivideBezier(points)
  const combined = Array<SliderPoint>(points.length * 2 - 1)
  for (let index = 0; index < points.length; index += 1) combined[index] = left[index]!
  for (let index = 0; index < points.length - 1; index += 1) combined[points.length + index] = right[index + 1]!
  output.push(copyPoint(points[0]!))
  for (let index = 1; index < points.length - 1; index += 1) {
    const offset = 2 * index
    output.push({
      x: 0.25 * (combined[offset - 1]!.x + 2 * combined[offset]!.x + combined[offset + 1]!.x),
      y: 0.25 * (combined[offset - 1]!.y + 2 * combined[offset]!.y + combined[offset + 1]!.y),
    })
  }
}

function trimSegments(segments: readonly (readonly SliderPoint[])[], maximumLength: number): SliderPoint[][] {
  const result: SliderPoint[][] = []
  let remaining = maximumLength
  for (const segment of segments) {
    if (remaining <= 0) break
    const output: SliderPoint[] = []
    for (const point of segment) {
      if (output.length === 0) {
        output.push(copyPoint(point))
        continue
      }
      const previous = output.at(-1)!
      const step = distance(previous, point)
      if (step <= remaining) {
        output.push(copyPoint(point))
        remaining -= step
      } else {
        output.push(lerpPoint(previous, point, step > 0 ? remaining / step : 0))
        remaining = 0
        break
      }
    }
    if (output.length > 0) result.push(output)
  }
  return result.length > 0 ? result : [[copyPoint(segments[0]?.[0] ?? { x: 0, y: 0 })]]
}

function calculateAngles(curve: OsuSliderCurveEqualDistanceMulti): void {
  const points = curve.equalDistancePoints
  if (points.length < 2) return
  const start = points[0]!
  let startNeighbor = points[1]!
  for (let index = 2; index < points.length && distance(start, startNeighbor) < 1; index += 1) startNeighbor = points[index]!
  curve.startAngle = radiansToDegrees(Math.atan2(startNeighbor.y - start.y, startNeighbor.x - start.x))

  const end = points.at(-1)!
  let endNeighbor = points.at(-2)!
  for (let index = points.length - 3; index >= 0 && distance(end, endNeighbor) < 1; index -= 1) endNeighbor = points[index]!
  curve.endAngle = radiansToDegrees(Math.atan2(endNeighbor.y - end.y, endNeighbor.x - end.x))
}

function areCircleNormalsParallel(points: readonly SliderPoint[]): boolean {
  const first = { x: -(points[1]!.y - points[0]!.y), y: points[1]!.x - points[0]!.x }
  const second = { x: -(points[1]!.y - points[2]!.y), y: points[1]!.x - points[2]!.x }
  return Math.abs(second.x * first.y - second.y * first.x) < 0.00001
}

function intersect(a: SliderPoint, tangentA: SliderPoint, b: SliderPoint, tangentB: SliderPoint): SliderPoint {
  const denominator = tangentB.x * tangentA.y - tangentB.y * tangentA.x
  if (Math.abs(denominator) < 0.0001) return { x: 0, y: 0 }
  const amount = ((b.y - a.y) * tangentA.x + (a.x - b.x) * tangentA.y) / denominator
  return { x: b.x + tangentB.x * amount, y: b.y + tangentB.y * amount }
}

function anglesPassingThrough(start: number, middle: number, end: number): [number, number] {
  const inRange = (a: number, b: number, c: number) => (b > a && b < c) || (b < a && b > c)
  if (inRange(start, middle, end)) return [start, end]
  const tau = Math.PI * 2
  if (Math.abs(start + tau - end) < tau && inRange(start + tau, middle, end)) return [start + tau, end]
  if (Math.abs(start - (end + tau)) < tau && inRange(start, middle, end + tau)) return [start, end + tau]
  if (Math.abs(start - tau - end) < tau && inRange(start - tau, middle, end)) return [start - tau, end]
  if (Math.abs(start - (end - tau)) < tau && inRange(start, middle, end - tau)) return [start, end - tau]
  return [start, end]
}

function sanitizeControlPoints(points: readonly SliderPoint[]): SliderPoint[] {
  if (points.length === 0) return [{ x: 0, y: 0 }]
  return points.map((point) => ({
    x: clamp(Number.isFinite(point.x) ? point.x : 0, -SLIDER_CURVE_MAX_LENGTH, SLIDER_CURVE_MAX_LENGTH),
    y: clamp(Number.isFinite(point.y) ? point.y : 0, -SLIDER_CURVE_MAX_LENGTH, SLIDER_CURVE_MAX_LENGTH),
  }))
}

function weighted(a: SliderPoint, weightA: number, b: SliderPoint, weightB: number): SliderPoint {
  return { x: a.x * weightA + b.x * weightB, y: a.y * weightA + b.y * weightB }
}

function samePoint(a: SliderPoint, b: SliderPoint): boolean {
  return a.x === b.x && a.y === b.y
}

function distance(a: SliderPoint, b: SliderPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function copyPoint(point: SliderPoint): SliderPoint {
  return { x: point.x, y: point.y }
}

function lerpPoint(a: SliderPoint, b: SliderPoint, amount: number): SliderPoint {
  return { x: lerp(a.x, b.x, amount), y: lerp(a.y, b.y, amount) }
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
