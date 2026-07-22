# Spinner, Replay Export, and Scores Database Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the remaining browser-port gaps before Tauri by rendering McOsu-style spinners, exporting real osu! replays and McOsu custom score databases, and providing original generated default hitsounds.

**Architecture:** Spinner judgment state will expose a small DOM-free visual snapshot consumed by the existing canvas renderer and optional skin assets. Replay export will translate stored `ReplayFrame` and `LocalScore` data into osu-classes objects for `osu-parsers` `ScoreEncoder`, while a dedicated little-endian writer will serialize the already-supported McOsu custom scores schema. Default hitsounds will be deterministic synthesized PCM WAV files loaded only after beatmap and user-skin samples fail.

**Tech Stack:** TypeScript, Canvas 2D, existing skin/fs/audio adapters, `osu-classes`, `osu-parsers`, Node built-in tests, Vite, read-only McOsu C++ reference.

## Global Constraints

- `/home/code/McOsu` remains read-only and authoritative for spinner drawing and custom `scores.db` field order.
- `.osr` output must decode through `ScoreDecoder` with beatmap hash, player/mod metadata, and legacy replay frames preserved.
- Custom `scores.db` output uses version `20210110`, writes browser-owned plays only, and round-trips through `parseMcOsuScoresDatabase()`.
- Default sounds are original deterministic synthesis; no osu! or McOsu audio assets are copied.
- Missing spinner skin images and unavailable default audio continue through procedural/silent-safe fallbacks rather than failing gameplay.
- Node tests remain deterministic, offline, and free of DOM globals.
- `npm test` and `npm run build` must pass before commits on `main`; finish with a clean worktree.

---

### Task 1: Expose deterministic spinner visual state

**Files:**
- Modify: `src/core/GameplaySession.ts`
- Modify: `tests/GameplaySession.test.ts`

**Interfaces:**
- `GameplaySnapshot.spinnerStates` exposes per-object rotation, required-spin ratio, RPM, clear state, and bonus count without canvas or DOM types.

- [x] Add Node tests for progress/clear/bonus transitions and a bounded RPM value from synthetic spinner input.
- [x] Extend spinner state with signed draw rotation and rolling RPM derived from the existing moving-angle window.
- [x] Preserve current judgment/scoring behavior and cite `OsuSpinner.cpp:288-414,490-536` where the visual values originate.
- [x] Run focused gameplay-session tests.

### Task 2: Port spinner skin layers and canvas drawing

**Files:**
- Modify: `src/skin/Skin.ts`
- Modify: `src/render/Playfield.ts`
- Modify: `tests/Skin.test.ts`

**Interfaces:**
- `LoadedSkin` gains optional spinner background/circle/approach/bottom/middle/middle2/top/spin/clear assets through the existing `SkinImage` loader.
- `CanvasPlayfield` consumes `GameplaySnapshot.spinnerStates` and falls back to procedural rings/text when layers are absent.

- [x] Extend skin loading with the exact `spinner-*` names from `OsuSkin.cpp:726-734` and retain @2x/animation behavior.
- [x] Render old/new skin layer ordering, rotation divisors, finish scaling, shrinking approach circle, SPIN/CLEAR prompts, RPM, progress/glow, and bonus count following `OsuSpinner.cpp:78-267`.
- [x] Keep Hidden suppression and fade behavior consistent with the existing renderer.
- [x] Add pure/skin fixture assertions where practical and verify procedural fallback builds without assets.

### Task 3: Encode downloadable `.osr` replays

**Files:**
- Create: `src/data/ReplayExport.ts`
- Create: `tests/ReplayExport.test.ts`
- Modify: `src/ui/PlayerPanel.ts`

**Interfaces:**
- `encodeReplay(score: LocalScore): Promise<Uint8Array>` accepts a browser score with frames and returns a stable-compatible `.osr` payload.
- Local score rows with frames expose separate Watch and Export actions.

- [x] Write a Node round-trip test using `ScoreEncoder` then `ScoreDecoder`, asserting MD5, mods, hit counts, player, and legacy frames survive LZMA encoding.
- [x] Map `ReplayFrame` values to `LegacyReplayFrame` and local score metadata to `ScoreInfo`/`Replay` without introducing a second replay format.
- [x] Add Blob download behavior with a filesystem-safe `.osr` filename and clear row-level errors.
- [x] Run replay import/export tests offline.

### Task 4: Write McOsu custom `scores.db`

**Files:**
- Create: `src/data/OsuFileWriter.ts`
- Modify: `src/data/ScoresDatabase.ts`
- Create: `tests/ScoresDatabaseWriter.test.ts`
- Modify: `src/data/LocalPlayStore.ts`
- Modify: `src/ui/PlayerPanel.ts`

**Interfaces:**
- `encodeMcOsuScoresDatabase(scores: readonly LocalScore[]): Uint8Array` serializes valid browser scores grouped by MD5 using custom version `20210110`.
- `LocalPlayStore.scores()` remains the source of browser-owned export rows.

- [x] Add little-endian primitive/string writing with explicit range checks matching `OsuFile` encodings.
- [x] Port `OsuDatabase.cpp:2420-2517` field order, `0xA9` imported flag semantics, post-`20180722` fields, and non-legacy push conditions using safe defaults for unavailable analytics.
- [x] Round-trip multiple beatmaps/scores through the existing custom parser and assert ordering/core fields.
- [x] Add a player-panel Download `scores.db` action that exports browser plays only and disables cleanly when none exist.

### Task 5: Bundle original generated default hitsounds

**Files:**
- Create: `scripts/generate-default-hitsounds.mjs`
- Create: `public/default-hitsounds/README.md`
- Create: `public/default-hitsounds/normal-hitnormal.wav`
- Create: `public/default-hitsounds/normal-hitwhistle.wav`
- Create: `public/default-hitsounds/normal-hitfinish.wav`
- Create: `public/default-hitsounds/normal-hitclap.wav`
- Modify: `src/audio/HitSoundPlayer.ts`
- Create: `tests/DefaultHitSounds.test.ts`
- Modify: `package.json`

**Interfaces:**
- The existing hitsound lookup falls back from beatmap/user-skin samples to `/default-hitsounds/normal-hit*.wav` and still respects `osu_volume_effects`.

- [x] Add a deterministic synthesis script and commit its tiny PCM WAV outputs with provenance/license documentation.
- [x] Test WAV headers, sample parameters, non-empty signal data, and deterministic regeneration offline.
- [x] Fetch/decode generated defaults only after mapped beatmap and skin candidates fail; map soft/drum misses to the normal fallback set.
- [x] Verify gameplay remains non-fatal if fetch or decode fails.

### Task 6: Progress, browser smoke, verification, and commits

**Files:**
- Modify: `docs/master-plan.md`
- Modify: `README.md`
- Verify: all changed files

- [x] Document replay/scores exports and synthesized hitsound provenance; update PROGRESS with final test count and the Tauri-wrap next step.
- [x] Smoke-test spinner fallback plus local-score `.osr`/`scores.db` download controls in Chromium with no console errors.
- [x] Run `npm test`, `npm run build`, and `git diff --check` with zero failures.
- [x] Commit in logical conventional-commit units (or one `feat:` commit if boundaries are inseparable), confirm `main`, and leave a clean worktree.
