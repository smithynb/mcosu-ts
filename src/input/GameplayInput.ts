import { getPlayfieldTransform, type Point } from '../core/GameRules.ts'
import type { GameplayFrameInput } from '../core/GameplaySession.ts'

interface QueuedClick {
  readonly timeStamp: number
  readonly position: Point
  readonly input: string
}

export class GameplayInput {
  readonly #canvas: HTMLCanvasElement
  readonly #pressed = new Set<string>()
  readonly #clicks: QueuedClick[] = []
  readonly #pointerEventName: 'pointerrawupdate' | 'pointermove'
  #pointer: Point = { x: 256, y: 192 }
  #mouseButtonsEnabled = true

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas
    this.#pointerEventName = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove'
    window.addEventListener('keydown', this.#onKeyDown, { capture: true })
    window.addEventListener('keyup', this.#onKeyUp, { capture: true })
    canvas.addEventListener(this.#pointerEventName, this.#onPointerMove as EventListener)
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    window.addEventListener('pointerup', this.#onPointerUp)
    window.addEventListener('pointercancel', this.#onPointerUp)
    window.addEventListener('blur', this.#onBlur)
    canvas.addEventListener('contextmenu', this.#preventContextMenu)
  }

  setMouseButtonsEnabled(enabled: boolean): void {
    this.#mouseButtonsEnabled = enabled
    if (!enabled) {
      this.#pressed.delete('MouseLeft')
      this.#pressed.delete('MouseRight')
    }
  }

  consume(positionMS: number, frameTimeStamp: number, speedMultiplier: number): GameplayFrameInput {
    // DOM event timestamps and performance.now() share the monotonic time origin.
    const clicks = this.#clicks.splice(0).map((click) => ({
      musicTime: positionMS + (click.timeStamp - frameTimeStamp) * speedMultiplier,
      position: click.position,
      input: click.input,
    }))
    return { position: this.#pointer, held: this.#pressed.size > 0, heldInputs: [...this.#pressed], clicks }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.#onKeyDown, { capture: true })
    window.removeEventListener('keyup', this.#onKeyUp, { capture: true })
    this.#canvas.removeEventListener(this.#pointerEventName, this.#onPointerMove as EventListener)
    this.#canvas.removeEventListener('pointerdown', this.#onPointerDown)
    window.removeEventListener('pointerup', this.#onPointerUp)
    window.removeEventListener('pointercancel', this.#onPointerUp)
    window.removeEventListener('blur', this.#onBlur)
    this.#canvas.removeEventListener('contextmenu', this.#preventContextMenu)
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if ((event.code !== 'KeyZ' && event.code !== 'KeyX') || event.repeat) return
    event.preventDefault()
    this.#pressed.add(event.code)
    this.#clicks.push({ timeStamp: event.timeStamp, position: this.#pointer, input: event.code })
  }

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyZ' && event.code !== 'KeyX') return
    event.preventDefault()
    this.#pressed.delete(event.code)
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
    const latest = events.at(-1) ?? event
    this.#pointer = this.#toOsuCoordinates(latest.clientX, latest.clientY)
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    this.#pointer = this.#toOsuCoordinates(event.clientX, event.clientY)
    if (!this.#mouseButtonsEnabled || (event.button !== 0 && event.button !== 2)) return
    event.preventDefault()
    const code = event.button === 0 ? 'MouseLeft' : 'MouseRight'
    if (this.#pressed.has(code)) return
    this.#pressed.add(code)
    this.#clicks.push({ timeStamp: event.timeStamp, position: this.#pointer, input: code })
    this.#canvas.setPointerCapture?.(event.pointerId)
  }

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.type === 'pointercancel') {
      this.#pressed.delete('MouseLeft')
      this.#pressed.delete('MouseRight')
      return
    }
    if (event.button === 0) this.#pressed.delete('MouseLeft')
    if (event.button === 2) this.#pressed.delete('MouseRight')
  }

  readonly #preventContextMenu = (event: MouseEvent): void => {
    if (this.#mouseButtonsEnabled) event.preventDefault()
  }

  readonly #onBlur = (): void => {
    this.#pressed.clear()
  }

  #toOsuCoordinates(clientX: number, clientY: number): Point {
    const rect = this.#canvas.getBoundingClientRect()
    const transform = getPlayfieldTransform(rect.width, rect.height)
    return {
      x: (clientX - rect.left - transform.offset.x) / transform.scale,
      y: (clientY - rect.top - transform.offset.y) / transform.scale,
    }
  }
}
