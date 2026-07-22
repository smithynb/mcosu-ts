export type FileSystemPermissionMode = 'read' | 'readwrite'
export type FileSystemPermissionState = 'granted' | 'denied' | 'prompt'

export interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode
}

declare global {
  interface FileSystemHandle {
    queryPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<FileSystemPermissionState>
    requestPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<FileSystemPermissionState>
  }

  interface Window {
    showDirectoryPicker(options?: { mode?: FileSystemPermissionMode }): Promise<FileSystemDirectoryHandle>
    __TAURI_INTERNALS__?: unknown
  }
}

export interface DirectoryEntry {
  readonly name: string
  readonly kind: 'file' | 'directory'
}

export interface OsuFileSystem {
  readonly root: { readonly name: string }
  getFile(path: string): Promise<File>
  listDir(path?: string): Promise<DirectoryEntry[]>
  exists(path: string): Promise<boolean>
}

export interface ReconnectResult {
  readonly fileSystem: OsuFileSystem | null
  readonly hasStoredHandle: boolean
  readonly permission: FileSystemPermissionState | 'unsupported' | 'missing'
}

export {}
