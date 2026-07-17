import { BeatmapClock, BeatmapClockState, InterpolatedClock } from '../audio/InterpolatedClock.ts'
import { MusicPlayer } from '../audio/MusicPlayer.ts'
import type { BeatmapEntry } from '../data/OsuDatabase.ts'
import type { OsuFileSystem } from '../fs/osuFileSystem.ts'

interface JitterSample {
  readonly at: number
  readonly delta: number
}

const JITTER_WINDOW_MS = 2_000
const END_TOLERANCE_MS = 20

export class PlayerPanel {
  readonly #root: HTMLElement
  readonly #title: HTMLHeadingElement
  readonly #status: HTMLParagraphElement
  readonly #playButton: HTMLButtonElement
  readonly #seek: HTMLInputElement
  readonly #elapsed: HTMLOutputElement
  readonly #duration: HTMLOutputElement
  readonly #pitchToggle: HTMLInputElement
  readonly #speedButtons: HTMLButtonElement[]
  readonly #rawReadout: HTMLOutputElement
  readonly #interpolatedReadout: HTMLOutputElement
  readonly #stateReadout: HTMLOutputElement
  readonly #jitterMin: HTMLOutputElement
  readonly #jitterMax: HTMLOutputElement
  readonly #jitterStdDev: HTMLOutputElement
  #player: MusicPlayer | null = null
  #interpolatedClock: InterpolatedClock | null = null
  #beatmapClock: BeatmapClock | null = null
  #animationFrame = 0
  #loadGeneration = 0
  #jitterSamples: JitterSample[] = []
  #lastInterpolatedPosition: number | null = null

  constructor(root: HTMLElement) {
    this.#root = root
    root.innerHTML = `
      <div class="player-heading">
        <div>
          <p class="eyebrow">playback laboratory</p>
          <h2 id="player-title">Select a beatmap</h2>
        </div>
        <p id="player-status" class="player-status" role="status" aria-live="polite">Audio idle</p>
      </div>

      <div class="transport">
        <button id="player-play" class="transport-button" type="button" disabled>Play</button>
        <div class="seek-control">
          <label for="player-seek">Position</label>
          <input id="player-seek" type="range" min="0" max="1" value="0" step="1" disabled>
          <div class="time-scale" aria-live="off">
            <output id="player-elapsed">00:00.000</output>
            <output id="player-duration">00:00.000</output>
          </div>
        </div>
      </div>

      <div class="playback-options">
        <fieldset class="speed-keys" disabled>
          <legend>Rate</legend>
          <button type="button" data-speed="0.75" aria-pressed="false">0.75× <span>HT</span></button>
          <button type="button" data-speed="1" aria-pressed="true">1.00×</button>
          <button type="button" data-speed="1.5" aria-pressed="false">1.50× <span>DT</span></button>
        </fieldset>
        <label class="pitch-switch">
          <input id="pitch-preserved" type="checkbox" checked disabled>
          <span>Preserve pitch</span>
          <small>off ≈ Nightcore · on = DoubleTime</small>
        </label>
      </div>

      <div class="clock-console" aria-label="Gameplay clock diagnostics">
        <div class="clock-channel clock-channel-raw">
          <span>raw audio</span>
          <output id="raw-position">0.000</output>
          <small>milliseconds from HTMLAudioElement</small>
        </div>
        <div class="clock-channel clock-channel-interpolated">
          <span>interpolated</span>
          <output id="interpolated-position">0.000</output>
          <small>McOsu gameplay timeline</small>
        </div>
      </div>

      <div class="jitter-console">
        <p><span>state</span><output id="clock-state">WAITING</output></p>
        <p><span>Δ min</span><output id="jitter-min">—</output></p>
        <p><span>Δ max</span><output id="jitter-max">—</output></p>
        <p><span>Δ σ</span><output id="jitter-stddev">—</output></p>
        <small>rolling 2 s · interpolated frame delta</small>
      </div>
    `

    this.#title = element(root, 'player-title')
    this.#status = element(root, 'player-status')
    this.#playButton = element(root, 'player-play')
    this.#seek = element(root, 'player-seek')
    this.#elapsed = element(root, 'player-elapsed')
    this.#duration = element(root, 'player-duration')
    this.#pitchToggle = element(root, 'pitch-preserved')
    this.#speedButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-speed]'))
    this.#rawReadout = element(root, 'raw-position')
    this.#interpolatedReadout = element(root, 'interpolated-position')
    this.#stateReadout = element(root, 'clock-state')
    this.#jitterMin = element(root, 'jitter-min')
    this.#jitterMax = element(root, 'jitter-max')
    this.#jitterStdDev = element(root, 'jitter-stddev')

    this.#playButton.addEventListener('click', () => void this.#togglePlayback())
    this.#seek.addEventListener('input', () => this.#seekTo(Number(this.#seek.value)))
    this.#pitchToggle.addEventListener('change', () => {
      this.#player?.setPitchPreserved(this.#pitchToggle.checked)
    })
    for (const button of this.#speedButtons) {
      button.addEventListener('click', () => this.#setSpeed(Number(button.dataset.speed)))
    }
  }

  async open(beatmap: BeatmapEntry, fileSystem: OsuFileSystem): Promise<void> {
    const generation = ++this.#loadGeneration
    this.#releasePlayer()
    this.#root.hidden = false
    this.#title.textContent = `${beatmap.artist} — ${beatmap.title} [${beatmap.difficultyName}]`
    this.#setStatus(`Loading ${beatmap.audioFile || 'beatmap audio'}…`)
    this.#setControlsEnabled(false)
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.#root.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })

    try {
      const player = await MusicPlayer.load(fileSystem, beatmap)
      if (generation !== this.#loadGeneration) {
        player.dispose()
        return
      }

      this.#player = player
      this.#interpolatedClock = new InterpolatedClock(player)
      this.#beatmapClock = new BeatmapClock(player, this.#interpolatedClock)
      this.#beatmapClock.startWaiting(0)
      this.#seek.max = String(Math.max(1, Math.round(player.getLengthMS())))
      this.#duration.value = formatTime(player.getLengthMS())
      this.#pitchToggle.checked = true
      this.#setSpeed(1)
      this.#setControlsEnabled(true)
      this.#setStatus('Ready. Press Play to start the clock.')
      this.#resetJitter()
      this.#renderFrame()
    } catch (error) {
      if (generation !== this.#loadGeneration) return
      this.#setStatus(error instanceof Error ? error.message : 'Could not load beatmap audio.', true)
    }
  }

  async #togglePlayback(): Promise<void> {
    const player = this.#player
    const clock = this.#beatmapClock
    if (player === null || clock === null) return

    if (player.isPlaying()) {
      player.pause()
      this.#playButton.textContent = 'Play'
      this.#setStatus('Paused.')
      return
    }

    if (player.getPositionMS() >= player.getLengthMS() - END_TOLERANCE_MS) {
      player.setPositionMS(0)
      this.#interpolatedClock?.markSeek()
    }
    try {
      await player.play()
      clock.startPlaying()
      this.#playButton.textContent = 'Pause'
      this.#setStatus('Playing.')
      this.#resetJitter()
    } catch (error) {
      this.#setStatus(error instanceof Error ? error.message : 'Playback failed.', true)
    }
  }

  #seekTo(positionMS: number): void {
    if (this.#player === null || this.#beatmapClock === null) return
    this.#player.setPositionMS(positionMS)
    this.#beatmapClock.startPlaying()
    this.#playButton.textContent = this.#player.isPlaying() ? 'Pause' : 'Play'
    this.#setStatus(this.#player.isPlaying() ? 'Playing.' : 'Position set. Press Play to continue.')
    this.#resetJitter()
  }

  #setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return
    this.#player?.setSpeed(speed)
    for (const button of this.#speedButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed))
    }
    this.#resetJitter()
  }

  #renderFrame = (): void => {
    cancelAnimationFrame(this.#animationFrame)
    const player = this.#player
    const clock = this.#beatmapClock
    if (player === null || clock === null) return

    const now = performance.now()
    const rawPosition = player.getPositionMS()
    const length = player.getLengthMS()
    if (
      clock.state === BeatmapClockState.PLAYING &&
      !player.isPlaying() &&
      rawPosition >= length - END_TOLERANCE_MS
    ) {
      clock.finish()
      this.#playButton.textContent = 'Replay'
      this.#setStatus('Audio ended; virtual clock continuing past length.')
    }
    const interpolatedPosition = clock.update()

    this.#rawReadout.value = rawPosition.toFixed(3)
    this.#interpolatedReadout.value = interpolatedPosition.toFixed(3)
    this.#stateReadout.value = clock.state
    this.#elapsed.value = formatTime(rawPosition)
    if (document.activeElement !== this.#seek) this.#seek.value = String(Math.round(rawPosition))

    if (player.isPlaying() && this.#lastInterpolatedPosition !== null) {
      this.#jitterSamples.push({ at: now, delta: interpolatedPosition - this.#lastInterpolatedPosition })
      this.#jitterSamples = this.#jitterSamples.filter((sample) => sample.at >= now - JITTER_WINDOW_MS)
      this.#renderJitter()
    }
    this.#lastInterpolatedPosition = player.isPlaying() ? interpolatedPosition : null
    this.#animationFrame = requestAnimationFrame(this.#renderFrame)
  }

  #renderJitter(): void {
    if (this.#jitterSamples.length === 0) return
    const deltas = this.#jitterSamples.map((sample) => sample.delta)
    const minimum = Math.min(...deltas)
    const maximum = Math.max(...deltas)
    const mean = deltas.reduce((total, value) => total + value, 0) / deltas.length
    const variance = deltas.reduce((total, value) => total + (value - mean) ** 2, 0) / deltas.length
    this.#jitterMin.value = `${minimum.toFixed(2)} ms`
    this.#jitterMax.value = `${maximum.toFixed(2)} ms`
    this.#jitterStdDev.value = `${Math.sqrt(variance).toFixed(2)} ms`
  }

  #resetJitter(): void {
    this.#jitterSamples = []
    this.#lastInterpolatedPosition = null
    this.#jitterMin.value = '—'
    this.#jitterMax.value = '—'
    this.#jitterStdDev.value = '—'
  }

  #setControlsEnabled(enabled: boolean): void {
    this.#playButton.disabled = !enabled
    this.#seek.disabled = !enabled
    this.#pitchToggle.disabled = !enabled
    const fieldset = this.#root.querySelector<HTMLFieldSetElement>('.speed-keys')
    if (fieldset !== null) fieldset.disabled = !enabled
  }

  #setStatus(message: string, error = false): void {
    this.#status.textContent = message
    this.#status.dataset.state = error ? 'error' : 'neutral'
  }

  #releasePlayer(): void {
    cancelAnimationFrame(this.#animationFrame)
    this.#animationFrame = 0
    this.#player?.dispose()
    this.#player = null
    this.#interpolatedClock = null
    this.#beatmapClock = null
    this.#playButton.textContent = 'Play'
    this.#seek.value = '0'
    this.#rawReadout.value = '0.000'
    this.#interpolatedReadout.value = '0.000'
    this.#stateReadout.value = BeatmapClockState.WAITING
    this.#resetJitter()
  }
}

function element<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const result = root.querySelector<T>(`#${id}`)
  if (result === null) throw new Error(`Missing player element #${id}`)
  return result
}

function formatTime(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds))
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1_000)
  const millis = safe % 1_000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}
