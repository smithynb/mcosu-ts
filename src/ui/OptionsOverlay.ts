import type { ConVarRegistry } from '../core/ConVar.ts'
import { formatOptionValue, parseBoundedOptionValue, type OptionValueFormat } from '../core/OptionValues.ts'

interface RangeBinding {
  readonly name: string
  readonly minimum: number
  readonly maximum: number
  readonly step: number
  readonly format: OptionValueFormat
}

export class OptionsOverlay {
  readonly #registry: ConVarRegistry
  readonly #getSkinNames: () => readonly string[]
  readonly #root: HTMLDivElement
  readonly #skinSelect: HTMLSelectElement
  #restoreFocus: HTMLElement | null = null

  constructor(registry: ConVarRegistry, getSkinNames: () => readonly string[]) {
    this.#registry = registry
    this.#getSkinNames = getSkinNames
    this.#root = document.createElement('div')
    this.#root.className = 'options-overlay'
    this.#root.hidden = true
    this.#root.innerHTML = `
      <section class="options-window" role="dialog" aria-modal="true" aria-labelledby="options-title">
        <header class="options-header">
          <div><p class="eyebrow">live ConVar adapter</p><h2 id="options-title">Options</h2></div>
          <p>Changes apply immediately and persist locally.</p>
          <button type="button" data-options-close aria-label="Close options">Close <kbd>Esc</kbd></button>
        </header>
        <div class="options-layout">
          <nav aria-label="Options sections">
            <a href="#options-gameplay">Gameplay</a>
            <a href="#options-skin">Skin</a>
            <a href="#options-input">Input</a>
            <a href="#options-general">General</a>
          </nav>
          <div class="options-content">
            <section id="options-gameplay" class="options-section">
              <div class="options-section-heading"><span>01</span><div><h3>Gameplay</h3><p>Timing, visibility, and stable rules.</p></div></div>
              ${rangeRow('Universal offset', 'osu_universal_offset', '-300', '300', '1')}
              ${selectRow('Notelock', 'osu_notelock_type', [['0', 'None'], ['1', 'McOsu'], ['2', 'osu!stable'], ['3', 'osu!lazer 2020']])}
              ${selectRow('HP drain', 'osu_drain_type', [['0', 'None'], ['1', 'VR'], ['2', 'osu!stable'], ['3', 'osu!lazer 2020'], ['4', 'osu!lazer 2018']])}
              ${rangeRow('Background dim', 'osu_background_dim', '0', '1', '0.01')}
              ${rangeRow('Background fade in', 'osu_background_fade_in_duration', '0', '3', '0.05')}
              ${rangeRow('Background fade out', 'osu_background_fade_out_duration', '0', '3', '0.05')}
            </section>
            <section id="options-skin" class="options-section">
              <div class="options-section-heading"><span>02</span><div><h3>Skin</h3><p>Local graphics and hitsound mix.</p></div></div>
              <div class="option-row" data-option-row="osu_skin">
                <div><label for="option-osu-skin">Current skin</label><small>Uses the procedural fallback when empty.</small></div>
                <select id="option-osu-skin" data-convar="osu_skin"></select>
                <button type="button" data-reset="osu_skin">Reset</button>
              </div>
              ${rangeRow('Hitsound volume', 'osu_volume_effects', '0', '1', '0.01')}
            </section>
            <section id="options-input" class="options-section">
              <div class="options-section-heading"><span>03</span><div><h3>Input</h3><p>Current browser gameplay bindings.</p></div></div>
              <div class="binding-reference"><span>Left click</span><kbd>Z</kbd><small>KeyboardEvent.code: KeyZ</small></div>
              <div class="binding-reference"><span>Right click</span><kbd>X</kbd><small>KeyboardEvent.code: KeyX</small></div>
              <div class="binding-reference"><span>Pointer</span><kbd>M1 / M2</kbd><small>Toggleable in gameplay</small></div>
            </section>
            <section id="options-general" class="options-section">
              <div class="options-section-heading"><span>04</span><div><h3>General</h3><p>Browser runtime behavior.</p></div></div>
              ${checkRow('Interpolate music position', 'osu_interpolate_music_pos')}
              ${checkRow('Snaking sliders', 'osu_snaking_sliders')}
            </section>
          </div>
        </div>
      </section>
    `
    this.#skinSelect = required(this.#root, '#option-osu-skin')
    this.#bindRange({ name: 'osu_universal_offset', minimum: -300, maximum: 300, step: 1, format: 'milliseconds' })
    this.#bindSelect('osu_notelock_type')
    this.#bindSelect('osu_drain_type')
    this.#bindRange({ name: 'osu_background_dim', minimum: 0, maximum: 1, step: 0.01, format: 'percent' })
    this.#bindRange({ name: 'osu_background_fade_in_duration', minimum: 0, maximum: 3, step: 0.05, format: 'seconds' })
    this.#bindRange({ name: 'osu_background_fade_out_duration', minimum: 0, maximum: 3, step: 0.05, format: 'seconds' })
    this.#bindSelect('osu_skin')
    this.#bindRange({ name: 'osu_volume_effects', minimum: 0, maximum: 1, step: 0.01, format: 'percent' })
    this.#bindCheckbox('osu_interpolate_music_pos')
    this.#bindCheckbox('osu_snaking_sliders')
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('[data-reset]')) {
      button.addEventListener('click', () => this.#registry.require(button.dataset.reset ?? '').reset())
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('[data-options-close]')) button.onclick = () => this.close()
    this.#root.addEventListener('pointerdown', (event) => { if (event.target === this.#root) this.close() })
    document.addEventListener('keydown', this.#onKeyDown, { capture: true })
    document.body.append(this.#root)
  }

  get isOpen(): boolean { return !this.#root.hidden }

  open(): void {
    if (this.isOpen) return
    this.#restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.#refreshSkins()
    this.#root.hidden = false
    required<HTMLButtonElement>(this.#root, '[data-options-close]').focus()
  }

  close(): void {
    if (!this.isOpen) return
    this.#root.hidden = true
    this.#restoreFocus?.focus()
    this.#restoreFocus = null
  }

  toggle(): void { if (this.isOpen) this.close(); else this.open() }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isOpen) return
    event.preventDefault()
    event.stopPropagation()
    this.close()
  }

  #bindRange(binding: RangeBinding): void {
    const input = required<HTMLInputElement>(this.#root, `[data-convar="${binding.name}"]`)
    const output = required<HTMLOutputElement>(this.#root, `[data-output="${binding.name}"]`)
    const variable = this.#registry.require(binding.name)
    const update = () => {
      input.value = String(variable.getFloat())
      output.value = formatOptionValue(variable.getFloat(), binding.format)
    }
    input.addEventListener('input', () => variable.setValue(
      parseBoundedOptionValue(input.value, binding.minimum, binding.maximum, binding.step),
    ))
    variable.onChange(update)
    update()
  }

  #bindSelect(name: string): void {
    const input = required<HTMLSelectElement>(this.#root, `[data-convar="${name}"]`)
    const variable = this.#registry.require(name)
    const update = () => { input.value = variable.getString() }
    input.addEventListener('change', () => variable.setValue(input.value))
    variable.onChange(update)
    update()
  }

  #bindCheckbox(name: string): void {
    const input = required<HTMLInputElement>(this.#root, `[data-convar="${name}"]`)
    const variable = this.#registry.require(name)
    const update = () => { input.checked = variable.getBool() }
    input.addEventListener('change', () => variable.setValue(input.checked))
    variable.onChange(update)
    update()
  }

  #refreshSkins(): void {
    const variable = this.#registry.require('osu_skin')
    const current = variable.getString()
    this.#skinSelect.replaceChildren(option('', 'Procedural fallback'))
    for (const name of this.#getSkinNames()) this.#skinSelect.append(option(name, name))
    if (current.length > 0 && ![...this.#skinSelect.options].some((item) => item.value === current)) {
      this.#skinSelect.append(option(current, `${current} (unavailable)`))
    }
    this.#skinSelect.value = current
  }
}

function rangeRow(label: string, name: string, minimum: string, maximum: string, step: string): string {
  return `<div class="option-row" data-option-row="${name}"><div><label for="option-${name}">${label}</label><small>${name}</small></div><input id="option-${name}" data-convar="${name}" type="range" min="${minimum}" max="${maximum}" step="${step}"><output data-output="${name}"></output><button type="button" data-reset="${name}">Reset</button></div>`
}

function selectRow(label: string, name: string, choices: readonly (readonly [string, string])[]): string {
  return `<div class="option-row" data-option-row="${name}"><div><label for="option-${name}">${label}</label><small>${name}</small></div><select id="option-${name}" data-convar="${name}">${choices.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select><button type="button" data-reset="${name}">Reset</button></div>`
}

function checkRow(label: string, name: string): string {
  return `<div class="option-row option-row-check" data-option-row="${name}"><div><label for="option-${name}">${label}</label><small>${name}</small></div><input id="option-${name}" data-convar="${name}" type="checkbox"><button type="button" data-reset="${name}">Reset</button></div>`
}

function option(value: string, label: string): HTMLOptionElement {
  const result = document.createElement('option')
  result.value = value
  result.textContent = label
  return result
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing options element ${selector}`)
  return element
}
