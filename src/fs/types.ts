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
  }
}

export interface DirectoryEntry {
  readonly name: string
  readonly kind: FileSystemHandle['kind']
}

export interface ReconnectResult {
  readonly fileSystem: import('./osuFileSystem').OsuFileSystem | null
  readonly hasStoredHandle: boolean
  readonly permission: FileSystemPermissionState | 'unsupported' | 'missing'
}

export {}
