import type { BeatmapEntry } from './OsuDatabase.ts'

type Section = 'general' | 'metadata' | 'difficulty' | 'other'

/**
 * Lightweight metadata port of McOsu `OsuDatabaseBeatmap.cpp:1031-1181`.
 * Only fields needed by the phase-1 library are retained; parsing stops before
 * hit objects so raw fallback does not perform gameplay-level work.
 */
export function parseOsuBeatmapMetadata(
  text: string,
  folder: string,
  fileName: string,
): BeatmapEntry | null {
  const values = new Map<string, string>()
  let section: Section = 'other'

  for (const untrimmedLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = untrimmedLine.trim()
    if (line.startsWith('//') || line.length === 0) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).toLocaleLowerCase()
      if (name === 'hitobjects') break
      section = name === 'general' || name === 'metadata' || name === 'difficulty' ? name : 'other'
      continue
    }
    if (section === 'other') continue

    const colon = line.indexOf(':')
    if (colon < 1) continue
    const key = line.slice(0, colon).trim().toLocaleLowerCase()
    values.set(`${section}.${key}`, line.slice(colon + 1).trim())
  }

  const rawMode = values.get('general.mode')
  const mode = rawMode === undefined ? 0 : integer(rawMode)
  if (mode !== 0) return null

  const artist = value(values, 'metadata.artist')
  const title = value(values, 'metadata.title')
  const creator = value(values, 'metadata.creator')
  const difficultyName = value(values, 'metadata.version')
  if ([artist, title, creator, difficultyName].every((item) => item.length === 0)) return null

  const od = finite(values.get('difficulty.overalldifficulty'), 5)
  return {
    artist,
    title,
    creator,
    difficultyName,
    audioFile: value(values, 'general.audiofilename'),
    md5: '',
    osuPath: joinPath(folder, fileName),
    folder: normalizePath(folder),
    ar: finite(values.get('difficulty.approachrate'), od),
    cs: finite(values.get('difficulty.circlesize'), 5),
    hp: finite(values.get('difficulty.hpdrainrate'), 5),
    od,
    length: 0,
    mode,
    localOffset: 0,
  }
}

function value(values: ReadonlyMap<string, string>, key: string): string {
  return values.get(key)?.trim() ?? ''
}

function finite(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.length === 0) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function integer(raw: string): number | null {
  if (!/^[+-]?\d+$/.test(raw.trim())) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
}

function joinPath(folder: string, fileName: string): string {
  const normalizedFolder = normalizePath(folder)
  const normalizedFile = normalizePath(fileName)
  return normalizedFolder.length === 0 ? normalizedFile : `${normalizedFolder}/${normalizedFile}`
}
