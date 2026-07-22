import type { GameplayBeatmap, GameplaySample } from '../data/GameplayLoader.ts'
import type { BeatmapEntry } from '../data/OsuDatabase.ts'
import type { OsuFileSystem } from '../fs/types.ts'
import { osuVolumeEffects } from '../core/ConVars.ts'

interface LoadedSample {
  readonly buffer: AudioBuffer
  readonly volume: number
}

export class HitSoundPlayer {
  readonly #context: AudioContext
  readonly #samples = new Map<string, LoadedSample>()

  private constructor(context: AudioContext) {
    this.#context = context
  }

  static async load(
    fileSystem: Pick<OsuFileSystem, 'getFile'>,
    entry: BeatmapEntry,
    beatmap: GameplayBeatmap,
    skinName: string,
  ): Promise<HitSoundPlayer | null> {
    const Context = window.AudioContext ?? window.webkitAudioContext
    if (Context === undefined) return null
    let context: AudioContext
    try {
      context = new Context()
    } catch {
      return null
    }
    const player = new HitSoundPlayer(context)
    const unique = new Map<string, GameplaySample>()
    for (const object of beatmap.objects) {
      for (const sample of object.samples) unique.set(sampleKey(sample), sample)
      if (object.kind === 'slider') {
        for (const node of object.nodeSamples) for (const sample of node) unique.set(sampleKey(sample), sample)
      }
    }
    await Promise.all([...unique.values()].map((sample) => player.#loadSample(fileSystem, entry, skinName, sample)))
    return player
  }

  async resume(): Promise<void> {
    if (this.#context.state !== 'suspended') return
    try {
      await this.#context.resume()
    } catch {
      // A later keyboard/pointer gesture will retry if transient activation expired.
    }
  }

  play(samples: readonly GameplaySample[], x: number): void {
    if (this.#context.state !== 'running') return
    for (const sample of samples) {
      const loaded = this.#findSample(sample)
      if (loaded === undefined) continue
      const source = this.#context.createBufferSource()
      const gain = this.#context.createGain()
      const panner = this.#context.createStereoPanner()
      source.buffer = loaded.buffer
      // OsuSkin.cpp:844-865 applies 0.8 to hitnormal, 0.85 to
      // whistle/clap, and 1.0 to finish before the timing-point volume.
      gain.gain.value = clamp(
        (loaded.volume / 100) * sampleVolumeMultiplier(sample.hitSound) * osuVolumeEffects.getFloat(),
        0,
        1,
      )
      // OsuGameRules.h:24-27: positional pan covers the center 80% of stereo.
      panner.pan.value = clamp((x / 512 - 0.5) * 0.8, -1, 1)
      source.connect(gain).connect(panner).connect(this.#context.destination)
      source.start()
    }
  }

  close(): void {
    void this.#context.close().catch(() => undefined)
    this.#samples.clear()
  }

  async #loadSample(
    fileSystem: Pick<OsuFileSystem, 'getFile'>,
    entry: BeatmapEntry,
    skinName: string,
    sample: GameplaySample,
  ): Promise<void> {
    const key = sampleKey(sample)
    const paths: string[] = []
    if (sample.filename.length > 0) paths.push(`Songs/${entry.folder}/${sample.filename}`)
    if (skinName.length > 0 && sample.filename.length === 0) {
      const index = sample.customIndex > 1 ? String(sample.customIndex) : ''
      const stem = `${normalizedSet(sample.sampleSet)}-hit${normalizedSound(sample.hitSound)}${index}`
      for (const extension of ['wav', 'ogg', 'mp3']) paths.push(`Skins/${skinName}/${stem}.${extension}`)
      if (index.length > 0) {
        const unindexed = `${normalizedSet(sample.sampleSet)}-hit${normalizedSound(sample.hitSound)}`
        for (const extension of ['wav', 'ogg', 'mp3']) paths.push(`Skins/${skinName}/${unindexed}.${extension}`)
      }
      if (normalizedSet(sample.sampleSet) !== 'normal') {
        for (const extension of ['wav', 'ogg', 'mp3']) paths.push(`Skins/${skinName}/normal-hit${normalizedSound(sample.hitSound)}${index}.${extension}`)
        if (index.length > 0) {
          for (const extension of ['wav', 'ogg', 'mp3']) paths.push(`Skins/${skinName}/normal-hit${normalizedSound(sample.hitSound)}.${extension}`)
        }
      }
    }
    for (const path of paths) {
      try {
        const data = await (await fileSystem.getFile(path)).arrayBuffer()
        const buffer = await this.#context.decodeAudioData(data.slice(0))
        this.#samples.set(key, { buffer, volume: sample.volume })
        return
      } catch {
        // Probe the next codec or the normal-set fallback.
      }
    }
    try {
      const response = await fetch(defaultHitSoundPath(sample.hitSound))
      if (!response.ok) return
      const buffer = await this.#context.decodeAudioData((await response.arrayBuffer()).slice(0))
      this.#samples.set(key, { buffer, volume: sample.volume })
    } catch {
      // Generated defaults are best-effort; unsupported audio remains silent.
    }
  }

  #findSample(sample: GameplaySample): LoadedSample | undefined {
    return this.#samples.get(sampleKey(sample))
  }
}

export function defaultHitSoundPath(hitSound: string): string {
  return `/default-hitsounds/normal-hit${normalizedSound(hitSound)}.wav`
}

function sampleKey(sample: GameplaySample): string {
  return `${sample.filename}|${normalizedSet(sample.sampleSet)}|${normalizedSound(sample.hitSound)}|${sample.customIndex}`
}

function normalizedSet(value: string): 'normal' | 'soft' | 'drum' {
  return value === 'soft' || value === 'drum' ? value : 'normal'
}

function normalizedSound(value: string): 'normal' | 'whistle' | 'finish' | 'clap' {
  return value === 'whistle' || value === 'finish' || value === 'clap' ? value : 'normal'
}

function sampleVolumeMultiplier(hitSound: string): number {
  const sound = normalizedSound(hitSound)
  return sound === 'normal' ? 0.8 : sound === 'finish' ? 1 : 0.85
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
