import type { ConVar, ConVarRegistry } from '../core/ConVar.ts'

export class ConsoleOverlay {
  readonly #registry: ConVarRegistry
  readonly #root: HTMLDivElement
  readonly #output: HTMLDivElement
  readonly #input: HTMLInputElement
  readonly #history: string[] = []
  #historyIndex = 0

  constructor(registry: ConVarRegistry) {
    this.#registry = registry
    this.#root = document.createElement('div')
    this.#root.className = 'console-overlay'
    this.#root.hidden = true
    this.#root.innerHTML = `
      <section class="console-window" aria-label="McOsu console">
        <header><strong>mcosu console</strong><span>backtick to close · help for commands</span></header>
        <div class="console-output" role="log" aria-live="polite"></div>
        <label><span>&gt;</span><input class="console-input" type="text" autocomplete="off" spellcheck="false" aria-label="Console command"></label>
      </section>
    `
    this.#output = required(this.#root, '.console-output')
    this.#input = required(this.#root, '.console-input')
    this.#input.addEventListener('keydown', this.#onInputKeyDown)
    document.addEventListener('keydown', this.#onDocumentKeyDown, { capture: true })
    document.body.append(this.#root)
  }

  toggle(): void {
    this.#root.hidden = !this.#root.hidden
    if (!this.#root.hidden) {
      this.#input.focus()
      if (this.#output.childElementCount === 0) this.#write('Type help, find <text>, or <convar> [value].')
    }
  }

  readonly #onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Backquote') return
    event.preventDefault()
    event.stopPropagation()
    this.toggle()
  }

  readonly #onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const command = this.#input.value.trim()
      if (command.length === 0) return
      this.#history.push(command)
      this.#historyIndex = this.#history.length
      this.#write(`> ${command}`, 'command')
      this.#execute(command)
      this.#input.value = ''
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? -1 : 1
      this.#historyIndex = Math.max(0, Math.min(this.#history.length, this.#historyIndex + delta))
      this.#input.value = this.#history[this.#historyIndex] ?? ''
      this.#input.setSelectionRange(this.#input.value.length, this.#input.value.length)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const token = this.#input.value.trim().split(/\s+/, 1)[0] ?? ''
      const matches = this.#registry.prefix(token)
      if (matches.length === 1) this.#input.value = `${matches[0]!.name} `
      else if (matches.length > 1) this.#write(matches.map((variable) => variable.name).join('  '))
    }
  }

  #execute(command: string): void {
    const [name = '', ...valueParts] = command.split(/\s+/)
    if (name === 'help') {
      this.#write('help · find <substring> · <convar> · <convar> <value> · reset <convar>')
      return
    }
    if (name === 'find') {
      const query = valueParts.join(' ')
      const matches = this.#registry.find(query)
      this.#write(matches.length === 0 ? 'No matching ConVars.' : matches.map(formatVariable).join('\n'))
      return
    }
    if (name === 'reset') {
      const variable = this.#registry.get(valueParts[0] ?? '')
      if (variable === undefined) this.#write(`Unknown ConVar: ${valueParts[0] ?? ''}`, 'error')
      else {
        variable.reset()
        this.#write(formatVariable(variable))
      }
      return
    }
    const variable = this.#registry.get(name)
    if (variable === undefined) {
      this.#write(`Unknown command or ConVar: ${name}`, 'error')
      return
    }
    if (valueParts.length > 0) {
      try {
        variable.setValue(valueParts.join(' '))
      } catch (error) {
        this.#write(error instanceof Error ? error.message : String(error), 'error')
        return
      }
    }
    this.#write(formatVariable(variable))
  }

  #write(text: string, kind: 'normal' | 'command' | 'error' = 'normal'): void {
    const line = document.createElement('pre')
    line.dataset.kind = kind
    line.textContent = text
    this.#output.append(line)
    this.#output.scrollTop = this.#output.scrollHeight
  }
}

function formatVariable(variable: ConVar): string {
  const description = variable.description.length === 0 ? '' : ` — ${variable.description}`
  return `${variable.name} = ${variable.getString()} (default ${String(variable.defaultValue)})${description}`
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing console element ${selector}`)
  return element
}
