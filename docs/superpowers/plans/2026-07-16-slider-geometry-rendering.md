# Slider Geometry and Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 3a slider polylines with McOsu-compatible curve geometry, timing ticks, animated slider furniture, and depth-resolved WebGL2 bodies.

**Architecture:** Pure curve and tick modules convert the `osu-parsers` boundary into McOsu's absolute-point/span conventions and remain fully Node-testable. A dedicated slider body renderer owns a WebGL2 canvas below the existing Canvas 2D sprite layer; it uses instanced cone meshes, an RGBA framebuffer, and a depth renderbuffer, with an independent Canvas 2D fallback. `CanvasPlayfield` coordinates both layers and renders skin sprites or procedural substitutes.

**Tech Stack:** TypeScript, Node test runner, Canvas 2D, WebGL2 / GLSL ES 3.00, osu-parsers.

## Global Constraints

- `/home/code/McOsu` is read-only.
- Routine tests are pure, deterministic, Node-only, and do not construct a GL context.
- Keep the Phase 3a `PlayfieldRenderer` interface.
- WebGL2 failure must retain a usable Canvas 2D slider-body fallback.
- Preserve the existing audio and `BeatmapClock` timing path.

---

### Task 1: Curve compatibility boundary

**Files:**
- Create: `src/core/SliderCurves.ts`
- Test: `tests/SliderCurves.test.ts`

**Interfaces:**
- Consumes: parser-relative `GameplaySlider.controlPoints`, head position, curve char, and pixel length.
- Produces: `createSliderCurve(type, absolutePoints, pixelLength)`, `relativeControlPointsToAbsolute(head, points)`, `SliderCurve.getPointAt(t)`, equal-distance points, segments, and endpoint angles.

- [ ] Add tests for relative-to-absolute integer conversion and the 32768 coordinate clamp.
- [ ] Add reference tests for linear equal-distance points, a quadratic Bezier endpoint/length, a known semicircular P midpoint, and collinear-P fallback.
- [ ] Port the Bezier flatness/subdivision approximator from `OsuSliderCurves.cpp:738-855`.
- [ ] Port Linear/Bezier segment splitting, Catmull windows, equal-distance sampling, 2.5 px separation, 9999 interpolated-point cap, and endpoint-angle calculation.
- [ ] Port the three-point circle construction and arc-length truncation, falling back to Bezier for collinear P controls.
- [ ] Run `npm test -- --test-name-pattern=slider` and confirm the numerical tests pass.

### Task 2: Gameplay timing and slider preparation

**Files:**
- Create: `src/core/SliderTicks.ts`
- Modify: `src/data/GameplayLoader.ts`
- Modify: `tests/GameplayLoader.test.ts`

**Interfaces:**
- Consumes: decoded file version, slider velocity/span duration, timing-point beat length, slider multiplier, and tick rate.
- Produces: absolute control points, `spanDuration`, and per-span tick percentages on every `GameplaySlider`.

- [ ] Add assertions that parser repeat `1` maps back to two McOsu spans and relative controls map to the original absolute integer coordinates.
- [ ] Implement McOsu tick distance, end-distance rejection, and 2048-tick cap from `OsuDatabaseBeatmap.cpp:576-645`.
- [ ] Store a lazily reusable curve-compatible representation at the gameplay boundary without leaking osu-parsers classes.
- [ ] Run the gameplay loader tests and confirm the existing object boundary remains green.

### Task 3: Depth-resolved body renderer

**Files:**
- Create: `src/render/SliderRenderer.ts`

**Interfaces:**
- Consumes: pixel-space equal-distance points, diameter, snake range, body/border colors, and alpha.
- Produces: `SliderBodyRenderer.beginFrame`, `drawBody`, `endFrame`, and `dispose`; `createSliderBodyRenderer(canvas)` chooses WebGL2 or Canvas 2D.

- [ ] Build the 42-subdivision unit cone from `OsuSliderRenderer.cpp:821-914` as an instanced triangle fan.
- [ ] Port the slider fragment color regions and uniforms to GLSL ES 3.00.
- [ ] Allocate an RGBA8 texture framebuffer plus DEPTH_COMPONENT16 attachment and validate completeness.
- [ ] Render each body with blending disabled and depth testing enabled, then alpha-composite the body texture to the layered canvas.
- [ ] Add DPR/max-renderbuffer clamping and a Canvas 2D round-stroke fallback for context, shader, or framebuffer failure.

### Task 4: Slider furniture and playback animation

**Files:**
- Modify: `src/skin/Skin.ts`
- Modify: `src/render/Playfield.ts`
- Modify: `src/ui/PlayfieldView.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: prepared slider geometry/ticks and existing interpolated music position.
- Produces: layered passive rendering with snaking body, endpoint sprites, repeat arrows, ticks, slider ball, and follow circle.

- [ ] Probe slider start/end circle and overlays, reverse arrow, slider ball, follow circle, and score-point assets with existing animation/@2x rules.
- [ ] Add the WebGL/2D body canvas beneath the sprite canvas in the 4:3 letterbox.
- [ ] Snake bodies over one third of approach time (`OsuSlider.cpp:1434-1435`) and keep the interpolated snake endpoint cap.
- [ ] Draw ticks only once reached by the snake, then draw start/end circles and procedural or skinned repeat arrows at curve endpoint angles.
- [ ] During active playback, map elapsed time through odd/even spans and render the moving ball and follow circle at `getPointAt`.
- [ ] Preserve spinner and circle behavior from Phase 3a.

### Task 5: Verification and commit

**Files:**
- Verify all modified Phase 3b files.

- [ ] Run `npm test` and require all offline tests to pass.
- [ ] Run `npm run build` and require strict TypeScript plus Vite bundling to pass.
- [ ] Run `git diff --check`, inspect the complete diff, and confirm only Phase 3b files changed.
- [ ] Commit on `main` with `feat: render depth-resolved sliders`.
