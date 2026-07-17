# Modern Database and Raw Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read current 2025+ osu!stable databases and automatically recover by incrementally scanning `Songs/*/*.osu` when `osu!.db` is absent or unusable.

**Architecture:** Keep binary layout handling in `OsuDatabase.ts`, pure `.osu` text parsing in a new data module, and browser directory traversal in a new raw-library module built on `OsuFileSystem`. The UI tries the database first, catches any database read/format failure, then scans raw folders while reporting folder-level progress.

**Tech Stack:** Strict TypeScript, Vite, File System Access API, Node built-in test runner, plain DOM/CSS.

## Global Constraints

- `/home/code/McOsu` is a read-only reference.
- Parse star ratings as `double` before database version `20250108` and `float` from that version onward.
- Consume the entry-size integer only before database version `20191107`.
- Routine tests remain deterministic, Node-only, and offline.
- Raw entries have no calculated star rating.

---

### Task 1: Versioned database fixtures and alignment guard

**Files:**
- Create: `tests/OsuDatabase.test.ts`
- Modify: `src/data/OsuDatabase.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseOsuDatabase(buffer: ArrayBuffer)`
- Produces: current-version parsing plus clear `OsuFileFormatError` failures for invalid entry alignment or trailing bytes.

- [ ] Build synthetic one-entry buffers for versions `20170222`, `20191114`, and `20250108`, encoding the entry-size prefix and star-rating width at their exact version gates.
- [ ] Assert the same public `BeatmapEntry` values for each layout and assert malformed mode/trailing-byte fixtures fail clearly.
- [ ] Run `npm run test:db` and confirm the modern fixture fails under the old ceiling.
- [ ] Remove the upper-version rejection, read the gated star width, validate mode/numeric fields, wrap entry failures with entry index/offset, and accept only zero bytes or the documented four-byte permissions trailer after all entries.
- [ ] Run `npm run test:db` and confirm all database fixtures pass.

### Task 2: Pure `.osu` metadata parser

**Files:**
- Create: `src/data/OsuBeatmapMetadata.ts`
- Create: `tests/OsuBeatmapMetadata.test.ts`

**Interfaces:**
- Produces: `parseOsuBeatmapMetadata(text, folder, fileName): BeatmapEntry | null`.

- [ ] Add synthetic text fixtures covering spaced values, colons inside values, comments, missing `ApproachRate`, non-standard mode filtering, and malformed numeric values.
- [ ] Run `npm run test:db` and confirm the missing parser fails.
- [ ] Parse only `[General]`, `[Metadata]`, and `[Difficulty]`; stop at `[HitObjects]`; default mode to standard and AR to OD when omitted, matching McOsu's metadata defaults/compatibility behavior.
- [ ] Return `null` for non-standard or unusable metadata and return `starRating: undefined`, `length: 0`, and an empty MD5 for valid raw entries.
- [ ] Run `npm run test:db` and confirm parser tests pass offline.

### Task 3: Incremental raw Songs scan

**Files:**
- Create: `src/data/RawSongsLibrary.ts`
- Modify: `src/fs/osuFileSystem.ts`

**Interfaces:**
- Produces: `scanRawSongs(fileSystem, onProgress): Promise<RawSongsResult>` and `RawScanProgress { scannedFolders, totalFolders }`.

- [ ] Add a filesystem helper that distinguishes missing paths without weakening traversal protection.
- [ ] Enumerate directory entries under `Songs`, retain folders, list each folder's `.osu` files case-insensitively, parse their text, and collect valid standard entries.
- [ ] Invoke progress once before work and after each folder, and yield to the browser event loop between folders so status paint/input is not starved.
- [ ] Treat an unreadable individual file/folder as skippable while surfacing a missing/unreadable top-level `Songs` directory as a clear scan error.

### Task 4: Automatic UI fallback

**Files:**
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: database parser and `scanRawSongs`.

- [ ] Try `osu!.db` when present; on missing/read/format failure, change status to the fallback reason and start a raw scan automatically.
- [ ] Render `Scanning N/M Songs folders…` from the callback and publish raw results through the same searchable library state.
- [ ] Preserve the database error when fallback also fails so the final message explains both causes.
- [ ] Update UI copy and README format notes for modern databases, permissions trailer validation, and raw-scan limitations.

### Task 5: Verification and handoff

**Files:**
- Modify: phase files above only.

**Interfaces:**
- Produces: one clean commit on `main` following the existing phase-1 commit.

- [ ] Run `npm run test:db`; expect all pure reader, layout, and metadata tests to pass offline.
- [ ] Run `npm run build`; expect strict TypeScript and Vite production build to pass.
- [ ] Run `git diff --check`, inspect the staged inventory, and commit with `feat: add modern database fallback`.
- [ ] Confirm `git status --short --branch` reports clean `main` and report exact format decisions and unresolved C++ ambiguities.
