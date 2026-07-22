import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_COMBO_COLORS, parseSkinIni } from '../src/skin/Skin.ts'

test('parses McOsu skin general settings and ordered combo colors', () => {
  const config = parseSkinIni(`
[General]
Version: latest
AnimationFramerate: 24

[Colours]
Combo3 : 18, 124, 255
Combo1: 255, 192, 0
Combo2 : 0, 202, 0
SliderBorder: 245,245,245
SliderTrackOverride: 12,34,56
`)
  assert.equal(config.animationFramerate, 24)
  assert.equal(config.version, 2.5)
  assert.deepEqual(config.comboColors, ['#ffc000', '#00ca00', '#127cff'])
  assert.equal(config.sliderBorderColor, '#f5f5f5')
  assert.equal(config.sliderTrackOverride, '#0c2238')
})

test('falls back to McOsu combo colors and clamps invalid framerate', () => {
  const config = parseSkinIni('[General]\nAnimationFramerate: -1')
  assert.equal(config.animationFramerate, 0)
  assert.deepEqual(config.comboColors, DEFAULT_COMBO_COLORS)
  assert.equal(config.version, 1)
})
