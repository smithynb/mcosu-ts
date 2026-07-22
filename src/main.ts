import './style.css'

import {
  parseOsuDatabase,
  type BeatmapEntry,
} from './data/OsuDatabase'
import { scanRawSongs } from './data/RawSongsLibrary'
import {
  isFileSystemAccessSupported,
  reconnectOsuFolder,
  selectOsuFolder,
  UNSUPPORTED_BROWSER_MESSAGE,
  type OsuFileSystem,
} from './fs/osuFileSystem'
import { PlayerPanel } from './ui/PlayerPanel'
import { ConsoleOverlay } from './ui/ConsoleOverlay'
import { OptionsOverlay } from './ui/OptionsOverlay'
import { convars } from './core/ConVars'
import { NO_MODS } from './core/Mods'
import { calculateStarRating } from './core/StandardPerformance'
import { StarRatingCache } from './core/StarRatingCache'
import { indexScoresByMd5, parseScoresDatabase, type LocalScore } from './data/ScoresDatabase'
import { readGameplayBeatmapText } from './data/GameplayLoader'
import {
  indexCollectionHashes,
  mergeCollections,
  parseCollectionsDatabase,
  type BeatmapCollection,
} from './data/CollectionsDatabase'

const MAX_RENDERED_ROWS = 400

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <header class="masthead">
      <div class="wordmark" aria-label="mcosu TypeScript">
        <span class="pulse" aria-hidden="true"></span>
        <span>mcosu</span><span class="wordmark-suffix">.ts</span>
      </div>
      <div class="masthead-actions"><p class="phase">options parity / phase 05b+</p><button id="options-button" type="button">Options <kbd>O</kbd></button></div>
    </header>

    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">osu!stable database reader</p>
      <h1 id="page-title">Your beatmaps.<br><span>Still on your disk.</span></h1>
      <p class="lede">Choose the osu! installation folder that contains <code>osu!.db</code> and <code>Songs</code>. Files stay in your browser and are never uploaded.</p>
      <button id="select-folder" class="primary-action" type="button">Select osu! folder</button>
      <p id="status" class="status" role="status" aria-live="polite">Checking for a previously selected folder…</p>
    </section>

    <section id="player-panel" class="player-panel" aria-labelledby="player-title" hidden></section>

    <section id="library" class="library" aria-labelledby="library-title" hidden>
      <div class="library-toolbar">
        <div>
          <p class="eyebrow">indexed locally</p>
          <h2 id="library-title">Song library</h2>
        </div>
        <label class="search-field">
          <span>Filter beatmaps</span>
          <input id="search" type="search" placeholder="Artist, title, difficulty, creator…" autocomplete="off" />
        </label>
        <label class="collection-field">
          <span>Collection</span>
          <select id="collection-filter" disabled><option value="">All beatmaps</option></select>
        </label>
      </div>
      <div class="library-meta">
        <p id="count"></p>
        <p id="render-note"></p>
      </div>
      <div id="song-list" class="song-list" role="list"></div>
    </section>
  </main>
`

const selectButton = requireElement<HTMLButtonElement>('select-folder')
const statusLine = requireElement<HTMLParagraphElement>('status')
const library = requireElement<HTMLElement>('library')
const searchInput = requireElement<HTMLInputElement>('search')
const countLine = requireElement<HTMLParagraphElement>('count')
const renderNote = requireElement<HTMLParagraphElement>('render-note')
const songList = requireElement<HTMLDivElement>('song-list')
const collectionSelect = requireElement<HTMLSelectElement>('collection-filter')
let localScoreIndex: ReadonlyMap<string, readonly LocalScore[]> = new Map()
const playerPanel = new PlayerPanel(requireElement<HTMLElement>('player-panel'), (index) => {
  localScoreIndex = index
  renderLibrary()
})
new ConsoleOverlay(convars)
const optionsOverlay = new OptionsOverlay(convars, () => playerPanel.skinNames())
const optionsButton = requireElement<HTMLButtonElement>('options-button')

let beatmaps: BeatmapEntry[] | null = null
let activeFileSystem: OsuFileSystem | null = null
let starRatingCache: StarRatingCache | null = null
let libraryGeneration = 0
let collectionIndex: ReadonlyMap<string, ReadonlySet<string>> = new Map()

selectButton.addEventListener('click', () => void chooseFolder())
searchInput.addEventListener('input', renderLibrary)
collectionSelect.addEventListener('change', renderLibrary)
optionsButton.addEventListener('click', () => { if (!playerPanel.isGameplayOpen) optionsOverlay.toggle() })
document.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyO' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || playerPanel.isGameplayOpen) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
  event.preventDefault()
  optionsOverlay.toggle()
})

void reconnectOnLoad()

async function reconnectOnLoad(): Promise<void> {
  if (!isFileSystemAccessSupported()) {
    selectButton.disabled = true
    setStatus(UNSUPPORTED_BROWSER_MESSAGE, 'error')
    return
  }

  try {
    const result = await reconnectOsuFolder(false)
    if (result.fileSystem !== null) {
      setStatus(`Reconnected to “${result.fileSystem.root.name}”. Reading osu!.db…`)
      await loadLibrary(result.fileSystem)
      return
    }
    if (result.hasStoredHandle && result.permission === 'prompt') {
      setStatus('Folder remembered. Select it again to restore read permission.')
      return
    }
    if (result.permission === 'denied') {
      setStatus('Folder access was denied. Select the folder to grant access again.', 'error')
      return
    }
    setStatus('Select your osu! installation folder to read its local database.')
  } catch (error) {
    setStatus(messageForError(error), 'error')
  }
}

async function chooseFolder(): Promise<void> {
  selectButton.disabled = true
  setStatus('Waiting for folder access…')
  try {
    const restored = await reconnectOsuFolder(true)
    const fileSystem = restored.fileSystem ?? (await selectOsuFolder())
    setStatus(`Reading osu!.db from “${fileSystem.root.name}”…`)
    await loadLibrary(fileSystem)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      setStatus('No folder selected. Your existing library has not changed.')
    } else {
      setStatus(messageForError(error), 'error')
    }
  } finally {
    selectButton.disabled = false
  }
}

async function loadLibrary(fileSystem: OsuFileSystem): Promise<void> {
  const generation = ++libraryGeneration
  activeFileSystem = fileSystem
  localScoreIndex = new Map()
  collectionIndex = new Map()
  collectionSelect.replaceChildren(optionElement('', 'Loading collections…'))
  collectionSelect.disabled = true
  starRatingCache = new StarRatingCache(async (entry) =>
    calculateStarRating(await readGameplayBeatmapText(fileSystem, entry), NO_MODS),
  )
  playerPanel.setLocalScores(null)
  void loadLocalScores(fileSystem, generation)
  void loadCollections(fileSystem, generation)
  let databaseFailure: string | null = null
  if (await fileSystem.exists('osu!.db')) {
    try {
      const file = await fileSystem.getFile('osu!.db')
      const database = parseOsuDatabase(await file.arrayBuffer())
      publishLibrary(database.beatmaps)
      setStatus(
        `Loaded ${formatNumber(database.beatmaps.length)} osu!standard beatmaps from database version ${database.version}.`,
        'success',
      )
      return
    } catch (error) {
      databaseFailure = messageForError(error)
    }
  } else {
    databaseFailure = 'osu!.db is missing'
  }

  setStatus(`${databaseFailure}. Falling back to a raw Songs scan…`)
  try {
    const result = await scanRawSongs(fileSystem, ({ scannedFolders, totalFolders }) => {
      setStatus(`Scanning ${formatNumber(scannedFolders)}/${formatNumber(totalFolders)} Songs folders…`)
    })
    publishLibrary(result.beatmaps)
    const skipped = result.skippedFolders + result.skippedFiles
    const skipNote = skipped === 0 ? '' : ` Skipped ${formatNumber(skipped)} unreadable items.`
    setStatus(
      `Loaded ${formatNumber(result.beatmaps.length)} osu!standard beatmaps from ${formatNumber(result.folderCount)} Songs folders.${skipNote}`,
      'success',
    )
  } catch (error) {
    beatmaps = null
    library.hidden = true
    throw new Error(`${databaseFailure}. Raw Songs scan also failed: ${messageForError(error)}`)
  }
}

async function loadCollections(fileSystem: OsuFileSystem, generation: number): Promise<void> {
  const groups: BeatmapCollection[][] = []
  const failures: string[] = []
  for (const [path, source] of [['collection.db', 'stable'], ['collections.db', 'mcosu']] as const) {
    try {
      if (!(await fileSystem.exists(path))) continue
      const file = await fileSystem.getFile(path)
      groups.push([...parseCollectionsDatabase(await file.arrayBuffer(), source).collections])
    } catch (error) {
      failures.push(`${path}: ${messageForError(error)}`)
    }
  }
  if (generation !== libraryGeneration) return
  const collections = mergeCollections(groups)
  collectionIndex = indexCollectionHashes(collections)
  collectionSelect.replaceChildren(optionElement('', 'All beatmaps'))
  for (const collection of collections) {
    collectionSelect.append(optionElement(collection.name, `${collection.name} (${formatNumber(collection.hashes.length)})`))
  }
  collectionSelect.disabled = collections.length === 0
  collectionSelect.title = failures.length === 0 ? '' : `Some collections could not be read: ${failures.join('; ')}`
  renderLibrary()
}

async function loadLocalScores(fileSystem: OsuFileSystem, generation: number): Promise<void> {
  try {
    if (!(await fileSystem.exists('scores.db'))) {
      if (generation === libraryGeneration) playerPanel.setLocalScores(new Map(), 'scores.db is missing from the selected folder.')
      return
    }
    const file = await fileSystem.getFile('scores.db')
    const database = parseScoresDatabase(await file.arrayBuffer())
    if (generation !== libraryGeneration) return
    playerPanel.setLocalScores(
      indexScoresByMd5(database.scores),
      `No ${database.format === 'stable' ? 'osu!stable' : 'McOsu'} local scores for this beatmap.`,
    )
  } catch (error) {
    if (generation !== libraryGeneration) return
    const reason = error instanceof Error ? error.message : String(error)
    playerPanel.setLocalScores(new Map(), `Local scores unavailable: ${reason}`)
  }
}

function publishLibrary(entries: BeatmapEntry[]): void {
  beatmaps = entries
  searchInput.value = ''
  collectionSelect.value = ''
  library.hidden = false
  renderLibrary()
}

function renderLibrary(): void {
  if (beatmaps === null) return
  const query = searchInput.value.trim().toLocaleLowerCase()
  const hashes = collectionSelect.value.length === 0 ? null : collectionIndex.get(collectionSelect.value) ?? new Set<string>()
  const inCollection = hashes === null ? beatmaps : beatmaps.filter((entry) => hashes.has(entry.md5.toLowerCase()))
  const matches = query.length === 0
    ? inCollection
    : inCollection.filter((entry) => searchableText(entry).includes(query))
  const visible = matches.slice(0, MAX_RENDERED_ROWS)

  countLine.textContent = query.length === 0 && hashes === null
    ? `${formatNumber(matches.length)} standard beatmaps`
    : `${formatNumber(matches.length)} of ${formatNumber(beatmaps.length)} standard beatmaps`
  renderNote.textContent = matches.length > MAX_RENDERED_ROWS
    ? `Showing the first ${formatNumber(MAX_RENDERED_ROWS)}. Refine the filter to narrow the list.`
    : ''

  songList.replaceChildren(...visible.map(createSongRow))
  if (visible.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'No beatmaps match that filter.'
    songList.append(empty)
  }
}

function createSongRow(entry: BeatmapEntry): HTMLElement {
  const item = document.createElement('div')
  item.setAttribute('role', 'listitem')
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'song-row'
  row.addEventListener('click', () => {
    if (activeFileSystem !== null) void playerPanel.open(entry, activeFileSystem)
  })

  const title = document.createElement('span')
  title.className = 'song-title'
  title.textContent = `${entry.artist} — ${entry.title}`

  const difficulty = document.createElement('span')
  difficulty.className = 'difficulty'
  difficulty.textContent = `[${entry.difficultyName}]`
  title.append(' ', difficulty)

  const creator = document.createElement('span')
  creator.className = 'creator'
  creator.textContent = `mapped by ${entry.creator}`

  const stars = document.createElement('span')
  stars.className = 'stars'
  stars.textContent = entry.starRating === undefined ? '— ★' : `${entry.starRating.toFixed(2)} ★`
  stars.title = entry.starRating === undefined ? 'Calculating no-mod star rating…' : 'osu!.db no-mod rating; recalculating lazily…'

  const copy = document.createElement('span')
  copy.className = 'song-copy'
  copy.append(title, creator)
  const best = entry.md5.length === 0 ? undefined : localScoreIndex.get(entry.md5.toLowerCase())?.[0]
  if (best !== undefined) {
    const badge = document.createElement('span')
    badge.className = 'local-best-grade'
    badge.textContent = best.grade
    badge.title = `Local best: ${formatScore(best.score)} · ${(best.accuracy * 100).toFixed(2)}%`
    copy.append(badge)
  }
  row.append(copy, stars)
  item.append(row)
  const cache = starRatingCache
  if (cache !== null) {
    queueMicrotask(() => {
      if (!item.isConnected || cache !== starRatingCache) return
      void cache.get(entry).then((rating) => {
        if (!item.isConnected || cache !== starRatingCache) return
        stars.textContent = `${rating.toFixed(2)} ★`
        stars.title = 'Calculated lazily with osu-standard-stable (no mods)'
      }).catch((error) => {
        if (!item.isConnected || cache !== starRatingCache) return
        stars.title = `Star calculation failed: ${messageForError(error)}`
      })
    })
  }
  return item
}

function searchableText(entry: BeatmapEntry): string {
  return `${entry.artist}\n${entry.title}\n${entry.difficultyName}\n${entry.creator}`.toLocaleLowerCase()
}

function setStatus(message: string, state: 'neutral' | 'success' | 'error' = 'neutral'): void {
  statusLine.textContent = message
  statusLine.dataset.state = state
}

function messageForError(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'The osu! database could not be read.'
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Missing required element #${id}`)
  return element as T
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatScore(value: bigint): string {
  return new Intl.NumberFormat().format(value)
}

function optionElement(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option')
  option.value = value
  option.textContent = label
  return option
}
