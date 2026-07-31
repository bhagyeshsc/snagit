import {spawn, type ChildProcess} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {mkdir, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {ensureYtDlp, findFfmpeg} from './binaries.js';
import {buildChoices, cleanError, siteName, type Choice, type Media} from './media.js';

// Markers let us tell progress lines apart from the final path on one stdout.
const PROGRESS = 'SNAGPROG';
const FILE = 'SNAGFILE';

export type Progress = {
	received: number;
	total?: number;
	speed?: number;
	eta?: number;
};

function run(binary: string, args: string[]) {
	return spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe']});
}

function collect(child: ChildProcess): Promise<{code: number; out: string; err: string}> {
	return new Promise((resolve, reject) => {
		let out = '';
		let err = '';
		child.stdout?.on('data', chunk => {
			out += chunk;
		});
		child.stderr?.on('data', chunk => {
			err += chunk;
		});
		child.on('error', reject);
		child.on('close', code => resolve({code: code ?? 0, out, err}));
	});
}

/** Look up a link without downloading, so we can list its real qualities. */
export async function probe(url: string): Promise<Media> {
	const binary = await ensureYtDlp();
	const {code, out, err} = await collect(
		run(binary, [
			'--dump-single-json',
			'--no-warnings',
			// Cap a playlist at its first entry, otherwise a 200-video list would
			// pull every entry's formats before we could show anything.
			'--playlist-items',
			'1',
			url,
		]),
	);

	if (code !== 0 || !out.trim()) {
		throw new Error(cleanError(err || out));
	}

	let info: Record<string, unknown>;
	try {
		info = JSON.parse(out) as Record<string, unknown>;
	} catch {
		throw new Error("Couldn't make sense of what that link returned.");
	}

	if (info['_type'] === 'playlist') {
		const entries = ((info['entries'] as Record<string, unknown>[]) ?? []).filter(Boolean);
		if (entries.length === 0) throw new Error('That playlist is empty.');
		info = entries[0]!;
	}

	return {
		title: String(info['title'] ?? 'Untitled'),
		uploader: String(info['uploader'] ?? info['channel'] ?? 'unknown'),
		source: siteName(info),
		duration: info['duration'] as number | undefined,
		url: String(info['webpage_url'] ?? url),
		choices: buildChoices(info),
	};
}

export type DownloadHandle = {
	/** Resolves with the saved path, or rejects with a readable message. */
	done: Promise<{path: string; fresh: boolean}>;
	/** Stop the transfer and clean up the partial file. */
	cancel: () => void;
};

function selectorFor(choice: Choice): string[] {
	if (choice.kind === 'video') {
		// Hold the 1080p ceiling even on the "best available" row, so an unlabelled
		// source can't quietly hand back a 4K file.
		const cap = choice.quality || 1080;
		// The fallbacks matter: they keep things working when a resolution only
		// exists video-only, or when the cap can't be met at all.
		const format = `bv*[height<=${cap}]+ba/b[height<=${cap}]/bv*+ba/b`;
		return ['-f', format, '--merge-output-format', 'mp4'];
	}
	return [
		'-f',
		'ba/b',
		'-x',
		'--audio-format',
		'mp3',
		'--audio-quality',
		`${choice.quality}k`,
		'--embed-metadata',
	];
}

export function download(
	url: string,
	choice: Choice,
	outputDir: string,
	onProgress: (progress: Progress) => void,
	onStage: (stage: string) => void,
): DownloadHandle {
	let child: ChildProcess | undefined;
	let cancelled = false;
	const partials = new Set<string>();

	const done = (async () => {
		const binary = await ensureYtDlp();
		const ffmpeg = await findFfmpeg();
		await mkdir(outputDir, {recursive: true});

		// The quality goes in the filename on purpose. Without it, grabbing the
		// same video twice at different qualities would collide — and yt-dlp skips
		// files that already exist, so you'd silently keep the first one.
		const tag = choice.label.replace(/\s+/g, '');
		const template = join(outputDir, `%(title)s [${tag}].%(ext)s`);

		const args = [
			...selectorFor(choice),
			'-o',
			template,
			'--newline',
			'--no-warnings',
			'--no-playlist',
			'--progress-template',
			`download:${PROGRESS}|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
			// after_move fires once postprocessing is finished, so this is the real
			// final path — guessing the extension would break on mp3 extraction.
			'--print',
			`after_move:${FILE}|%(filepath)s`,
			// --print implies --quiet, which would swallow every progress line and
			// leave the bar frozen at 0%. Order matters: this has to come after.
			'--no-quiet',
		];
		if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
		args.push(url);

		child = run(binary, args);

		let savedPath = '';
		let sawBytes = false;
		let stderr = '';
		let buffer = '';
		// A merged download arrives as two streams, each counting from zero. These
		// track the finished ones so the bar reports one journey, not two.
		let banked = 0;
		let lastReceived = 0;
		let lastTotal = 0;

		// Set SNAG_DEBUG=<file> to capture the raw child output; Ink owns the screen
		// so there's nowhere else for it to go.
		const debugTo = process.env['SNAG_DEBUG'];

		child.stdout?.on('data', (chunk: Buffer) => {
			if (debugTo) appendFileSync(debugTo, chunk);
			buffer += chunk.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) handleLine(line.trim());
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		function handleLine(line: string) {
			if (line.startsWith(`${PROGRESS}|`)) {
				const [, received, total, estimate, speed, eta] = line.split('|');
				const number_ = (value?: string) => {
					const parsed = Number(value);
					return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
				};
				const got = number_(received) ?? 0;
				const streamTotal = number_(total) ?? number_(estimate);
				if (got > 0) sawBytes = true;

				// The counter restarting means a stream finished — bank it.
				if (got < lastReceived) banked += lastTotal || lastReceived;
				lastReceived = got;
				if (streamTotal) lastTotal = streamTotal;

				// The estimate covers the whole file, so the bar doesn't hit 100% when
				// only the video half has landed. The measured running total guards
				// the other way, in case the estimate came in low.
				const measured = streamTotal ? banked + streamTotal : undefined;
				const totals = [choice.size, measured].filter(
					(value): value is number => typeof value === 'number',
				);

				onProgress({
					received: banked + got,
					total: totals.length ? Math.max(...totals) : undefined,
					speed: number_(speed),
					eta: number_(eta),
				});
				return;
			}
			if (line.startsWith(`${FILE}|`)) {
				savedPath = line.slice(FILE.length + 1);
				return;
			}
			// yt-dlp narrates postprocessing on stdout; surface it as a stage label.
			if (line.startsWith('[Merger]')) onStage('merging …');
			else if (line.startsWith('[ExtractAudio]')) onStage('converting …');
			else if (line.includes('has already been downloaded')) onStage('already there');
			else if (line.startsWith('[download] Destination:')) {
				partials.add(`${line.split('Destination:')[1]?.trim()}.part`);
			}
		}

		const code = await new Promise<number>((resolve, reject) => {
			child!.on('error', reject);
			child!.on('close', value => resolve(value ?? 0));
		});

		if (cancelled) {
			await Promise.all([...partials].map(path => unlink(path).catch(() => {})));
			throw Object.assign(new Error('cancelled'), {cancelled: true});
		}

		if (code !== 0) {
			const message = cleanError(stderr);
			throw new Error(
				ffmpeg || !/ffmpeg|ffprobe/i.test(stderr)
					? message
					: `${message} — ffmpeg is missing, so merging and mp3 can't run.`,
			);
		}

		if (!savedPath) throw new Error("Finished, but couldn't tell where the file went.");
		return {path: savedPath, fresh: sawBytes};
	})();

	return {
		done,
		cancel: () => {
			cancelled = true;
			child?.kill('SIGTERM');
		},
	};
}
