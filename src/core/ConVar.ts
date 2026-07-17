export type ConVarValue = number | boolean | string
export type ConVarKind = 'float' | 'int' | 'bool' | 'string'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type ConVarChangeCallback<T extends ConVarValue> = (
  value: T,
  previous: T,
  variable: ConVar<T>,
) => void

export interface ConVarDefinition<T extends ConVarValue> {
  readonly name: string
  readonly kind: ConVarKind
  readonly defaultValue: T
  readonly description?: string
}

const STORAGE_KEY = 'mcosu-ts.convars.v1'

export class ConVar<T extends ConVarValue = ConVarValue> {
  readonly name: string
  readonly kind: ConVarKind
  readonly defaultValue: T
  readonly description: string
  readonly #registry: ConVarRegistry
  readonly #callbacks = new Set<ConVarChangeCallback<T>>()
  #value: T

  constructor(registry: ConVarRegistry, definition: ConVarDefinition<T>, initialValue?: unknown) {
    this.#registry = registry
    this.name = definition.name
    this.kind = definition.kind
    this.defaultValue = definition.defaultValue
    this.description = definition.description ?? ''
    this.#value = initialValue === undefined ? definition.defaultValue : this.#coerce(initialValue)
  }

  getFloat(): number {
    if (typeof this.#value === 'number') return this.#value
    if (typeof this.#value === 'boolean') return this.#value ? 1 : 0
    const parsed = Number(this.#value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  getInt(): number {
    return Math.trunc(this.getFloat())
  }

  getBool(): boolean {
    if (typeof this.#value === 'boolean') return this.#value
    if (typeof this.#value === 'number') return this.#value !== 0
    return this.#value.length > 0 && this.#value !== '0' && this.#value.toLowerCase() !== 'false'
  }

  getString(): string {
    return String(this.#value)
  }

  get value(): T {
    return this.#value
  }

  get isDefault(): boolean {
    return Object.is(this.#value, this.defaultValue)
  }

  setValue(value: unknown): T {
    const next = this.#coerce(value)
    if (Object.is(next, this.#value)) return this.#value
    const previous = this.#value
    this.#value = next
    this.#registry.persist()
    for (const callback of this.#callbacks) callback(next, previous, this)
    return next
  }

  reset(): void {
    this.setValue(this.defaultValue)
  }

  onChange(callback: ConVarChangeCallback<T>): () => void {
    this.#callbacks.add(callback)
    return () => this.#callbacks.delete(callback)
  }

  #coerce(value: unknown): T {
    if (this.kind === 'string') return String(value) as T
    if (this.kind === 'bool') {
      if (typeof value === 'boolean') return value as T
      if (typeof value === 'number') return (value !== 0) as T
      const normalized = String(value).trim().toLowerCase()
      if (['1', 'true', 'on', 'yes'].includes(normalized)) return true as T
      if (['0', 'false', 'off', 'no'].includes(normalized)) return false as T
      throw new Error(`${this.name} expects a boolean (true/false, on/off, 1/0).`)
    }
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed)) throw new Error(`${this.name} expects a finite number.`)
    return (this.kind === 'int' ? Math.trunc(parsed) : parsed) as T
  }
}

export class ConVarRegistry {
  // Registry storage is intentionally type-erased; registration returns the
  // concrete generic type to callers.
  readonly #variables = new Map<string, ConVar<any>>()
  readonly #storage: StorageLike | null
  readonly #storageKey: string
  readonly #restored: Readonly<Record<string, unknown>>

  constructor(storage: StorageLike | null = browserStorage(), storageKey = STORAGE_KEY) {
    this.#storage = storage
    this.#storageKey = storageKey
    this.#restored = readStored(storage, storageKey)
  }

  register<T extends ConVarValue>(definition: ConVarDefinition<T>): ConVar<T> {
    const name = definition.name.trim()
    if (name.length === 0) throw new Error('ConVar names cannot be empty.')
    if (this.#variables.has(name)) throw new Error(`ConVar ${name} is already registered.`)
    let initial: unknown = this.#restored[name]
    let variable: ConVar<T>
    try {
      variable = new ConVar(this, { ...definition, name }, initial)
    } catch {
      initial = undefined
      variable = new ConVar(this, { ...definition, name })
    }
    this.#variables.set(name, variable)
    return variable
  }

  get(name: string): ConVar | undefined {
    return this.#variables.get(name)
  }

  require(name: string): ConVar {
    const variable = this.get(name)
    if (variable === undefined) throw new Error(`Unknown ConVar: ${name}`)
    return variable
  }

  list(): readonly ConVar[] {
    return [...this.#variables.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  prefix(prefix: string): readonly ConVar[] {
    return this.list().filter((variable) => variable.name.startsWith(prefix))
  }

  find(fragment: string): readonly ConVar[] {
    const query = fragment.toLowerCase()
    return this.list().filter(
      (variable) => variable.name.toLowerCase().includes(query) || variable.description.toLowerCase().includes(query),
    )
  }

  resetAll(): void {
    for (const variable of this.#variables.values()) variable.reset()
  }

  persist(): void {
    if (this.#storage === null) return
    const overrides = Object.fromEntries(
      this.list().filter((variable) => !variable.isDefault).map((variable) => [variable.name, variable.value]),
    )
    try {
      if (Object.keys(overrides).length === 0) this.#storage.removeItem(this.#storageKey)
      else this.#storage.setItem(this.#storageKey, JSON.stringify(overrides))
    } catch {
      // Storage denial/quota must not prevent live configuration.
    }
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readStored(storage: StorageLike | null, key: string): Readonly<Record<string, unknown>> {
  if (storage === null) return {}
  try {
    const raw = storage.getItem(key)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}
