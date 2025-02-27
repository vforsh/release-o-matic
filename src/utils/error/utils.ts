export function getErrorName(errorLike: unknown): string | null {
	if (typeof errorLike === 'object' && errorLike && 'name' in errorLike && typeof errorLike.name === 'string') {
		return errorLike.name;
	}

	if (typeof errorLike === 'string') {
		return errorLike;
	}

	return null;
}

export function getErrorMessage(errorLike: unknown): string | null {
	if (typeof errorLike === 'object' && errorLike && 'message' in errorLike && typeof errorLike.message === 'string') {
		return errorLike.message;
	}

	if (typeof errorLike === 'string') {
		return errorLike;
	}

	return null;
}

export function getErrorLog(errorLike: unknown, nameFallback?: string, msgFallback?: string): string {
	const name = getErrorName(errorLike) ?? nameFallback;
	const msg = getErrorMessage(errorLike) ?? msgFallback;

	return `${name ?? '???'} - ${msg ?? '???'}`;
}
