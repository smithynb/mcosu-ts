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

const MAX_RENDERED_ROWS = 400

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <header class="masthead">
      <div class="wordmark" aria-label="mcosu TypeScript">
        <span class="pulse" aria-hidden="true"></span>
        <span>mcosu</span><span class="wordmark-suffix">.ts</span>
      </div>
      <p class="phase">local library / phase 01</p>
    </header>

    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">osu!stable database reader</p>
      <h1 id="page-title">Your beatmaps.<br><span>Still on your disk.</span></h1>
      <p class="lede">Choose the osu! installation folder that contains <code>osu!.db</code> and <code>Songs</code>. Files stay in your browser and are never uploaded.</p>
      <button id="select-folder" class="primary-action" type="button">Select osu! folder</button>
      <p id="status" class="status" role="status" aria-live="polite">Checking for a previously selected folder…</p>
    </section>

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

let beatmaps: BeatmapEntry[] | null = null

selectButton.addEventListener('click', () => void chooseFolder())
searchInput.addEventListener('input', renderLibrary)

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

function publishLibrary(entries: BeatmapEntry[]): void {
  beatmaps = entries
  searchInput.value = ''
  library.hidden = false
  renderLibrary()
}

function renderLibrary(): void {
  if (beatmaps === null) return
  const query = searchInput.value.trim().toLocaleLowerCase()
  const matches = query.length === 0
    ? beatmaps
    : beatmaps.filter((entry) => searchableText(entry).includes(query))
  const visible = matches.slice(0, MAX_RENDERED_ROWS)

  countLine.textContent = query.length === 0
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
  const row = document.createElement('article')
  row.className = 'song-row'
  row.setAttribute('role', 'listitem')

  const title = document.createElement('p')
  title.className = 'song-title'
  title.textContent = `${entry.artist} — ${entry.title}`

  const difficulty = document.createElement('span')
  difficulty.className = 'difficulty'
  difficulty.textContent = `[${entry.difficultyName}]`
  title.append(' ', difficulty)

  const creator = document.createElement('p')
  creator.className = 'creator'
  creator.textContent = `mapped by ${entry.creator}`

  const stars = document.createElement('p')
  stars.className = 'stars'
  stars.textContent = entry.starRating === undefined ? '— ★' : `${entry.starRating.toFixed(2)} ★`
  stars.title = entry.starRating === undefined ? 'No no-mod star rating in osu!.db' : 'No-mod star rating'

  const copy = document.createElement('div')
  copy.className = 'song-copy'
  copy.append(title, creator)
  row.append(copy, stars)
  return row
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
