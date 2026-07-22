export type OptionValueFormat = 'number' | 'percent' | 'milliseconds' | 'seconds'

export function formatOptionValue(value: number, format: OptionValueFormat): string {
  if (!Number.isFinite(value)) return '—'
  if (format === 'percent') return `${Math.round(value * 100)}%`
  if (format === 'milliseconds') return `${compact(value, 1)} ms`
  if (format === 'seconds') return `${compact(value, 2)} s`
  return compact(value, 2)
}

export function parseBoundedOptionValue(raw: string, minimum: number, maximum: number, step: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('Option value must be a finite number.')
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
    throw new Error('Option bounds are invalid.')
  }
  if (!Number.isFinite(step) || step <= 0) throw new Error('Option step must be positive.')
  const clamped = Math.min(maximum, Math.max(minimum, value))
  const stepped = minimum + Math.round((clamped - minimum) / step) * step
  return Number(Math.min(maximum, Math.max(minimum, stepped)).toFixed(stepPrecision(step)))
}

function compact(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, '').replace(/\.$/, '')
}

function stepPrecision(step: number): number {
  const text = step.toString().toLowerCase()
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0
}
