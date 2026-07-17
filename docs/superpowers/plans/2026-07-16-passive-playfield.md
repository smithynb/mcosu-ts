# Phase 3a Passive Playfield Implementation Plan

**Goal:** Decode standard-mode gameplay objects into a lean local model and render a skin-aware, passive McOsu-style playfield driven by the existing gameplay clock.

**Architecture:** `GameplayLoader` is the only module coupled to `osu-parsers`; it converts decoded objects into local discriminated types. Pure `GameRules` functions own difficulty and coordinate math. The skin loader provides optional browser image assets with procedural fallback, while an abstract renderer contract is implemented by a DPR-aware Canvas 2D playfield. `PlayerPanel` owns playback timing and forwards its single clock update to the watch view.

**Tech Stack:** TypeScript, Vite, Node test runner, osu-parsers/osu-classes, Canvas 2D, File System Access API.

---

### Task 1: Gameplay boundary and rules

**Files:**
- Create: `src/data/GameplayLoader.ts`
- Create: `src/core/GameRules.ts`
- Create: `tests/GameplayLoader.test.ts`
- Create: `tests/GameRules.test.ts`

1. Decode synthetic `.osu` text in a failing boundary test.
2. Convert circles, sliders, and spinners to local types, preserving combo fields and raw slider control-point types/positions.
3. Add reference-value tests for AR, OD, CS, spinner requirements, fade, and playfield transforms.
4. Implement the exact non-mod McOsu formulas and constants.

### Task 2: Skin subset

**Files:**
- Create: `src/skin/Skin.ts`
- Create: `tests/Skin.test.ts`

1. Test skin.ini combo-color/general parsing without browser image APIs.
2. Enumerate `Skins/*`, parse a selected skin, and probe animated/static files case-insensitively.
3. Prefer `@2x` frames and retain a 2.0/1.0 source scale; stop animations at the first missing frame with a 512-frame cap.
4. Return missing assets as `undefined` so rendering remains procedural and non-fatal.

### Task 3: Passive renderer and watch view

**Files:**
- Create: `src/render/Playfield.ts`
- Create: `src/ui/PlayfieldView.ts`
- Modify: `src/ui/PlayerPanel.ts`
- Modify: `src/style.css`

1. Add a renderer interface and DPR-aware Canvas 2D implementation.
2. Draw visible circles with fade-in and shrinking approach circles, sliders as start circles plus raw-control-point polylines, and spinner placeholders.
3. Add a skin dropdown and Watch action to the player panel.
4. Present a responsive 4:3 letterboxed overlay and forward the panel's existing one-per-frame `BeatmapClock` value into it.

### Task 4: Verification and commit

1. Run `npm test` and `npm run build`.
2. Inspect the final diff and repository status.
3. Commit the verified phase on `main` with a focused conventional commit.
