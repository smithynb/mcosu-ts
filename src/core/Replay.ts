import { LegacyReplayFrame, ReplayButtonState } from 'osu-classes'
import { ScoreDecoder } from 'osu-parsers'
import type { GameplayFrameInput, GameplayClick } from './GameplaySession.ts'
import type { Point } from './GameRules.ts'
import { modsFromLegacy, type GameplayMods } from './Mods.ts'

export interface ReplayFrame {
  readonly delta: number
  readonly x: number
  readonly y: number
  readonly keys: number
}

export interface ImportedReplay {
  readonly beatmapMd5: string
  readonly playerName: string
  readonly modsLegacy: number
  readonly mods: GameplayMods
  readonly frames: readonly ReplayFrame[]
}

const KEY_M1 = ReplayButtonState.Left1
const KEY_M2 = ReplayButtonState.Right1
const KEY_K1 = ReplayButtonState.Left2
const KEY_K2 = ReplayButtonState.Right2
const GAMEPLAY_KEYS = KEY_M1 | KEY_M2 | KEY_K1 | KEY_K2
const LEFT_SIDE = KEY_M1 | KEY_K1
const RIGHT_SIDE = KEY_M2 | KEY_K2

/**
 * Decodes stable `.osr` through osu-parsers' lazer-lineage ScoreDecoder.
 * Its LegacyReplayFrame decoder drops the -12345 RNG seed and old
 * (256,-500) sentinel records before this boundary.
 */
export async function parseReplay(buffer: ArrayBuffer | Uint8Array): Promise<ImportedReplay> {
  const score = await new ScoreDecoder().decodeFromBuffer(buffer, true)
  const md5 = score.info.beatmapHashMD5.trim().toLowerCase()
  if (score.info.rulesetId !== 0) throw new Error(`Replay mode ${score.info.rulesetId} is not osu!standard.`)
  if (!/^[0-9a-f]{32}$/.test(md5)) throw new Error('Replay does not contain a valid beatmap MD5.')
  if (score.replay === null || score.replay.frames.length === 0) throw new Error('Replay contains no playable input frames.')
  const modsLegacy = typeof score.info.rawMods === 'number' ? score.info.rawMods : Number(score.info.rawMods)
  if (!Number.isSafeInteger(modsLegacy)) throw new Error('Replay contains an invalid legacy mod bitmask.')
  const frames = normalizeLegacyFrames(
    score.replay.frames.filter((frame): frame is LegacyReplayFrame => frame instanceof LegacyReplayFrame),
  )
  if (frames.length === 0) throw new Error('Replay contains no valid osu!standard frames.')
  return {
    beatmapMd5: md5,
    playerName: score.info.username,
    modsLegacy,
    mods: modsFromLegacy(modsLegacy),
    frames,
  }
}

export function normalizeLegacyFrames(frames: readonly { interval: number; mouseX: number; mouseY: number; buttonState: number }[]): ReplayFrame[] {
  const result: ReplayFrame[] = []
  for (const frame of frames) {
    if (frame.interval === -12_345 || (result.length < 2 && frame.mouseX === 256 && frame.mouseY === -500)) continue
    if (!Number.isFinite(frame.interval) || frame.interval < 0 || !Number.isFinite(frame.mouseX) || !Number.isFinite(frame.mouseY)) continue
    result.push({ delta: frame.interval, x: frame.mouseX, y: frame.mouseY, keys: frame.buttonState & GAMEPLAY_KEYS })
  }
  return result
}

export class ReplayPlayer {
  readonly #frames: readonly (ReplayFrame & { time: number })[]
  #index = 0
  #keys = 0
  #position: Point = { x: 256, y: 192 }
  #lastPositionMS = Number.NEGATIVE_INFINITY

  constructor(frames: readonly ReplayFrame[]) {
    let time = 0
    this.#frames = frames.map((frame) => ({ ...frame, time: time += Math.max(0, frame.delta) }))
  }

  inputAt(positionMS: number): GameplayFrameInput {
    if (positionMS < this.#lastPositionMS) this.reset()
    this.#lastPositionMS = positionMS
    const clicks: GameplayClick[] = []
    while (this.#index < this.#frames.length && this.#frames[this.#index]!.time <= positionMS) {
      const frame = this.#frames[this.#index++]!
      const previousKeys = this.#keys
      this.#keys = frame.keys
      this.#position = { x: frame.x, y: frame.y }
      for (const side of logicalSides()) {
        if ((previousKeys & side.mask) === 0 && (this.#keys & side.mask) !== 0) {
          clicks.push({ musicTime: frame.time, position: this.#position, input: side.input(this.#keys) })
        }
      }
    }
    return {
      position: this.#position,
      held: logicalSides().some((side) => (this.#keys & side.mask) !== 0),
      heldInputs: logicalSides()
        .filter((side) => (this.#keys & side.mask) !== 0)
        .map((side) => side.input(this.#keys)),
      clicks,
    }
  }

  reset(): void {
    this.#index = 0
    this.#keys = 0
    this.#position = { x: 256, y: 192 }
    this.#lastPositionMS = Number.NEGATIVE_INFINITY
  }
}

export class ReplayRecorder {
  readonly #frames: ReplayFrame[] = []
  #lastTime = 0
  #lastPosition: Point = { x: 256, y: 192 }
  #lastKeys = 0

  record(positionMS: number, input: GameplayFrameInput): void {
    if (!Number.isFinite(positionMS) || positionMS < 0) return
    for (const click of [...input.clicks].sort((left, right) => left.musicTime - right.musicTime)) {
      const bit = inputBit(click.input)
      if (bit !== 0 && (this.#lastKeys & bit) === 0) this.#append(click.musicTime, click.position, this.#lastKeys | bit)
    }
    const keys = keysFromInputs(input.heldInputs ?? [])
    const moved = Math.abs(input.position.x - this.#lastPosition.x) > 0.001 || Math.abs(input.position.y - this.#lastPosition.y) > 0.001
    if (moved || keys !== this.#lastKeys || positionMS - this.#lastTime >= 100) this.#append(positionMS, input.position, keys)
  }

  frames(): readonly ReplayFrame[] { return this.#frames.map((frame) => ({ ...frame })) }

  #append(time: number, position: Point, keys: number): void {
    const safeTime = Math.max(this.#lastTime, time)
    this.#frames.push({ delta: safeTime - this.#lastTime, x: position.x, y: position.y, keys: keys & GAMEPLAY_KEYS })
    this.#lastTime = safeTime
    this.#lastPosition = position
    this.#lastKeys = keys
  }
}

function logicalSides(): readonly {
  readonly mask: number
  readonly input: (keys: number) => string
}[] {
  return [
    { mask: LEFT_SIDE, input: (keys) => (keys & KEY_K1) !== 0 ? 'KeyZ' : 'MouseLeft' },
    { mask: RIGHT_SIDE, input: (keys) => (keys & KEY_K2) !== 0 ? 'KeyX' : 'MouseRight' },
  ]
}

function keysFromInputs(inputs: readonly string[]): number {
  return inputs.reduce((keys, input) => keys | inputBit(input), 0)
}

function inputBit(input: string | undefined): number {
  if (input === 'MouseLeft') return KEY_M1
  if (input === 'MouseRight') return KEY_M2
  if (input === 'KeyZ') return KEY_K1
  if (input === 'KeyX') return KEY_K2
  return 0
}

// Preserve the concrete legacy type in the public dependency boundary so a
// future ScoreEncoder/.osr writer can map frames without another translation.
export type OsuLegacyReplayFrame = LegacyReplayFrame
