import type { HitSoundPlayer } from '../audio/HitSoundPlayer.ts'
import { GameplaySession, type GameplayEvent, type GameplayFrameInput } from '../core/GameplaySession.ts'
import type { GameplayBeatmap } from '../data/GameplayLoader.ts'
import { GameplayInput } from '../input/GameplayInput.ts'
import { CanvasPlayfield, type PlayfieldRenderer } from '../render/Playfield.ts'
import type { LoadedSkin } from '../skin/Skin.ts'

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
  #lastPositionMS = Number.NEGATIVE_INFINITY

  constructor(onSpeedChange: (speed: number) => void) {
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
    `
    this.#canvas = required<HTMLCanvasElement>(this.#root, '.playfield-sprite-layer')
    this.#position = required<HTMLOutputElement>(this.#root, '#watch-position')
    required<HTMLButtonElement>(this.#root, '#watch-close').addEventListener('click', () => this.close())
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('[data-watch-speed]')) {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.watchSpeed)
        if (!Number.isFinite(speed)) return
        onSpeedChange(speed)
        for (const peer of this.#root.querySelectorAll<HTMLButtonElement>('[data-watch-speed]')) {
          peer.setAttribute('aria-pressed', String(Number(peer.dataset.watchSpeed) === speed))
        }
      })
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.#root.hidden) this.close()
    })
    document.body.append(this.#root)
  }

  open(
    beatmap: GameplayBeatmap,
    skin: LoadedSkin | null,
    title: string,
    options: { mode?: 'watch' | 'play'; hitSounds?: HitSoundPlayer | null } = {},
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
    this.#session = new GameplaySession(beatmap, { autoplay: this.#mode === 'watch' })
    this.#lastPositionMS = Number.NEGATIVE_INFINITY
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
      required<HTMLElement>(this.#root, '#play-results').hidden = true
    }
    this.#session.setSpeedMultiplier(speedMultiplier)
    this.#lastPositionMS = positionMS
    this.#position.value = `${positionMS.toFixed(3)} ms`
    const input = this.#input?.consume(positionMS, frameTimeStamp, speedMultiplier) ?? emptyInput(this.#lastCursor)
    this.#lastCursor = input.position
    const snapshot = this.#session.update(positionMS, input)
    this.#playHitSounds(snapshot.events)
    this.#renderer.render(positionMS, { snapshot, cursor: this.#lastCursor })
    const results = required<HTMLElement>(this.#root, '#play-results')
    if (snapshot.finished) {
      const score = snapshot.score
      results.hidden = false
      results.innerHTML = `<p class="eyebrow">results</p><h3>${String(score.score).padStart(8, '0')}</h3><dl><div><dt>300</dt><dd>${score.count300}</dd></div><div><dt>100</dt><dd>${score.count100}</dd></div><div><dt>50</dt><dd>${score.count50}</dd></div><div><dt>miss</dt><dd>${score.countMiss}</dd></div><div><dt>max combo</dt><dd>${score.maxCombo}×</dd></div><div><dt>accuracy</dt><dd>${(score.accuracy * 100).toFixed(2)}%</dd></div></dl>`
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
    this.#renderer = null
    this.#lastPositionMS = Number.NEGATIVE_INFINITY
    required<HTMLElement>(this.#root, '#play-results').hidden = true
    this.#root.hidden = true
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

function emptyInput(position: { readonly x: number; readonly y: number }): GameplayFrameInput {
  return { position, held: false, clicks: [] }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing playfield element ${selector}`)
  return element
}
