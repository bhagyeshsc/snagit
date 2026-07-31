#!/usr/bin/env node
import {homedir, platform} from 'node:os';
import {join, resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {App} from './app.js';
import {cacheDir, findFfmpeg, updateYtDlp} from './core/binaries.js';

// macOS only. Fail here with something readable rather than getting halfway in
// and dying on a binary that was never built for this platform.
if (platform() !== 'darwin') {
	console.error(`snagit runs on macOS only (this is ${platform()}).`);
	process.exit(1);
}

const HELP = `
  snagit — snag video or audio off a link

  Usage
    $ snagit                 open the app
    $ snagit --out <dir>     save somewhere else
    $ snagit --update        update the cached yt-dlp
    $ snagit --where         print the save and cache folders
    $ snagit --version       print the version

  Keys
    ↵ confirm   ↑↓ choose   esc back a step   ^c quit
    ↑ on the paste screen walks back through links you've used
`;

const argv = process.argv.slice(2);

function flagValue(name: string): string | undefined {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

const outputDir = resolve(
	flagValue('--out') ?? join(homedir(), 'Downloads', 'snagit'),
);

if (argv.includes('--help') || argv.includes('-h')) {
	console.log(HELP);
	process.exit(0);
}

if (argv.includes('--version') || argv.includes('-v')) {
	const manifest = JSON.parse(
		await readFile(new URL('../package.json', import.meta.url), 'utf8'),
	) as {version: string};
	console.log(manifest.version);
	process.exit(0);
}

if (argv.includes('--where')) {
	console.log(`saves to   ${outputDir}`);
	console.log(`cache      ${cacheDir()}`);
	console.log(`ffmpeg     ${(await findFfmpeg()) ?? 'not fetched yet'}`);
	process.exit(0);
}

if (argv.includes('--update')) {
	console.log('updating yt-dlp …');
	console.log(await updateYtDlp());
	process.exit(0);
}

// The app owns the screen from here, so nothing else may write to stdout.
await new App(outputDir).run();
