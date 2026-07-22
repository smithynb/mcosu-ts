# mcosu-ts

`mcosu-ts` is a browser-first TypeScript spike for reading an existing osu!stable song library. It asks you to select the osu! installation folder, reads `osu!.db` locally, and displays a searchable list of osu!standard beatmaps. If the database is missing or unusable, it automatically scans metadata from `Songs/*/*.osu`. No files are uploaded.

## Browser support

Use a Chromium-based desktop browser that exposes the File System Access API's `showDirectoryPicker`, such as Chrome or Edge. Browsers without that API are reported as unsupported.

Select the osu! installation root—the folder containing both `osu!.db` and normally `Songs`—rather than the `Songs` folder itself. The browser stores the selected directory handle in IndexedDB. It may still ask you to restore permission after a restart; permission is requested only from a user action.

## Development

Requires a current Node.js release supported by Vite 8.

```sh
npm install
npm run dev
npm run build
npm test
```

The build and Node-only rules/database tests are deterministic and require no network access after dependencies are installed. `npm run test:db` remains an alias for the full suite.

### ConVars

Gameplay constants live in `src/core/ConVars.ts` as typed McOsu-style ConVars. Register a value through the shared registry and retain the returned object:

```ts
export const osuExample = convars.register({
  name: 'osu_example',
  kind: 'float',
  defaultValue: 1,
  description: 'Shown by the in-app console.',
})

osuExample.getFloat()
osuExample.onChange((value, previous) => updateLiveState(value, previous))
```

Supported kinds are `float`, `int`, `bool`, and `string`; every ConVar also exposes `getFloat`, `getInt`, `getBool`, `getString`, `setValue`, and `reset`. Non-default values are persisted together in localStorage and restored as modules register at boot.

Press backtick in the app to open the console. Use `help`, `find <substring>`, `<name>` to inspect a variable, `<name> <value>` to change it, or `reset <name>`. Up/down navigates command history and Tab completes registry prefixes.

## Database formats and raw fallback

Phase 1 accepts `osu!.db` versions from `20170222` onward. Earlier databases are rejected with an update prompt and fall back to scanning the Songs directory. Each database entry is sanity-checked, and the parser accepts either no trailer or the documented four-byte permissions trailer; unexpected bytes abort database loading and trigger the raw fallback rather than displaying shifted garbage.

The parser follows McOsu's field order and consumes all four mode star-rating blocks before returning only mode `0` (osu!standard) entries. Two upstream format details are notably ambiguous or easy to implement incorrectly:

- Stable stopped prefixing beatmap entries with a byte size at version `20191107`. McOsu explicitly uses that date, while noting that the osu! wiki revision says `20191106`.
- McOsu switches star-rating values from 64-bit doubles to 32-bit floats at version `20250108`. The official format also changes the pair tag from `0x0d` (Int–Double) to `0x0c` (Int–Float), while McOsu reads and discards that tag without validating it.

The database stores beatmap folder paths in Windows form in some installations, including nested paths with backslashes. These are normalized to slash-delimited paths for browser traversal. Timing points are treated as two little-endian doubles followed by one byte, as implemented by McOsu's `OsuFile::readTimingPoint`.

The raw fallback reads only `[General]`, `[Metadata]`, and `[Difficulty]` from `.osu` files and stops before hit objects. It scans one Songs folder at a time so the UI can report progress. Raw entries do not calculate MD5 hashes, durations, or star ratings; those values are empty, zero, and unavailable respectively.

## Audio and gameplay clock

Select a beatmap row to open the playback laboratory. Audio is read from `Songs/<beatmap folder>/<AudioFilename>`, exposed to an `HTMLAudioElement` through a temporary Blob URL, and never uploaded. The URL is revoked when another beatmap is selected. Playback support depends on the browser's installed codecs; unsupported or corrupt audio is reported in the panel.

The gameplay clock ports McOsu's non-SDL interpolation path from `OsuBeatmap.cpp:2350-2427`: a `1.0` interpolation multiplier, `11 ms` error limit for the first `1500 ms` after an accurate sample or whenever speed is below `1.0x`, otherwise `33 ms`, delta easing by `1/8`, snap beyond twice the active limit, `2x` undershoot advancement, and `0.5x` overshoot advancement. Seek/loading frames bypass interpolation. Waiting time is negative and speed-scaled; post-song virtual time continues from the decoded duration in unscaled real milliseconds.

`preservesPitch` and its WebKit/Mozilla-prefixed variants are set together. At `1.5x`, preserved pitch behaves like DoubleTime; disabled pitch preservation behaves approximately like Nightcore. Unlike McOsu's sound backend, browser `currentTime` already reports media timeline time at `playbackRate`, so the backend-specific slow-speed pitch compensation of up to five milliseconds is not applied.

## Local score and replay exports

Completed browser plays keep osu!-compatible replay frames in localStorage. A score row can download those frames as a real `.osr` file encoded by `osu-parsers` (including its LZMA frame block), or watch them through the same judgment engine. The player panel can also download all browser-owned plays as McOsu's custom `scores.db` version `20210110`; imported stable/McOsu rows are intentionally not copied into that export.

When a beatmap and selected skin provide no usable hitsound, gameplay falls back to four tiny original PCM WAV samples in `public/default-hitsounds`. They are deterministic synthesis from `scripts/generate-default-hitsounds.mjs`, not copied game or skin assets; provenance and reuse terms are documented beside the generated files.

## Provenance and license

The binary reader and database layout are TypeScript ports derived from [McOsu](https://github.com/McKay42/McOsu), with source regions cited in the implementation. McOsu is licensed under GPL-3.0.

This project is distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
