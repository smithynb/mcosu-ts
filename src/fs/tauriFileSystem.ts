import { normalizeRelativePath } from './paths.ts'
import type { DirectoryEntry, OsuFileSystem, ReconnectResult } from './types.ts'

export interface NativeRoot {
  readonly path: string
  readonly name: string
}

export type NativeInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
export type DirectoryPicker = () => Promise<string | null>

export class TauriOsuFileSystem implements OsuFileSystem {
  readonly root: NativeRoot
  readonly #invoke: NativeInvoker

  constructor(root: NativeRoot, invoke: NativeInvoker) {
    this.root = root
    this.#invoke = invoke
  }

  async getFile(path: string): Promise<File> {
    const relative = requireFilePath(path)
    const bytes = await this.#invoke<number[]>('read_file', { path: relative })
    return new File([Uint8Array.from(bytes)], relative.split('/').at(-1)!, { type: '' })
  }

  async listDir(path = ''): Promise<DirectoryEntry[]> {
    const entries = await this.#invoke<DirectoryEntry[]>('list_dir', { path: normalizeRelativePath(path) })
    if (!Array.isArray(entries) || entries.some((entry) =>
      typeof entry?.name !== 'string' || (entry.kind !== 'file' && entry.kind !== 'directory'))) {
      throw new Error('Native filesystem returned an invalid directory listing.')
    }
    return [...entries].sort((left, right) => left.name.localeCompare(right.name))
  }

  exists(path: string): Promise<boolean> {
    return this.#invoke<boolean>('path_exists', { path: normalizeRelativePath(path) })
  }
}

export async function selectTauriOsuFolder(
  pickDirectory: DirectoryPicker = defaultDirectoryPicker,
  invoke: NativeInvoker = defaultInvoker,
): Promise<OsuFileSystem> {
  const selected = await pickDirectory()
  if (selected === null) throw abortError()
  const root = await invoke<NativeRoot>('set_root', { path: selected })
  return new TauriOsuFileSystem(root, invoke)
}

export async function reconnectTauriOsuFolder(
  invoke: NativeInvoker = defaultInvoker,
): Promise<ReconnectResult> {
  const root = await invoke<NativeRoot | null>('get_root')
  return root === null
    ? { fileSystem: null, hasStoredHandle: false, permission: 'missing' }
    : { fileSystem: new TauriOsuFileSystem(root, invoke), hasStoredHandle: true, permission: 'granted' }
}

async function defaultDirectoryPicker(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, multiple: false, recursive: true, title: 'Select osu! folder' })
  return typeof selected === 'string' ? selected : null
}

async function defaultInvoker<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

function requireFilePath(path: string): string {
  const relative = normalizeRelativePath(path)
  if (relative.length === 0) throw new Error('A file path is required.')
  return relative
}

function abortError(): Error {
  const error = new Error('No folder selected.')
  error.name = 'AbortError'
  return error
}
