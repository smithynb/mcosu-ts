import { BeatmapClock, BeatmapClockState, InterpolatedClock } from '../audio/InterpolatedClock.ts'
import { MusicPlayer } from '../audio/MusicPlayer.ts'
import { HitSoundPlayer } from '../audio/HitSoundPlayer.ts'
import { parseGameplayBeatmap, readGameplayBeatmapText } from '../data/GameplayLoader.ts'
import type { BeatmapEntry } from '../data/OsuDatabase.ts'
import type { LocalScore } from '../data/ScoresDatabase.ts'
import type { OsuFileSystem } from '../fs/osuFileSystem.ts'
import { listSkinNames, loadSkin } from '../skin/Skin.ts'
import { PlayfieldView } from './PlayfieldView.ts'
import {
  applyDifficultyMods,
  modPitchPreserved,
  modSpeed,
  musicPositionWithOffsets,
  NO_MODS,
  scoreMultiplier,
  type GameplayMod,
} from '../core/Mods.ts'
import { createStandardPerformance } from '../core/StandardPerformance.ts'

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
  readonly #skinSelect: HTMLSelectElement
  readonly #watchButton: HTMLButtonElement
  readonly #gameplayButton: HTMLButtonElement
  readonly #modButtons: HTMLButtonElement[]
  readonly #modMultiplier: HTMLOutputElement
  readonly #localScores: HTMLOListElement
  readonly #localScoresStatus: HTMLParagraphElement
  readonly #rawReadout: HTMLOutputElement
  readonly #interpolatedReadout: HTMLOutputElement
  readonly #stateReadout: HTMLOutputElement
  readonly #jitterMin: HTMLOutputElement
  readonly #jitterMax: HTMLOutputElement
  readonly #jitterStdDev: HTMLOutputElement
  readonly #playfieldView: PlayfieldView
  #player: MusicPlayer | null = null
  #interpolatedClock: InterpolatedClock | null = null
  #beatmapClock: BeatmapClock | null = null
  #animationFrame = 0
  #loadGeneration = 0
  #jitterSamples: JitterSample[] = []
  #lastInterpolatedPosition: number | null = null
  #beatmap: BeatmapEntry | null = null
  #fileSystem: OsuFileSystem | null = null
  #speed = 1
  #mods: Record<GameplayMod, boolean> = { ...NO_MODS }
  #scoreIndex: ReadonlyMap<string, readonly LocalScore[]> | null = null
  #scoreStatus = 'Local scores are loading…'

  constructor(root: HTMLElement) {
    this.#root = root
    this.#playfieldView = new PlayfieldView((speed) => this.#setSpeed(speed))
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

      <div class="watch-options">
        <label for="skin-select">
          <span>Skin</span>
          <select id="skin-select" disabled>
            <option value="">Procedural fallback</option>
          </select>
        </label>
        <div class="gameplay-actions">
          <button id="play-beatmap" class="watch-button play-map-button" type="button" disabled>Play</button>
          <button id="watch-beatmap" class="watch-button" type="button" disabled>Watch</button>
        </div>
      </div>

      <fieldset class="mod-select">
        <legend>Gameplay mods</legend>
        <div>${['NF', 'EZ', 'HD', 'HR', 'DT', 'NC', 'HT', 'Auto'].map((mod) => `<button type="button" data-mod="${mod}" aria-pressed="false">${mod}</button>`).join('')}</div>
        <small>score multiplier <output id="mod-multiplier">1.00×</output></small>
      </fieldset>

      <section class="local-scores" aria-labelledby="local-scores-title">
        <div><h3 id="local-scores-title">Top local scores</h3><p id="local-scores-status">Local scores are loading…</p></div>
        <ol id="local-scores-list"></ol>
      </section>

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
    this.#skinSelect = element(root, 'skin-select')
    this.#watchButton = element(root, 'watch-beatmap')
    this.#gameplayButton = element(root, 'play-beatmap')
    this.#modButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-mod]'))
    this.#modMultiplier = element(root, 'mod-multiplier')
    this.#localScores = element(root, 'local-scores-list')
    this.#localScoresStatus = element(root, 'local-scores-status')
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
    this.#watchButton.addEventListener('click', () => void this.#openGameplay('watch'))
    this.#gameplayButton.addEventListener('click', () => void this.#openGameplay('play'))
    for (const button of this.#modButtons) {
      button.addEventListener('click', () => this.#toggleMod(button.dataset.mod as GameplayMod))
    }
  }

  async open(beatmap: BeatmapEntry, fileSystem: OsuFileSystem): Promise<void> {
    const generation = ++this.#loadGeneration
    this.#releasePlayer()
    this.#beatmap = beatmap
    this.#fileSystem = fileSystem
    this.#root.hidden = false
    this.#title.textContent = `${beatmap.artist} — ${beatmap.title} [${beatmap.difficultyName}]`
    this.#renderLocalScores()
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
      void this.#loadSkinChoices(fileSystem, generation)
    } catch (error) {
      if (generation !== this.#loadGeneration) return
      this.#setStatus(error instanceof Error ? error.message : 'Could not load beatmap audio.', true)
    }
  }

  setLocalScores(
    index: ReadonlyMap<string, readonly LocalScore[]> | null,
    status = index === null ? 'Local scores are loading…' : 'No local scores for this beatmap.',
  ): void {
    this.#scoreIndex = index
    this.#scoreStatus = status
    this.#renderLocalScores()
  }

  async #loadSkinChoices(fileSystem: OsuFileSystem, generation: number): Promise<void> {
    const names = await listSkinNames(fileSystem)
    if (generation !== this.#loadGeneration) return
    this.#skinSelect.replaceChildren(option('', 'Procedural fallback'))
    for (const name of names) this.#skinSelect.append(option(name, name))
  }

  async #openGameplay(mode: 'watch' | 'play'): Promise<void> {
    const beatmap = this.#beatmap
    const fileSystem = this.#fileSystem
    if (beatmap === null || fileSystem === null) return

    this.#watchButton.disabled = true
    this.#gameplayButton.disabled = true
    this.#setStatus('Decoding gameplay objects…')
    try {
      const beatmapText = await readGameplayBeatmapText(fileSystem, beatmap)
      const gameplay = applyDifficultyMods(parseGameplayBeatmap(beatmapText), this.#mods)
      const performance = createStandardPerformance(beatmapText, this.#mods)
      const speed = modSpeed(this.#mods)
      this.#pitchToggle.checked = modPitchPreserved(this.#mods)
      this.#player?.setPitchPreserved(this.#pitchToggle.checked)
      this.#setSpeed(speed)
      let skin = null
      const skinName = this.#skinSelect.value
      if (skinName.length > 0) {
        this.#setStatus(`Loading skin “${skinName}”…`)
        try {
          skin = await loadSkin(fileSystem, skinName)
        } catch {
          // Missing or malformed skin elements are intentionally non-fatal.
        }
      }
      this.#setStatus('Preloading gameplay hitsounds…')
      const hitSounds = await HitSoundPlayer.load(fileSystem, beatmap, gameplay, skinName)
      this.#playfieldView.open(
        gameplay,
        skin,
        `${beatmap.artist} — ${beatmap.title} [${beatmap.difficultyName}]`,
        { mode, hitSounds, performance },
      )
      if (mode === 'play' && this.#player !== null && this.#beatmapClock !== null) {
        this.#player.setPositionMS(0)
        this.#beatmapClock.startPlaying()
        await this.#player.play()
        this.#playButton.textContent = 'Pause'
      }
      this.#setStatus(
        skinName.length > 0 && skin === null
          ? `Skin “${skinName}” was unusable; using procedural graphics.`
          : mode === 'play'
            ? 'Playfield live. Use Z/X or mouse buttons.'
            : 'Autoplay ready. Playback controls continue to drive the watch clock.',
      )
    } catch (error) {
      this.#playfieldView.close()
      this.#setStatus(error instanceof Error ? error.message : 'Could not load gameplay objects.', true)
    } finally {
      this.#watchButton.disabled = this.#player === null
      this.#gameplayButton.disabled = this.#player === null
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
    this.#speed = speed
    for (const button of this.#speedButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed))
    }
    this.#playfieldView.setSpeed(speed)
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
    const judgmentPosition = musicPositionWithOffsets(interpolatedPosition, this.#speed, this.#beatmap?.localOffset ?? 0)
    this.#playfieldView.render(judgmentPosition, now, this.#speed)

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
    this.#skinSelect.disabled = !enabled
    this.#watchButton.disabled = !enabled
    this.#gameplayButton.disabled = !enabled
    const fieldset = this.#root.querySelector<HTMLFieldSetElement>('.speed-keys')
    if (fieldset !== null) fieldset.disabled = !enabled
    const mods = this.#root.querySelector<HTMLFieldSetElement>('.mod-select')
    if (mods !== null) mods.disabled = !enabled
  }

  #toggleMod(mod: GameplayMod): void {
    this.#mods[mod] = !this.#mods[mod]
    if (this.#mods[mod]) {
      if (mod === 'EZ') this.#mods.HR = false
      if (mod === 'HR') this.#mods.EZ = false
      if (mod === 'DT' || mod === 'NC' || mod === 'HT') {
        for (const peer of ['DT', 'NC', 'HT'] as const) if (peer !== mod) this.#mods[peer] = false
      }
    }
    for (const button of this.#modButtons) {
      button.setAttribute('aria-pressed', String(this.#mods[button.dataset.mod as GameplayMod]))
    }
    this.#modMultiplier.value = `${scoreMultiplier(this.#mods).toFixed(2)}×`
    const speed = modSpeed(this.#mods)
    this.#pitchToggle.checked = modPitchPreserved(this.#mods)
    this.#player?.setPitchPreserved(this.#pitchToggle.checked)
    this.#setSpeed(speed)
  }

  #renderLocalScores(): void {
    const beatmap = this.#beatmap
    this.#localScores.replaceChildren()
    if (beatmap === null) {
      this.#localScoresStatus.textContent = this.#scoreStatus
      return
    }
    if (beatmap.md5.length === 0) {
      this.#localScoresStatus.textContent = 'Raw-scanned beatmaps have no MD5 for scores.db lookup.'
      return
    }
    if (this.#scoreIndex === null) {
      this.#localScoresStatus.textContent = this.#scoreStatus
      return
    }
    const scores = this.#scoreIndex.get(beatmap.md5.toLowerCase()) ?? []
    if (scores.length === 0) {
      this.#localScoresStatus.textContent = this.#scoreStatus
      return
    }
    this.#localScoresStatus.textContent = `${scores.length} local score${scores.length === 1 ? '' : 's'} · showing top ${Math.min(5, scores.length)}`
    for (const score of scores.slice(0, 5)) {
      const item = document.createElement('li')
      const heading = document.createElement('strong')
      heading.textContent = `${score.grade} · ${formatScore(score.score)}`
      const detail = document.createElement('span')
      const pp = score.pp !== undefined && score.pp > 0 ? ` · ${score.pp.toFixed(2)} pp` : ''
      detail.textContent = `${score.playerName || 'Unknown'} · ${score.maxCombo}× · ${(score.accuracy * 100).toFixed(2)}% · ${score.modAcronyms}${pp}`
      const date = document.createElement('time')
      date.dateTime = score.playedAt.toISOString()
      date.textContent = score.playedAt.toLocaleDateString()
      item.append(heading, detail, date)
      this.#localScores.append(item)
    }
  }

  #setStatus(message: string, error = false): void {
    this.#status.textContent = message
    this.#status.dataset.state = error ? 'error' : 'neutral'
  }

  #releasePlayer(): void {
    cancelAnimationFrame(this.#animationFrame)
    this.#animationFrame = 0
    this.#player?.dispose()
    this.#playfieldView.close()
    this.#player = null
    this.#interpolatedClock = null
    this.#beatmapClock = null
    this.#beatmap = null
    this.#fileSystem = null
    this.#skinSelect.replaceChildren(option('', 'Procedural fallback'))
    this.#playButton.textContent = 'Play'
    this.#seek.value = '0'
    this.#rawReadout.value = '0.000'
    this.#interpolatedReadout.value = '0.000'
    this.#stateReadout.value = BeatmapClockState.WAITING
    this.#resetJitter()
  }
}

function option(value: string, label: string): HTMLOptionElement {
  const result = document.createElement('option')
  result.value = value
  result.textContent = label
  return result
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

function formatScore(score: bigint): string {
  return new Intl.NumberFormat().format(score)
}
