import type { GameplayBeatmap } from '../data/GameplayLoader.ts'
import { CanvasPlayfield, type PlayfieldRenderer } from '../render/Playfield.ts'
import type { LoadedSkin } from '../skin/Skin.ts'

export class PlayfieldView {
  readonly #root: HTMLDivElement
  readonly #canvas: HTMLCanvasElement
  readonly #position: HTMLOutputElement
  #renderer: PlayfieldRenderer | null = null

  constructor(onSpeedChange: (speed: number) => void) {
    this.#root = document.createElement('div')
    this.#root.className = 'playfield-overlay'
    this.#root.hidden = true
    this.#root.innerHTML = `
      <header class="playfield-toolbar">
        <div>
          <p class="eyebrow">passive standard playfield</p>
          <h2 id="watch-title">Beatmap watch</h2>
        </div>
        <div class="playfield-toolbar-actions">
          <div class="watch-speed" aria-label="Playback rate">
            <button type="button" data-watch-speed="0.75">0.75×</button>
            <button type="button" data-watch-speed="1" aria-pressed="true">1.00×</button>
            <button type="button" data-watch-speed="1.5">1.50×</button>
          </div>
          <output id="watch-position">0.000 ms</output>
          <button id="watch-close" type="button">Close</button>
        </div>
      </header>
      <div class="playfield-letterbox">
        <canvas class="slider-body-layer" aria-hidden="true"></canvas>
        <canvas class="playfield-sprite-layer" aria-label="Passive osu! playfield"></canvas>
      </div>
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

  open(beatmap: GameplayBeatmap, skin: LoadedSkin | null, title: string): void {
    this.close()
    required<HTMLHeadingElement>(this.#root, '#watch-title').textContent = title
    this.#root.hidden = false
    const sliderCanvas = required<HTMLCanvasElement>(this.#root, '.slider-body-layer')
    this.#renderer = new CanvasPlayfield(this.#canvas, sliderCanvas, beatmap, skin)
  }

  render(positionMS: number): void {
    if (this.#root.hidden || this.#renderer === null) return
    this.#position.value = `${positionMS.toFixed(3)} ms`
    this.#renderer.render(positionMS)
  }

  setSpeed(speed: number): void {
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('[data-watch-speed]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.watchSpeed) === speed))
    }
  }

  close(): void {
    this.#renderer?.dispose()
    this.#renderer = null
    this.#root.hidden = true
  }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing playfield element ${selector}`)
  return element
}
