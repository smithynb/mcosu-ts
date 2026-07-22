# Replay Fixes and Options Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct stable replay key-channel and collection-hash semantics, then add a persisted McOsu-style DOM options overlay backed directly by the shared ConVar registry.

**Architecture:** `ReplayPlayer` will normalize M/K duplicate bits into two logical sides at playback time while preserving the existing osu-compatible recorder format. Collection parsing will consume every declared string but retain only valid MD5s. A new `OptionsOverlay` will be a thin DOM adapter over existing/new exact-name McOsu ConVars, with pure numeric formatting/parsing helpers kept DOM-free and tested in Node.

**Tech Stack:** TypeScript, existing `ConVarRegistry`, DOM/CSS, Node built-in tests, Vite, read-only McOsu C++ reference.

## Global Constraints

- `/home/code/McOsu` remains read-only and authoritative for replay key semantics and ConVar names/defaults.
- Stable duplicate key pairs collapse as left=`M1|K1`, right=`M2|K2`; keyboard labels win when their bit is present.
- Replay recording remains one raw osu-compatible bit per input channel.
- Invalid collection hashes are skipped; structural corruption still fails parsing.
- Options controls use the shared ConVar registry and its existing localStorage persistence only.
- O opens options only outside gameplay; Escape closes it; the masthead also exposes an Options button.
- Node tests remain deterministic, offline, and free of DOM globals.
- `npm test` and `npm run build` must pass before commits on `main`; finish with a clean worktree.

---

### Task 1: Collapse stable replay duplicate key channels

**Files:**
- Modify: `src/core/Replay.ts`
- Modify: `tests/Replay.test.ts`

**Interfaces:**
- Consumes: raw `ReplayFrame.keys` values containing M1/M2/K1/K2 bits.
- Produces: unchanged `ReplayPlayer.inputAt(): GameplayFrameInput` with at most one logical click/held channel per side.

- [x] Add regression tests proving keys `5` emit one `KeyZ` click and alternating `5/10` taps emit exactly one left/right click each.
- [x] Replace per-bit rising-edge emission with two-side transitions and keyboard-preferred labels.
- [x] Collapse `heldInputs` and `held` through the same side mapping while leaving `ReplayRecorder` unchanged.
- [x] Run replay tests and require the new regressions to pass.

### Task 2: Match McOsu collection hash leniency

**Files:**
- Modify: `src/data/CollectionsDatabase.ts`
- Modify: `tests/CollectionsDatabase.test.ts`

**Interfaces:**
- `parseCollectionsDatabase()` continues consuming all declared strings and returns only valid lowercase 32-hex hashes.

- [x] Change malformed-hash coverage from whole-file rejection to collection retention with the bad hash omitted.
- [x] Keep negative/oversized counts, truncation, unsupported custom versions, and trailing bytes as errors.
- [x] Cite `OsuDatabase.cpp:2644-2650` at the skip branch and run collection tests.

### Task 3: Add exact McOsu option ConVars and pure value helpers

**Files:**
- Modify: `src/core/ConVars.ts`
- Create: `src/core/OptionValues.ts`
- Create: `tests/OptionValues.test.ts`
- Modify: `src/audio/HitSoundPlayer.ts`

**Interfaces:**
- Produces exact-name/default ConVars: `osu_background_dim=0.9`, `osu_background_fade_in_duration=0.85`, `osu_background_fade_out_duration=0.25`, `osu_skin=''`, `osu_volume_effects=1.0`.
- Produces `formatOptionValue()` and `parseBoundedOptionValue()` for DOM-independent slider behavior.

- [x] Add Node tests for percent/ms/seconds formatting, clamping, step rounding, and invalid numeric input.
- [x] Register only the exact C++ names/defaults from `OsuBeatmap.cpp:72-78`, `Osu.cpp:85`, and `OsuSkin.cpp:33`.
- [x] Apply `osu_volume_effects` at hitsound playback so changes affect subsequent sounds live.
- [x] Run option-helper and existing audio-independent tests.

### Task 4: Build the thin DOM options adapter

**Files:**
- Create: `src/ui/OptionsOverlay.ts`
- Modify: `src/ui/PlayerPanel.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`

**Interfaces:**
- `OptionsOverlay` consumes `ConVarRegistry` and `getSkinNames(): readonly string[]`; every input writes a registered ConVar and subscribes with `onChange()`.
- `PlayerPanel.skinNames()` exposes loaded local names and its skin selector mirrors `osu_skin`.

- [x] Build Gameplay controls for universal offset, notelock type, HP drain type, background dim, and fade-in/out durations.
- [x] Build Skin controls for current `osu_skin` and `osu_volume_effects`; synchronize the existing player skin selector through the same ConVar.
- [x] Build Input as a read-only Z/X and mouse binding reference, and General controls for music-position interpolation and slider snaking.
- [x] Add masthead Options button, O shortcut outside gameplay, Escape close, focus restoration, labelled sections, reset buttons, and responsive/focus-visible CSS.
- [x] Run a local Chromium smoke test for open/close, control updates, and zero console errors.

### Task 5: Progress, verification, and commits

**Files:**
- Modify: `docs/master-plan.md`
- Verify: all changed files

- [x] Update PROGRESS with the replay/collection corrections, options overlay, final test count, and next-up text.
- [x] Run `npm test`, `npm run build`, and `git diff --check` with zero failures.
- [x] Commit correctness fixes with `fix: collapse replay key channels` and options/docs with `feat: add ConVar options menu` (or one combined conventional commit if staging boundaries cannot stay coherent).
- [x] Confirm `main` and a clean worktree.
