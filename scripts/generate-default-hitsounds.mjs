import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'public/default-hitsounds')
const sampleRate = 22_050

await mkdir(output, { recursive: true })

const sounds = {
  'normal-hitnormal.wav': synth(0.055, (time, progress) =>
    Math.sin(2 * Math.PI * (780 - 300 * progress) * time) * Math.exp(-progress * 6)),
  'normal-hitwhistle.wav': synth(0.11, (time, progress) =>
    Math.sin(2 * Math.PI * (1_150 + 900 * progress) * time) * Math.sin(Math.PI * progress) * 0.72),
  'normal-hitfinish.wav': synth(0.16, (time, progress) =>
    (Math.sin(2 * Math.PI * 170 * time) + Math.sin(2 * Math.PI * 255 * time) * 0.65) * Math.exp(-progress * 4) * 0.62),
  'normal-hitclap.wav': synth(0.08, (_time, progress, index) =>
    deterministicNoise(index) * Math.exp(-progress * 8) * 0.82),
}

for (const [filename, samples] of Object.entries(sounds)) {
  await writeFile(resolve(output, filename), wav(samples))
}

function synth(durationSeconds, sample) {
  const length = Math.round(durationSeconds * sampleRate)
  return Int16Array.from({ length }, (_, index) => {
    const progress = index / Math.max(1, length - 1)
    const value = Math.max(-1, Math.min(1, sample(index / sampleRate, progress, index)))
    return Math.round(value * 24_000)
  })
}

function deterministicNoise(index) {
  let value = (index + 1) * 1_664_525 + 1_013_904_223
  value = Math.imul(value ^ (value >>> 16), 2_246_822_519)
  return ((value >>> 0) / 0xffff_ffff) * 2 - 1
}

function wav(samples) {
  const dataLength = samples.length * 2
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  for (let index = 0; index < samples.length; index += 1) buffer.writeInt16LE(samples[index], 44 + index * 2)
  return buffer
}
