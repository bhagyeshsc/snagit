import {createWriteStream} from 'node:fs';
import {chmod, mkdir, rename, stat, unlink} from 'node:fs/promises';
import {arch, homedir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';

/**
 * The two binaries this app is a front-end over.
 *
 * Both are fetched on first run rather than bundled as npm packages, which is
 * what keeps the project at zero runtime dependencies. It also means yt-dlp
 * stays current — a frozen copy rots as soon as the sites it supports change.
 */

const YTDLP_URL =
	'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';

// macOS builds from the ffmpeg-static project's releases. We take the binary
// without the npm package around it.
const FFMPEG_BASE =
	'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0';

export function cacheDir(): string {
	return join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'snagit');
}

const ytDlpPath = () => join(cacheDir(), 'yt-dlp');
const ffmpegPath = () => join(cacheDir(), 'ffmpeg');

async function exists(path: string): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isFile() && info.size > 0;
	} catch {
		return false;
	}
}

export type FetchProgress = {received: number; total?: number};

/** Download to a temp name, mark executable, then move into place. */
async function fetchBinary(
	url: string,
	target: string,
	onProgress?: (progress: FetchProgress) => void,
): Promise<string> {
	await mkdir(cacheDir(), {recursive: true});
	const partial = `${target}.part`;

	let response: Response;
	try {
		response = await fetch(url, {redirect: 'follow'});
	} catch (error) {
		throw new Error(`Couldn't reach GitHub (${(error as Error).message}).`);
	}
	if (!response.ok || !response.body) {
		throw new Error(`Download failed — GitHub returned ${response.status}.`);
	}

	const total = Number(response.headers.get('content-length')) || undefined;
	let received = 0;
	const source = Readable.fromWeb(response.body as never);
	source.on('data', (chunk: Buffer) => {
		received += chunk.length;
		onProgress?.({received, total});
	});

	try {
		await pipeline(source, createWriteStream(partial));
		await chmod(partial, 0o755);
		// Rename last, so an interrupted fetch never leaves a half binary that a
		// later run would treat as good.
		await rename(partial, target);
	} catch (error) {
		await unlink(partial).catch(() => {});
		throw error;
	}

	return target;
}

export async function ytDlpReady(): Promise<boolean> {
	return exists(ytDlpPath());
}

export async function ensureYtDlp(
	onProgress?: (progress: FetchProgress) => void,
): Promise<string> {
	const target = ytDlpPath();
	if (await exists(target)) return target;
	return fetchBinary(YTDLP_URL, target, onProgress);
}

/** True when ffmpeg is cached, or already on the system. */
export async function ffmpegReady(): Promise<boolean> {
	if (await exists(ffmpegPath())) return true;
	return Boolean(await systemFfmpeg());
}

/**
 * Path to ffmpeg — needed to merge video with audio and to make mp3s.
 *
 * Prefers a copy already on the system, so we don't download 44 MB that the
 * machine already has.
 */
export async function ensureFfmpeg(
	onProgress?: (progress: FetchProgress) => void,
): Promise<string> {
	const system = await systemFfmpeg();
	if (system) return system;

	const target = ffmpegPath();
	if (await exists(target)) return target;

	const asset = arch() === 'arm64' ? 'ffmpeg-darwin-arm64' : 'ffmpeg-darwin-x64';
	return fetchBinary(`${FFMPEG_BASE}/${asset}`, target, onProgress);
}

export async function findFfmpeg(): Promise<string | undefined> {
	const system = await systemFfmpeg();
	if (system) return system;
	return (await exists(ffmpegPath())) ? ffmpegPath() : undefined;
}

function systemFfmpeg(): Promise<string | undefined> {
	return new Promise(resolve => {
		const probe = spawn('which', ['ffmpeg']);
		let out = '';
		probe.stdout.on('data', chunk => {
			out += chunk;
		});
		probe.on('error', () => resolve(undefined));
		probe.on('close', code => {
			const first = out.split('\n')[0]?.trim();
			resolve(code === 0 && first ? first : undefined);
		});
	});
}

/** Ask yt-dlp to update itself in place. Used by `snagit --update`. */
export async function updateYtDlp(): Promise<string> {
	const binary = await ensureYtDlp();
	return new Promise((resolve, reject) => {
		const child = spawn(binary, ['-U'], {stdio: ['ignore', 'pipe', 'pipe']});
		let out = '';
		child.stdout.on('data', chunk => {
			out += chunk;
		});
		child.stderr.on('data', chunk => {
			out += chunk;
		});
		child.on('error', reject);
		child.on('close', () => resolve(out.trim()));
	});
}
