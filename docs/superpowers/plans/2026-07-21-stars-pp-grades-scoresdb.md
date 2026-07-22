# Stars, Performance Points, Grades, and scores.db Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lazy osu!standard star calculation, live/final pp, McOsu-compatible grades, and read-only local score browsing for osu!stable and McOsu score databases.

**Architecture:** A DOM-free `StandardPerformance` boundary owns the `osu-standard-stable` dependency, decoded beatmap, mod mapping, difficulty attributes, and score-to-pp conversion. A small queued cache computes no-mod stars only after song rows render and reuses results by beatmap identity. Pure `Grade` and `ScoresDatabase` modules port McOsu behavior; browser adapters load `scores.db` once, index by MD5, and pass selected-map scores to the player panel.

**Tech Stack:** TypeScript, `osu-standard-stable@5.0.1`, `osu-classes`, `osu-parsers`, File System Access API, Node built-in tests, Vite.

## Global Constraints

- `/home/code/McOsu` remains read-only and authoritative for grade and score database semantics.
- Routine tests remain deterministic, offline, Node-only, and free of DOM/localStorage globals.
- Star work must not block initial song-list rendering; calculations are queued/yielded and cached.
- scores.db support is read-only. Corrupt counts, unsupported custom versions, truncation, and trailing misalignment must fail clearly instead of returning shifted records.
- `npm test` and `npm run build` must pass before one `feat:` commit on `main`; finish with a clean worktree.

---

### Task 1: Install and isolate the osu!standard ruleset package

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/core/StandardPerformance.ts`
- Test: `tests/StandardPerformance.test.ts`

**Interfaces:**
- Produces: `modsToAcronyms()`, `StandardPerformanceContext`, `calculateStarRating()`, and `calculatePerformance()`.
- Consumes: decoded `IBeatmap`, `GameplayMods`, and the existing `ScoreSnapshot` fields.

- [ ] Add `osu-standard-stable@^5.0.1` using npm so the lockfile records the resolved dependency.
- [ ] Map supported gameplay mods to package acronyms (`NF/EZ/HD/HR/DT/NC/HT`; Auto is excluded from difficulty/performance mods).
- [ ] Decode `.osu` text once per performance context, calculate modded difficulty attributes, and retain max combo/object statistics.
- [ ] Convert current ScoreV1 counts/combo into package `ScoreInfo`; derive count300 for incomplete live play from resolved judgments only and calculate pp without mutating gameplay score state.
- [ ] Test deterministic no-mod/modded stars, acronym mapping, perfect versus miss-heavy pp, live partial counts, and finite output on empty/early state.

### Task 2: Lazy cached stars in the song library

**Files:**
- Create: `src/core/StarRatingCache.ts`
- Modify: `src/main.ts`, `src/style.css`
- Test: `tests/StarRatingCache.test.ts`

**Interfaces:**
- Produces: an injected-loader cache keyed by MD5 when available, otherwise normalized `.osu` path.
- Consumes: selected `OsuFileSystem`, `BeatmapEntry`, and `StandardPerformance` no-mod calculation.

- [ ] Render every song row immediately with the existing database rating or a pending placeholder.
- [ ] Queue visible-row calculations after DOM insertion, yield between synchronous difficulty calculations, and limit work to one calculation at a time.
- [ ] Cache in-flight and completed values, reject stale row updates after filtering/re-rendering, and fall back to the database rating/error marker without breaking selection.
- [ ] Test de-duplication, retry/error behavior, key selection, and serial queue ordering without DOM globals.

### Task 3: Live/final pp and McOsu grades

**Files:**
- Create: `src/core/Grade.ts`
- Modify: `src/core/Score.ts`, `src/core/GameplaySession.ts`, `src/render/Playfield.ts`, `src/ui/PlayfieldView.ts`, `src/ui/PlayerPanel.ts`
- Test: `tests/Grade.test.ts`, `tests/StandardPerformance.test.ts`

**Interfaces:**
- Produces: `calculateGrade()` returning `XH/SH/X/S/A/B/C/D` and performance values attached to gameplay snapshots.
- Consumes: ScoreV1 counts/combo, selected gameplay mods, and one prepared performance context.

- [ ] Port `OsuScore.cpp:644-668` exactly, including strict percentage comparisons and HD/Flashlight silver variants (FL supported by the pure API even though no FL selector exists yet).
- [ ] Prepare the performance context when Play/Watch opens and calculate live pp from each score snapshot using the same mod combination as star difficulty.
- [ ] Show live pp in the gameplay HUD and final pp plus grade in the results overlay; Auto remains visibly unranked/zero-pp rather than presented as a legitimate performance.
- [ ] Test every grade boundary, silver variants, zero-hit behavior, and representative pp monotonicity cases.

### Task 4: Read osu!stable and McOsu scores.db formats

**Files:**
- Create: `src/data/ScoresDatabase.ts`
- Modify: `src/data/OsuFile.ts` only if a missing bounded reader primitive is required
- Test: `tests/ScoresDatabase.test.ts`

**Interfaces:**
- Produces: `parseStableScoresDatabase()`, `parseMcOsuScoresDatabase()`, `parseScoresDatabase()` fallback detection, normalized `LocalScore`, and MD5 index helpers.
- Consumes: `ArrayBuffer` and the existing `OsuFile` primitive readers.

- [ ] Port stable entry layout from `OsuDatabase.cpp:2270-2414`: mode/version/hash/name/replay hash, hit counts, 32-bit score, combo/perfect/mods, life graph, Windows ticks, replay byte array, online-score-id gates, and Target extra accuracy.
- [ ] Port McOsu custom layout from `OsuDatabase.cpp:2078-2244`: custom DB/version cap `20210110`, imported-legacy flag gates, 64-bit timestamp/score, extended float difficulty/pp fields, post-20180722 object counts, and experimental-mod string.
- [ ] Normalize timestamps, clamp negative stable scores to zero, keep only osu!standard entries, preserve legacy mod bitmasks, and sort top scores by score descending with stable source ordering.
- [ ] Add bounded count/string/byte-array validation and exact-consumption checks; explicit format parsers stay available because old stable and custom date-version headers can be ambiguous.
- [ ] Build synthetic buffers covering stable version gates, Target payload, custom pre/post gates, mode filtering, malformed MD5/count/truncation, and sorting.

### Task 5: Load and surface selected-beatmap local scores

**Files:**
- Modify: `src/main.ts`, `src/ui/PlayerPanel.ts`, `src/style.css`
- Test: parser/index behavior remains in `tests/ScoresDatabase.test.ts`

**Interfaces:**
- Main loads root `scores.db` once and passes an MD5-indexed read-only view to `PlayerPanel`.

- [ ] Attempt stable parsing first for the selected osu! root, then guarded custom fallback; missing or corrupt scores never prevent library/audio loading.
- [ ] Show the selected beatmap's top local scores with player, score, combo, accuracy, grade, mods, date, and stored pp when available.
- [ ] Explain unavailable scores for raw-scan entries without an MD5 and keep the panel responsive during asynchronous database loading.

### Task 6: Progress, verification, and commit

**Files:**
- Modify: `docs/master-plan.md`
- Verify: all changed files and generated tests

- [ ] Update PROGRESS date, commit/test count, completed phase 4b entry, next-up text, and known gaps without editing the read-only canonical external plan.
- [ ] Run `npm test` and require a zero exit status.
- [ ] Run `npm run build` and require a zero exit status.
- [ ] Run `git diff --check`, review staged scope, commit on `main` with a `feat:` message, and confirm a clean worktree.
