# Tauri v2 Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the browser-first Vite application in a Tauri v2 desktop shell with a root-confined native osu! filesystem adapter while preserving the existing browser workflow unchanged.

**Architecture:** The current concrete browser filesystem class will become one implementation of a small `OsuFileSystem` interface. A runtime selector will lazily load a Tauri adapter only when `window.__TAURI_INTERNALS__` is present; that adapter uses the native dialog plugin for folder selection and dedicated Rust commands for persistence and root-confined reads, directory listings, and existence checks. The Rust shell owns the canonical selected root in managed state and persists it under Tauri's app config directory.

**Tech Stack:** TypeScript, Vite, Node built-in tests, Tauri CLI 2.11.4, Tauri crate 2.11.5, `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, Rust 2021 edition, WebKitGTK 4.1.

## Global Constraints

- `npm run dev` and `npm run build` remain browser-first and retain File System Access plus IndexedDB behavior.
- Add `npm run tauri:dev` and `npm run tauri:build`; do not launch a GUI during automated verification.
- The app identifier is `dev.mcosu.ts`, title/product name is `mcosu-ts`, and Rust/package metadata is GPL-3.0.
- Native paths are always resolved relative to one canonical selected root and symlink escapes are rejected server-side.
- The selected native root is persisted in Tauri's app config directory, never IndexedDB.
- WebKitGTK inside Tauri is supported even though `showDirectoryPicker` is absent.
- Routine Node tests remain deterministic, offline, and free of Tauri/WebKit globals.
- Acceptance gates are `npm test`, `npm run build`, and `cargo check` or `cargo build --debug` in `src-tauri`; no AppImage launch is attempted.
- Commit on `main` with a `feat:` message and finish with a clean worktree.

---

### Task 1: Establish a swappable filesystem contract

**Files:**
- Modify: `src/fs/types.ts`
- Modify: `src/fs/osuFileSystem.ts`
- Modify: filesystem type imports under `src/audio/`, `src/data/`, `src/skin/`, and `src/ui/`
- Create: `tests/FileSystemRuntime.test.ts`

**Interfaces:**
- Produces `OsuFileSystem` with `root: { name: string }`, `getFile(path): Promise<File>`, `listDir(path?): Promise<DirectoryEntry[]>`, and `exists(path): Promise<boolean>`.
- Produces `normalizeRelativePath(path): string` for shared traversal rejection.

- [x] Add Node unit tests for slash normalization, empty-root handling, and rejection of `.`, `..`, and absolute paths.
- [x] Move the public shape into `src/fs/types.ts` and rename the existing concrete implementation to `BrowserOsuFileSystem`.
- [x] Preserve browser selection, reconnect, permission, sorting, and IndexedDB behavior behind the interface.
- [x] Update consumers to import the interface from `src/fs/types.ts` without changing application behavior.
- [x] Run the focused filesystem tests and TypeScript build.

### Task 2: Add the root-confined Tauri adapter

**Files:**
- Create: `src/fs/tauriFileSystem.ts`
- Extend: `tests/FileSystemRuntime.test.ts`
- Create: `src/fs/runtimeFileSystem.ts`

**Interfaces:**
- `TauriOsuFileSystem` consumes an injected `NativeInvoker` in tests and implements `OsuFileSystem`.
- `selectOsuFolder()`, `reconnectOsuFolder()`, `isOsuFileSystemSupported()`, and `isTauriRuntime()` provide the only runtime-specific entry points used by `main.ts`.

- [x] Test Tauri command names/payloads, returned byte-to-`File` conversion, sorted listings, missing-root reconnect, and dialog cancellation with fake functions only.
- [x] Implement the native adapter with lazy `@tauri-apps/api/core` and dialog imports so the browser path never executes native code.
- [x] Add runtime detection based on `window.__TAURI_INTERNALS__` and delegate browser/native select and reconnect calls through one facade.
- [x] Keep unsupported-browser messaging unchanged outside Tauri and run focused tests.

### Task 3: Create the Tauri v2 Rust shell and commands

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/Cargo.lock`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/.gitignore`

**Interfaces:**
- Rust commands: `get_root`, `set_root`, `read_file`, `list_dir`, and `path_exists`.
- `set_root` canonicalizes a directory and writes its path to the app config directory; all data commands re-check confinement after canonicalization.

- [x] Install current stable Tauri npm packages and add browser/native scripts without changing existing script semantics.
- [x] Add Tauri package/config metadata, Vite build/dev wiring, one desktop window, dialog capability, and GPL metadata.
- [x] Implement managed root state, config-file load/save, traversal component rejection, canonical root enforcement, and symlink-escape rejection.
- [x] Register the dialog plugin and command handler in `lib.rs` without adding broad fs-plugin scope.
- [x] Run `cargo fmt --check`, `cargo test`, and `cargo check` from `src-tauri`.

### Task 4: Route the existing UI through runtime selection

**Files:**
- Modify: `src/main.ts`
- Modify: `src/fs/types.ts`
- Modify: `README.md`

**Interfaces:**
- Existing song-library, player, skin, scores, collections, and raw-scan code continue receiving only `OsuFileSystem`.

- [x] Replace direct browser filesystem imports in `main.ts` with the runtime facade.
- [x] Allow the support gate and select button inside Tauri even when `showDirectoryPicker` is unavailable.
- [x] Use interface-level root display names so status copy is identical across runtimes.
- [x] Document browser and Tauri commands, native folder persistence, and the no-GUI verification boundary.
- [x] Run `npm test` and `npm run build` to prove browser behavior still compiles and tests offline.

### Task 5: Progress, native verification, and commit

**Files:**
- Modify: `docs/master-plan.md`
- Verify: all changed files

- [x] Update PROGRESS with Phase 6 completion, final test count, native compile result, and remaining release-parity work.
- [x] Run `npm test`, `npm run build`, `cargo fmt --check`, `cargo test`, `cargo check`, and `git diff --check` with zero failures.
- [x] If bundling is attempted and the headless host blocks AppImage packaging, document `cargo check`/debug shell compilation as the accepted gate rather than launching a window.
- [x] Commit with `feat: add Tauri native shell`, confirm `main`, and leave a clean worktree.
