import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RmaticConfigError } from '@vforsh/rmatic-client'

export type CliFlags = {
	baseUrl?: string
	token?: string
	timeout?: string | number
	json?: boolean
	plain?: boolean
	quiet?: boolean
	verbose?: boolean
	debug?: boolean
	noColor?: boolean
	noInput?: boolean
	force?: boolean
	interactive?: boolean
}

export type ResolvedConfig = {
	baseUrl?: string
	token?: string
	timeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	const xdgConfig = env.XDG_CONFIG_HOME
	const baseDir = xdgConfig ? xdgConfig : path.join(os.homedir(), '.config')
	return path.join(baseDir, 'rmatic', 'config.json')
}

export async function readConfigFile(configPath: string): Promise<{ baseUrl?: string; token?: string } | null> {
	try {
		const raw = await fs.readFile(configPath, 'utf8')
		const parsed = JSON.parse(raw) as { baseUrl?: string; token?: string }
		return parsed
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null
		}

		throw new RmaticConfigError(`Failed to read config file at ${configPath}.`, { cause: error })
	}
}

function parseTimeout(timeout?: string | number): number {
	if (timeout === undefined) {
		return DEFAULT_TIMEOUT_MS
	}

	const value = typeof timeout === 'string' ? Number(timeout) : timeout
	if (!Number.isFinite(value) || value <= 0) {
		throw new RmaticConfigError(`Invalid timeout value: ${timeout}`)
	}

	return value
}

export async function resolveConfig(flags: CliFlags, env: NodeJS.ProcessEnv = process.env, configPath?: string): Promise<ResolvedConfig> {
	const configFilePath = configPath ?? getConfigPath(env)
	const fileConfig = await readConfigFile(configFilePath)

	return {
		baseUrl: flags.baseUrl ?? env.RMATIC_BASE_URL ?? fileConfig?.baseUrl,
		token: flags.token ?? env.RMATIC_TOKEN ?? fileConfig?.token,
		timeoutMs: parseTimeout(flags.timeout),
	}
}
