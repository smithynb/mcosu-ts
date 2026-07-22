import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { defaultHitSoundPath } from '../src/audio/HitSoundPlayer.ts'

const names = ['normal', 'whistle', 'finish', 'clap'] as const

test('generated default hitsounds are small valid mono PCM WAV files with signal', async () => {
  for (const name of names) {
    const data = await readFile(`public/default-hitsounds/normal-hit${name}.wav`)
    assert.equal(data.toString('ascii', 0, 4), 'RIFF')
    assert.equal(data.toString('ascii', 8, 12), 'WAVE')
    assert.equal(data.readUInt16LE(20), 1)
    assert.equal(data.readUInt16LE(22), 1)
    assert.equal(data.readUInt32LE(24), 22_050)
    assert.equal(data.readUInt16LE(34), 16)
    assert.ok(data.length > 1_000 && data.length < 10_000)
    assert.ok(data.subarray(44).some((byte) => byte !== 0))
    assert.equal(defaultHitSoundPath(name), `/default-hitsounds/normal-hit${name}.wav`)
  }
})

test('default hitsound generation is deterministic', async () => {
  const before = await hashes()
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolve, reject) => execFile(process.execPath, ['scripts/generate-default-hitsounds.mjs'], (error) => error ? reject(error) : resolve()))
  assert.deepEqual(await hashes(), before)
})

async function hashes(): Promise<string[]> {
  return Promise.all(names.map(async (name) => createHash('sha256')
    .update(await readFile(`public/default-hitsounds/normal-hit${name}.wav`)).digest('hex')))
}
