# Lean TypeScript McOsu Rewrite — Feasibility & Plan

> **This is the project's master plan.** Canonical copy lives at
> `/root/.claude/plans/let-s-read-into-this-mighty-toast.md`; this file is the in-repo
> mirror — keep the PROGRESS section below updated in both places at each phase commit.
>
> **Workflow:** implementation increments are executed by Codex CLI sessions (resumable via
> `codex exec --skip-git-repo-check resume --last`, historically run from `/home/code/McOsu`),
> while Claude Code verifies each increment against the read-only C++ reference at
> `/home/code/McOsu` and dispatches the next phase. Per-phase implementation plans live in
> `docs/superpowers/plans/`.

## PROGRESS (updated 2026-07-21)

Repo: `/home/code/mcosu-ts` (git, `main`, 13 commits including this increment, 88 Node tests passing, `npm run build` clean). Implementation by Codex CLI; Claude verifies each increment against the C++ and dispatches the next.

Done (commit — content):
- `c296fb3` — phase 1 spike: Vite+TS scaffold, File System Access adapter (IndexedDB-persisted handle), OsuFile binary reader port, osu!.db parser, DOM song list + search.
- `f699c90` — modern 2025+ osu!.db versions (float star pairs @20250108, alignment validation), Songs-folder raw-scan fallback with progress, .osu metadata text parser.
- `5a3032b` — MusicPlayer (blob-URL audio, speed/pitch = DT/NC/HT), InterpolatedClock: exact port of `OsuBeatmap.cpp:2350` (verified line-by-line), BeatmapClock WAITING/PLAYING/FINISHED.
- `4ebf7b8` — GameRules port (AR/OD/CS math incl. 1.00041 constant), osu-parsers gameplay loading, skin subset (skin.ini, @2x, animations, combo colors), passive autoplay playfield on 2D canvas.
- `2e0bc8e` — SliderCurves port (B/C/L/P, equal-distance), WebGL2 depth-trick slider bodies (shader ported from slider.mcshader; runtime-verified in headless Chromium: compiles, draws, 0 GL errors), snaking, ticks, repeat arrows, slider ball.
- `509cf02` — playable: input queue (Z/X + pointer, coalesced/rawupdate), circle/slider/spinner judgment ports (notelock w/ 3ms 2B tolerance, follow-radius 1x/2.4x, tail −36ms), ScoreV1 + accuracy, WebAudio hitsounds w/ pan, HUD, results overlay.
- `4715b08` — ConVar registry + backtick console (localStorage persist, McOsu names/defaults), stacking port (modern+legacy branches), mods EZ/HR/HD/NF/DT/NC/HT/Auto with exact factors, universal/local offsets (signs match `OsuBeatmap.cpp:581`).
- `d587247` — phase 4b: lazy/cached no-mod stars and live/final pp via `osu-standard-stable`, exact McOsu grades, read-only osu!stable + McOsu custom `scores.db` parsing, selected-map top local scores.
- `25403c2` — phase 5a: stable HP drain calibration/gains, NF/Auto fail suppression, HP HUD, 2.25s browser fail slowdown, pause/retry/quit flow, full ranking statistics, and browser-local completed scores.
- `76e4bf3` — phase 5b: `.osr` import/watch through ScoreV1 judgments, osu-compatible browser replay recording and local persistence, stable/custom collection parsing and filtering, replay actions, and local-best grade badges.
- `40b2d72` — phase 5b corrections: collapse stable M/K duplicate replay bits into two logical input sides and skip malformed collection hashes like McOsu.
- options increment (this commit) — McOsu-structured DOM options overlay backed directly by persisted ConVars for gameplay, skin/effects volume, input reference, and general runtime behavior.

**Next up (phase 6)**: Tauri filesystem adapter and release wrapper, plus real-folder/replay parity testing on the native path.

Known gaps: scores.db, collection.db, and binary `.osr` write support are deferred (browser plays and replay frames use localStorage); McOsu custom `collections.db` is visible only when it is inside the selected browser folder; Flashlight and Relax gameplay are not implemented; no default-skin audio is bundled (silent hitsounds without user skin); browser fail slowdown approximates McOsu frequency control with playbackRate; spinner visuals remain a placeholder; no manual parity run with a real osu! folder and stable replay yet (needs Chromium + user gesture).

## Context

Goal: a lean TS rewrite of McOsu — no VR, FPoSu, mania, multiplayer, Steam workshop/integration. Local-only, reads a local osu! install (Songs folder, osu!.db, scores.db, collections, skins), delivers a great vanilla osu!standard experience, and is highly extensible for TS devs unfamiliar with C++.

**Verdict: viable and worth doing — as a reference-port, not a literal fork.** McOsu is 65.6k lines of C++ game code on top of McEngine (separate ~9MB C++ repo providing renderer/BASS audio/input/UI toolkit), so a TS version replaces both layers; there is nothing to "fork" in the git sense. But McOsu is the best available reference: readable, monolithic, gameplay logic self-contained, pp calc matches lazer. Excludable features are shallowly coupled (~7.1k lines, mostly if-guards). Prior browser clones (webosu, osu-online, osw) are abandoned/toy-grade and none read a local osu! install — the niche is open.

**Decisions made (user-confirmed):**
- Runtime: **web-first, Tauri wrap later.** Browser dev/play via File System Access API (Chromium directory picker for osu! folder); thin Tauri shell later for native FS + release binary. One codebase.
- Strategy: **hybrid port.** Port McOsu's gameplay "feel" core faithfully; reuse existing TS libs for parsing/pp; rebuild menus in DOM.

**Licensing:** McOsu is GPL-3.0 — the new project must be GPL-3.0 since it ports McOsu logic. McEngine is MIT (mostly replaced by browser APIs anyway).

## Architecture

```
new repo (GPL-3.0, TypeScript, Vite)
├── core/          ported from McOsu C++ (the "feel" layer)
│   ├── clock      ← OsuBeatmap.cpp:2350 getMusicPositionMSInterpolated (audio-pos interpolation, peppy constants)
│   ├── gamerules  ← OsuGameRules.h (AR/OD/CS/HP timing math, static, ~500 lines, ports near-1:1)
│   ├── hitobjects ← OsuHitObject/OsuCircle/OsuSlider/OsuSpinner (strip drawVR/draw3D virtuals + guards)
│   ├── curves     ← OsuSliderCurves (Bezier/Catmull/Linear/PerfectCircle, EqualDistanceMulti)
│   ├── score      ← OsuScore (combo/acc/live pp bookkeeping)
│   └── convar     ← ConVar system (~800 osu_* settings; the extensibility + config surface)
├── data/          mostly reused, thin ports
│   ├── osu-parsers + osu-classes (npm)   → .osu / .osr decode (lazer-based, maintained)
│   ├── osu-standard-stable (npm)         → star/pp calc (replaces 2.5k-line OsuDifficultyCalculator port; same lazer lineage → matching numbers)
│   └── binary db  ← OsuFile.cpp (only ~460 lines: ULEB128 strings, readByte/Int/etc.) → osu!.db, scores.db, collection.db
├── skin/          ported from OsuSkin/OsuSkinImage (skin.ini 2-pass parse, @2x, frame-probe animations, default-skin fallback, hitsound sets)
├── render/        WebGL2 playfield canvas
│   └── slider     ← OsuSliderRenderer + build/shaders/slider.mcshader (depth-buffered unit-circle cone mesh into framebuffer; shader is already GLSL-ish)
├── audio/         WebAudio: AudioContext clock, decoded-buffer hitsounds w/ pan, music via MediaElement
│   └── DT/NC/HT: playbackRate + preservesPitch (NC pitch-up = preservesPitch off); frequency ramp for fail anim
├── ui/            DOM/React overlay — NOT ported from CBaseUI
│   └── song select, options (bind directly to ConVars, mirroring OsuOptionsMenu's pattern), mod select, pause, ranking
└── fs/            File System Access API adapter (osu! folder handle, persisted permission) — swappable for Tauri FS later
```

Key layer boundary: **playfield + HUD on WebGL canvas** (ported render code); **all menus in DOM** (skips porting ~20k lines of C++ widget UI and CBaseUI toolkit; this is also the extensibility story for TS devs).

## What gets dropped vs ported (from code audit)

- Drop outright (~7.1k lines, shallow coupling): OsuVR* + VR UI, OsuModFPoSu, OsuMultiplayer, OsuSteamWorkshop, OsuRichPresence, OsuBeatmapMania/OsuManiaNote/OsuGameRulesMania, Osu2, OsuEditor stub. In ported files: strip `isInVRMode()`/`isInMultiplayer()` guards, `drawVR`/`draw3D*` virtuals, mania GAMEMODE branches.
- Port faithfully (feel-critical): interpolated music clock, OsuGameRules constants, hitobject update/hit-detection paths, slider curve math + stacking, notelock behavior, skin loading semantics, ConVar defaults.
- Reuse (don't port): .osu/.osr parsing, star/pp, storyboard basics — kionell npm packages.
- Rebuild (don't port): all menu screens, options UI, song browser carousel — DOM.

## Phased roadmap

1. **Skeleton + data**: Vite + TS repo, FS Access adapter, osu!.db binary reader (port OsuFile), song list in DOM. *Milestone: browse your real osu! library in the browser.*
2. **Audio + clock**: MediaElement music, WebAudio hitsounds, port interpolated clock. *Milestone: song plays, stable ms-accurate clock readout.*
3. **Gameplay core**: port GameRules, HitObject/Circle first (approach circles, hit windows, scoring), then Slider (curves + renderer + shader), then Spinner. Skin loader in parallel (needed for visuals). *Milestone: pass a real map with a real skin.*
4. **Feel + mods**: stacking, notelock, DT/NC/HT/HR/EZ/HD, offsets, ConVar console. Star/pp via osu-standard-stable, scores.db read/write.
5. **Vanilla polish**: mod select, pause/ranking screens, options bound to ConVars, replays (.osr via osu-parsers), collections.
6. **Tauri wrap**: native FS adapter, release binary.

Effort honesty: solo, this is months (~6+ to phase 5), not weeks. Phase 1–2 is a good cheap viability spike (~days) before committing.

## Hard parts to watch

- **Clock interpolation** (`OsuBeatmap.cpp:2350`): port constants exactly (delta/8 easing, 11/33 ms clamps, speed compensation). This is the game feel.
- **Slider body rendering**: depth-buffer cone trick needs WebGL2 framebuffer w/ depth attachment; port `slider.mcshader` uniforms (style, border/body colors, feather, mvp).
- **Input latency**: pointer rawupdate/`getCoalescedEvents`, canvas `desynchronized: true`, no DOM in the hot path.
- **FS Access API**: Chromium-only for directory picker — acceptable given Tauri endgame.

## Verification

- Phase gates above are each manually playable/inspectable in the browser.
- Clock: on-screen debug comparing raw `getPositionMS` vs interpolated, jitter < 1 frame.
- Parity: same map + mods in McOsu vs TS build — compare hit windows, star rating, pp (osu-standard-stable output vs McOsu's displayed values), slider snake/shape screenshots.
- Replay check: import a stable .osr, verify score/acc/combo reproduce.

## First concrete step (post-approval)

New repo scaffold + phase 1 spike: FS Access folder picker, port `OsuFile` binary reader to TS, parse local `osu!.db`, render song list. Proves the riskiest platform assumption (local install access from browser) immediately.
