# Audio Playback and Interpolated Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play beatmap audio from the selected osu! folder and expose McOsu-faithful raw, interpolated, waiting, and post-song clocks in an instrument-style debug panel.

**Architecture:** Keep `MusicPlayer` as the browser-only HTML media adapter, keep interpolation/state clocks pure and dependency-injected for Node tests, and isolate player-panel DOM/render-loop behavior in `src/ui`. Song rows pass their existing `BeatmapEntry` and current filesystem into the panel.

**Tech Stack:** Strict TypeScript, HTMLAudioElement, Blob URLs, requestAnimationFrame, File System Access API, Node built-in test runner, plain DOM/CSS.

## Global Constraints

- `/home/code/McOsu` remains read-only.
- Non-SDL interpolation multiplier is exactly `1.0`.
- Accurate-set window is exactly `1500 ms`; delta limits are exactly `11 ms` and `33 ms`.
- Easing divisor is exactly `8`; snap threshold is `2 * limit`; undershoot boost is `2x`; overshoot advance is `0.5x`.
- Routine clock tests are deterministic, Node-only, DOM-free, and offline.
- Existing database and metadata tests remain in the default test command.

---

### Task 1: Pure interpolated and beatmap clocks

**Files:**
- Create: `tests/InterpolatedClock.test.ts`
- Create: `src/audio/InterpolatedClock.ts`

**Interfaces:**
- Consumes: `AudioClockSource { getPositionMS(), isPlaying(), getSpeed(), getLengthMS() }` and injected `now(): number` in milliseconds.
- Produces: `InterpolatedClock.update(isLoading?)`, `markSeek()`, `reset()` and `BeatmapClock` state transitions `WAITING`, `PLAYING`, `FINISHED`.

- [ ] Add a fake time/audio source whose raw position changes every 32 ms while frames advance every 16 ms.
- [ ] Assert normal playback is monotonic and converges, average advancement scales at `1.5x` and `0.75x`, a marked seek bypasses interpolation for one frame, and a huge unmarked raw jump snaps immediately.
- [ ] Assert WAITING returns `(now - waitUntil) * speed`, PLAYING delegates to interpolation, and FINISHED returns `length + (now - finishedAt)` without speed scaling.
- [ ] Run `npm test` and confirm failure because the clock module is absent.
- [ ] Implement the exact algorithm from `OsuBeatmap.cpp:2350-2427`, citing every constant group at its source line.
- [ ] Run `npm test` and confirm the pure unit tests pass.

### Task 2: Browser music adapter

**Files:**
- Create: `src/audio/MusicPlayer.ts`

**Interfaces:**
- Consumes: `MusicPlayer.load(fileSystem, beatmap)` resolving `Songs/<folder>/<audioFile>`.
- Produces: `play`, `pause`, `stop`, `getPositionMS`, `setPositionMS`, `getLengthMS`, `isPlaying`, `setVolume`, `setSpeed`, `getSpeed`, `setPitchPreserved`, and `dispose`.

- [ ] Resolve the beatmap audio through `OsuFileSystem.getFile`, create an object URL, and wait for media metadata.
- [ ] Reject missing audio names, file errors, decode/codec errors, and non-finite media duration with actionable messages.
- [ ] Clamp position, volume, and playback speed to browser-safe values; set `preservesPitch`, `mozPreservesPitch`, and `webkitPreservesPitch` together.
- [ ] Revoke the object URL on load failure or disposal and pause before replacement.

### Task 3: Timing-instrument player panel

**Files:**
- Create: `src/ui/PlayerPanel.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `PlayerPanel.open(beatmap, fileSystem)` from clickable song rows.
- Produces: accessible playback, seek, speed, pitch, raw/interpolated readout, and rolling jitter controls.

- [ ] Add a hidden panel with a restrained audio-instrument layout: song identity, transport rail, three speed keys, pitch toggle, paired clock counters, and rolling jitter telemetry.
- [ ] Make each song row a real button and open/load its audio without autoplay.
- [ ] Drive readouts with one requestAnimationFrame loop, retain two seconds of interpolated per-frame deltas, and compute min/max/population standard deviation.
- [ ] Reset jitter on load/seek/speed changes, mark seek frames, detect media end, and continue FINISHED time virtually past the loaded duration.
- [ ] Preserve keyboard focus, responsive layout, and reduced-motion behavior.

### Task 4: Commands, documentation, and handoff

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `npm test` for all unit tests, retained `npm run test:db` compatibility, and a clean main-branch commit.

- [ ] Add `test` as the plain all-tests command while retaining `test:db` as an alias.
- [ ] Document browser codec dependence, Blob URL lifetime, pitch behavior, and the interpolation constants/deviation from McOsu's backend-specific slow-speed compensation.
- [ ] Run `npm test`, `npm run test:db`, and `npm run build`.
- [ ] Run `git diff --check`, inspect staged scope, and commit `feat: add audio playback clock`.
- [ ] Confirm clean `main` and report exact C++ constants plus HTMLAudioElement deviations.
