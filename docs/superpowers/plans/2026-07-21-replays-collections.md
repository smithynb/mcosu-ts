# Replays and Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import and watch osu!standard replays through the existing judgment engine, record/re-watch browser plays, read stable and McOsu collections, and surface collection/local-score context in song select.

**Architecture:** A DOM-free replay boundary normalizes `osu-parsers` legacy frames into one compact delta/x/y/key format shared by imports and browser recordings. `ReplayPlayer` converts cumulative frames into the existing `GameplayFrameInput`, while `ReplayRecorder` captures interactive frames without changing judgment code. A bounded `CollectionsDatabase` parser reads either file format and merges same-name collections; main owns collection and score indexes for library filtering/badges, while `PlayerPanel` owns file/drop controls and replay launch.

**Tech Stack:** TypeScript, `osu-parsers` `ScoreDecoder`, `osu-classes` legacy replay types, existing gameplay/input/ScoreV1 modules, File System Access API, localStorage, Node built-in tests, Vite.

## Global Constraints

- `/home/code/McOsu` remains read-only and authoritative where replay mod/key semantics and collection loading behavior come from it.
- Imported `.osr` files must be osu!standard and their beatmap MD5 must exactly match the selected beatmap.
- The `-12345` RNG seed frame and legacy `(256,-500)` sentinel frames are metadata, never gameplay input.
- Local replay frames remain osu!-compatible delta/x/y/key records; binary `.osr` export is deferred.
- `collection.db`, custom `collections.db`, and scores.db remain read-only.
- Tests remain deterministic, offline, Node-only, and free of DOM/localStorage globals through injected storage.
- `npm test` and `npm run build` must pass before one `feat:` commit on `main`; finish with a clean worktree.

---

### Task 1: Normalize imported and recorded replay frames

**Files:**
- Create: `src/core/Replay.ts`
- Modify: `src/core/Mods.ts`
- Test: `tests/Replay.test.ts`

**Interfaces:**
- Produces: `ReplayFrame`, `ImportedReplay`, `parseReplay()`, `ReplayPlayer.inputAt()`, `ReplayRecorder.record()`, and `modsFromLegacy()`.
- Consumes: `ScoreDecoder`, `LegacyReplayFrame`, `GameplayFrameInput`, and legacy mod/key bitmasks.

- [x] Write synthetic-frame tests for cumulative deltas, key transitions, simultaneous keys, cursor state, the seed/sentinel quirk, and supported replay mod mapping.
- [x] Decode `.osr` with `ScoreDecoder.decodeFromBuffer(buffer, true)`, reject malformed/non-standard/no-frame scores, and retain normalized metadata and frames.
- [x] Map legacy key bits exactly: M1=`Left1`, M2=`Right1`, K1=`Left2`, K2=`Right2`; emit clicks only on rising edges and preserve held channels.
- [x] Record compact frames whenever cursor/key state changes (plus bounded keepalive), using cumulative music time converted to osu!-compatible deltas.
- [x] Run `npm test -- --test-name-pattern replay` and require all replay unit tests to pass.

### Task 2: Feed imported replay input through gameplay and apply replay mods

**Files:**
- Modify: `src/ui/PlayfieldView.ts`, `src/ui/PlayerPanel.ts`, `src/core/StandardPerformance.ts`
- Test: replay behavior remains in `tests/Replay.test.ts` and judgment behavior in `tests/GameplaySession.test.ts`

**Interfaces:**
- `PlayfieldView.open()` accepts optional replay frames and selects replay input instead of live input/autoplay.
- Ranking results include recorded frames for interactive plays.

- [x] Add `.osr` file input plus drag/drop affordance to the player panel and report parse/mode/MD5 errors without closing the current selection.
- [x] Apply replay NF/EZ/HD/HR/DT/NC/HT mods before stacking, performance, audio speed, and pitch setup.
- [x] Open replay mode with the ordinary HUD, hitsounds, health, score, and judgment engine; never invoke autoplay synthesis for replay playback.
- [x] Capture interactive inputs into `ReplayRecorder`, return frames with the ranking result, and allow Retry to reconstruct replay/recorder state.
- [x] Keep imported replay watching unranked and never overwrite the selected interactive mod controls.

### Task 3: Persist local replay frames and re-watch browser scores

**Files:**
- Modify: `src/data/LocalPlayStore.ts`, `src/data/ScoresDatabase.ts`, `src/ui/PlayerPanel.ts`, `src/ui/PlayfieldView.ts`
- Test: `tests/LocalPlayStore.test.ts`

**Interfaces:**
- `CompletedPlay` and browser `LocalScore` carry optional `replayFrames`; stable/McOsu score entries do not.

- [x] Extend versioned local play serialization with bounded, validated replay frames while continuing to read Phase 5a entries without frames.
- [x] Save ranking replay frames once with successful interactive plays and expose a Watch replay button only for scores that contain valid stored frames.
- [x] Launch stored frames with their saved legacy mods and selected beatmap MD5 through the same replay-watch path as imported `.osr` files.
- [x] Test old-entry compatibility, replay round-trip, malformed-frame rejection, de-duplication, and score sorting.

### Task 4: Parse and merge stable/custom collections

**Files:**
- Create: `src/data/CollectionsDatabase.ts`
- Test: `tests/CollectionsDatabase.test.ts`

**Interfaces:**
- Produces: `parseCollectionsDatabase(buffer, source)`, `mergeCollections()`, and `indexCollectionHashes()`.
- Consumes: existing `OsuFile` bounded readers.

- [x] Port `OsuDatabase.cpp:2536-2634` version/count/name/hash layout with explicit `stable` and `mcosu` source labels.
- [x] Enforce finite collection/entry caps, 32-character lowercase MD5 validation, supported custom version `<=20220110`, truncation handling, and exact buffer consumption.
- [x] Port `OsuDatabase.cpp:2677-2722` same-name merge semantics with hash de-duplication while preserving source labels.
- [x] Test stable/custom parsing, same-name merging, empty collections, malformed counts/hashes, unsupported custom versions, truncation, and trailing drift.

### Task 5: Collection filtering and local-best song badges

**Files:**
- Modify: `src/main.ts`, `src/ui/PlayerPanel.ts`, `src/style.css`
- Test: collection/index behavior remains in pure parser tests.

**Interfaces:**
- Main owns current collection and merged-score indexes; `PlayerPanel` publishes browser-score index changes back to main.

- [x] Load root `collection.db` and `collections.db` independently after folder selection, merge valid files, and keep library loading successful when either is missing/corrupt.
- [x] Add an All collections dropdown and filter beatmaps by selected collection MD5 intersection before text search and row limiting.
- [x] Render the best merged local grade on each matching song row and refresh badges after a browser play is saved.
- [x] Style replay import/drop, replay-watch buttons, collection select, and grade badges within the existing visual system.

### Task 6: Progress, verification, and commit

**Files:**
- Modify: `docs/master-plan.md`
- Verify: all changed files and generated tests

- [x] Update PROGRESS date, commit/test count, completed phase 5b entry, next-up text, and known gaps.
- [x] Run `npm test` and require a zero exit status.
- [x] Run `npm run build` and require a zero exit status.
- [x] Run a local Chromium startup smoke test for the new controls, then close the browser and dev server.
- [x] Run `git diff --check`, review staged scope, commit on `main` with a `feat:` message, and confirm a clean worktree.
