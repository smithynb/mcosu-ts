import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateGrade } from '../src/core/Grade.ts'

const counts = (count300: number, count100 = 0, count50 = 0, countMiss = 0) =>
  ({ count300, count100, count50, countMiss })

test('McOsu grade thresholds retain strict greater-than boundaries', () => {
  // OsuScore.cpp:656-666 uses strict comparisons at 60/70/80/90 percent.
  assert.equal(calculateGrade(counts(6, 4)), 'D')
  assert.equal(calculateGrade(counts(7, 3)), 'C')
  assert.equal(calculateGrade(counts(8, 2)), 'B')
  assert.equal(calculateGrade(counts(9, 1)), 'A')
  assert.equal(calculateGrade(counts(91, 8, 1)), 'S')
})

test('miss branches and excessive 50s prevent higher grades', () => {
  assert.equal(calculateGrade(counts(8, 1, 0, 1)), 'C')
  assert.equal(calculateGrade(counts(9, 0, 1, 0)), 'A')
  assert.equal(calculateGrade(counts(91, 7, 2, 0)), 'A')
})

test('perfect and S grades become silver with Hidden or Flashlight', () => {
  assert.equal(calculateGrade(counts(10)), 'X')
  assert.equal(calculateGrade(counts(10), { hidden: true }), 'XH')
  assert.equal(calculateGrade(counts(91, 8, 1), { flashlight: true }), 'SH')
})

test('zero resolved hits follows McOsu perfect-grade ordering', () => {
  // The C++ helper does not special-case an empty score; all non-300 counts are
  // zero, so its final condition wins.
  assert.equal(calculateGrade(counts(0)), 'X')
})
