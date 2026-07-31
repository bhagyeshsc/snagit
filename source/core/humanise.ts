export function duration(seconds?: number): string {
	if (!seconds || !Number.isFinite(seconds)) return '—';
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	const pad = (value: number) => String(value).padStart(2, '0');
	return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function size(bytes?: number): string {
	if (!bytes || !Number.isFinite(bytes)) return '—';
	let value = bytes;
	const units = ['B', 'KB', 'MB', 'GB'];
	for (const unit of units) {
		if (value < 1024 || unit === 'GB') {
			// A decimal only earns its place on small numbers: 3.3 MB, but 232 MB.
			const decimals = value < 10 && unit !== 'B' && unit !== 'KB' ? 1 : 0;
			return `${value.toFixed(decimals)} ${unit}`;
		}
		value /= 1024;
	}
	return `${bytes} B`;
}
