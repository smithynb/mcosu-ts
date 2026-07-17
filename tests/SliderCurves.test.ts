import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OsuSliderCurveCircumscribedCircle,
  OsuSliderCurveLinearBezier,
  createSliderCurve,
  relativeControlPointsToAbsolute,
  type SliderPoint,
} from '../src/core/SliderCurves.ts'

function closePoint(actual: SliderPoint, expected: SliderPoint, epsilon = 1e-4): void {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `${actual.x} != ${expected.x}`)
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `${actual.y} != ${expected.y}`)
}

function polylineLength(points: readonly SliderPoint[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y)
  }
  return length
}

test('converts parser-relative controls back to McOsu absolute integer points', () => {
  // OsuDatabaseBeatmap.cpp:352-359,432-445 truncates float coordinates and clamps
  // them to osu_slider_curve_max_length (32768), inserting the slider head first.
  assert.deepEqual(
    relativeControlPointsToAbsolute(
      { x: 256.8, y: 192.2 },
      [
        { x: 0, y: 0 },
        { x: 44.9, y: 8.9 },
        { x: 100_000, y: -100_000 },
      ],
    ),
    [
      { x: 256, y: 192 },
      { x: 301, y: 201 },
      { x: 32_768, y: -32_768 },
    ],
  )
})

test('linear curve produces equal-distance samples and endpoint angles', () => {
  // OsuSliderCurves.cpp:230-418 samples floor(pixelLength/separation)+1 points.
  const curve = createSliderCurve('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100, 10)
  assert.equal(curve.equalDistancePoints.length, 11)
  assert.deepEqual(curve.equalDistancePoints.map((point) => point.x), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  closePoint(curve.getPointAt(0.35), { x: 35, y: 0 })
  assert.equal(curve.startAngle, 0)
  assert.equal(Math.abs(curve.endAngle), 180)
})

test('bezier approximator preserves endpoints and requested pixel length', () => {
  // Quadratic arc length for (0,0),(50,100),(100,0) is ~147.894285.
  // McOsu truncates preferred distances to integers, so a file length of 148
  // reaches and then repeats the ~147.894 px mathematical endpoint.
  const pixelLength = 148
  const curve = createSliderCurve(
    'B',
    [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }],
    pixelLength,
  )
  closePoint(curve.getPointAt(0), { x: 0, y: 0 })
  closePoint(curve.getPointAt(1), { x: 100, y: 0 }, 0.01)
  assert.ok(Math.abs(polylineLength(curve.equalDistancePoints) - pixelLength) < 1)
})

test('perfect circle follows the middle control point on a known semicircle', () => {
  // OsuSliderCurves.cpp:607-691: a pi*r pixel length selects exactly a semicircle.
  const curve = createSliderCurve(
    'P',
    [{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 }],
    Math.PI * 100,
  )
  assert.ok(curve instanceof OsuSliderCurveCircumscribedCircle)
  closePoint(curve.getPointAt(0.5), { x: 0, y: 100 })
})

test('collinear perfect curve falls back to bezier and degenerate inputs stay finite', () => {
  // OsuSliderCurves.cpp:34-50 uses LinearBezier when the P normals are parallel.
  const curve = createSliderCurve('P', [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], 100)
  assert.ok(curve instanceof OsuSliderCurveLinearBezier)
  closePoint(curve.getPointAt(0.5), { x: 50, y: 0 }, 1)

  const degenerate = createSliderCurve('C', [{ x: 7, y: 9 }], -10)
  closePoint(degenerate.getPointAt(0.5), { x: 7, y: 9 })
  assert.ok(degenerate.equalDistancePoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
})

test('pixel length and interpolated point count use McOsu sanity limits', () => {
  // OsuSliderCurves.cpp:15-16,230-232 cap length at 32768 and samples at 9999 + endpoint.
  const curve = createSliderCurve('L', [{ x: 0, y: 0 }, { x: 40_000, y: 0 }], 100_000, 1)
  assert.equal(curve.pixelLength, 32_768)
  assert.equal(curve.equalDistancePoints.length, 10_000)
})
