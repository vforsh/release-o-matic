export class RmaticError extends Error {
	cause?: unknown

	constructor(message: string, options?: { cause?: unknown }) {
		super(message)
		this.name = 'RmaticError'
		if (options?.cause) {
			this.cause = options.cause
		}
	}
}

export class RmaticConfigError extends RmaticError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'RmaticConfigError'
	}
}

export class RmaticHttpError extends RmaticError {
	status: number
	method: string
	url: string
	body?: unknown

	constructor(options: { status: number; method: string; url: string; message: string; body?: unknown; cause?: unknown }) {
		super(options.message, { cause: options.cause })
		this.name = 'RmaticHttpError'
		this.status = options.status
		this.method = options.method
		this.url = options.url
		this.body = options.body
	}
}

export class RmaticNetworkError extends RmaticError {
	kind: 'network' | 'timeout'

	constructor(message: string, options: { kind: 'network' | 'timeout'; cause?: unknown }) {
		super(message, { cause: options.cause })
		this.name = 'RmaticNetworkError'
		this.kind = options.kind
	}
}
