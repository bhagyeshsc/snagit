/** State, key routing and the render loop. */

import * as binaries from './core/binaries.js';
import * as history from './core/history.js';
import * as humanise from './core/humanise.js';
import type {Choice, Media} from './core/media.js';
import {download, probe, type DownloadHandle, type Progress} from './core/ytdlp.js';
import * as screens from './screens.js';
import {Term, type Key, size} from './term.js';

type State =
	| {name: 'setup'; note: string}
	| {name: 'paste'}
	| {name: 'choose'; media: Media; index: number}
	| {
			name: 'download';
			media: Media;
			choice: Choice;
			progress?: Progress;
			stage: string;
			outcome: screens.Outcome;
	  };

export class App {
	private readonly term = new Term();
	private state: State = {name: 'setup', note: 'fetching yt-dlp …'};
	private value = '';
	private cursor = 0;
	private busy = false;
	private status = '';
	private links: string[] = [];
	private recalled = -1;
	private handle?: DownloadHandle;
	private stopping = false;

	constructor(private readonly outputDir: string) {}

	async run(): Promise<void> {
		this.term.start();
		this.term.onKey(key => this.onKey(key));
		this.term.onResize(() => this.draw());

		// Leave the terminal usable however we exit.
		const bail = () => this.quit();
		process.on('SIGINT', bail);
		process.on('SIGTERM', bail);
		process.on('exit', () => this.term.stop());

		this.draw();
		void history.load().then(items => {
			this.links = items;
		});
		await this.prepare();

		// Hold the process open; everything from here is key- and promise-driven.
		await new Promise<void>(resolve => {
			this.done = resolve;
		});
	}

	private done: () => void = () => {};

	private draw(): void {
		if (this.stopping) return;
		const {columns} = size();
		let lines: string[];

		switch (this.state.name) {
			case 'setup':
				lines = screens.setup(this.state.note, columns);
				break;
			case 'paste':
				lines = screens.paste(this.value, this.cursor, this.busy, this.status, columns);
				break;
			case 'choose':
				lines = screens.choose(this.state.media, this.state.index, columns);
				break;
			case 'download':
				lines = screens.download(
					this.state.media.title,
					this.state.choice,
					this.state.progress,
					this.state.stage,
					this.state.outcome,
					columns,
				);
				break;
		}

		this.term.paint(lines);
	}

	/** First run fetches the two binaries; later runs fall straight through. */
	private async prepare(): Promise<void> {
		try {
			if (!(await binaries.ytDlpReady())) {
				await binaries.ensureYtDlp(({received, total}) => {
					this.state = {
						name: 'setup',
						note: total
							? `fetching yt-dlp — ${humanise.size(received)} of ${humanise.size(total)}`
							: `fetching yt-dlp — ${humanise.size(received)}`,
					};
					this.draw();
				});
			}
			if (!(await binaries.ffmpegReady())) {
				await binaries.ensureFfmpeg(({received, total}) => {
					this.state = {
						name: 'setup',
						note: total
							? `fetching ffmpeg — ${humanise.size(received)} of ${humanise.size(total)}`
							: `fetching ffmpeg — ${humanise.size(received)}`,
					};
					this.draw();
				});
			}
			this.state = {name: 'paste'};
			this.draw();
		} catch (error) {
			this.state = {name: 'setup', note: (error as Error).message};
			this.draw();
		}
	}

	private onKey(key: Key): void {
		if (key.name === 'ctrl-c') {
			this.quit();
			return;
		}

		switch (this.state.name) {
			case 'paste':
				this.onPasteKey(key);
				break;
			case 'choose':
				this.onChooseKey(key);
				break;
			case 'download':
				this.onDownloadKey(key);
				break;
			default:
				break;
		}
	}

	// --- paste ---

	private onPasteKey(key: Key): void {
		if (this.busy) return;

		switch (key.name) {
			case 'enter':
				void this.look();
				return;
			case 'up':
				if (this.recalled + 1 < this.links.length) {
					this.recalled += 1;
					this.setValue(this.links[this.recalled]!);
				}
				break;
			case 'down':
				if (this.recalled > 0) {
					this.recalled -= 1;
					this.setValue(this.links[this.recalled]!);
				} else if (this.recalled === 0) {
					this.recalled = -1;
					this.setValue('');
				}
				break;
			case 'left':
				this.cursor = Math.max(0, this.cursor - 1);
				break;
			case 'right':
				this.cursor = Math.min(this.value.length, this.cursor + 1);
				break;
			case 'backspace':
				if (this.cursor > 0) {
					this.value =
						this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
					this.cursor -= 1;
					this.recalled = -1;
				}
				break;
			case 'ctrl-u':
				this.setValue('');
				this.recalled = -1;
				break;
			case 'char':
				this.value =
					this.value.slice(0, this.cursor) + key.text + this.value.slice(this.cursor);
				this.cursor += key.text.length;
				this.recalled = -1;
				break;
			default:
				return;
		}

		this.draw();
	}

	private setValue(value: string): void {
		this.value = value;
		this.cursor = value.length;
	}

	private async look(): Promise<void> {
		const url = this.value.trim();
		if (!url) {
			this.status = 'Paste a link first.';
			this.draw();
			return;
		}

		this.busy = true;
		this.status = 'looking it up …';
		this.draw();

		try {
			const media = await probe(url);
			await history.remember(media.url);
			this.links = await history.load();
			this.recalled = -1;
			this.status = '';
			this.state = {name: 'choose', media, index: 0};
		} catch (error) {
			this.status = (error as Error).message;
		} finally {
			this.busy = false;
			this.draw();
		}
	}

	// --- choose ---

	private onChooseKey(key: Key): void {
		if (this.state.name !== 'choose') return;
		const {media} = this.state;

		if (key.name === 'up') {
			this.state.index = Math.max(0, this.state.index - 1);
		} else if (key.name === 'down') {
			this.state.index = Math.min(media.choices.length - 1, this.state.index + 1);
		} else if (key.name === 'enter') {
			this.begin(media, media.choices[this.state.index]!);
			return;
		} else if (key.name === 'escape') {
			this.state = {name: 'paste'};
		} else {
			return;
		}

		this.draw();
	}

	// --- download ---

	private begin(media: Media, choice: Choice): void {
		this.state = {name: 'download', media, choice, stage: '', outcome: {state: 'running'}};
		this.draw();

		const running = download(
			media.url,
			choice,
			this.outputDir,
			progress => {
				if (this.state.name === 'download') {
					this.state.progress = progress;
					this.draw();
				}
			},
			stage => {
				if (this.state.name === 'download') {
					this.state.stage = stage;
					this.draw();
				}
			},
		);
		this.handle = running;

		running.done.then(
			({path, fresh}) => {
				this.handle = undefined;
				if (this.state.name !== 'download') return;
				this.state.outcome = {state: 'saved', path, fresh};
				this.draw();
			},
			(error: Error & {cancelled?: boolean}) => {
				this.handle = undefined;
				if (error.cancelled) return; // we're already on the way out
				if (this.state.name !== 'download') return;
				this.state.outcome = {state: 'failed', message: error.message};
				this.draw();
			},
		);
	}

	private onDownloadKey(key: Key): void {
		if (this.state.name !== 'download' || key.name !== 'escape') return;
		const {outcome, media} = this.state;
		// Escape does nothing mid-download; leaving would hide a live transfer.
		if (outcome.state === 'running') return;
		this.state =
			outcome.state === 'saved' ? {name: 'paste'} : {name: 'choose', media, index: 0};
		this.draw();
	}

	private quit(): void {
		if (this.stopping) return;
		this.stopping = true;
		// Stop the child first — it holds a partial file we want cleaned up.
		this.handle?.cancel();
		this.term.stop();
		this.done();
		// Give the cancel a moment to unlink the partial, then go.
		setTimeout(() => process.exit(0), 120);
	}
}
