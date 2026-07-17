const DATABASE_NAME = 'mcosu-ts'
const DATABASE_VERSION = 1
const HANDLE_STORE = 'file-system-handles'
const OSU_ROOT_KEY = 'osu-root'

export async function loadStoredRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const value = await runRequest('readonly', (store) => store.get(OSU_ROOT_KEY))
  if (!isDirectoryHandle(value)) return null
  return value
}

export async function storeRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await runRequest('readwrite', (store) => store.put(handle, OSU_ROOT_KEY))
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(HANDLE_STORE)) {
        database.createObjectStore(HANDLE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the folder handle database.'))
    request.onblocked = () => reject(new Error('Folder handle storage is blocked by another tab.'))
  })
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE, mode)
      const request = operation(transaction.objectStore(HANDLE_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not access the stored folder handle.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Folder handle transaction was aborted.'))
    })
  } finally {
    database.close()
  }
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { kind?: unknown; getDirectoryHandle?: unknown }
  return candidate.kind === 'directory' && typeof candidate.getDirectoryHandle === 'function'
}
