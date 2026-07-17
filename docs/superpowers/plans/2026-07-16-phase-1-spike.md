# mcosu-ts Phase 1 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-first TypeScript spike that reconnects to a user-selected osu! folder, parses its legacy `osu!.db`, and displays searchable osu!standard beatmaps.

**Architecture:** Keep browser filesystem persistence in `src/fs`, binary decoding in a browser-independent `OsuFile` class, database-format alignment in `OsuDatabase`, and DOM rendering in `main.ts`. Reject database versions outside McOsu's safe legacy range rather than guessing at format drift.

**Tech Stack:** Vite, strict TypeScript, IndexedDB, File System Access API, Node's built-in test runner, plain DOM/CSS.

## Global Constraints

- Do not modify `/home/code/McOsu`.
- Ported code must cite the relevant McOsu source file and line region.
- The default build and database-reader test must be deterministic and offline after dependency installation.
- No UI framework.
- License the project GPL-3.0.

---

### Task 1: Pure binary reader and unit test

**Files:**
- Create: `src/data/OsuFile.ts`
- Create: `tests/OsuFile.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `new OsuFile(buffer)`, primitive read methods, `skip(bytes)`, `remaining`, and `offset`.

- [ ] Add Node tests covering signed integers, ULEB128 boundaries, empty and UTF-8 strings, floating-point values, dates, skipping, and truncated input.
- [ ] Run `npm run test:db` and confirm the test initially fails because the reader is absent.
- [ ] Implement a bounds-checked little-endian reader over `DataView`, returning `bigint` for 64-bit values and `Date` for .NET ticks.
- [ ] Run `npm run test:db` and confirm all reader tests pass.

### Task 2: Legacy osu!.db parser

**Files:**
- Create: `src/data/OsuDatabase.ts`

**Interfaces:**
- Consumes: `OsuFile` primitive and skip methods.
- Produces: `parseOsuDatabase(buffer): OsuDatabaseResult`, `BeatmapEntry`, and typed format/version errors.

- [ ] Port the header and beatmap-entry sequence from `OsuDatabase.cpp:1355-1565` exactly, including pre-20191107 entry sizes, all four mode star-rating blocks, timing points, and trailing flags.
- [ ] Keep no-mod osu!standard stars, consume every non-standard mode field, filter returned entries to mode `0`, and normalize Windows separators in folder paths.
- [ ] Enforce McOsu's supported range `20170222..20191114` with actionable errors; document the unreachable 20250108 star float gate as format drift rather than force-loading it.
- [ ] Run type-check/build to verify parser interfaces.

### Task 3: Browser filesystem adapter

**Files:**
- Create: `src/fs/types.ts`
- Create: `src/fs/idb.ts`
- Create: `src/fs/osuFileSystem.ts`

**Interfaces:**
- Produces: `isFileSystemAccessSupported`, `selectOsuFolder`, `reconnectOsuFolder`, and an `OsuFileSystem` with `getFile`, `listDir`, and `exists`.

- [ ] Declare the missing File System Access TypeScript interfaces without weakening strict mode.
- [ ] Store one directory handle in IndexedDB and restore it on load.
- [ ] Query permission first and request it only from user-initiated paths; return a clear unsupported-browser result when the picker API is absent.
- [ ] Resolve relative slash-delimited paths segment by segment and reject `.`/`..` traversal.

### Task 4: Song library UI and documentation

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Create: `README.md`
- Create: `LICENSE`

**Interfaces:**
- Consumes: filesystem adapter and `parseOsuDatabase`.

- [ ] Build the accessible selection, reconnect, status, search, count, and capped-list interactions.
- [ ] Style a responsive dark osu!-library index with visible focus states and reduced-motion handling.
- [ ] Explain Chromium support, folder permissions, commands, GPL provenance, and McOsu upstream in the README.
- [ ] Run `npm run build` and `npm run test:db`.

### Task 5: Repository handoff

**Files:**
- Create: `.gitignore`

- [ ] Inspect the final file inventory and ensure generated dependencies/build output are ignored.
- [ ] Initialize `main`, commit the verified Phase 1 spike, and confirm a clean working tree.
