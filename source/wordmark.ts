// The SNAGIT wordmark, drawn as blocks in a 5x5 pixel font.

// Each glyph is five rows of five pixels. '#' is on, '.' is off.
const glyphs: Record<string, string[]> = {
	S: ['.####', '#....', '.###.', '....#', '####.'],
	N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
	A: ['.###.', '#...#', '#####', '#...#', '#...#'],
	G: ['.###.', '#....', '#..##', '#...#', '.###.'],
	I: ['#####', '..#..', '..#..', '..#..', '#####'],
	T: ['#####', '..#..', '..#..', '..#..', '..#..'],
};

// A few pixels sit a shade back to give the mark some texture, keyed by
// "letter,row,column". Fixed, so it renders the same every time rather than
// shimmering between runs.
const shaded = new Set([
	'1,2,0',
	'1,3,4',
	'2,0,3',
	'3,2,2',
	'4,4,4',
	'5,2,1',
]);

const pixel = '██'; // two cells wide, so glyphs come out roughly square
const gap = ' '.repeat(pixel.length);

export type Span = {text: string; shaded: boolean};

/**
 * The wordmark as rows of coloured spans. Rows keep their full width including
 * trailing blanks — trimming them would let centring shift each row by a
 * different amount and shear the mark.
 */
export function render(word = 'SNAGIT'): Span[][] {
	const letters = [...word].filter(char => glyphs[char]).map(char => glyphs[char]!);
	if (letters.length === 0) return [];

	const rows: Span[][] = [];
	for (let row = 0; row < letters[0]!.length; row++) {
		const spans: Span[] = [];
		letters.forEach((glyph, index) => {
			const line = glyph[row]!;
			for (let col = 0; col < line.length; col++) {
				spans.push(
					line[col] === '#'
						? {text: pixel, shaded: shaded.has(`${index},${row},${col}`)}
						: {text: ' '.repeat(pixel.length), shaded: false},
				);
			}
			if (index < letters.length - 1) spans.push({text: gap, shaded: false});
		});
		rows.push(spans);
	}

	return rows;
}

/** Columns the mark needs, so we can fall back to plain text when cramped. */
export function width(word = 'SNAGIT'): number {
	const count = [...word].filter(char => glyphs[char]).length;
	return count * 5 * pixel.length + Math.max(0, count - 1) * gap.length;
}
