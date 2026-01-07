import { RmaticConfigError, RmaticError, RmaticHttpError, RmaticNetworkError } from './errors'
import type {
	HealthResponse,
	PublishResponse,
	ReleaseInfo,
	ReleaseWithFilesResponse,
	ReleasesResponse,
	RollbackResponse,
} from './types'

export type ClientOptions = {
	baseUrl: string
	token?: string
	timeoutMs?: number
	fetch?: typeof fetch
}

export type PublishInput = {
	game: string
	platform: string
	buildKey?: string
}

export type RollbackInput = {
	game: string
	platform: string
	buildKey?: string
}

export type ReleaseLookup = {
	game: string
	platform: string
	buildKey: string
}

const DEFAULT_TIMEOUT_MS = 30_000

function normalizeBaseUrl(baseUrl: string): URL {
	if (!baseUrl) {
		throw new RmaticConfigError('Base URL is required.')
	}

	try {
		return new URL(baseUrl)
	} catch (error) {
		throw new RmaticConfigError(`Invalid base URL: ${baseUrl}`, { cause: error })
	}
}

function getErrorMessage(status: number, method: string, url: string, body?: unknown): string {
	if (body && typeof body === 'object' && 'message' in body) {
		const message = (body as { message?: unknown }).message
		if (typeof message === 'string' && message.trim().length > 0) {
			return message
		}
	}

	return `${method} ${url} failed with status ${status}`
}

export function createClient(options: ClientOptions) {
	const baseUrl = normalizeBaseUrl(options.baseUrl)
	const token = options.token
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const fetchImpl = options.fetch ?? globalThis.fetch

	if (!fetchImpl) {
		throw new RmaticConfigError('Global fetch is not available. Provide a custom fetch implementation.')
	}

	async function request<T>(method: string, path: string): Promise<T> {
		const url = new URL(path, baseUrl)
		const headers = new Headers()
		if (token) {
			headers.set('Authorization', `Bearer ${token}`)
		}

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await fetchImpl(url, {
				method,
				headers,
				signal: controller.signal,
			})

			const text = await response.text()
			let body: unknown = null
			if (text) {
				try {
					body = JSON.parse(text)
				} catch (error) {
					if (response.ok) {
						throw new RmaticError('Failed to parse JSON response.', { cause: error })
					}
					body = text
				}
			}

			if (!response.ok) {
				throw new RmaticHttpError({
					status: response.status,
					method,
					url: url.toString(),
					message: getErrorMessage(response.status, method, url.toString(), body),
					body,
				})
			}

			return body as T
		} catch (error) {
			if (error instanceof RmaticHttpError) {
				throw error
			}

			if (error instanceof DOMException && error.name === 'AbortError') {
				throw new RmaticNetworkError('Request timed out.', { kind: 'timeout', cause: error })
			}

			throw new RmaticNetworkError('Network request failed.', { kind: 'network', cause: error })
		} finally {
			clearTimeout(timeoutId)
		}
	}

	return {
		health: () => request<HealthResponse>('GET', '/health'),
		publish: ({ game, platform, buildKey }: PublishInput) =>
			request<PublishResponse>(
				'GET',
				`/publish/${encodeURIComponent(game)}/${encodeURIComponent(platform)}${
					buildKey ? `/${encodeURIComponent(buildKey)}` : ''
				}`,
			),
		rollback: ({ game, platform, buildKey }: RollbackInput) =>
			request<RollbackResponse>(
				'GET',
				`/rollback/${encodeURIComponent(game)}/${encodeURIComponent(platform)}${
					buildKey ? `/${encodeURIComponent(buildKey)}` : ''
				}`,
			),
		releases: {
			list: ({ game, platform }: { game: string; platform: string }) =>
				request<ReleasesResponse>(
					'GET',
					`/releases/${encodeURIComponent(game)}/${encodeURIComponent(platform)}`,
				),
			current: ({ game, platform }: { game: string; platform: string }) =>
				request<ReleaseInfo>(
					'GET',
					`/releases/${encodeURIComponent(game)}/${encodeURIComponent(platform)}/current`,
				),
			get: ({ game, platform, buildKey }: ReleaseLookup) =>
				request<ReleaseWithFilesResponse>(
					'GET',
					`/releases/${encodeURIComponent(game)}/${encodeURIComponent(platform)}/${encodeURIComponent(buildKey)}`,
				),
		},
	}
}
