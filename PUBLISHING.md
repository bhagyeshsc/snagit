# Publishing from the Windows machine

The app itself is macOS-only. Windows here is just the machine you build and upload from — you won't
be able to *run* snagit there, and that's expected.

## Once, to set up

Install Node 22 or newer:

```powershell
winget install OpenJS.NodeJS.LTS
```

Reopen the terminal and check:

```powershell
node --version
```

It must print `v22` or higher. The build won't work below that.

## Build and publish

```powershell
cd path\to\snagit
npm install
npm run build
npm publish
```

`npm publish` rebuilds automatically, so `npm run build` is really just a way to catch problems
before you're mid-upload.

If you haven't logged in on that machine:

```powershell
npm login
```

## Check before you upload

```powershell
npm pack --dry-run
```

You should see only `dist\`, `package.json`, `README.md` and `LICENSE` — 15 files, around 19.5 kB. Not
`source\`, not `screenshots\`, not `node_modules\`.

## Two Windows-specific things

**Don't run `node dist/cli.js` expecting the app.** It prints `snagit runs on macOS only` and exits.
That's the guard working, not a broken build.

**The launcher's executable bit.** `snagit` in the project root is a shell script that needs the Unix
execute permission. Extracting a zip on Windows drops that, so if you commit from there, macOS users
who clone the repo won't be able to run `./snagit`. Fix it once when you commit:

```powershell
git add .
git update-index --chmod=+x snagit
git commit -m "Initial commit"
```

Verify with `git ls-files -s snagit` — you want mode `100755`, not `100644`.

Line endings are already handled: `tsconfig.json` pins LF output and `.gitattributes` keeps the repo
LF, so the shebang in the built CLI won't get a stray carriage return.

## If publish is rejected

- **`EPUBLISHCONFLICT` or "name taken"** — someone claimed `snagit` first. Change `name` in
  `package.json` and retry.
- **`ENEEDAUTH`** — `npm login` didn't stick. Run it again and watch for the browser window.
- **403 mentioning the name** — npm sometimes blocks names too similar to existing packages. You'd
  need a different one.
- **`EBADPLATFORM`** — shouldn't happen; there's deliberately no `os` field in `package.json`,
  because that field makes `npm install` refuse to run on Windows at all.

## After it's live

```powershell
npm view snagit
```

The npm page renders `README.md`. Image links in it are relative, which GitHub resolves but npm does
not — so the screenshots will show as broken on npmjs.com until they're switched to full
`https://raw.githubusercontent.com/...` URLs.
