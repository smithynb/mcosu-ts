import { loadStoredRootHandle, storeRootHandle } from './idb'
import type { DirectoryEntry, ReconnectResult } from './types'

const READ_PERMISSION = { mode: 'read' } as const

export const UNSUPPORTED_BROWSER_MESSAGE =
  'Local folder access requires a Chromium-based browser such as Chrome, Edge, or Brave. Open this page there to select your osu! folder.'

export function isFileSystemAccessSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined'
}

export class OsuFileSystem {
  constructor(readonly root: FileSystemDirectoryHandle) {}

  async getFile(path: string): Promise<File> {
    const segments = parsePath(path)
    if (segments.length === 0) throw new Error('A file path is required.')
    const fileName = segments.pop()
    if (fileName === undefined) throw new Error('A file path is required.')
    const directory = await this.#resolveDirectory(segments)
    const handle = await directory.getFileHandle(fileName)
    return handle.getFile()
  }

  async listDir(path = ''): Promise<DirectoryEntry[]> {
    const directory = await this.#resolveDirectory(parsePath(path))
    const entries: DirectoryEntry[] = []
    for await (const handle of directory.values()) {
      entries.push({ name: handle.name, kind: handle.kind })
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name))
  }

  async exists(path: string): Promise<boolean> {
    const segments = parsePath(path)
    if (segments.length === 0) return true
    const name = segments.pop()
    if (name === undefined) return true

    try {
      const directory = await this.#resolveDirectory(segments)
      try {
        await directory.getFileHandle(name)
        return true
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      try {
        await directory.getDirectoryHandle(name)
        return true
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      return false
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async #resolveDirectory(segments: readonly string[]): Promise<FileSystemDirectoryHandle> {
    let directory = this.root
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment)
    }
    return directory
  }
}

export async function selectOsuFolder(): Promise<OsuFileSystem> {
  assertSupported()
  const handle = await window.showDirectoryPicker({ mode: 'read' })
  await storeRootHandle(handle)
  return new OsuFileSystem(handle)
}

/**
 * Restore the structured-cloned directory handle from IndexedDB. Browsers may
 * downgrade persisted permissions between visits, so callers should first try
 * without a prompt and retry with `requestPermission: true` from a click.
 */
export async function reconnectOsuFolder(requestPermission = false): Promise<ReconnectResult> {
  if (!isFileSystemAccessSupported()) {
    return { fileSystem: null, hasStoredHandle: false, permission: 'unsupported' }
  }

  const handle = await loadStoredRootHandle()
  if (handle === null) {
    return { fileSystem: null, hasStoredHandle: false, permission: 'missing' }
  }

  let permission = await handle.queryPermission(READ_PERMISSION)
  if (permission === 'prompt' && requestPermission) {
    permission = await handle.requestPermission(READ_PERMISSION)
  }

  return {
    fileSystem: permission === 'granted' ? new OsuFileSystem(handle) : null,
    hasStoredHandle: true,
    permission,
  }
}

function assertSupported(): void {
  if (!isFileSystemAccessSupported()) throw new Error(UNSUPPORTED_BROWSER_MESSAGE)
}

function parsePath(path: string): string[] {
  const normalized = path.replaceAll('\\', '/')
  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Paths must stay inside the selected osu! folder.')
  }
  return segments
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}
