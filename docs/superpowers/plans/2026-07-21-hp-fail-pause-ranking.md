# HP, Fail, Pause, and Ranking Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add McOsu-compatible stable HP drain and failure, pause/retry flow without clock drift, a browser-appropriate fail slowdown, and a complete ranking screen that persists locally completed plays.

**Architecture:** A DOM-free `HealthSystem` owns stable drain calibration, runtime passive drain, event health deltas, failure eligibility, and fail animation progress. `GameplaySession` feeds judgment events into health and exposes health/fail/timing statistics in snapshots. `BeatmapClock` gains an explicit paused state while `PlayfieldView` coordinates pause/fail/ranking DOM and `PlayerPanel` owns audio pause, retry, quit, and local-play persistence callbacks. A pure storage module serializes browser plays and merges them with read-only scores.db entries.

**Tech Stack:** TypeScript, osu-parsers, existing ScoreV1/performance modules, HTMLAudioElement, DOM overlays, localStorage, Node built-in tests, Vite.

## Global Constraints

- `/home/code/McOsu` remains read-only and authoritative for HP, fail, and pause semantics.
- Default to McOsu's `osu_drain_type=2` stable algorithm; cite exact C++ regions at each port boundary.
- Stable passive drain reaching zero does not fail by itself (`osu_drain_stable_passive_fail=false`); a negative hit event at zero does.
- NF, Auto, and the pure API's Relax flag suppress failure. Auto remains unranked.
- Browser fail audio uses a bounded playback-rate ramp as an explicit approximation of McOsu's backend frequency ramp.
- Routine tests remain deterministic, offline, Node-only, and free of DOM/localStorage globals.
- scores.db remains read-only; browser-created scores use a separate localStorage record and merge only in presentation.
- `npm test` and `npm run build` must pass before one `feat:` commit on `main`; finish with a clean worktree.

---

### Task 1: Port stable health constants, gains, and drain calibration

**Files:**
- Modify: `src/core/ConVars.ts`, `src/data/GameplayLoader.ts`
- Create: `src/core/Health.ts`
- Test: `tests/Health.test.ts`, `tests/GameplayLoader.test.ts`

**Interfaces:**
- Produces: `healthIncrease()`, `calculateStableDrain()`, `HealthSystem`, `HealthSnapshot`, and explicit break ranges.
- Consumes: gameplay objects, HP difficulty, speed, breaks, and gameplay events.

- [x] Register exact defaults for `osu_drain_type`, `osu_drain_kill`, `osu_drain_stable_passive_fail`, stable break flags, spinner nerf, HP maximum, and `osu_fail_time` from `OsuBeatmap.cpp`/`OsuScore.cpp`.
- [x] Expose decoded break start/end times in the lean gameplay boundary in addition to aggregate break duration.
- [x] Port `OsuScore.cpp:415-531` stable health changes for 300/100/50/miss, combo-end geki/katu/mu, slider break/tick/30, and spinner spin/bonus.
- [x] Port `OsuBeatmapStandard.cpp:2197-2425` stable perfect-play drain calibration, including HP targets, long-object clamp, nested slider/spinner gains, versioned break behavior, and normal/combo multiplier adjustment loops.
- [x] Model runtime passive drain from `OsuBeatmap.cpp:1048-1148`: only active gameplay time, speed-scaled, break-aware, with the `0.25` spinner multiplier and stable passive-fail distinction.
- [x] Test exact gain values, calibration determinism, break exclusion, spinner nerf, passive-zero behavior, negative-hit fail, and NF/Auto/Relax suppression.

### Task 2: Integrate health, combo-end counts, and hit-error statistics

**Files:**
- Modify: `src/core/Score.ts`, `src/core/GameplaySession.ts`, `src/render/Playfield.ts`
- Test: `tests/Score.test.ts`, `tests/GameplaySession.test.ts`

**Interfaces:**
- Gameplay snapshots add health, failed/failing state, pause count, geki/katu counts, hit-error mean, and unstable rate.

- [x] Route every resolved judgment/slider/spinner event through `HealthSystem` exactly once and apply combo-end health at object combo boundaries.
- [x] Derive geki/katu counts with McOsu's combo-end bitmask behavior and retain hit deltas for mean and unstable-rate calculations.
- [x] Stop consuming gameplay input and judgment progression after failure while keeping fail animation/ranking state externally controllable.
- [x] Draw an HP bar in the canvas HUD and keep health live during autoplay, speed mods, and breaks.
- [x] Test event de-duplication, combo-end counts, failure freeze, health snapshots, mean hit error, and unstable rate.

### Task 3: Add pause-safe clock and browser fail animation control

**Files:**
- Modify: `src/audio/InterpolatedClock.ts`, `src/audio/MusicPlayer.ts`, `src/ui/PlayerPanel.ts`, `src/ui/PlayfieldView.ts`
- Test: `tests/InterpolatedClock.test.ts`, `tests/Health.test.ts`

**Interfaces:**
- `BeatmapClock` adds `PAUSED`, `pause()`, and `resume()`; the player/view exchange pause, resume, retry, quit, and fail-ramp callbacks.

- [x] Add a paused clock state that returns a frozen media position, resumes through a seek/synchronization frame, and does not advance waiting or finished virtual clocks while paused.
- [x] Make Escape open a DOM pause overlay in active interactive play; Continue resumes audio/clock, Retry restarts from zero, and Quit returns to the player panel.
- [x] Track pause count per play and reject repeated pause toggles during the fail animation.
- [x] Port the `2.25s` linear fail-animation timeline from `OsuBeatmap.cpp:1638-1665`; freeze judgment immediately and approximate McOsu frequency slowdown by ramping HTMLAudioElement playbackRate to a safe browser floor before pausing.
- [x] Ensure retry reconstructs session, health, performance, input, clock, and audio state without reloading the selected beatmap.
- [x] Test pause freeze/resume at WAITING/PLAYING/FINISHED boundaries and fail timeline progression with fake time sources.

### Task 4: Replace results with ranking and persist browser plays

**Files:**
- Create: `src/data/LocalPlayStore.ts`
- Modify: `src/data/ScoresDatabase.ts`, `src/ui/PlayfieldView.ts`, `src/ui/PlayerPanel.ts`, `src/style.css`
- Test: `tests/LocalPlayStore.test.ts`

**Interfaces:**
- Produces: versioned browser-score serialization with injected storage and merge/index helpers.
- Consumes: final score/grade/pp/mods/timing/pause statistics and selected beatmap identity.

- [x] Build a full DOM ranking screen for pass/fail with grade, score, accuracy, combo, 300/100/50/miss/geki/katu, pp, mods, mean error, unstable rate, pause count, Retry, and Back.
- [x] Save completed ranked plays once per run to versioned localStorage; serialize dates and 64-bit-safe score fields without DOM dependencies in the storage core.
- [x] Merge browser plays with scores.db entries for the selected MD5, sort consistently, and label browser versus stable/McOsu sources.
- [x] Keep failed and Auto plays out of ranked local-score persistence while still showing their ranking/fail summary.
- [x] Test malformed storage recovery, round trips, de-duplication of one run, MD5 indexing, source-preserving merge, and descending score order.

### Task 5: Progress, verification, and commit

**Files:**
- Modify: `docs/master-plan.md`
- Verify: all changed files and generated tests

- [x] Update PROGRESS date, commit/test count, completed phase 5a entry, next-up text, and known gaps.
- [x] Run `npm test` and require a zero exit status.
- [x] Run `npm run build` and require a zero exit status.
- [x] Run `git diff --check`, review staged scope, commit on `main` with a `feat:` message, and confirm a clean worktree.
