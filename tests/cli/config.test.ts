import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RmaticConfigError } from '../../packages/client/src/index'
import { resolveConfig } from '../../packages/cli/src/config'

describe('cli config resolution', () => {
	it('uses config file when no flags or env vars are set', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmatic-'))
		const configPath = path.join(tempDir, 'config.json')
		await fs.writeFile(configPath, JSON.stringify({ baseUrl: 'https://config', token: 'cfg' }))

		const resolved = await resolveConfig({}, {}, configPath)

		expect(resolved.baseUrl).toBe('https://config')
		expect(resolved.token).toBe('cfg')
	})

	it('env vars override config file', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmatic-'))
		const configPath = path.join(tempDir, 'config.json')
		await fs.writeFile(configPath, JSON.stringify({ baseUrl: 'https://config', token: 'cfg' }))

		const resolved = await resolveConfig(
			{},
			{ RMATIC_BASE_URL: 'https://env', RMATIC_TOKEN: 'env-token' },
			configPath,
		)

		expect(resolved.baseUrl).toBe('https://env')
		expect(resolved.token).toBe('env-token')
	})

	it('flags override env vars', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmatic-'))
		const configPath = path.join(tempDir, 'config.json')
		await fs.writeFile(configPath, JSON.stringify({ baseUrl: 'https://config', token: 'cfg' }))

		const resolved = await resolveConfig(
			{ baseUrl: 'https://flag', token: 'flag-token', timeout: 5000 },
			{ RMATIC_BASE_URL: 'https://env', RMATIC_TOKEN: 'env-token' },
			configPath,
		)

		expect(resolved.baseUrl).toBe('https://flag')
		expect(resolved.token).toBe('flag-token')
		expect(resolved.timeoutMs).toBe(5000)
	})

	it('rejects invalid timeout', async () => {
		await expect(resolveConfig({ timeout: 'nope' }, {}, '/tmp/missing.json')).rejects.toBeInstanceOf(
			RmaticConfigError,
		)
	})
})
