import { parseOsuBeatmapMetadata } from './OsuBeatmapMetadata.ts'
import type { BeatmapEntry } from './OsuDatabase.ts'
import type { OsuFileSystem } from '../fs/types.ts'

export interface RawScanProgress {
  readonly scannedFolders: number
  readonly totalFolders: number
  readonly beatmapsFound: number
}

export interface RawSongsResult {
  readonly beatmaps: BeatmapEntry[]
  readonly folderCount: number
  readonly skippedFolders: number
  readonly skippedFiles: number
}

export type RawScanProgressCallback = (progress: RawScanProgress) => void

/**
 * Browser equivalent of McOsu `OsuDatabase::scheduleLoadRaw()` and
 * `loadRawBeatmap()` (`OsuDatabase.cpp:1250-1310`, `2890-2930`). Work is
 * divided by Songs folder and yields after each folder so UI progress paints.
 */
export async function scanRawSongs(
  fileSystem: OsuFileSystem,
  onProgress: RawScanProgressCallback = () => undefined,
): Promise<RawSongsResult> {
  let songEntries
  try {
    songEntries = await fileSystem.listDir('Songs')
  } catch (error) {
    throw new Error(`The selected folder does not contain a readable Songs directory: ${message(error)}`)
  }

  const folders = songEntries.filter((entry) => entry.kind === 'directory')
  const beatmaps: BeatmapEntry[] = []
  let skippedFolders = 0
  let skippedFiles = 0
  onProgress({ scannedFolders: 0, totalFolders: folders.length, beatmapsFound: 0 })

  for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
    const folder = folders[folderIndex]
    if (folder === undefined) continue
    const folderPath = `Songs/${folder.name}`

    try {
      const files = await fileSystem.listDir(folderPath)
      const osuFiles = files.filter(
        (entry) => entry.kind === 'file' && entry.name.toLocaleLowerCase().endsWith('.osu'),
      )
      for (const osuFile of osuFiles) {
        try {
          const file = await fileSystem.getFile(`${folderPath}/${osuFile.name}`)
          const entry = parseOsuBeatmapMetadata(await file.text(), folder.name, osuFile.name)
          if (entry !== null) beatmaps.push(entry)
        } catch {
          skippedFiles += 1
        }
      }
    } catch {
      skippedFolders += 1
    }

    onProgress({
      scannedFolders: folderIndex + 1,
      totalFolders: folders.length,
      beatmapsFound: beatmaps.length,
    })
    await yieldToBrowser()
  }

  return { beatmaps, folderCount: folders.length, skippedFolders, skippedFiles }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
