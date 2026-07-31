/**
 * The terminal layer: colour, layout measurement, painting and key input.
 *
 * Hand-written so the project ships with no runtime dependencies. Everything
 * here is escape codes and string maths.
 */

const ESC = '\x1b[';

// --- colour ----------------------------------------------------------------

const noColour =
	Boolean(process.env['NO_COLOR']) || process.env['TERM'] === 'dumb';

// Terminal.app only does 256 colours, iTerm2 and friends do 24-bit. Emitting
// truecolor blindly leaves the palette wrong in Terminal.app, so ask first.
const trueColour = /truecolor|24bit/i.test(process.env['COLORTERM'] ?? '');

function channels(hex: string): [number, number, number] {
	const value = hex.replace('#', '');
	return [
		parseInt(value.slice(0, 2), 16),
		parseInt(value.slice(2, 4), 16),
		parseInt(value.slice(4, 6), 16),
	];
}

/** Nearest xterm-256 index, for terminals without 24-bit colour. */
function to256(hex: string): number {
	const [r, g, b] = channels(hex);
	if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
		// Grey ramp is finer than the colour cube, so prefer it for greys.
		if (r < 8) return 16;
		if (r > 248) return 231;
		return 232 + Math.round(((r - 8) / 247) * 24);
	}
	const step = (value: number) => Math.round((value / 255) * 5);
	return 16 + 36 * step(r) + 6 * step(g) + step(b);
}

function code(hex: string, background: boolean): string {
	const layer = background ? 48 : 38;
	if (trueColour) {
		const [r, g, b] = channels(hex);
		return `${ESC}${layer};2;${r};${g};${b}m`;
	}
	return `${ESC}${layer};5;${to256(hex)}m`;
}

export const reset = noColour ? '' : `${ESC}0m`;

export function fg(hex: string, text: string): string {
	return noColour ? text : code(hex, false) + text + reset;
}

export function bg(hex: string, text: string): string {
	return noColour ? text : code(hex, true) + text + reset;
}

export function bold(text: string): string {
	return noColour ? text : `${ESC}1m${text}${reset}`;
}

/** Foreground and background together, for the filled button. */
export function paintOn(hexFg: string, hexBg: string, text: string): string {
	if (noColour) return text;
	return code(hexBg, true) + code(hexFg, false) + text + reset;
}

// --- measurement -----------------------------------------------------------

const ANSI = /\x1b\[[0-9;]*m/g;

/** Text without escape codes, for measuring and truncating. */
export function plain(text: string): string {
	return text.replace(ANSI, '');
}

function isWide(point: number): boolean {
	return (
		(point >= 0x1100 && point <= 0x115f) || // Hangul Jamo
		(point >= 0x2e80 && point <= 0xa4cf) || // CJK, Kangxi
		(point >= 0xac00 && point <= 0xd7a3) || // Hangul syllables
		(point >= 0xf900 && point <= 0xfaff) || // CJK compatibility
		(point >= 0xfe30 && point <= 0xfe6f) || // CJK forms
		(point >= 0xff00 && point <= 0xff60) || // Fullwidth forms
		(point >= 0xffe0 && point <= 0xffe6) ||
		(point >= 0x1f300 && point <= 0x1f64f) || // pictographs, emoji
		(point >= 0x1f900 && point <= 0x1f9ff)
	);
}

function isZero(point: number): boolean {
	return (
		point === 0x200d || // zero-width joiner
		(point >= 0x0300 && point <= 0x036f) || // combining marks
		(point >= 0xfe00 && point <= 0xfe0f) // variation selectors
	);
}

/**
 * Columns a string occupies. Video titles arrive with CJK and emoji in them, so
 * counting code points alone would misalign every panel that holds one.
 */
export function width(text: string): number {
	let total = 0;
	for (const char of plain(text)) {
		const point = char.codePointAt(0) ?? 0;
		if (isZero(point)) continue;
		total += isWide(point) ? 2 : 1;
	}
	return total;
}

/** Cut to a column budget, adding an ellipsis when something was dropped. */
export function truncate(text: string, limit: number): string {
	if (width(text) <= limit) return text;
	let out = '';
	let used = 0;
	for (const char of plain(text)) {
		const point = char.codePointAt(0) ?? 0;
		const size = isZero(point) ? 0 : isWide(point) ? 2 : 1;
		if (used + size > limit - 1) break;
		out += char;
		used += size;
	}
	return `${out}…`;
}

export function pad(text: string, to: number): string {
	return text + ' '.repeat(Math.max(0, to - width(text)));
}

export function centre(text: string, within: number): string {
	const left = Math.max(0, Math.floor((within - width(text)) / 2));
	return ' '.repeat(left) + text;
}

/** Wrap on word boundaries, for titles that outrun their column. */
export function wrap(text: string, limit: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (width(candidate) > limit && line) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
	}
	if (line) lines.push(line);
	return lines.length ? lines : [''];
}

// --- screen ----------------------------------------------------------------

export type Size = {columns: number; rows: number};

export function size(): Size {
	// A tty can report 0 (pipes, some CI), and `??` would pass that straight
	// through into negative widths downstream.
	return {
		columns: Math.max(40, process.stdout.columns || 100),
		rows: Math.max(12, process.stdout.rows || 30),
	};
}

export type Key = {
	name:
		| 'up'
		| 'down'
		| 'left'
		| 'right'
		| 'enter'
		| 'escape'
		| 'backspace'
		| 'ctrl-c'
		| 'ctrl-u'
		| 'char';
	text: string;
};

function decode(chunk: string): Key[] {
	const keys: Key[] = [];
	let index = 0;

	while (index < chunk.length) {
		const rest = chunk.slice(index);

		if (rest.startsWith('\x1b[')) {
			const arrows: Record<string, Key['name']> = {
				A: 'up',
				B: 'down',
				C: 'right',
				D: 'left',
			};
			const letter = rest[2] ?? '';
			if (arrows[letter]) {
				keys.push({name: arrows[letter]!, text: ''});
				index += 3;
				continue;
			}
			// Some other CSI sequence (mouse, function key) — skip to its end.
			const end = rest.search(/[A-Za-z~]/);
			index += end === -1 ? rest.length : end + 1;
			continue;
		}

		const char = rest[0]!;
		if (char === '\x1b') {
			keys.push({name: 'escape', text: ''});
			index += 1;
		} else if (char === '\r' || char === '\n') {
			keys.push({name: 'enter', text: ''});
			index += 1;
		} else if (char === '\x03') {
			keys.push({name: 'ctrl-c', text: ''});
			index += 1;
		} else if (char === '\x15') {
			keys.push({name: 'ctrl-u', text: ''});
			index += 1;
		} else if (char === '\x7f' || char === '\b') {
			keys.push({name: 'backspace', text: ''});
			index += 1;
		} else if (char >= ' ') {
			// Gather a printable run, so a pasted link arrives as one event.
			let run = '';
			while (index < chunk.length) {
				const next = chunk[index]!;
				if (next < ' ' || next === '\x1b') break;
				run += next;
				index += 1;
			}
			keys.push({name: 'char', text: run});
		} else {
			index += 1; // some other control byte; ignore
		}
	}

	return keys;
}

export class Term {
	private painted = 0;
	private started = false;
	private onKeyHandler?: (key: Key) => void;
	private onResizeHandler?: () => void;
	private readonly handleData = (chunk: Buffer | string) => {
		for (const key of decode(chunk.toString())) this.onKeyHandler?.(key);
	};
	private readonly handleResize = () => this.onResizeHandler?.();

	start(): void {
		if (this.started) return;
		this.started = true;
		// Alternate screen, so the user's scrollback survives us.
		process.stdout.write(`${ESC}?1049h${ESC}?25l`);
		if (process.stdin.isTTY) process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on('data', this.handleData);
		process.stdout.on('resize', this.handleResize);
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;
		process.stdin.off('data', this.handleData);
		process.stdout.off('resize', this.handleResize);
		if (process.stdin.isTTY) process.stdin.setRawMode(false);
		process.stdin.pause();
		process.stdout.write(`${ESC}?25h${ESC}?1049l`);
	}

	onKey(handler: (key: Key) => void): void {
		this.onKeyHandler = handler;
	}

	onResize(handler: () => void): void {
		this.onResizeHandler = handler;
	}

	/**
	 * Draw a frame.
	 *
	 * Repaints in place from the home position and clears each line as it goes,
	 * rather than clearing the whole screen first — a full clear between frames
	 * is what makes a terminal UI flicker.
	 */
	paint(lines: string[]): void {
		const out = [`${ESC}H`];
		for (const line of lines) out.push(line, `${ESC}K\r\n`);
		if (lines.length < this.painted) out.push(`${ESC}J`);
		this.painted = lines.length;
		process.stdout.write(out.join(''));
	}
}
