/** Shared drawing: the panel frame, the header, the hint footer, the bar. */

import {glyph, theme} from './theme.js';
import * as term from './term.js';
import {render as renderMark, width as markWidth} from './wordmark.js';

const TAGLINE = 'video or audio, off any link';

/** A bordered panel with its title set into the top edge. */
export function panel(title: string, width: number, body: string[]): string[] {
	const inner = width - 4; // two border cells, two padding cells
	const filler = Math.max(1, width - 5 - term.width(title));

	const lines = [
		term.fg(theme.line, '╭─ ') +
			term.fg(theme.ink, title) +
			term.fg(theme.line, ` ${'─'.repeat(filler)}╮`),
	];
	for (const row of body) {
		lines.push(
			term.fg(theme.line, '│') +
				' ' +
				term.pad(row, inner) +
				' ' +
				term.fg(theme.line, '│'),
		);
	}
	lines.push(term.fg(theme.line, `╰${'─'.repeat(width - 2)}╯`));
	return lines;
}

/** The wordmark block, or plain type when the terminal is too narrow for it. */
export function header(columns: number): string[] {
	const lines: string[] = [];
	const roomy = columns >= markWidth() + 2;

	if (roomy) {
		for (const spans of renderMark()) {
			const row = spans
				.map(span =>
					span.text.trim()
						? term.fg(span.shaded ? theme.shade : theme.ink, span.text)
						: span.text,
				)
				.join('');
			lines.push(term.centre(row, columns));
		}
		lines.push('');
	} else {
		lines.push(term.centre(term.bold(term.fg(theme.ink, 'SNAGIT')), columns));
	}

	lines.push(term.centre(term.fg(theme.dim, TAGLINE), columns));
	lines.push('');
	return lines;
}

/** The footer strip: bright key, dim label, faint dots between. */
export function hints(pairs: Array<[string, string]>, columns: number): string[] {
	// Drop hints from the end until the strip fits. Letting it wrap onto a second
	// line reads as a broken layout on a narrow terminal.
	let shown = [...pairs];
	const build = (items: Array<[string, string]>) =>
		items
			.map(([key, label]) => `${term.fg(theme.dim, key)} ${term.fg(theme.dimmer, label)}`)
			.join(term.fg(theme.faint, '   ·   '));

	while (shown.length > 1 && term.width(build(shown)) > columns) shown.pop();

	return ['', term.centre(build(shown), columns)];
}

export function bar(fraction: number, width: number): string {
	const track = Math.max(1, width);
	const safe = Number.isFinite(fraction) ? Math.max(0, Math.min(fraction, 1)) : 0;
	const filled = Math.min(track, Math.round(safe * track));
	return (
		term.fg(theme.ink, '█'.repeat(filled)) +
		term.fg(theme.track, '█'.repeat(track - filled)) +
		' ' +
		term.fg(theme.accent, `${Math.round(safe * 100)}%`)
	);
}

/** Indent a block so it sits centred within the terminal. */
export function centreBlock(lines: string[], columns: number, width: number): string[] {
	const left = ' '.repeat(Math.max(0, Math.floor((columns - width) / 2)));
	return lines.map(line => left + line);
}

export {glyph, theme};
