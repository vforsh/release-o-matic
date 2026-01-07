#!/usr/bin/env node
import { cac } from 'cac'
import prompts from 'prompts'
import {
	createClient,
	RmaticConfigError,
	RmaticError,
	RmaticHttpError,
	RmaticNetworkError,
	type DeployInfo,
	type DeploymentDetail,
	type ReleaseInfo,
} from '@vforsh/rmatic-client'
import { resolveConfig, type CliFlags } from './config.js'
import { resolveOutputMode, writeError, writeJson, writeLines, writeText } from './output.js'

const cli = cac('rmatic')

cli
	.option('--base-url <url>', 'Release-o-matic base URL (overrides RMATIC_BASE_URL)')
	.option('--token <token>', 'Bearer token (prefer RMATIC_TOKEN or config file)')
	.option('--json', 'Output JSON to stdout')
	.option('--plain', 'Plain, line-oriented output')
	.option('-q, --quiet', 'Reduce non-essential output')
	.option('-v, --verbose', 'Verbose logging (stderr)')
	.option('--debug', 'Include stack traces in errors')
	.option('--no-color', 'Disable color output')
	.option('--timeout <ms>', 'Request timeout in milliseconds', { default: undefined })
	.option('--no-input', 'Disable prompts')
	.option('-f, --force', 'Skip confirmations for risky actions')
	.help()

cli
	.command('health', 'Check service health')
	.example('rmatic --base-url https://… --token $RMATIC_TOKEN health')
	.action(async (_, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.health()
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeText(data.status ?? 'ok')
				return
			}

			const lines = [`Status: ${data.status}`]
			if (data.buildVersion) {
				lines.push(`Build: ${data.buildVersion}`)
			}
			if (data.deployedAt) {
				lines.push(`Deployed: ${data.deployedAt}`)
			}
			writeLines(lines)
		})
	})

cli
	.command('deploy pre <game> <env> <version>', 'Prepare a deployment directory')
	.example('rmatic deploy pre papa-cherry-2 staging 42')
	.action(async (game, env, version, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.deploy.pre({ game, env, version })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeLines([data.newBuildDir])
				return
			}

			writeLines([
				`Prepared build #${data.newBuildVersion} for ${game}/${env}.`,
				`Directory: ${data.newBuildDir}`,
			])
		})
	})

cli
	.command('deploy post <game> <env> <version>', 'Finalize a deployment')
	.example('rmatic deploy post papa-cherry-2 staging 42')
	.action(async (game, env, version, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.deploy.post({ game, env, version })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeLines([data.buildDirAlias])
				return
			}

			writeLines([
				`Deployed build #${data.buildVersion} for ${game}/${env}.`,
				`Build: ${data.buildDir}`,
				`Alias: ${data.buildDirAlias}`,
			])
		})
	})

cli
	.command('deployments list <game> <env>', 'List deployments for an environment')
	.example('rmatic deployments list papa-cherry-2 staging --plain')
	.action(async (game, env, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.deployments.list({ game, env })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeLines(data.map((item: DeployInfo) => String(item.version)))
				return
			}

			const lines = [`Deployments for ${game}/${env}:`]
			for (const deployment of data) {
				lines.push(`- #${deployment.version} (${deployment.deployedAt})`)
			}
			writeLines(lines)
		})
	})

cli
	.command('deployments current <game> <env>', 'Show current deployment')
	.action(async (game, env, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.deployments.current({ game, env })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeText(String(data.version))
				return
			}

			writeLines([
				`Current deployment: #${data.version}`,
				`Deployed: ${data.deployedAt}`,
				`Built: ${data.builtAtReadable ?? data.builtAt}`,
			])
		})
	})

cli
	.command('deployments get <game> <env> <version>', 'Show deployment details')
	.action(async (game, env, version, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.deployments.get({ game, env, version })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeText(String(data.version))
				return
			}

			const details = data as DeploymentDetail
			writeLines([
				`Deployment: #${details.version}`,
				`Current: ${details.isCurrent ? 'yes' : 'no'}`,
				`Deployed: ${details.deployedAt}`,
				`Built: ${details.builtAtReadable ?? details.builtAt}`,
			])
		})
	})

cli
	.command('publish <game> <platform> [buildKey]', 'Publish a build')
	.example('rmatic publish papa-cherry-2 vk master-21')
	.action(async (game, platform, buildKey, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.publish({ game, platform, buildKey })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeText(data.release.key)
				return
			}

			writeLines([
				`Published ${data.release.key} for ${game}/${platform}.`,
				`Path: ${data.path}`,
			])
		})
	})

cli
	.command('rollback <game> <platform> [buildKey]', 'Rollback to a previous build')
	.example('rmatic rollback papa-cherry-2 vk --force')
	.action(async (game, platform, buildKey, flags) => {
		await withClient(flags, async (client, outputMode, cliFlags) => {
			const target = await resolveRollbackTarget(client, game, platform, buildKey)

			const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
			const shouldConfirm = !cliFlags.force && !cliFlags.noInput && isInteractive
			if (shouldConfirm) {
				const confirmed = await promptRollbackConfirmation(target)
				if (!confirmed) {
					writeError('Rollback cancelled.')
					process.exitCode = 1
					return
				}
			} else if (!cliFlags.force) {
				throw new RmaticConfigError('Rollback requires confirmation. Pass --force to proceed non-interactively.')
			}

			const data = await client.rollback({ game, platform, buildKey: target.key })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeText(data.release.key)
				return
			}

			writeLines([
				`Rolled back to ${data.release.key} for ${game}/${platform}.`,
				`Path: ${data.path}`,
			])
		})
	})

cli
	.command('releases list <game> <platform>', 'List releases')
	.example('rmatic releases list papa-cherry-2 vk --plain')
	.action(async (game, platform, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.releases.list({ game, platform })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeLines(data.builds.map((item: ReleaseInfo) => item.key))
				return
			}

			const lines = [`Current: ${data.current ?? 'none'}`]
			for (const release of data.builds) {
				lines.push(`- ${release.key} (${release.releasedAt})`)
			}
			writeLines(lines)
		})
	})

cli
	.command('releases current <game> <platform>', 'Show the current release')
	.action(async (game, platform, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.releases.current({ game, platform })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeText(data.key)
				return
			}

			writeLines([
				`Current: ${data.key}`,
				`Released: ${data.releasedAt}`,
				`Built: ${data.builtAt}`,
			])
		})
	})

cli
	.command('releases get <game> <platform> <buildKey>', 'Show a release by build key')
	.action(async (game, platform, buildKey, flags) => {
		await withClient(flags, async (client, outputMode) => {
			const data = await client.releases.get({ game, platform, buildKey })
			if (outputMode === 'json') {
				writeJson(data)
				return
			}
			if (outputMode === 'plain') {
				writeText(data.key)
				return
			}

			writeLines([
				`Release: ${data.key}`,
				`Current: ${data.isCurrent ? 'yes' : 'no'}`,
				`Released: ${data.releasedAt}`,
				`Files: ${data.filesList.length}`,
			])
		})
	})

cli
	.command('help [command]', 'Show help for a command')
	.action((command) => {
		if (command) {
			const target = cli.commands.find((cmd) => cmd.name === command)
			if (target && typeof (target as { outputHelp?: () => void }).outputHelp === 'function') {
				;(target as { outputHelp: () => void }).outputHelp()
				return
			}
		}

		cli.outputHelp()
	})

cli.on('command:*', () => {
	writeError('Unknown command. Use --help to see available commands.')
	process.exitCode = 2
})

cli.parse()

async function withClient(
	flags: CliFlags,
	handler: (
		client: ReturnType<typeof createClient>,
		outputMode: ReturnType<typeof resolveOutputMode>,
		flags: CliFlags,
	) => Promise<void>,
) {
	let outputMode: ReturnType<typeof resolveOutputMode>
	try {
		outputMode = resolveOutputMode(flags)
	} catch (error) {
		handleError(new RmaticConfigError((error as Error).message, { cause: error }), flags)
		return
	}

	let config: Awaited<ReturnType<typeof resolveConfig>>
	try {
		config = await resolveConfig(flags)
	} catch (error) {
		handleError(error, flags)
		return
	}

	if (!config.baseUrl) {
		throw new RmaticConfigError(
			'Base URL is required. Use --base-url, RMATIC_BASE_URL, or a config file to set it.',
		)
	}

	const client = createClient({
		baseUrl: config.baseUrl,
		token: config.token,
		timeoutMs: config.timeoutMs,
	})

	try {
		await handler(client, outputMode, flags)
	} catch (error) {
		handleError(error, flags)
	}
}

function handleError(error: unknown, flags: CliFlags) {
	if (error instanceof RmaticConfigError) {
		writeError(error.message)
		if (flags.debug && error.cause) {
			writeError(String(error.cause))
		}
		process.exitCode = 2
		return
	}

	if (error instanceof RmaticHttpError) {
		writeError(error.message)
		if (flags.debug && error.cause) {
			writeError(String(error.cause))
		}

		switch (error.status) {
			case 401:
			case 403:
				process.exitCode = 3
				return
			case 404:
				process.exitCode = 4
				return
			case 400:
			case 409:
				process.exitCode = 5
				return
			default:
				process.exitCode = 1
				return
		}
	}

	if (error instanceof RmaticNetworkError) {
		writeError(error.message)
		if (flags.debug && error.cause) {
			writeError(String(error.cause))
		}
		process.exitCode = 6
		return
	}

	if (error instanceof RmaticError) {
		writeError(error.message)
		if (flags.debug && error.cause) {
			writeError(String(error.cause))
		}
		process.exitCode = 1
		return
	}

	writeError('Unexpected error occurred.')
	if (flags.debug) {
		writeError(String(error))
	}
	process.exitCode = 1
}

async function resolveRollbackTarget(
	client: ReturnType<typeof createClient>,
	game: string,
	platform: string,
	buildKey?: string,
): Promise<{ key: string; current?: ReleaseInfo | null }> {
	const current = await client.releases.current({ game, platform })
	if (buildKey) {
		return { key: buildKey, current }
	}

	const list = await client.releases.list({ game, platform })
	const currentIndex = list.builds.findIndex((item: ReleaseInfo) => item.key === list.current)
	const previous = currentIndex >= 0 ? list.builds[currentIndex + 1] : undefined

	if (!previous) {
		throw new RmaticError('No previous release found to rollback to.')
	}

	return { key: previous.key, current }
}

async function promptRollbackConfirmation(target: { key: string; current?: ReleaseInfo | null }) {
	const currentLabel = target.current?.key ?? 'unknown'
	const result = await prompts({
		type: 'confirm',
		name: 'confirm',
		message: `Rollback release?\nCurrent: ${currentLabel}\nTarget: ${target.key}`,
		initial: false,
	})

	return Boolean(result.confirm)
}
