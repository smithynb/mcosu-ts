import type { BeatmapEntry } from '../data/OsuDatabase.ts'

export type StarRatingLoader = (entry: BeatmapEntry) => Promise<number>
export type YieldTask = () => Promise<void>

const yieldToEventLoop: YieldTask = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Serial, retryable cache for CPU-heavy star calculations. */
export class StarRatingCache {
  readonly #loader: StarRatingLoader
  readonly #yieldTask: YieldTask
  readonly #values = new Map<string, Promise<number>>()
  #queue: Promise<void> = Promise.resolve()

  constructor(loader: StarRatingLoader, yieldTask: YieldTask = yieldToEventLoop) {
    this.#loader = loader
    this.#yieldTask = yieldTask
  }

  get(entry: BeatmapEntry): Promise<number> {
    const key = starRatingKey(entry)
    const cached = this.#values.get(key)
    if (cached !== undefined) return cached

    let resolveValue!: (value: number) => void
    let rejectValue!: (reason: unknown) => void
    const pending = new Promise<number>((resolve, reject) => {
      resolveValue = resolve
      rejectValue = reject
    })
    this.#values.set(key, pending)

    this.#queue = this.#queue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.#yieldTask()
          const value = await this.#loader(entry)
          if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid star rating: ${value}`)
          resolveValue(value)
        } catch (error) {
          if (this.#values.get(key) === pending) this.#values.delete(key)
          rejectValue(error)
        }
      })

    return pending
  }

  clear(): void {
    this.#values.clear()
  }
}

export function starRatingKey(entry: Pick<BeatmapEntry, 'md5' | 'osuPath'>): string {
  const md5 = entry.md5.trim().toLowerCase()
  return md5.length > 0 ? `md5:${md5}` : `path:${entry.osuPath.replaceAll('\\', '/').toLowerCase()}`
}
