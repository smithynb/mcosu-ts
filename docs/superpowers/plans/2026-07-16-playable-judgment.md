# Playable Judgment Implementation Plan

> **For Codex:** Implement this plan task-by-task, keeping the judgment engine and tests DOM-free.

**Goal:** Add timestamped standard-mode input, McOsu-compatible object judgments and score v1, skin hitsounds, an interactive playfield HUD, autoplay through the same judgment engine, and end-of-map results.

**Architecture:** Extend the parser-independent gameplay boundary with resolved sample metadata, then drive a pure `GameplaySession` state machine once per animation frame. Browser-only input and audio adapters translate pointer/key events and skin files into state-machine input/events; the canvas renderer reads the resulting snapshot and animations. Watch and Play share the same session, differing only in whether frame input comes from the DOM adapter or the autoplay synthesizer.

**Tech Stack:** TypeScript, osu-parsers/osu-classes, Canvas 2D/WebGL2 layers, Web Audio, Node's built-in test runner.

---

### Task 1: Pure rules, scoring, and parser boundary

- Add `src/core/Score.ts` with score-v1 difficulty multiplier, combo/counts/max combo, accuracy, slider bonus, spinner spin/bonus score.
- Add `src/core/GameplaySession.ts` with circle, stable-default notelock, slider element tracking/tail leniency, spinner angle accumulation, and autoplay.
- Extend `src/data/GameplayLoader.ts` with hitSound/sample metadata required by the hitsound adapter.
- Add Node-only tests for all judgment boundaries, score arithmetic, notelock, slider tracking, and spinner rotation.

### Task 2: Browser input and hitsounds

- Add `src/input/GameplayInput.ts` for Z/X, optional mouse buttons, coalesced/raw pointer movement, timestamped one-frame click queues, held-state, and osu-coordinate conversion.
- Add `src/audio/HitSoundPlayer.ts` for preloaded Web Audio skin samples, fallback sample-set resolution, bitmask additions, first-gesture resume, and x-position stereo pan.

### Task 3: Interactive rendering and UI

- Extend skin loading for score digits, result sprites, and cursor.
- Feed session snapshots/events into `CanvasPlayfield`; hide judged objects, draw result fade/scale animation, cursor, combo, accuracy, spinner progress, and results overlay.
- Add a Play action beside Watch; interactive and autoplay modes share loading, playback speed, renderer, and judgment session.

### Task 4: Verification and commit

- Run `npm test` and `npm run build`.
- Review the scoped diff and repository status.
- Commit the phase on `main` with a focused message.
