import { RmaticConfigError, RmaticError, RmaticHttpError, RmaticNetworkError } from './errors.js'
import type {
	DeployInfo,
	HealthResponse,
	PostDeployResponse,
	PreDeployResponse,
	PublishResponse,
	ReleaseInfo,
	ReleaseWithFilesResponse,
	ReleasesResponse,
	RollbackResponse,
	DeploymentDetail,
} from './types.js'

export type ClientOptions = {
	/**
	 * Base URL for the Release-o-matic API (required).
	 */
	baseUrl: string
	/**
	 * Optional bearer token for authenticated servers.
	 */
	token?: string
	/**
	 * Request timeout in milliseconds (default: 30000).
	 */
	timeoutMs?: number
	/**
	 * Custom fetch implementation (primarily for testing).
	 */
	fetch?: typeof fetch
}

export type PublishInput = {
	/**
	 * Game slug.
	 */
	game: string
	/**
	 * Platform identifier.
	 */
	platform: string
	/**
	 * Optional build key. If omitted, server selects latest build.
	 */
	buildKey?: string
}

export type RollbackInput = {
	/**
	 * Game slug.
	 */
	game: string
	/**
	 * Platform identifier.
	 */
	platform: string
	/**
	 * Optional build key. If omitted, server rolls back to previous.
	 */
	buildKey?: string
}

export type ReleaseLookup = {
	/**
	 * Game slug.
	 */
	game: string
	/**
	 * Platform identifier.
	 */
	platform: string
	/**
	 * Build key to fetch.
	 */
	buildKey: string
}

export type DeployLookup = {
	/**
	 * Game slug.
	 */
	game: string
	/**
	 * Deployment environment.
	 */
	env: string
	/**
	 * Build version number.
	 */
	version: number | string
}

/**
 * Typed client interface for the Release-o-matic API.
 */
export type RmaticClient = {
	/**
	 * Check service health.
	 */
	health: () => Promise<HealthResponse>
	/**
	 * Prepare a deployment directory.
	 */
	preDeploy: (input: DeployLookup) => Promise<PreDeployResponse>
	/**
	 * Finalize deployment (post-deploy).
	 */
	postDeploy: (input: DeployLookup) => Promise<PostDeployResponse>
	/**
	 * Deployment queries.
	 */
	deployments: {
		/**
		 * List deployments for an environment.
		 */
		list: (input: { game: string; env: string }) => Promise<DeployInfo[]>
		/**
		 * Get the current deployment for an environment.
		 */
		current: (input: { game: string; env: string }) => Promise<DeployInfo>
		/**
		 * Get deployment details for a specific version.
		 */
		get: (input: DeployLookup) => Promise<DeploymentDetail>
	}
	/**
	 * Publish a build.
	 */
	publish: (input: PublishInput) => Promise<PublishResponse>
	/**
	 * Roll back to a previous build.
	 */
	rollback: (input: RollbackInput) => Promise<RollbackResponse>
	/**
	 * Release queries.
	 */
	releases: {
		/**
		 * List releases for a platform.
		 */
		list: (input: { game: string; platform: string }) => Promise<ReleasesResponse>
		/**
		 * Get the current release for a platform.
		 */
		current: (input: { game: string; platform: string }) => Promise<ReleaseInfo>
		/**
		 * Get a specific release by build key.
		 */
		get: (input: ReleaseLookup) => Promise<ReleaseWithFilesResponse>
	}
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

/**
 * Create a typed client for the Release-o-matic API.
 */
export function createClient(options: ClientOptions): RmaticClient {
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
		preDeploy: ({ game, env, version }: DeployLookup) =>
			request<PreDeployResponse>(
				'GET',
				`/preDeploy/${encodeURIComponent(game)}/${encodeURIComponent(env)}/${encodeURIComponent(
					version.toString(),
				)}`,
			),
		postDeploy: ({ game, env, version }: DeployLookup) =>
			request<PostDeployResponse>(
				'GET',
				`/postDeploy/${encodeURIComponent(game)}/${encodeURIComponent(env)}/${encodeURIComponent(
					version.toString(),
				)}`,
			),
		deployments: {
			list: ({ game, env }: { game: string; env: string }) =>
				request<DeployInfo[]>(
					'GET',
					`/deployments/${encodeURIComponent(game)}/${encodeURIComponent(env)}`,
				),
			current: ({ game, env }: { game: string; env: string }) =>
				request<DeployInfo>(
					'GET',
					`/deployments/${encodeURIComponent(game)}/${encodeURIComponent(env)}/current`,
				),
			get: ({ game, env, version }: DeployLookup) =>
				request<DeploymentDetail>(
					'GET',
					`/deployments/${encodeURIComponent(game)}/${encodeURIComponent(env)}/${encodeURIComponent(
						version.toString(),
					)}`,
				),
		},
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
