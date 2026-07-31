// Palette for the whole app. Kept in one place so the screens stay consistent.
export const theme = {
	ink: '#e8eaf0', // primary text
	shade: '#4c5566', // knocked-back pixels in the wordmark
	dim: '#7c8595', // secondary text
	dimmer: '#5b6472', // hint labels, placeholders
	faint: '#454d5c', // separators
	line: '#4c5566', // panel borders
	accent: '#9fb4e0', // the selected row
	track: '#3a4150', // the unfilled part of the progress bar
	button: '#262b35', // text on the filled button
} as const;

export const glyph = {
	chevron: '❯',
	bullet: '‣',
	video: '▶',
	audio: '♪',
	tick: '✓',
	cross: '✗',
} as const;
