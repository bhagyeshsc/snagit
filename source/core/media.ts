export type Choice = {
	kind: 'video' | 'audio';
	quality: number; // pixel height, or kbps for audio
	label: string; // '1080p' / '192 kbps'
	container: 'mp4' | 'mp3';
	size?: number; // estimated bytes
};

export type Media = {
	title: string;
	uploader: string;
	source: string;
	duration?: number;
	url: string;
	choices: Choice[];
};

type Format = {
	height?: number;
	tbr?: number;
	abr?: number;
	vcodec?: string;
	acodec?: string;
	filesize?: number;
	filesize_approx?: number;
	format_id?: string;
};

// Offered when the source actually has them, best first. Capped at 1080p on
// purpose — 4K pulls are enormous and slow, and nobody asked for them.
const HEIGHTS = [1080, 720, 480, 360, 240, 144];
export const BITRATES = [320, 192, 128];

// yt-dlp's extractor keys aren't brand-cased ('Youtube'), so tidy up the ones
// people actually see. Anything else falls back to the raw key.
const SITE_NAMES: Record<string, string> = {
	youtube: 'YouTube',
	twitter: 'X',
	instagram: 'Instagram',
	tiktok: 'TikTok',
	threads: 'Threads',
	facebook: 'Facebook',
	vimeo: 'Vimeo',
	twitch: 'Twitch',
	reddit: 'Reddit',
	soundcloud: 'SoundCloud',
	bandcamp: 'Bandcamp',
	dailymotion: 'Dailymotion',
};

export function siteName(info: Record<string, unknown>): string {
	const raw = String(info['extractor'] ?? '').split(':')[0]?.toLowerCase() ?? '';
	return SITE_NAMES[raw] ?? String(info['extractor_key'] ?? 'unknown');
}

const hasVideo = (format: Format) => Boolean(format.vcodec && format.vcodec !== 'none');
const isAudioOnly = (format: Format) =>
	Boolean(format.acodec && format.acodec !== 'none') && !hasVideo(format);

/** Best available size for one format: exact, approximate, then from bitrate. */
function formatSize(format: Format, duration?: number): number | undefined {
	if (format.filesize) return format.filesize;
	if (format.filesize_approx) return format.filesize_approx;
	if (format.tbr && duration) return Math.round((format.tbr * 1000) / 8 * duration);
	return undefined;
}

/**
 * How yt-dlp ranks video codecs, roughly — newer and more efficient first.
 *
 * This has to mirror what yt-dlp will actually download, not just pick the
 * fattest stream at a resolution. A site often carries both an efficient AV1
 * and a bloated H.264 at the same height, and the H.264 one at 144p can be
 * larger than the AV1 one at 360p — which made the size column read as
 * nonsense while also being wrong about the file you'd get.
 */
function codecRank(format: Format): number {
	const codec = (format.vcodec ?? '').toLowerCase();
	if (codec.startsWith('av01') || codec.startsWith('av1')) return 0;
	if (codec.startsWith('vp9') || codec.startsWith('vp09')) return 1;
	if (codec.startsWith('vp8')) return 2;
	if (codec.startsWith('hev') || codec.startsWith('h265')) return 3;
	if (codec.startsWith('avc') || codec.startsWith('h264')) return 4;
	return 5;
}

/** The stream yt-dlp would pick at this height: best codec, then best bitrate. */
function preferredAt(formats: Format[]): Format | undefined {
	return [...formats].sort(
		(a, b) => codecRank(a) - codecRank(b) || (b.tbr ?? 0) - (a.tbr ?? 0),
	)[0];
}

/** Turn the raw format list into the rows we show, best quality first. */
export function buildChoices(info: Record<string, unknown>): Choice[] {
	const formats = ((info['formats'] as Format[]) ?? []).filter(f => f?.format_id);
	const duration = info['duration'] as number | undefined;

	const audioTracks = formats.filter(isAudioOnly);
	const bestAudio = audioTracks.sort(
		(a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0),
	)[0];
	const audioSize = bestAudio ? formatSize(bestAudio, duration) : undefined;

	const choices: Choice[] = [];
	const present = new Set(formats.map(f => f.height).filter(Boolean) as number[]);
	let heights = HEIGHTS.filter(height => present.has(height));
	if (heights.length === 0) {
		// An extractor with non-standard resolutions. Still hold the 1080p ceiling.
		heights = [...present].filter(height => height <= 1080).sort((a, b) => b - a);
	}

	for (const height of heights) {
		const atHeight = formats.filter(f => f.height === height && hasVideo(f));
		if (atHeight.length === 0) continue;
		const best = preferredAt(atHeight)!;
		let size = formatSize(best, duration);
		// Video-only streams get merged with audio, so add the audio weight.
		if (size && !(best.acodec && best.acodec !== 'none') && audioSize) {
			size += audioSize;
		}
		choices.push({
			kind: 'video',
			quality: height,
			label: `${height}p`,
			container: 'mp4',
			size,
		});
	}

	if (choices.length === 0) {
		// Nothing enumerable — offer a single "best available" row.
		choices.push({
			kind: 'video',
			quality: 0,
			label: 'best available',
			container: 'mp4',
		});
	}

	for (const bitrate of BITRATES) {
		choices.push({
			kind: 'audio',
			quality: bitrate,
			label: `${bitrate} kbps`,
			container: 'mp3',
			size: duration ? Math.round((bitrate * 1000) / 8 * duration) : undefined,
		});
	}

	return choices;
}

/** Strip yt-dlp's prefixes so a failure reads as one plain sentence. */
export function cleanError(text: string): string {
	const line = text
		.split('\n')
		.map(part => part.trim())
		.filter(part => part.startsWith('ERROR:'))
		.pop();
	const message = (line ?? text.split('\n').filter(Boolean).pop() ?? '')
		.replace(/^ERROR:\s*/, '')
		.replace(/^\[[^\]]+]\s*/, match => match) // keep the [youtube] tag, it's useful
		.trim();
	return message || 'Something went wrong.';
}
