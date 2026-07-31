/** Each screen renders to an array of lines. No state lives here. */

import * as humanise from './core/humanise.js';
import type {Choice, Media} from './core/media.js';
import type {Progress} from './core/ytdlp.js';
import {bar, centreBlock, header, hints, panel} from './paint.js';
import * as term from './term.js';
import {glyph, theme} from './theme.js';

const ROW = 82;
const LIST = 46;
const META = 44;

export type Outcome =
	| {state: 'running'}
	| {state: 'saved'; path: string; fresh: boolean}
	| {state: 'failed'; message: string};

// --- setup (first run) -----------------------------------------------------

export function setup(note: string, columns: number): string[] {
	const width = Math.max(30, Math.min(ROW, columns - 2));
	return [
		...header(columns),
		...centreBlock(
			panel('One moment', width, [
				term.fg(theme.dim, term.truncate(note, width - 4)),
				term.fg(theme.dimmer, "Only happens once — it's cached for next time."),
			]),
			columns,
			width,
		),
		...hints([['^c', 'quit']], columns),
	];
}

// --- paste -----------------------------------------------------------------

export function paste(
	value: string,
	cursor: number,
	busy: boolean,
	status: string,
	columns: number,
): string[] {
	const width = Math.max(34, Math.min(ROW, columns - 2));
	const buttonWidth = 12;
	const boxWidth = width - buttonWidth;
	const field = boxWidth - 6;

	const title = 'Paste a link';
	const filler = Math.max(1, boxWidth - 5 - title.length);

	const label = term.fg(theme.accent, `${glyph.chevron} `);
	const button = (text: string) =>
		term.paintOn(theme.button, busy ? theme.accent : theme.ink, text);
	const blank = button(' '.repeat(buttonWidth));

	// The button sits beside all three rows of the box, so it reads as one solid
	// block rather than a bar floating next to the middle row.
	const box = [
		term.fg(theme.line, '╭─ ') +
			term.fg(theme.ink, title) +
			term.fg(theme.line, ` ${'─'.repeat(filler)}╮`) +
			blank,
		term.fg(theme.line, '│') +
			' ' +
			term.pad(label + inputLine(value, cursor, field, busy), boxWidth - 4) +
			' ' +
			term.fg(theme.line, '│') +
			button(centreIn('snag', buttonWidth)),
		term.fg(theme.line, `╰${'─'.repeat(boxWidth - 2)}╯`) + blank,
	];

	return [
		...header(columns),
		...centreBlock(box, columns, width),
		'',
		term.centre(term.fg(theme.dim, term.truncate(status, width)), columns),
		...hints(
			[
				['↵', 'snag'],
				['↑', 'history'],
				['^c', 'quit'],
			],
			columns,
		),
	];
}

function centreIn(text: string, within: number): string {
	const left = Math.max(0, Math.floor((within - text.length) / 2));
	return ' '.repeat(left) + text + ' '.repeat(Math.max(0, within - left - text.length));
}

/** The field contents, with a block cursor and a window that follows it. */
function inputLine(value: string, cursor: number, field: number, busy: boolean): string {
	if (value.length === 0) {
		const hint = 'paste a video link here…';
		const head = hint.slice(0, 1);
		const tail = hint.slice(1, field);
		return (
			(busy ? term.fg(theme.dimmer, head) : term.bg(theme.dimmer, head)) +
			term.fg(theme.dimmer, tail)
		);
	}

	const at = Math.min(cursor, value.length);
	const start = Math.max(0, at - field + 2);
	const shown = value.slice(start, start + field);
	const local = at - start;

	const before = shown.slice(0, local);
	const under = shown[local] ?? ' ';
	const after = shown.slice(local + 1);

	return (
		term.fg(theme.ink, before) +
		(busy ? term.fg(theme.ink, under) : term.bg(theme.ink, term.fg(theme.button, under))) +
		term.fg(theme.ink, after)
	);
}

// --- choose ----------------------------------------------------------------

export function choose(media: Media, index: number, columns: number): string[] {
	const wide = columns >= 96;
	const listWidth = wide ? LIST : Math.max(30, Math.min(LIST, columns - 2));
	const metaWidth = wide ? META : listWidth;

	const rows = media.choices.map((choice, row) => {
		const selected = row === index;
		const mark = choice.kind === 'audio' ? glyph.audio : glyph.video;
		const body = `${mark} ${choice.label} · ${choice.container} · ~${humanise.size(choice.size)}`;
		return (
			(selected ? term.fg(theme.accent, glyph.chevron) : ' ') +
			' ' +
			(selected ? term.bold(term.fg(theme.accent, body)) : term.fg(theme.ink, body))
		);
	});

	const meta = [
		...term
			.wrap(media.title, metaWidth - 2)
			.map(line => term.bold(term.fg(theme.ink, line))),
		'',
		term.fg(
			theme.dim,
			term.truncate(
				`${glyph.bullet} ${media.source} · ${humanise.duration(media.duration)} · ${media.uploader}`,
				metaWidth - 2,
			),
		),
	];

	const list = panel('Download', listWidth, rows);

	let block: string[];
	if (wide) {
		// Two columns side by side, padded to the same height.
		const height = Math.max(meta.length, list.length);
		block = [];
		for (let row = 0; row < height; row++) {
			block.push(
				term.pad(meta[row] ?? '', metaWidth) + (list[row] ?? ' '.repeat(listWidth)),
			);
		}
		block = centreBlock(block, columns, metaWidth + listWidth);
	} else {
		// Narrow terminal — stack rather than let the columns crush.
		block = [
			...centreBlock(meta, columns, metaWidth),
			'',
			...centreBlock(list, columns, listWidth),
		];
	}

	return [
		...header(columns),
		...block,
		...hints(
			[
				['↑↓', 'choose'],
				['↵', 'snag'],
				['esc', 'back'],
				['^c', 'quit'],
			],
			columns,
		),
	];
}

// --- download --------------------------------------------------------------

export function download(
	title: string,
	choice: Choice,
	progress: Progress | undefined,
	stage: string,
	outcome: Outcome,
	columns: number,
): string[] {
	const width = Math.max(30, Math.min(ROW, columns - 2));
	const track = Math.max(10, Math.min(46, width - 12));

	// A stage message means the bytes are in and ffmpeg has taken over, so fill
	// the bar rather than leaving it short while it merges.
	const fraction =
		outcome.state === 'saved' || stage
			? 1
			: progress?.total
				? progress.received / progress.total
				: 0;

	const heading =
		outcome.state === 'saved' ? 'Done' : outcome.state === 'failed' ? 'Failed' : 'Snagging';

	let line: string;
	if (outcome.state === 'saved') {
		line = `${outcome.fresh ? 'saved to' : 'already had it —'} ${outcome.path}`;
	} else if (outcome.state === 'failed') {
		line = outcome.message;
	} else {
		const bits = [`${choice.label} · ${choice.container}`];
		if (progress?.total) {
			bits.push(`${humanise.size(progress.received)} of ${humanise.size(progress.total)}`);
		} else if (progress?.received) {
			bits.push(`${humanise.size(progress.received)} so far`);
		}
		if (progress?.speed) bits.push(`${humanise.size(progress.speed)}/s`);
		if (progress?.eta) bits.push(`eta ${humanise.duration(progress.eta)}`);
		if (stage) bits.push(stage);
		line = bits.join('   ');
	}

	const footer: Array<[string, string]> =
		outcome.state === 'saved'
			? [
					['esc', 'snag another'],
					['^c', 'quit'],
				]
			: outcome.state === 'failed'
				? [
						['esc', 'back'],
						['^c', 'quit'],
					]
				: [['^c', 'quit']];

	return [
		...header(columns),
		...centreBlock(
			panel(heading, width, [
				term.bold(term.fg(theme.ink, term.truncate(title, width - 4))),
				'',
				bar(fraction, track),
				'',
				term.fg(theme.dim, term.truncate(line, width - 4)),
			]),
			columns,
			width,
		),
		...hints(footer, columns),
	];
}
