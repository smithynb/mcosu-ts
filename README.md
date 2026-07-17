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
npm run test:db
```

The build and database-reader tests are deterministic and require no network access after dependencies are installed.

## Database formats and raw fallback

Phase 1 accepts `osu!.db` versions from `20170222` onward. Earlier databases are rejected with an update prompt and fall back to scanning the Songs directory. Each database entry is sanity-checked, and the parser accepts either no trailer or the documented four-byte permissions trailer; unexpected bytes abort database loading and trigger the raw fallback rather than displaying shifted garbage.

The parser follows McOsu's field order and consumes all four mode star-rating blocks before returning only mode `0` (osu!standard) entries. Two upstream format details are notably ambiguous or easy to implement incorrectly:

- Stable stopped prefixing beatmap entries with a byte size at version `20191107`. McOsu explicitly uses that date, while noting that the osu! wiki revision says `20191106`.
- McOsu switches star-rating values from 64-bit doubles to 32-bit floats at version `20250108`. The official format also changes the pair tag from `0x0d` (Int–Double) to `0x0c` (Int–Float), while McOsu reads and discards that tag without validating it.

The database stores beatmap folder paths in Windows form in some installations, including nested paths with backslashes. These are normalized to slash-delimited paths for browser traversal. Timing points are treated as two little-endian doubles followed by one byte, as implemented by McOsu's `OsuFile::readTimingPoint`.

The raw fallback reads only `[General]`, `[Metadata]`, and `[Difficulty]` from `.osu` files and stops before hit objects. It scans one Songs folder at a time so the UI can report progress. Raw entries do not calculate MD5 hashes, durations, or star ratings; those values are empty, zero, and unavailable respectively.

## Provenance and license

The binary reader and database layout are TypeScript ports derived from [McOsu](https://github.com/McKay42/McOsu), with source regions cited in the implementation. McOsu is licensed under GPL-3.0.

This project is distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
