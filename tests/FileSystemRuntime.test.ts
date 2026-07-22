import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRelativePath, relativePathSegments } from '../src/fs/paths.ts'
import { hasTauriInternals } from '../src/fs/runtimeFileSystem.ts'
import {
  reconnectTauriOsuFolder,
  selectTauriOsuFolder,
  TauriOsuFileSystem,
  type NativeInvoker,
} from '../src/fs/tauriFileSystem.ts'

test('filesystem paths normalize separators while retaining a valid empty root', () => {
  assert.equal(normalizeRelativePath('Songs\\123 Map//audio.mp3'), 'Songs/123 Map/audio.mp3')
  assert.equal(normalizeRelativePath(''), '')
  assert.deepEqual(relativePathSegments('Skins/default'), ['Skins', 'default'])
})

test('Tauri support detection is pure and does not require browser directory APIs', () => {
  assert.equal(hasTauriInternals({ __TAURI_INTERNALS__: {} }), true)
  assert.equal(hasTauriInternals({ showDirectoryPicker: undefined }), false)
  assert.equal(hasTauriInternals(null), false)
})

test('Tauri adapter maps relative operations to root-confined native commands', async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = []
  const invoke: NativeInvoker = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push([command, args])
    if (command === 'read_file') return [1, 2, 3] as T
    if (command === 'list_dir') return [
      { name: 'z.osu', kind: 'file' },
      { name: 'A Folder', kind: 'directory' },
    ] as T
    if (command === 'path_exists') return true as T
    throw new Error(`Unexpected command ${command}`)
  }
  const fileSystem = new TauriOsuFileSystem({ path: '/games/osu', name: 'osu' }, invoke)
  const file = await fileSystem.getFile('Songs\\map.osu')
  assert.equal(file.name, 'map.osu')
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3])
  assert.deepEqual(await fileSystem.listDir('Songs'), [
    { name: 'A Folder', kind: 'directory' },
    { name: 'z.osu', kind: 'file' },
  ])
  assert.equal(await fileSystem.exists('osu!.db'), true)
  assert.deepEqual(calls, [
    ['read_file', { path: 'Songs/map.osu' }],
    ['list_dir', { path: 'Songs' }],
    ['path_exists', { path: 'osu!.db' }],
  ])
})

test('Tauri selection persists through set_root and cancellation is AbortError', async () => {
  const invoke: NativeInvoker = async <T>(command: string, args?: Record<string, unknown>) => {
    assert.equal(command, 'set_root')
    assert.deepEqual(args, { path: '/games/osu!' })
    return { path: '/games/osu!', name: 'osu!' } as T
  }
  const selected = await selectTauriOsuFolder(async () => '/games/osu!', invoke)
  assert.equal(selected.root.name, 'osu!')
  await assert.rejects(() => selectTauriOsuFolder(async () => null, invoke), (error: Error) => error.name === 'AbortError')
})

test('Tauri reconnect distinguishes persisted and missing roots', async () => {
  const found = await reconnectTauriOsuFolder(async <T>() => ({ path: '/games/osu', name: 'osu' }) as T)
  assert.equal(found.permission, 'granted')
  assert.equal(found.fileSystem?.root.name, 'osu')
  const missing = await reconnectTauriOsuFolder(async <T>() => null as T)
  assert.deepEqual(missing, { fileSystem: null, hasStoredHandle: false, permission: 'missing' })
})

test('filesystem paths reject traversal and native absolute forms', () => {
  for (const path of ['.', '..', 'Songs/../secret', '/etc/passwd', '\\etc\\passwd', 'C:\\osu!\\osu!.db']) {
    assert.throws(() => normalizeRelativePath(path), /stay inside/)
  }
})
