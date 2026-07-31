import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {cacheDir} from './binaries.js';

const MAX = 30;
const file = () => join(cacheDir(), 'history');

/** Past links, most recent first. */
export async function load(): Promise<string[]> {
	try {
		const text = await readFile(file(), 'utf8');
		return text.split('\n').filter(line => line.trim());
	} catch {
		return [];
	}
}

export async function remember(url: string): Promise<void> {
	try {
		const history = (await load()).filter(item => item !== url);
		history.unshift(url);
		await mkdir(cacheDir(), {recursive: true});
		await writeFile(file(), `${history.slice(0, MAX).join('\n')}\n`, 'utf8');
	} catch {
		// History is a convenience; never let it break a download.
	}
}
