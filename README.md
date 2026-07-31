# SNAGIT

A terminal app for pulling video or audio off a link. Paste, pick a quality, done.

macOS · Node 22+ · zero dependencies

<img width="1860" height="640" alt="01-paste" src="https://github.com/user-attachments/assets/9e7068ed-e471-4922-b271-d02e6359c4a8" />

## Install

```bash
npx snagit
```

Or keep it around:

```bash
npm install -g snagit
```

That installs exactly one package — snagit has no runtime dependencies at all. No Python either.

The first run fetches the two tools it drives, into `~/.cache/snagit`:

- **yt-dlp** (~38 MB) — does the downloading
- **ffmpeg** (~45 MB) — merges video with audio and makes mp3s, and is skipped entirely if you
  already have ffmpeg on your PATH

Both are cached, so it only happens once.

## Run it from the folder

If you've cloned the repo, there's a launcher in the project root:

```bash
cd snagit
./snagit
```

That installs dependencies and builds on first run, then starts the app. It rebuilds automatically
whenever you've changed something in `source/`.

## How it works

Paste a link and press Enter. It looks the link up and lists the qualities that source actually has —
resolutions plus mp3 bitrates — with estimated sizes.

<img width="1860" height="808" alt="02-choose" src="https://github.com/user-attachments/assets/fcfa2256-5080-49ef-82cc-48ed171ec388" />


Arrow keys to move, Enter to start. The bar tracks the whole file, including the audio stream that
gets merged in at the end.

<img width="1860" height="696" alt="04-downloading" src="https://github.com/user-attachments/assets/53ae028b-71d2-4723-8e1b-7cbf5b80adf2" />


Then it tells you where the file went.

<img width="1860" height="696" alt="05-done" src="https://github.com/user-attachments/assets/829dbc10-1948-4b99-844d-9a0016234f7e" />


## Keys

| Key | Does |
|---|---|
| `↵` | confirm |
| `↑` `↓` | move through the list |
| `↑` | on the paste screen, walk back through links you've used |
| `esc` | back a step |
| `^c` | quit — stops a download in progress and cleans up after itself |

## Options

```
snagit                 open the app
snagit --out <dir>     save somewhere else
snagit --update        update the bundled yt-dlp
snagit --where         print the save and cache folders
snagit --version
snagit --help
```

Files land in `~/Downloads/snagit` unless you pass `--out`.

## Notes

**Only the qualities that exist.** The list is built from the link you pasted, so you can't pick
1080p on a 360p video and quietly get something worse.

**Capped at 1080p** on purpose. 4K pulls are enormous and slow.

**Sizes are estimates** read from the stream metadata, and they account for the audio track that gets
merged in. That's why a 144p download can still be tens of megabytes — the site pairs it with the
same high-bitrate audio as everything else.

**Repeat downloads are cheap.** Filenames carry the quality (`[720p]`, `[192kbps]`), so the same
video at two qualities won't overwrite itself. Ask for something you already have and it says so
instead of fetching it again.

**Not just one site.** It works with whatever [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports,
which is around 1750 sites.

**Colours assume a dark terminal.** There's no light theme yet.

If downloads start failing, update yt-dlp first with `snagit --update`. It tracks changes on the
sites it supports, so an old copy eventually breaks.

Use it for content you have the right to download.

## Development

```bash
git clone <this repo>
cd snagit
npm install
npm run build
node dist/cli.js
```

| Path | What's in it |
|---|---|
| `source/cli.ts` | entry point, flags, the macOS guard |
| `source/app.ts` | state, key routing, the render loop |
| `source/term.ts` | the terminal layer — colour, measurement, painting, key decoding |
| `source/paint.ts` | drawing primitives: panel, header, hints, bar |
| `source/screens.ts` | the four screens, each rendering to an array of lines |
| `source/core/` | yt-dlp and ffmpeg: binaries, probing, downloading |
| `source/wordmark.ts` | the SNAGIT logo, from a 5×5 pixel font |
| `source/theme.ts` | colours |

`npm run dev` watches and rebuilds. TypeScript is the only dev dependency; nothing ships with the
package but compiled JavaScript.

The interface is written directly against terminal escape codes rather than a TUI framework, which
is what keeps the dependency count at zero. `source/term.ts` holds all of it: a 256-colour fallback
for terminals without truecolor, display-width measurement that copes with CJK and emoji in video
titles, flicker-free repainting, and key decoding.

## Built on

[yt-dlp](https://github.com/yt-dlp/yt-dlp) for the downloading and
[ffmpeg](https://ffmpeg.org) for merging and mp3 — both fetched at runtime, neither an npm package.

## Licence

MIT
