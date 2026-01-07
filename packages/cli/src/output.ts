export type OutputMode = 'human' | 'plain' | 'json'

export function resolveOutputMode(flags: { json?: boolean; plain?: boolean }): OutputMode {
	if (flags.json && flags.plain) {
		throw new Error('Cannot use --json and --plain together.')
	}

	if (flags.json) {
		return 'json'
	}

	if (flags.plain) {
		return 'plain'
	}

	return 'human'
}

export function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function writeLines(lines: string[]): void {
	process.stdout.write(`${lines.join('\n')}\n`)
}

export function writeText(text: string): void {
	process.stdout.write(`${text}\n`)
}

export function writeError(message: string): void {
	process.stderr.write(`${message}\n`)
}
