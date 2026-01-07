import { describe, expect, it } from 'vitest'
import {
	createClient,
	RmaticConfigError,
	RmaticHttpError,
	RmaticNetworkError,
} from '../../packages/client/src/index'

describe('rmatic client', () => {
	it('adds Authorization header when token is provided', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
		const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ input, init })
			return new Response(
				JSON.stringify({ status: 'ok', buildVersion: null, deployedAt: null, timestamp: 0, uptime: 0 }),
				{ status: 200 },
			)
		}

		const client = createClient({ baseUrl: 'https://example.com', token: 'token-123', fetch })
		await client.health()

		const headers = calls[0]?.init?.headers
		const authHeader =
			headers instanceof Headers
				? headers.get('Authorization')
				: Array.isArray(headers)
					? headers.find(([key]) => key.toLowerCase() === 'authorization')?.[1]
					: (headers as Record<string, string> | undefined)?.Authorization

		expect(authHeader).toBe('Bearer token-123')
	})

	it('maps HTTP errors', async () => {
		const fetch = async () =>
			new Response(JSON.stringify({ message: 'Not found' }), {
				status: 404,
				headers: { 'content-type': 'application/json' },
			})

		const client = createClient({ baseUrl: 'https://example.com', fetch })

		await expect(client.releases.current({ game: 'demo', platform: 'vk' })).rejects.toBeInstanceOf(
			RmaticHttpError,
		)
	})

	it('throws on invalid base URL', () => {
		expect(() => createClient({ baseUrl: 'not-a-url' })).toThrow(RmaticConfigError)
	})

	it('maps timeouts to network errors', async () => {
		const fetch = async (_input: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					reject(new DOMException('Aborted', 'AbortError'))
				})
			})

		const client = createClient({ baseUrl: 'https://example.com', fetch, timeoutMs: 10 })

		await expect(client.health()).rejects.toBeInstanceOf(RmaticNetworkError)
	})
})
