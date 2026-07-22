import assert from 'node:assert/strict'
import test from 'node:test'
import { formatOptionValue, parseBoundedOptionValue } from '../src/core/OptionValues.ts'

test('formats option values for percent, timing, and raw readouts', () => {
  assert.equal(formatOptionValue(0.9, 'percent'), '90%')
  assert.equal(formatOptionValue(-12, 'milliseconds'), '-12 ms')
  assert.equal(formatOptionValue(0.85, 'seconds'), '0.85 s')
  assert.equal(formatOptionValue(2, 'number'), '2')
  assert.equal(formatOptionValue(Number.NaN, 'number'), '—')
})

test('parses, clamps, and rounds range values to their declared step', () => {
  assert.equal(parseBoundedOptionValue('0.856', 0, 2, 0.01), 0.86)
  assert.equal(parseBoundedOptionValue('-50', -25, 25, 1), -25)
  assert.equal(parseBoundedOptionValue('200', -25, 25, 1), 25)
  assert.throws(() => parseBoundedOptionValue('nope', 0, 1, 0.1), /finite number/)
  assert.throws(() => parseBoundedOptionValue('1', 0, 1, 0), /positive/)
})
