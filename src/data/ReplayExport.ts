import { LegacyReplayFrame, Replay, Score, ScoreInfo, Vector2 } from 'osu-classes'
import { ScoreEncoder } from 'osu-parsers'
import type { LocalScore } from './ScoresDatabase.ts'

export const REPLAY_GAME_VERSION = 20250721

/** Encodes a browser-recorded play as an osu!stable-compatible `.osr`. */
export async function encodeReplay(score: LocalScore): Promise<Uint8Array> {
  if (!/^[0-9a-f]{32}$/i.test(score.md5)) throw new Error('Replay export requires a valid beatmap MD5.')
  if (score.replayFrames === undefined || score.replayFrames.length === 0) {
    throw new Error('This score does not contain recorded replay frames.')
  }

  const info = new ScoreInfo({
    id: Math.max(0, Math.trunc(score.playedAt.getTime())),
    rulesetId: 0,
    rawMods: score.modsLegacy,
    username: score.playerName || 'Local Player',
    date: score.playedAt,
    beatmapHashMD5: score.md5.toLowerCase(),
    count300: score.count300,
    count100: score.count100,
    count50: score.count50,
    countGeki: score.countGeki,
    countKatu: score.countKatu,
    countMiss: score.countMiss,
    totalScore: clampInteger(score.score, 0, 2_147_483_647),
    maxCombo: clampInteger(BigInt(score.maxCombo), 0, 32_767),
    perfect: score.perfect,
    passed: score.countMiss === 0,
  })
  const replay = new Replay()
  replay.gameVersion = REPLAY_GAME_VERSION
  replay.mode = 0
  replay.hashMD5 = ''
  replay.lifeBar = []
  let startTime = 0
  replay.frames = score.replayFrames.map((frame) => {
    startTime += Math.max(0, frame.delta)
    return new LegacyReplayFrame(
      startTime,
      Math.max(0, frame.delta),
      new Vector2(frame.x, frame.y),
      frame.keys,
    )
  })
  const encoded = await new ScoreEncoder().encodeToBuffer(new Score(info, replay))
  if (encoded.length === 0) throw new Error('osu-parsers could not encode this replay.')
  return encoded
}

export function replayFilename(score: LocalScore): string {
  const player = safeFilename(score.playerName || 'Local Player')
  const date = score.playedAt.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `${player}_${score.md5.slice(0, 8)}_${date}.osr`
}

function clampInteger(value: bigint, minimum: number, maximum: number): number {
  if (value < BigInt(minimum)) return minimum
  if (value > BigInt(maximum)) return maximum
  return Number(value)
}

function safeFilename(value: string): string {
  const result = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ')
  return result.length === 0 ? 'Local Player' : result.slice(0, 80)
}
