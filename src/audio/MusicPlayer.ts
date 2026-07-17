import type { BeatmapEntry } from '../data/OsuDatabase.ts'
import type { OsuFileSystem } from '../fs/osuFileSystem.ts'
import type { AudioClockSource } from './InterpolatedClock.ts'

interface PitchCapableAudio extends HTMLAudioElement {
  mozPreservesPitch?: boolean
  webkitPreservesPitch?: boolean
}

const LOAD_TIMEOUT_MS = 15_000
const MIN_PLAYBACK_RATE = 0.25
const MAX_PLAYBACK_RATE = 4

/** HTMLAudioElement-backed subset of McOsu's Sound surface. */
export class MusicPlayer implements AudioClockSource {
  readonly #audio: PitchCapableAudio
  readonly #objectUrl: string
  #disposed = false

  private constructor(audio: PitchCapableAudio, objectUrl: string) {
    this.#audio = audio
    this.#objectUrl = objectUrl
  }

  static async load(fileSystem: OsuFileSystem, beatmap: BeatmapEntry): Promise<MusicPlayer> {
    if (beatmap.audioFile.trim().length === 0) {
      throw new Error('This beatmap does not name an audio file.')
    }

    const audioPath = joinAudioPath(beatmap.folder, beatmap.audioFile)
    let file: File
    try {
      file = await fileSystem.getFile(audioPath)
    } catch (error) {
      throw new Error(`Could not open “${audioPath}”: ${message(error)}`)
    }

    const objectUrl = URL.createObjectURL(file)
    const audio = new Audio() as PitchCapableAudio
    audio.preload = 'metadata'
    const player = new MusicPlayer(audio, objectUrl)
    try {
      await player.#loadMetadata()
      player.setPitchPreserved(true)
      return player
    } catch (error) {
      player.dispose()
      throw error
    }
  }

  async play(): Promise<void> {
    this.#assertActive()
    try {
      await this.#audio.play()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        throw new Error('The browser blocked playback. Press Play again to allow audio.')
      }
      throw new Error(`Could not play this audio file: ${message(error)}`)
    }
  }

  pause(): void {
    if (!this.#disposed) this.#audio.pause()
  }

  stop(): void {
    this.#assertActive()
    this.#audio.pause()
    this.setPositionMS(0)
  }

  getPositionMS(): number {
    const seconds = this.#audio.currentTime
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : 0
  }

  setPositionMS(positionMS: number): void {
    this.#assertActive()
    const length = this.getLengthMS()
    const finitePosition = Number.isFinite(positionMS) ? positionMS : 0
    this.#audio.currentTime = Math.min(Math.max(0, finitePosition), length)
  }

  getLengthMS(): number {
    const seconds = this.#audio.duration
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : 0
  }

  isPlaying(): boolean {
    return !this.#disposed && !this.#audio.paused && !this.#audio.ended
  }

  setVolume(volume: number): void {
    this.#assertActive()
    this.#audio.volume = clamp(Number.isFinite(volume) ? volume : 1, 0, 1)
  }

  setSpeed(speed: number): void {
    this.#assertActive()
    const safeSpeed = Number.isFinite(speed) ? speed : 1
    this.#audio.playbackRate = clamp(safeSpeed, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE)
  }

  getSpeed(): number {
    return this.#audio.playbackRate
  }

  setPitchPreserved(preserved: boolean): void {
    this.#assertActive()
    this.#audio.preservesPitch = preserved
    this.#audio.mozPreservesPitch = preserved
    this.#audio.webkitPreservesPitch = preserved
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#audio.pause()
    this.#audio.removeAttribute('src')
    this.#audio.load()
    URL.revokeObjectURL(this.#objectUrl)
  }

  async #loadMetadata(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let timeout = 0
      const cleanup = (): void => {
        clearTimeout(timeout)
        this.#audio.removeEventListener('loadedmetadata', onLoaded)
        this.#audio.removeEventListener('error', onError)
      }
      const onLoaded = (): void => {
        cleanup()
        const duration = this.getLengthMS()
        if (duration <= 0) {
          reject(new Error('The browser decoded the file but reported no playable duration.'))
          return
        }
        resolve()
      }
      const onError = (): void => {
        cleanup()
        reject(new Error(mediaErrorMessage(this.#audio.error)))
      }

      this.#audio.addEventListener('loadedmetadata', onLoaded)
      this.#audio.addEventListener('error', onError)
      timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Timed out while loading beatmap audio metadata.'))
      }, LOAD_TIMEOUT_MS)
      this.#audio.src = this.#objectUrl
      this.#audio.load()
    })
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('This music player has been disposed.')
  }
}

function joinAudioPath(folder: string, audioFile: string): string {
  const normalizedFolder = folder.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const normalizedAudio = audioFile.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  return normalizedFolder.length === 0
    ? `Songs/${normalizedAudio}`
    : `Songs/${normalizedFolder}/${normalizedAudio}`
}

function mediaErrorMessage(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Audio loading was aborted.'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'The browser could not read the selected audio file.'
    case MediaError.MEDIA_ERR_DECODE:
      return 'The browser could not decode this audio file; its codec may be unsupported or corrupt.'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This browser does not support the beatmap audio codec.'
    default:
      return 'The browser could not load this beatmap audio file.'
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
