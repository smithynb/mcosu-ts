import {
  isFileSystemAccessSupported,
  reconnectBrowserOsuFolder,
  selectBrowserOsuFolder,
  UNSUPPORTED_BROWSER_MESSAGE,
} from './osuFileSystem.ts'
import type { OsuFileSystem, ReconnectResult } from './types.ts'

export { UNSUPPORTED_BROWSER_MESSAGE }
export type { OsuFileSystem }

export function hasTauriInternals(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '__TAURI_INTERNALS__' in value
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && hasTauriInternals(window)
}

export function isOsuFileSystemSupported(): boolean {
  return isTauriRuntime() || isFileSystemAccessSupported()
}

export async function selectOsuFolder(): Promise<OsuFileSystem> {
  if (!isTauriRuntime()) return selectBrowserOsuFolder()
  const { selectTauriOsuFolder } = await import('./tauriFileSystem.ts')
  return selectTauriOsuFolder()
}

export async function reconnectOsuFolder(requestPermission = false): Promise<ReconnectResult> {
  if (!isTauriRuntime()) return reconnectBrowserOsuFolder(requestPermission)
  const { reconnectTauriOsuFolder } = await import('./tauriFileSystem.ts')
  return reconnectTauriOsuFolder()
}
