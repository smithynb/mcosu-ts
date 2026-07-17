# mcosu-ts

`mcosu-ts` is a browser-first TypeScript spike for reading an existing osu!stable song library. It asks you to select the osu! installation folder, reads its legacy `osu!.db` locally, and displays a searchable list of osu!standard beatmaps. No files are uploaded.

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

## Database scope and known format boundaries

Phase 1 deliberately accepts only legacy `osu!.db` versions `20170222` through `20191114`, matching McOsu's conservative supported range. Earlier databases are rejected with an update prompt. Later databases are rejected instead of guessing at layout changes; a future Songs-folder crawler can provide the raw-file fallback used by McOsu.

The parser follows McOsu's field order and consumes all four mode star-rating blocks before returning only mode `0` (osu!standard) entries. Two upstream format details are notably ambiguous or easy to implement incorrectly:

- Stable stopped prefixing beatmap entries with a byte size at version `20191107`. McOsu explicitly uses that date, while noting that the osu! wiki revision says `20191106`.
- McOsu switches star-rating values from 64-bit doubles to 32-bit floats at version `20250108`. That branch is intentionally unreachable under this spike's `20191114` ceiling. Supporting current databases requires validating the complete post-2019 layout, not only changing this one field width.

The database stores beatmap folder paths in Windows form in some installations, including nested paths with backslashes. These are normalized to slash-delimited paths for browser traversal. Timing points are treated as two little-endian doubles followed by one byte, as implemented by McOsu's `OsuFile::readTimingPoint`.

## Provenance and license

The binary reader and database layout are TypeScript ports derived from [McOsu](https://github.com/McKay42/McOsu), with source regions cited in the implementation. McOsu is licensed under GPL-3.0.

This project is distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
