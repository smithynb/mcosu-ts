import type { SliderPoint } from '../core/SliderCurves.ts'

const UNIT_CIRCLE_SUBDIVISIONS = 42

export interface SliderBodyStyle {
  readonly style?: 0 | 1
  readonly bodyAlphaMultiplier?: number
  readonly bodyColorSaturation?: number
  readonly borderSizeMultiplier?: number
  readonly borderFeather?: number
  readonly borderColor: string
  readonly bodyColor: string
  readonly alpha: number
}

export interface SliderBodyRenderer {
  readonly kind: 'webgl2' | 'canvas2d'
  beginFrame(cssWidth: number, cssHeight: number, requestedDpr: number): void
  drawBody(
    points: readonly SliderPoint[],
    diameter: number,
    from: number,
    to: number,
    style: SliderBodyStyle,
  ): void
  endFrame(): void
  dispose(): void
}

export function createSliderBodyRenderer(canvas: HTMLCanvasElement): SliderBodyRenderer {
  try {
    return new WebGL2SliderRenderer(canvas)
  } catch (error) {
    console.warn('WebGL2 slider bodies unavailable; using Canvas 2D fallback.', error)
    // Once a WebGL context has been created the same canvas cannot acquire a 2D
    // context. Replace it so shader/FBO initialization failures still fall back.
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement
    replacement.className = canvas.className
    replacement.setAttribute('aria-hidden', 'true')
    canvas.replaceWith(replacement)
    return new Canvas2DSliderRenderer(replacement)
  }
}

class Canvas2DSliderRenderer implements SliderBodyRenderer {
  readonly kind = 'canvas2d' as const
  readonly #canvas: HTMLCanvasElement
  readonly #context: CanvasRenderingContext2D
  #scale = 1

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Neither WebGL2 nor Canvas 2D is available for slider bodies.')
    this.#canvas = canvas
    this.#context = context
  }

  beginFrame(cssWidth: number, cssHeight: number, requestedDpr: number): void {
    this.#scale = Math.max(1, requestedDpr)
    const width = Math.max(1, Math.round(cssWidth * this.#scale))
    const height = Math.max(1, Math.round(cssHeight * this.#scale))
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width
      this.#canvas.height = height
    }
    this.#context.setTransform(this.#scale, 0, 0, this.#scale, 0, 0)
    this.#context.clearRect(0, 0, cssWidth, cssHeight)
  }

  drawBody(
    points: readonly SliderPoint[],
    diameter: number,
    from: number,
    to: number,
    style: SliderBodyStyle,
  ): void {
    const visible = slicePoints(points, from, to)
    if (visible.length === 0 || style.alpha <= 0) return
    const context = this.#context
    context.save()
    context.globalAlpha = clamp(style.alpha, 0, 1)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    drawPolyline(context, visible, style.borderColor, diameter)
    const borderMultiplier = style.borderSizeMultiplier ?? 1
    const bodyWidth = diameter * clamp(1 - 0.19 * borderMultiplier, 0.05, 1)
    drawPolyline(context, visible, style.bodyColor, bodyWidth)
    context.restore()
  }

  endFrame(): void {}

  dispose(): void {
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height)
  }
}

class WebGL2SliderRenderer implements SliderBodyRenderer {
  readonly kind = 'webgl2' as const
  readonly #canvas: HTMLCanvasElement
  readonly #gl: WebGL2RenderingContext
  readonly #bodyProgram: WebGLProgram
  readonly #compositeProgram: WebGLProgram
  readonly #bodyVao: WebGLVertexArrayObject
  readonly #compositeVao: WebGLVertexArrayObject
  readonly #instanceBuffer: WebGLBuffer
  readonly #framebuffer: WebGLFramebuffer
  readonly #colorTexture: WebGLTexture
  readonly #depthBuffer: WebGLRenderbuffer
  readonly #bodyUniforms: Readonly<Record<string, WebGLUniformLocation>>
  readonly #compositeAlpha: WebGLUniformLocation
  readonly #maximumTargetSize: number
  #cssWidth = 1
  #cssHeight = 1
  #pixelScaleX = 1
  #pixelScaleY = 1
  #targetAllocated = false

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: true,
      premultipliedAlpha: false,
    })
    if (gl === null) throw new Error('WebGL2 context creation failed.')
    this.#canvas = canvas
    this.#gl = gl
    this.#bodyProgram = createProgram(gl, BODY_VERTEX_SHADER, BODY_FRAGMENT_SHADER)
    this.#compositeProgram = createProgram(gl, COMPOSITE_VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER)
    this.#bodyVao = requireResource(gl.createVertexArray(), 'body VAO')
    this.#compositeVao = requireResource(gl.createVertexArray(), 'composite VAO')
    this.#instanceBuffer = requireResource(gl.createBuffer(), 'instance buffer')
    this.#framebuffer = requireResource(gl.createFramebuffer(), 'framebuffer')
    this.#colorTexture = requireResource(gl.createTexture(), 'framebuffer texture')
    this.#depthBuffer = requireResource(gl.createRenderbuffer(), 'depth buffer')
    this.#maximumTargetSize = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    )
    this.#bodyUniforms = uniformMap(gl, this.#bodyProgram, [
      'uResolution',
      'uRadius',
      'style',
      'bodyAlphaMultiplier',
      'bodyColorSaturation',
      'borderSizeMultiplier',
      'borderFeather',
      'colBorder',
      'colBody',
    ])
    this.#compositeAlpha = requireUniform(gl, this.#compositeProgram, 'uAlpha')
    this.#initializeBodyMesh()
    gl.bindVertexArray(this.#compositeVao)
    gl.bindVertexArray(null)
  }

  beginFrame(cssWidth: number, cssHeight: number, requestedDpr: number): void {
    const gl = this.#gl
    this.#cssWidth = Math.max(1, cssWidth)
    this.#cssHeight = Math.max(1, cssHeight)
    // WebGL2 renderbuffers have implementation-specific size limits. Lower DPR
    // rather than changing CSS geometry when the requested target is too large.
    const maximumDpr = Math.min(
      this.#maximumTargetSize / this.#cssWidth,
      this.#maximumTargetSize / this.#cssHeight,
    )
    const dpr = Math.max(0.25, Math.min(Math.max(1, requestedDpr), maximumDpr))
    const width = Math.max(1, Math.round(this.#cssWidth * dpr))
    const height = Math.max(1, Math.round(this.#cssHeight * dpr))
    if (this.#canvas.width !== width || this.#canvas.height !== height || !this.#targetAllocated) {
      this.#canvas.width = width
      this.#canvas.height = height
      this.#allocateTarget(width, height)
      this.#targetAllocated = true
    }
    this.#pixelScaleX = width / this.#cssWidth
    this.#pixelScaleY = height / this.#cssHeight
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  drawBody(
    points: readonly SliderPoint[],
    diameter: number,
    from: number,
    to: number,
    style: SliderBodyStyle,
  ): void {
    const centers = slicePoints(points, from, to)
    if (centers.length === 0 || style.alpha <= 0 || diameter <= 0) return
    const gl = this.#gl
    const instances = new Float32Array(centers.length * 2)
    for (const [index, point] of centers.entries()) {
      instances[index * 2] = point.x * this.#pixelScaleX
      instances[index * 2 + 1] = point.y * this.#pixelScaleY
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer)
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.GREATER)
    gl.disable(gl.BLEND)
    gl.useProgram(this.#bodyProgram)
    gl.bindVertexArray(this.#bodyVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW)
    gl.uniform2f(this.#bodyUniforms.uResolution!, this.#canvas.width, this.#canvas.height)
    gl.uniform2f(
      this.#bodyUniforms.uRadius!,
      (diameter / 2) * this.#pixelScaleX,
      (diameter / 2) * this.#pixelScaleY,
    )
    gl.uniform1i(this.#bodyUniforms.style!, style.style ?? 0)
    gl.uniform1f(this.#bodyUniforms.bodyAlphaMultiplier!, style.bodyAlphaMultiplier ?? 1)
    gl.uniform1f(this.#bodyUniforms.bodyColorSaturation!, style.bodyColorSaturation ?? 1)
    gl.uniform1f(this.#bodyUniforms.borderSizeMultiplier!, style.borderSizeMultiplier ?? 1)
    gl.uniform1f(this.#bodyUniforms.borderFeather!, style.borderFeather ?? 0)
    gl.uniform3fv(this.#bodyUniforms.colBorder!, parseColor(style.borderColor))
    gl.uniform3fv(this.#bodyUniforms.colBody!, parseColor(style.bodyColor))
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, UNIT_CIRCLE_SUBDIVISIONS + 2, centers.length)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(this.#compositeProgram)
    gl.bindVertexArray(this.#compositeVao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#colorTexture)
    gl.uniform1f(this.#compositeAlpha, clamp(style.alpha, 0, 1))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  endFrame(): void {
    this.#gl.bindVertexArray(null)
    this.#gl.flush()
  }

  dispose(): void {
    const gl = this.#gl
    gl.deleteProgram(this.#bodyProgram)
    gl.deleteProgram(this.#compositeProgram)
    gl.deleteVertexArray(this.#bodyVao)
    gl.deleteVertexArray(this.#compositeVao)
    gl.deleteBuffer(this.#instanceBuffer)
    gl.deleteFramebuffer(this.#framebuffer)
    gl.deleteTexture(this.#colorTexture)
    gl.deleteRenderbuffer(this.#depthBuffer)
  }

  #initializeBodyMesh(): void {
    const gl = this.#gl
    const vertexBuffer = requireResource(gl.createBuffer(), 'unit-circle vertex buffer')
    const vertices = new Float32Array((UNIT_CIRCLE_SUBDIVISIONS + 2) * 4)
    // OsuSliderRenderer.cpp:826-861: cone center has radial UV 1 and z .5;
    // edge vertices have radial UV 0 and z 0.
    vertices.set([0, 0, 0.5, 1], 0)
    for (let index = 0; index <= UNIT_CIRCLE_SUBDIVISIONS; index += 1) {
      const phase = (index % UNIT_CIRCLE_SUBDIVISIONS) * Math.PI * 2 / UNIT_CIRCLE_SUBDIVISIONS
      vertices.set([Math.sin(phase), Math.cos(phase), 0, 0], (index + 1) * 4)
    }

    gl.bindVertexArray(this.#bodyVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#instanceBuffer)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8, 0)
    gl.vertexAttribDivisor(2, 1)
    gl.bindVertexArray(null)
    gl.deleteBuffer(vertexBuffer)
  }

  #allocateTarget(width: number, height: number): void {
    const gl = this.#gl
    gl.bindTexture(gl.TEXTURE_2D, this.#colorTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.#depthBuffer)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#colorTexture, 0)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.#depthBuffer)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Slider framebuffer with depth attachment is incomplete.')
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }
}

function slicePoints(points: readonly SliderPoint[], from: number, to: number): SliderPoint[] {
  if (points.length === 0) return []
  const start = clamp(from, 0, 1) * (points.length - 1)
  const end = clamp(to, 0, 1) * (points.length - 1)
  if (end < start) return []
  const output: SliderPoint[] = []
  output.push(interpolateIndexedPoint(points, start))
  for (let index = Math.floor(start) + 1; index <= Math.floor(end); index += 1) output.push(points[index]!)
  const endPoint = interpolateIndexedPoint(points, end)
  if (output.length === 0 || output.at(-1)!.x !== endPoint.x || output.at(-1)!.y !== endPoint.y) output.push(endPoint)
  return output
}

function interpolateIndexedPoint(points: readonly SliderPoint[], indexFloat: number): SliderPoint {
  const index = Math.floor(indexFloat)
  const first = points[index] ?? points.at(-1)!
  const second = points[index + 1] ?? first
  const amount = indexFloat - index
  return { x: first.x + (second.x - first.x) * amount, y: first.y + (second.y - first.y) * amount }
}

function drawPolyline(
  context: CanvasRenderingContext2D,
  points: readonly SliderPoint[],
  color: string,
  width: number,
): void {
  if (points.length === 1) {
    context.fillStyle = color
    context.beginPath()
    context.arc(points[0]!.x, points[0]!.y, width / 2, 0, Math.PI * 2)
    context.fill()
    return
  }
  context.strokeStyle = color
  context.lineWidth = width
  context.beginPath()
  context.moveTo(points[0]!.x, points[0]!.y)
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index]!.x, points[index]!.y)
  context.stroke()
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = requireResource(gl.createProgram(), 'shader program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'unknown link error'
    gl.deleteProgram(program)
    throw new Error(`Slider shader link failed: ${message}`)
  }
  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = requireResource(gl.createShader(type), 'shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown compile error'
    gl.deleteShader(shader)
    throw new Error(`Slider shader compile failed: ${message}`)
  }
  return shader
}

function uniformMap(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): Readonly<Record<string, WebGLUniformLocation>> {
  return Object.fromEntries(names.map((name) => [name, requireUniform(gl, program, name)]))
}

function requireUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (location === null) throw new Error(`Slider shader uniform ${name} was optimized out or missing.`)
  return location
}

function requireResource<T>(resource: T | null, name: string): T {
  if (resource === null) throw new Error(`Could not allocate WebGL ${name}.`)
  return resource
}

function parseColor(color: string): Float32Array {
  const value = /^#([\da-f]{6})$/i.exec(color)?.[1] ?? 'ffffff'
  return new Float32Array([
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ])
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

const BODY_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in float radial;
layout(location = 2) in vec2 instanceCenter;

uniform vec2 uResolution;
uniform vec2 uRadius;
out float tex_coord_x;

void main() {
  vec2 pixel = instanceCenter + position.xy * uRadius;
  vec2 clip = vec2((pixel.x / uResolution.x) * 2.0 - 1.0, 1.0 - (pixel.y / uResolution.y) * 2.0);
  gl_Position = vec4(clip, position.z, 1.0);
  tex_coord_x = radial;
}`

// GLSL ES 3.00 port of build/shaders/slider.mcshader's desktop fragment path.
const BODY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform int style;
uniform float bodyColorSaturation;
uniform float bodyAlphaMultiplier;
uniform float borderSizeMultiplier;
uniform float borderFeather;
uniform vec3 colBorder;
uniform vec3 colBody;

in float tex_coord_x;
out vec4 out_color;

const float defaultTransitionSize = 0.011;
const float defaultBorderSize = 0.11;
const float outerShadowSize = 0.08;

vec4 getInnerBodyColor(vec4 bodyColor) {
  float brightnessMultiplier = 0.25;
  bodyColor.rgb = min(vec3(1.0), bodyColor.rgb * (1.0 + 0.5 * brightnessMultiplier) + brightnessMultiplier);
  return bodyColor;
}

vec4 getOuterBodyColor(vec4 bodyColor) {
  float darknessMultiplier = 0.1;
  bodyColor.rgb = min(vec3(1.0), bodyColor.rgb / (1.0 + darknessMultiplier));
  return bodyColor;
}

void main() {
  float borderSize = (defaultBorderSize + borderFeather) * borderSizeMultiplier;
  float transitionSize = defaultTransitionSize + borderFeather;
  vec4 borderColor = vec4(colBorder, 1.0);
  vec4 bodyColor = vec4(colBody, 0.7 * bodyAlphaMultiplier);
  vec4 outerShadowColor = vec4(0.0, 0.0, 0.0, 0.25);
  vec4 innerBodyColor = getInnerBodyColor(bodyColor);
  vec4 outerBodyColor = getOuterBodyColor(bodyColor);
  innerBodyColor.rgb *= bodyColorSaturation;
  outerBodyColor.rgb *= bodyColorSaturation;
  if (style == 1) {
    outerBodyColor.rgb = bodyColor.rgb * bodyColorSaturation;
    outerBodyColor.a = bodyAlphaMultiplier;
    innerBodyColor.rgb = bodyColor.rgb * 0.5 * bodyColorSaturation;
    innerBodyColor.a = 0.0;
  }
  if (borderSizeMultiplier < 0.01) borderColor = outerShadowColor;
  out_color = vec4(0.0);
  if (tex_coord_x < outerShadowSize - transitionSize) {
    out_color = mix(vec4(0.0), outerShadowColor, tex_coord_x / (outerShadowSize - transitionSize));
  }
  if (tex_coord_x > outerShadowSize - transitionSize && tex_coord_x < outerShadowSize + transitionSize) {
    float delta = (tex_coord_x - outerShadowSize + transitionSize) / (2.0 * transitionSize);
    out_color = mix(outerShadowColor, borderColor, delta);
  }
  if (tex_coord_x > outerShadowSize + transitionSize && tex_coord_x < outerShadowSize + borderSize - transitionSize) out_color = borderColor;
  if (tex_coord_x > outerShadowSize + borderSize - transitionSize && tex_coord_x < outerShadowSize + borderSize + transitionSize) {
    float delta = (tex_coord_x - outerShadowSize - borderSize + transitionSize) / (2.0 * transitionSize);
    out_color = mix(borderColor, outerBodyColor, delta);
  }
  if (tex_coord_x > outerShadowSize + borderSize + transitionSize) {
    float size = outerShadowSize + borderSize + transitionSize;
    out_color = mix(outerBodyColor, innerBodyColor, (tex_coord_x - size) / (1.0 - size));
  }
}`

const COMPOSITE_VERTEX_SHADER = `#version 300 es
out vec2 uv;
void main() {
  vec2 positions[4] = vec2[4](vec2(-1.0,-1.0), vec2(1.0,-1.0), vec2(-1.0,1.0), vec2(1.0,1.0));
  vec2 texcoords[4] = vec2[4](vec2(0.0,0.0), vec2(1.0,0.0), vec2(0.0,1.0), vec2(1.0,1.0));
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
  uv = texcoords[gl_VertexID];
}`

const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform float uAlpha;
in vec2 uv;
out vec4 outColor;
void main() {
  vec4 sampled = texture(tex, uv);
  outColor = vec4(sampled.rgb, sampled.a * uAlpha);
}`
