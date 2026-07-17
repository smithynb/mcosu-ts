# ConVars, Stacking, Mods, and Offsets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add McOsu-style live configuration, standard stacking, gameplay mods, and correctly signed judgment offsets to the playable TypeScript port.

**Architecture:** A typed global ConVar registry owns every live gameplay constant and persists only overrides. Pure `Stacking` and `Mods` modules transform parser-independent gameplay data before the existing session and renderer consume it; the browser console and mod panel remain thin DOM adapters. The player applies offsets only to the gameplay/judgment timeline, leaving raw and interpolated clock diagnostics unchanged.

**Tech Stack:** TypeScript, Canvas 2D/WebGL2, HTMLAudioElement/Web Audio, localStorage, Node built-in tests, Vite.

## Global Constraints

- `/home/code/McOsu` is read-only and is the authoritative source for names, defaults, factors, signs, and stacking branches.
- Routine tests remain Node-only, deterministic, offline, and free of DOM/localStorage globals.
- Existing Watch autoplay and interactive Play must continue through the same judgment engine.
- `npm test` and `npm run build` must pass before committing on `main`.

---

### Task 1: Typed ConVar registry and defaults

**Files:**
- Create: `src/core/ConVar.ts`
- Create: `src/core/ConVars.ts`
- Test: `tests/ConVar.test.ts`
- Modify: `src/core/GameRules.ts`, `src/core/GameplaySession.ts`, `src/audio/InterpolatedClock.ts`, `src/render/Playfield.ts`

**Interfaces:**
- Produces: `ConVar<T>`, `ConVarRegistry`, `convars`, and named exported gameplay ConVars.
- Consumes: optional `StorageLike` for isolated persistence tests.

- [ ] Implement typed conversion, callbacks, reset, exact/prefix lookup, listing, and persisted non-default JSON overrides.
- [ ] Register McOsu defaults for interpolation, notelock, slider tracking/snaking, stacking, HD fades, universal offset, approach times, and hit windows.
- [ ] Replace the corresponding module constants with live `get*()` calls.
- [ ] Test typed setters, invalid values, callback behavior, reset, search ordering, restore, and default-value removal.

### Task 2: Console overlay and developer documentation

**Files:**
- Create: `src/ui/ConsoleOverlay.ts`
- Modify: `src/main.ts`, `src/style.css`, `README.md`

**Interfaces:**
- Consumes: `ConVarRegistry`.
- Produces: backtick-toggled command UI supporting `help`, `find <substring>`, variable reads/writes, history, and prefix completion.

- [ ] Build the DOM adapter without adding console behavior to Node tests.
- [ ] Initialize the overlay at boot and document registration, callbacks, persistence, and console commands for TypeScript contributors.

### Task 3: Standard stacking

**Files:**
- Create: `src/core/Stacking.ts`
- Modify: `src/data/GameplayLoader.ts`
- Test: `tests/Stacking.test.ts`

**Interfaces:**
- Produces: `calculateStackIndices(beatmap, options)` and `applyStacking(beatmap, options)`.
- Consumes: original circle positions and slider curves, file version, beatmap `StackLeniency`, AR, CS, and stacking ConVars.

- [ ] Port McOsu `calculateStacks()` version `>5` reverse algorithm, slider-end negative-stack case, spinner transparency, version `<=5` forward branch, `3 osu-pixel` lenience, and `0.05 * raw diameter` offset.
- [ ] Preserve original points for calculations and transform circle positions plus all slider absolute/relative control points consistently.
- [ ] Test simple circle chains, stack-window cutoff, slider-tail negative stacking, spinner transparency, old-format behavior, and applied offsets.

### Task 4: Gameplay mods and offset timeline

**Files:**
- Create: `src/core/Mods.ts`
- Modify: `src/core/Score.ts`, `src/core/GameplaySession.ts`, `src/render/Playfield.ts`, `src/ui/PlayerPanel.ts`, `src/ui/PlayfieldView.ts`, `src/data/OsuDatabase.ts`, `src/data/OsuBeatmapMetadata.ts`
- Test: `tests/Mods.test.ts`, `tests/Offsets.test.ts`

**Interfaces:**
- Produces: `GameplayMods`, `applyGameplayMods()`, `scoreMultiplierForMods()`, `gameplayPositionWithOffsets()`.
- Consumes: raw gameplay beatmap, database local offset, ConVars, and player speed/pitch controls.

- [ ] Port EZ/HR difficulty factors (`0.5`, HR `1.4`, HR CS `1.3`) with clamp `0..10`, HR Y flip, and stack application.
- [ ] Port score-v1 multipliers: EZ/NF `0.50`, HT `0.30`, HR `1.06`, DT/NC `1.12`, HD `1.06`; Auto remains unranked at the current score factor because McOsu excludes it from this function.
- [ ] Add mutually exclusive difficulty/speed mod controls and map DT/NC/HT to `1.5/1.5/0.75` plus pitch-preservation semantics.
- [ ] Port HD alpha percentages `1.0/0.6/0.6/0.3`, suppress approach circles except the first object when enabled, and retain NF as a no-fail selection.
- [ ] Apply `music + universalOffset * speed - databaseLocalOffset - browserLocalOffset` to frame judgments and timestamped clicks.
- [ ] Test factors, clamps, score multiplication, HR coordinates, HD alpha, speed semantics, and both offset signs.

### Task 5: Final verification and commit

**Files:**
- Verify all modified files and generated tests.

- [ ] Run `npm test` and require a zero exit status.
- [ ] Run `npm run build` and require a zero exit status.
- [ ] Run `git diff --check`, review the scoped staged diff, commit on `main`, and confirm a clean worktree.
