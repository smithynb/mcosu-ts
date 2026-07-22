import assert from 'node:assert/strict'
import test from 'node:test'
import { GameplaySession } from '../src/core/GameplaySession.ts'
import { osuSliderEndInsideCheckOffset, osuSliderFollowCircleSizeMultiplier } from '../src/core/ConVars.ts'
import type { GameplayBeatmap, GameplayCircle, GameplayObject, GameplaySlider, GameplaySpinner } from '../src/data/GameplayLoader.ts'

const BASE = {
  hitSound: 0,
  samples: [{ sampleSet: 'normal', hitSound: 'normal', customIndex: 0, volume: 100, filename: '' }],
  newCombo: false,
  comboOffset: 0,
  comboColorOffset: 0,
  comboNumber: 1,
  comboIndex: 1,
  comboColorIndex: 1,
} as const

test('circle judgment boundaries produce 300/100/50/miss', () => {
  // OD5 windows from OsuGameRules.h: 50/100/150 ms; miss click window is 400 ms.
  for (const [offset, expected] of [[50, '300'], [51, '100'], [101, '50'], [-151, 'miss']] as const) {
    const circle = makeCircle(1_000, 256, 192)
    const session = new GameplaySession(makeBeatmap([circle]))
    const snapshot = session.update(1_000 + Math.min(offset, 0), {
      position: circle.position,
      held: true,
      clicks: [{ musicTime: 1_000 + offset, position: circle.position }],
    })
    assert.equal(snapshot.objectResults[0], expected, `offset ${offset}`)
  }

  const missed = new GameplaySession(makeBeatmap([makeCircle(1_000, 256, 192)]))
  assert.equal(missed.update(1_151, emptyInput()).objectResults[0], 'miss')
})

test('stable-default notelock blocks a later circle until the earliest unhit object resolves', () => {
  // OsuBeatmap.cpp:682-728 and default osu_notelock_type=2 at line 108.
  const first = makeCircle(1_000, 64, 192)
  const second = makeCircle(1_050, 448, 192)
  const session = new GameplaySession(makeBeatmap([first, second]))
  let snapshot = session.update(1_050, {
    position: second.position,
    held: true,
    clicks: [{ musicTime: 1_050, position: second.position }],
  })
  assert.deepEqual(snapshot.objectResults, [null, null])

  snapshot = session.update(1_050, {
    position: first.position,
    held: true,
    clicks: [
      { musicTime: 1_050, position: first.position },
      { musicTime: 1_050, position: second.position },
    ],
  })
  assert.deepEqual(snapshot.objectResults, ['300', '300'])
})

test('slider tracking re-enters at circle radius, retains 2.4x, and samples tail 36ms early', () => {
  assert.equal(osuSliderFollowCircleSizeMultiplier.getFloat(), 2.4)
  assert.equal(osuSliderEndInsideCheckOffset.getInt(), 36)
  const slider = makeSlider()
  const session = new GameplaySession(makeBeatmap([slider]))
  session.update(1_000, {
    position: slider.position,
    held: true,
    clicks: [{ musicTime: 1_000, position: slider.position }],
  })
  let snapshot = session.update(1_250, { position: { x: 306, y: 192 }, held: true, clicks: [] })
  assert.equal(snapshot.events.some((event) => event.type === 'slider-element' && event.element === 'tick' && event.successful), true)
  snapshot = session.update(1_500, { position: { x: 356, y: 192 }, held: false, clicks: [] })
  assert.equal(snapshot.events.some((event) => event.type === 'slider-element' && event.element === 'repeat' && !event.successful), true)
  session.update(1_964, { position: slider.position, held: true, clicks: [] })
  snapshot = session.update(2_000, { position: { x: 0, y: 0 }, held: false, clicks: [] })
  assert.equal(snapshot.objectResults[0], '100')
  assert.equal(snapshot.events.some((event) => event.type === 'slider-element' && event.element === 'tail' && event.successful), true)
})

test('spinner accumulates wrapped cursor angle and clears from required rotations', () => {
  // OsuSpinner.cpp:364-370 wraps to [-PI, PI], then rotate() accumulates abs(delta).
  const spinner = makeSpinner()
  const session = new GameplaySession(makeBeatmap([spinner]))
  const center = spinner.position
  session.update(999, { position: { x: center.x + 100, y: center.y }, held: false, clicks: [] })
  for (let step = 1; step <= 32; step += 1) {
    const angle = (step * Math.PI) / 2
    session.update(1_000 + step * 30, {
      position: { x: center.x + Math.cos(angle) * 100, y: center.y + Math.sin(angle) * 100 },
      held: true,
      clicks: [],
    })
  }
  const snapshot = session.update(3_000, { position: { x: center.x + 100, y: center.y }, held: false, clicks: [] })
  assert.equal(snapshot.objectResults[0], '300')
  assert.ok(snapshot.score.score >= 500)
  const visual = snapshot.spinnerStates[0]
  assert.ok(visual !== null)
  assert.equal(visual.cleared, true)
  assert.ok(visual.ratio >= 1)
  assert.ok(visual.rotation > 0)
  assert.ok(visual.rpm > 0 && visual.rpm <= 477)
  assert.equal(visual.approachPercent, 0)
  assert.equal(visual.bonusCount, Math.max(0, Math.floor(visual.rotations) - Math.trunc(visual.requiredRotations) - 1))
})

function makeBeatmap(objects: readonly GameplayObject[]): GameplayBeatmap {
  return {
    fileVersion: 14,
    approachRate: 5,
    circleSize: 5,
    overallDifficulty: 5,
    drainRate: 5,
    sliderMultiplier: 1.4,
    sliderTickRate: 1,
    playableLengthMS: objects.length === 0 ? 0 : 2_000,
    breakLengthMS: 0,
    circles: objects.filter((object): object is GameplayCircle => object.kind === 'circle'),
    sliders: objects.filter((object): object is GameplaySlider => object.kind === 'slider'),
    spinners: objects.filter((object): object is GameplaySpinner => object.kind === 'spinner'),
    objects,
  }
}

function makeCircle(time: number, x: number, y: number): GameplayCircle {
  return { ...BASE, kind: 'circle', time, position: { x, y } }
}

function makeSlider(): GameplaySlider {
  return {
    ...BASE,
    kind: 'slider',
    time: 1_000,
    endTime: 2_000,
    position: { x: 256, y: 192 },
    repeats: 1,
    spans: 2,
    pixelLength: 100,
    curveType: 'L',
    controlPoints: [{ x: 0, y: 0, type: 'L' }, { x: 100, y: 0, type: null }],
    absoluteControlPoints: [{ x: 256, y: 192 }, { x: 356, y: 192 }],
    spanDuration: 500,
    tickPercentages: [0.5],
    nodeSamples: [
      [{ sampleSet: 'normal', hitSound: 'normal', customIndex: 0, volume: 100, filename: '' }],
      [{ sampleSet: 'normal', hitSound: 'normal', customIndex: 0, volume: 100, filename: '' }],
      [{ sampleSet: 'normal', hitSound: 'normal', customIndex: 0, volume: 100, filename: '' }],
    ],
  }
}

function makeSpinner(): GameplaySpinner {
  return { ...BASE, kind: 'spinner', time: 1_000, endTime: 3_000, position: { x: 256, y: 192 } }
}

function emptyInput() {
  return { position: { x: 0, y: 0 }, held: false, clicks: [] }
}
