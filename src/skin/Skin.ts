import type { OsuFileSystem } from '../fs/osuFileSystem.ts'

export const DEFAULT_COMBO_COLORS = ['#ffc000', '#00ca00', '#127cff', '#f21839'] as const
const MAX_ANIMATION_FRAMES = 512

export interface SkinConfig {
  readonly comboColors: readonly string[]
  readonly animationFramerate: number
  readonly sliderBorderColor: string
  readonly sliderTrackOverride?: string
}

export interface SkinFrame {
  readonly image: HTMLImageElement
  /** OsuSkinImage::loadImage uses 2.0 for @2x and 1.0 otherwise. */
  readonly sourceScale: 1 | 2
  readonly filename: string
}

export interface SkinImage {
  readonly frames: readonly SkinFrame[]
}

export interface LoadedSkin {
  readonly name: string
  readonly config: SkinConfig
  readonly hitcircle?: SkinImage
  readonly hitcircleoverlay?: SkinImage
  readonly approachcircle?: SkinImage
  readonly numbers: readonly (SkinImage | undefined)[]
  readonly scoreNumbers: readonly (SkinImage | undefined)[]
  readonly cursor?: SkinImage
  readonly hit300?: SkinImage
  readonly hit100?: SkinImage
  readonly hit50?: SkinImage
  readonly hit0?: SkinImage
  readonly sliderStartCircle?: SkinImage
  readonly sliderStartCircleOverlay?: SkinImage
  readonly sliderEndCircle?: SkinImage
  readonly sliderEndCircleOverlay?: SkinImage
  readonly reverseArrow?: SkinImage
  readonly sliderBall?: SkinImage
  readonly sliderFollowCircle?: SkinImage
  readonly sliderScorePoint?: SkinImage
  frame(image: SkinImage | undefined, timeMS: number): SkinFrame | undefined
  dispose(): void
}

export function parseSkinIni(text: string): SkinConfig {
  const comboColors: Array<{ index: number; color: string }> = []
  let section = ''
  let animationFramerate = 0
  let sliderBorderColor = '#ffffff'
  let sliderTrackOverride: string | undefined

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('//') || line.startsWith(';')) continue
    const sectionMatch = /^\[([^\]]+)]$/.exec(line)
    if (sectionMatch !== null) {
      section = sectionMatch[1]!.toLowerCase()
      continue
    }

    if (section === 'general') {
      const frameRateMatch = /^AnimationFramerate\s*:\s*(-?[\d.]+)/i.exec(line)
      if (frameRateMatch !== null) {
        const parsed = Number(frameRateMatch[1])
        animationFramerate = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
      }
    }

    if (section === 'colours' || section === 'colors') {
      const comboMatch = /^Combo\s*(\d+)\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(line)
      if (comboMatch !== null) {
        const channels = comboMatch.slice(2, 5).map((value) => clampByte(Number(value)))
        comboColors.push({
          index: Number(comboMatch[1]),
          color: toHex(channels[0]!, channels[1]!, channels[2]!),
        })
      }
      const sliderBorderMatch = /^SliderBorder\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(line)
      if (sliderBorderMatch !== null) sliderBorderColor = colorFromMatch(sliderBorderMatch)
      const sliderTrackMatch = /^SliderTrackOverride\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(line)
      if (sliderTrackMatch !== null) sliderTrackOverride = colorFromMatch(sliderTrackMatch)
    }
  }

  comboColors.sort((left, right) => left.index - right.index)
  return {
    comboColors: comboColors.length > 0 ? comboColors.map(({ color }) => color) : DEFAULT_COMBO_COLORS,
    animationFramerate,
    sliderBorderColor,
    sliderTrackOverride,
  }
}

export async function listSkinNames(fileSystem: Pick<OsuFileSystem, 'listDir'>): Promise<string[]> {
  try {
    return (await fileSystem.listDir('Skins'))
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

export async function loadSkin(
  fileSystem: Pick<OsuFileSystem, 'getFile' | 'listDir'>,
  name: string,
): Promise<LoadedSkin> {
  const folder = `Skins/${name}`
  const entries = await fileSystem.listDir(folder)
  const files = new Map(
    entries.filter((entry) => entry.kind === 'file').map((entry) => [entry.name.toLowerCase(), entry.name]),
  )
  const objectUrls: string[] = []
  let config: SkinConfig = {
    comboColors: DEFAULT_COMBO_COLORS,
    animationFramerate: 0,
    sliderBorderColor: '#ffffff',
  }
  const iniName = files.get('skin.ini')
  if (iniName !== undefined) {
    try {
      config = parseSkinIni(await (await fileSystem.getFile(`${folder}/${iniName}`)).text())
    } catch {
      // A broken skin.ini must not prevent procedural rendering or usable images.
    }
  }

  const loadImage = (baseName: string) => loadSkinImage(fileSystem, folder, files, baseName, objectUrls)
  const [
    hitcircle,
    hitcircleoverlay,
    approachcircle,
    cursor,
    sliderStartCircle,
    sliderStartCircleOverlay,
    sliderEndCircle,
    sliderEndCircleOverlay,
    reverseArrow,
    sliderBall,
    sliderFollowCircle,
    sliderScorePoint,
    hit300,
    hit100,
    hit50,
    hit0,
    ...numbers
  ] = await Promise.all([
    loadImage('hitcircle'),
    loadImage('hitcircleoverlay'),
    loadImage('approachcircle'),
    loadImage('cursor'),
    loadImage('sliderstartcircle'),
    loadImage('sliderstartcircleoverlay'),
    loadImage('sliderendcircle'),
    loadImage('sliderendcircleoverlay'),
    loadImage('reversearrow'),
    loadImage('sliderb'),
    loadImage('sliderfollowcircle'),
    loadImage('sliderscorepoint'),
    loadImage('hit300'),
    loadImage('hit100'),
    loadImage('hit50'),
    loadImage('hit0'),
    ...Array.from({ length: 10 }, (_, digit) => loadImage(`default-${digit}`)),
    ...Array.from({ length: 10 }, (_, digit) => loadImage(`score-${digit}`)),
  ])

  const defaultNumbers = numbers.slice(0, 10)
  const scoreNumbers = numbers.slice(10, 20)

  return {
    name,
    config,
    hitcircle,
    hitcircleoverlay,
    approachcircle,
    cursor,
    sliderStartCircle,
    sliderStartCircleOverlay,
    sliderEndCircle,
    sliderEndCircleOverlay,
    reverseArrow,
    sliderBall,
    sliderFollowCircle,
    sliderScorePoint,
    hit300,
    hit100,
    hit50,
    hit0,
    numbers: defaultNumbers,
    scoreNumbers,
    frame(image, timeMS) {
      if (image === undefined || image.frames.length === 0) return undefined
      if (image.frames.length === 1 || config.animationFramerate <= 0) return image.frames[0]
      const index = Math.floor((Math.max(0, timeMS) / 1_000) * config.animationFramerate) % image.frames.length
      return image.frames[index]
    },
    dispose() {
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.length = 0
    },
  }
}

async function loadSkinImage(
  fileSystem: Pick<OsuFileSystem, 'getFile'>,
  folder: string,
  files: ReadonlyMap<string, string>,
  baseName: string,
  objectUrls: string[],
): Promise<SkinImage | undefined> {
  // OsuSkinImage.cpp:72-100 probes name-0 first and caps at frame 511.
  const animated = findFrameFilename(files, `${baseName}-0`)
  const frames: SkinFrame[] = []
  if (animated !== undefined) {
    for (let index = 0; index < MAX_ANIMATION_FRAMES; index += 1) {
      const candidate = findFrameFilename(files, `${baseName}-${index}`)
      if (candidate === undefined) break
      const frame = await loadFrame(fileSystem, folder, candidate, objectUrls)
      if (frame === undefined) break
      frames.push(frame)
    }
  } else {
    const candidate = findFrameFilename(files, baseName)
    if (candidate !== undefined) {
      const frame = await loadFrame(fileSystem, folder, candidate, objectUrls)
      if (frame !== undefined) frames.push(frame)
    }
  }
  return frames.length > 0 ? { frames } : undefined
}

function findFrameFilename(
  files: ReadonlyMap<string, string>,
  stem: string,
): { filename: string; sourceScale: 1 | 2 } | undefined {
  // OsuSkinImage.cpp:105-153: @2x always wins when both variants exist.
  const highResolution = files.get(`${stem}@2x.png`.toLowerCase())
  if (highResolution !== undefined) return { filename: highResolution, sourceScale: 2 }
  const standard = files.get(`${stem}.png`.toLowerCase())
  return standard === undefined ? undefined : { filename: standard, sourceScale: 1 }
}

async function loadFrame(
  fileSystem: Pick<OsuFileSystem, 'getFile'>,
  folder: string,
  candidate: { filename: string; sourceScale: 1 | 2 },
  objectUrls: string[],
): Promise<SkinFrame | undefined> {
  let url: string | undefined
  try {
    const file = await fileSystem.getFile(`${folder}/${candidate.filename}`)
    url = URL.createObjectURL(file)
    const image = new Image()
    image.src = url
    await image.decode()
    objectUrls.push(url)
    return { image, sourceScale: candidate.sourceScale, filename: candidate.filename }
  } catch {
    if (url !== undefined) URL.revokeObjectURL(url)
    return undefined
  }
}

function clampByte(value: number): number {
  return Math.round(Math.min(255, Math.max(0, Number.isFinite(value) ? value : 0)))
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function colorFromMatch(match: RegExpExecArray): string {
  return toHex(
    clampByte(Number(match[1])),
    clampByte(Number(match[2])),
    clampByte(Number(match[3])),
  )
}
