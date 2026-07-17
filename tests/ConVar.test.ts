import assert from 'node:assert/strict'
import test from 'node:test'
import { ConVarRegistry, type StorageLike } from '../src/core/ConVar.ts'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

test('typed ConVars coerce, callback, reset, list, and prefix-search', () => {
  const registry = new ConVarRegistry(null)
  const speed = registry.register({ name: 'osu_speed', kind: 'float', defaultValue: 1, description: 'speed' })
  const enabled = registry.register({ name: 'osu_enabled', kind: 'bool', defaultValue: true })
  const changes: Array<[number, number]> = []
  speed.onChange((value, previous) => changes.push([value, previous]))
  assert.equal(speed.setValue('1.5'), 1.5)
  assert.equal(speed.getFloat(), 1.5)
  assert.equal(enabled.setValue('off'), false)
  assert.equal(enabled.getInt(), 0)
  assert.deepEqual(registry.prefix('osu_').map((item) => item.name), ['osu_enabled', 'osu_speed'])
  assert.deepEqual(registry.find('speed').map((item) => item.name), ['osu_speed'])
  speed.reset()
  assert.deepEqual(changes, [[1.5, 1], [1, 1.5]])
  assert.throws(() => enabled.setValue('maybe'), /expects a boolean/)
})

test('only non-default values persist and restore at registration time', () => {
  const storage = new MemoryStorage()
  const first = new ConVarRegistry(storage, 'test')
  first.register({ name: 'osu_int', kind: 'int', defaultValue: 2 }).setValue('7.9')
  first.register({ name: 'osu_text', kind: 'string', defaultValue: 'a' }).setValue('b')
  assert.equal(storage.getItem('test'), '{"osu_int":7,"osu_text":"b"}')

  const restored = new ConVarRegistry(storage, 'test')
  const integer = restored.register({ name: 'osu_int', kind: 'int', defaultValue: 2 })
  const text = restored.register({ name: 'osu_text', kind: 'string', defaultValue: 'a' })
  assert.equal(integer.getInt(), 7)
  assert.equal(text.getString(), 'b')
  integer.reset()
  text.reset()
  assert.equal(storage.getItem('test'), null)
})
