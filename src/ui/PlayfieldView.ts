import type { HitSoundPlayer } from '../audio/HitSoundPlayer.ts'
import { GameplaySession, type GameplayEvent, type GameplayFrameInput } from '../core/GameplaySession.ts'
import type { GameplayBeatmap } from '../data/GameplayLoader.ts'
import { GameplayInput } from '../input/GameplayInput.ts'
import { CanvasPlayfield, type PlayfieldRenderer } from '../render/Playfield.ts'
import type { LoadedSkin } from '../skin/Skin.ts'
import { calculateGrade } from '../core/Grade.ts'
import type { ModdedGameplayBeatmap } from '../core/Mods.ts'
import type { StandardPerformanceContext } from '../core/StandardPerformance.ts'
import { FailAnimation } from '../core/Health.ts'
import { osuFailTime } from '../core/ConVars.ts'
import type { GameplaySnapshot } from '../core/GameplaySession.ts'

export interface RankingResult {
  readonly snapshot: GameplaySnapshot
  readonly grade: ReturnType<typeof calculateGrade>
  readonly pp: number
  readonly failed: boolean
  readonly interactive: boolean
}

export interface PlayfieldCallbacks {
  readonly onSpeedChange: (speed: number) => void
  readonly onPauseChange: (paused: boolean) => void
  readonly onRetry: () => void
  readonly onQuit: () => void
  readonly onFailProgress: (progress: number, finished: boolean) => void
  readonly onComplete: (result: RankingResult) => void
}

export class PlayfieldView {
  readonly #root: HTMLDivElement
  readonly #canvas: HTMLCanvasElement
  readonly #position: HTMLOutputElement
  #renderer: PlayfieldRenderer | null = null
  #session: GameplaySession | null = null
  #input: GameplayInput | null = null
  #hitSounds: HitSoundPlayer | null = null
  #lastCursor = { x: 256, y: 192 }
  #mode: 'watch' | 'play' = 'watch'
  #beatmap: GameplayBeatmap | null = null
  #performance: StandardPerformanceContext | null = null
  #livePp = 0
  #lastPpKey = ''
  #lastPositionMS = Number.NEGATIVE_INFINITY
  readonly #callbacks: PlayfieldCallbacks
  #paused = false
  #completed = false
  #failAnimation: FailAnimation | null = null
  #lastSpeed = 1

  constructor(callbacks: PlayfieldCallbacks) {
    this.#callbacks = callbacks
    this.#root = document.createElement('div')
    this.#root.className = 'playfield-overlay'
    this.#root.hidden = true
    this.#root.innerHTML = `
      <header class="playfield-toolbar">
        <div>
          <p id="playfield-mode" class="eyebrow">autoplay standard playfield</p>
          <h2 id="watch-title">Beatmap watch</h2>
        </div>
        <div class="playfield-toolbar-actions">
          <div class="watch-speed" aria-label="Playback rate">
            <button type="button" data-watch-speed="0.75">0.75×</button>
            <button type="button" data-watch-speed="1" aria-pressed="true">1.00×</button>
            <button type="button" data-watch-speed="1.5">1.50×</button>
          </div>
          <output id="watch-position">0.000 ms</output>
          <label class="mouse-input-toggle"><input id="mouse-input" type="checkbox" checked> mouse</label>
          <button id="watch-close" type="button">Close</button>
        </div>
      </header>
      <div class="playfield-letterbox">
        <canvas class="slider-body-layer" aria-hidden="true"></canvas>
        <canvas class="playfield-sprite-layer" aria-label="Passive osu! playfield"></canvas>
      </div>
      <section id="play-results" class="play-results" hidden></section>
      <section id="pause-menu" class="pause-menu" hidden>
        <p class="eyebrow">paused</p><h3>Gameplay paused</h3>
        <div><button type="button" data-pause-action="continue">Continue</button><button type="button" data-pause-action="retry">Retry</button><button type="button" data-pause-action="quit">Quit</button></div>
      </section>
    `
    this.#canvas = required<HTMLCanvasElement>(this.#root, '.playfield-sprite-layer')
    this.#position = required<HTMLOutputElement>(this.#root, '#watch-position')
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('[data-watch-speed]')) {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.watchSpeed)
        if (!Number.isFinite(speed)) return
        callbacks.onSpeedChange(speed)
        for (const peer of this.#root.querySelectorAll<HTMLButtonElement>('[data-watch-speed]')) {
          peer.setAttribute('aria-pressed', String(Number(peer.dataset.watchSpeed) === speed))
        }
      })
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.#root.hidden || this.#mode !== 'play' || this.#completed || this.#failAnimation?.active === true) return
      event.preventDefault()
      this.#setPaused(!this.#paused)
    })
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('[data-pause-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.pauseAction
        if (action === 'continue') this.#setPaused(false)
        else if (action === 'retry') this.#retry()
        else if (action === 'quit') this.#quit()
      })
    }
    required<HTMLButtonElement>(this.#root, '#watch-close').onclick = () => this.#quit()
    document.body.append(this.#root)
  }

  open(
    beatmap: GameplayBeatmap,
    skin: LoadedSkin | null,
    title: string,
    options: {
      mode?: 'watch' | 'play'
      hitSounds?: HitSoundPlayer | null
      performance?: StandardPerformanceContext | null
    } = {},
  ): void {
    this.close()
    this.#mode = options.mode ?? 'watch'
    required<HTMLHeadingElement>(this.#root, '#watch-title').textContent = title
    required<HTMLElement>(this.#root, '#playfield-mode').textContent =
      this.#mode === 'play' ? 'interactive standard playfield' : 'autoplay standard playfield'
    this.#root.hidden = false
    const sliderCanvas = required<HTMLCanvasElement>(this.#root, '.slider-body-layer')
    this.#renderer = new CanvasPlayfield(this.#canvas, sliderCanvas, beatmap, skin)
    this.#beatmap = beatmap
    this.#performance = options.performance ?? null
    this.#session = new GameplaySession(beatmap, { autoplay: this.#mode === 'watch' })
    this.#lastPositionMS = Number.NEGATIVE_INFINITY
    this.#paused = false
    this.#completed = false
    this.#failAnimation = null
    required<HTMLElement>(this.#root, '#pause-menu').hidden = true
    this.#hitSounds = options.hitSounds ?? null
    void this.#hitSounds?.resume()
    window.addEventListener('keydown', this.#resumeAudio, { once: true })
    this.#root.addEventListener('pointerdown', this.#resumeAudio, { once: true })
    const mouseToggle = required<HTMLInputElement>(this.#root, '#mouse-input')
    mouseToggle.closest('label')!.toggleAttribute('hidden', this.#mode !== 'play')
    if (this.#mode === 'play') {
      this.#input = new GameplayInput(this.#canvas)
      this.#input.setMouseButtonsEnabled(mouseToggle.checked)
      mouseToggle.onchange = () => this.#input?.setMouseButtonsEnabled(mouseToggle.checked)
    }
  }

  render(positionMS: number, frameTimeStamp = performance.now(), speedMultiplier = 1): void {
    if (this.#root.hidden || this.#renderer === null || this.#session === null) return
    if (positionMS + 5 < this.#lastPositionMS && this.#beatmap !== null) {
      this.#session = new GameplaySession(this.#beatmap, { autoplay: this.#mode === 'watch', speedMultiplier })
      this.#lastPpKey = ''
      this.#livePp = 0
      required<HTMLElement>(this.#root, '#play-results').hidden = true
    }
    this.#session.setSpeedMultiplier(speedMultiplier)
    this.#lastSpeed = speedMultiplier
    this.#lastPositionMS = positionMS
    this.#position.value = `${positionMS.toFixed(3)} ms`
    const input = this.#input?.consume(positionMS, frameTimeStamp, speedMultiplier) ?? emptyInput(this.#lastCursor)
    this.#lastCursor = input.position
    const snapshot = this.#session.update(positionMS, input)
    const ppKey = scoreKey(snapshot.score)
    if (ppKey !== this.#lastPpKey) {
      this.#lastPpKey = ppKey
      this.#livePp = this.#performance?.calculate(snapshot.score).pp ?? 0
    }
    const mods = (this.#beatmap as Partial<ModdedGameplayBeatmap> | null)?.mods
    this.#playHitSounds(snapshot.events)
    this.#renderer.render(positionMS, {
      snapshot,
      cursor: this.#lastCursor,
      pp: this.#performance === null ? undefined : this.#livePp,
      ppUnranked: mods?.Auto === true,
    })
    if (snapshot.failed && !this.#completed) {
      this.#failAnimation ??= new FailAnimation(osuFailTime.getFloat() * 1_000)
      this.#failAnimation.start(frameTimeStamp)
      const progress = this.#failAnimation.progress(frameTimeStamp)
      this.#callbacks.onFailProgress(progress, progress >= 1)
      if (progress >= 1) this.#showRanking(snapshot, true)
    } else if (snapshot.finished) {
      this.#showRanking(snapshot, false)
    }
  }

  setSpeed(speed: number): void {
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('[data-watch-speed]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.watchSpeed) === speed))
    }
  }

  close(): void {
    this.#input?.dispose()
    this.#hitSounds?.close()
    this.#renderer?.dispose()
    this.#input = null
    this.#session = null
    this.#hitSounds = null
    this.#beatmap = null
    this.#performance = null
    this.#lastPpKey = ''
    this.#livePp = 0
    this.#renderer = null
    this.#lastPositionMS = Number.NEGATIVE_INFINITY
    this.#paused = false
    this.#completed = false
    this.#failAnimation = null
    required<HTMLElement>(this.#root, '#play-results').hidden = true
    this.#root.hidden = true
  }

  #showRanking(snapshot: GameplaySnapshot, failed: boolean): void {
    if (this.#completed) return
    this.#completed = true
    const score = snapshot.score
    const mods = (this.#beatmap as Partial<ModdedGameplayBeatmap> | null)?.mods
    const grade = calculateGrade(score, { hidden: mods?.HD === true })
    const ppText = mods?.Auto === true ? 'unranked' : `${this.#livePp.toFixed(2)} pp`
    const modText = mods === undefined ? 'NM' : Object.entries(mods).filter(([, enabled]) => enabled).map(([name]) => name).join('') || 'NM'
    const heading = failed ? 'map failed' : 'ranking'
    const results = required<HTMLElement>(this.#root, '#play-results')
    results.hidden = false
    results.innerHTML = `<p class="eyebrow">${heading}</p><h3>${grade} · ${String(score.score).padStart(8, '0')}</h3><dl><div><dt>300</dt><dd>${score.count300}</dd></div><div><dt>100</dt><dd>${score.count100}</dd></div><div><dt>50</dt><dd>${score.count50}</dd></div><div><dt>miss</dt><dd>${score.countMiss}</dd></div><div><dt>geki</dt><dd>${score.countGeki}</dd></div><div><dt>katu</dt><dd>${score.countKatu}</dd></div><div><dt>max combo</dt><dd>${score.maxCombo}×</dd></div><div><dt>accuracy</dt><dd>${(score.accuracy * 100).toFixed(2)}%</dd></div><div><dt>performance</dt><dd>${ppText}</dd></div><div><dt>mods</dt><dd>${modText}</dd></div><div><dt>mean error</dt><dd>${snapshot.hitErrorMean.toFixed(2)} ms</dd></div><div><dt>unstable rate</dt><dd>${snapshot.unstableRate.toFixed(2)}</dd></div><div><dt>pauses</dt><dd>${snapshot.pauseCount}</dd></div></dl><div class="ranking-actions"><button type="button" data-ranking-action="retry">Retry</button><button type="button" data-ranking-action="back">Back</button></div>`
    required<HTMLButtonElement>(results, '[data-ranking-action="retry"]').onclick = () => this.#retry()
    required<HTMLButtonElement>(results, '[data-ranking-action="back"]').onclick = () => this.#quit()
    this.#callbacks.onComplete({ snapshot, grade, pp: this.#livePp, failed, interactive: this.#mode === 'play' })
  }

  #setPaused(paused: boolean): void {
    if (this.#paused === paused || this.#session === null) return
    this.#paused = paused
    if (paused) this.#session.notePause()
    required<HTMLElement>(this.#root, '#pause-menu').hidden = !paused
    this.#callbacks.onPauseChange(paused)
  }

  #retry(): void {
    if (this.#beatmap === null) return
    this.#paused = false
    this.#completed = false
    this.#failAnimation = null
    this.#session = new GameplaySession(this.#beatmap, { autoplay: this.#mode === 'watch', speedMultiplier: this.#lastSpeed })
    this.#lastPositionMS = Number.NEGATIVE_INFINITY
    this.#lastPpKey = ''
    this.#livePp = 0
    required<HTMLElement>(this.#root, '#pause-menu').hidden = true
    required<HTMLElement>(this.#root, '#play-results').hidden = true
    this.#callbacks.onRetry()
  }

  #quit(): void {
    this.close()
    this.#callbacks.onQuit()
  }

  readonly #resumeAudio = (): void => {
    void this.#hitSounds?.resume()
  }

  #playHitSounds(events: readonly GameplayEvent[]): void {
    if (this.#hitSounds === null || this.#beatmap === null) return
    for (const event of events) {
      if (event.type === 'spinner-rotation') continue
      const object = this.#beatmap.objects[event.objectIndex]
      if (object === undefined) continue
      if (event.type === 'slider-element') {
        if (event.successful && event.element !== 'tick' && object.kind === 'slider') {
          this.#hitSounds.play(object.nodeSamples[event.sampleIndex] ?? object.samples, event.position.x)
        }
        continue
      }
      if (event.result === 'miss') continue
      // Slider totals do not play twice; their head/repeat/tail events own sound.
      if (object.kind !== 'slider') this.#hitSounds.play(object.samples, event.position.x)
    }
  }
}

function scoreKey(score: {
  readonly maxCombo: number
  readonly count300: number
  readonly count100: number
  readonly count50: number
  readonly countMiss: number
}): string {
  return `${score.maxCombo}:${score.count300}:${score.count100}:${score.count50}:${score.countMiss}`
}

function emptyInput(position: { readonly x: number; readonly y: number }): GameplayFrameInput {
  return { position, held: false, clicks: [] }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing playfield element ${selector}`)
  return element
}
