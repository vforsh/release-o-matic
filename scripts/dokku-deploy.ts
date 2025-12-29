#!/usr/bin/env bun

/**
 * Dokku Deploy Script
 *
 * Sets BUILD_VERSION and DEPLOYED_AT on the Dokku app, then pushes code.
 *
 * Usage:
 *   bun dokku-deploy.ts [--remote=dokku] [--refspec=master:dokku] [--ssh-host=dokku@example.com] [--no-meta] [<app-name>]
 */

import { execSync, spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import prompts from 'prompts'
import { parseArgs } from 'util'

interface Args {
	remote: string
	refspec: string
	appName: string
	sshHost: string
	noMeta: boolean
}

function parseCommandLineArgs(): Args {
	const { values, positionals } = parseArgs({
		args: Bun.argv,
		options: {
			'remote': { type: 'string' },
			'refspec': { type: 'string' },
			'ssh-host': { type: 'string' },
			'no-meta': { type: 'boolean' },
		},
		strict: true,
		allowPositionals: true,
	})

	const appName = positionals[2] ?? ''

	return {
		remote: values.remote ?? 'dokku',
		refspec: values.refspec ?? 'master:dokku',
		appName,
		sshHost: values['ssh-host'] ?? '',
		noMeta: values['no-meta'] ?? false,
	}
}

function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {}
	const lines = content.split('\n')

	for (const line of lines) {
		if (line.trim().startsWith('#') || line.trim() === '') {
			continue
		}

		const equalsIndex = line.indexOf('=')
		if (equalsIndex > 0) {
			const key = line.substring(0, equalsIndex).trim()
			let value = line.substring(equalsIndex + 1).trim()

			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.substring(1, value.length - 1)
			}

			result[key] = value
		}
	}

	return result
}

function saveDeploySettings(appName: string, sshHost: string): void {
	const content = `APP_NAME=${appName}\nSSH_HOST=${sshHost}`
	writeFileSync('.env.deploy', content, 'utf-8')
	console.log('Saved deployment settings to .env.deploy')
}

function loadDeploySettings(): { appName: string; sshHost: string } {
	if (!existsSync('.env.deploy')) {
		return { appName: '', sshHost: '' }
	}

	try {
		const content = readFileSync('.env.deploy', 'utf-8')
		const settings = parseEnvFile(content)
		return {
			appName: settings.APP_NAME || '',
			sshHost: settings.SSH_HOST || '',
		}
	} catch (error) {
		console.warn('Warning: Could not read .env.deploy file', error instanceof Error ? error.message : String(error))
		return { appName: '', sshHost: '' }
	}
}

function getGitCommitShort(): string {
	return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
}

async function setDeployMeta(appName: string, sshHost: string): Promise<void> {
	const buildVersion = process.env.BUILD_VERSION ?? getGitCommitShort()
	const deployedAt = process.env.DEPLOYED_AT ?? new Date().toISOString()

	const escapedBuildVersion = buildVersion.replace(/"/g, '\\"')
	const escapedDeployedAt = deployedAt.replace(/"/g, '\\"')
	const dokkuCmd = `config:set --no-restart ${appName} BUILD_VERSION="${escapedBuildVersion}" DEPLOYED_AT="${escapedDeployedAt}"`

	console.log(`\nSetting deploy metadata: BUILD_VERSION=${buildVersion} DEPLOYED_AT=${deployedAt}`)
	await runCommand('ssh', ['-t', sshHost, dokkuCmd])
}

async function runCommand(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, { stdio: 'inherit' })
		proc.on('close', (code) => {
			if (code === 0) {
				resolve()
			} else {
				reject(new Error(`${command} exited with code ${code}`))
			}
		})
	})
}

async function main() {
	try {
		let { remote, refspec, appName, sshHost, noMeta } = parseCommandLineArgs()

		if (!appName || !sshHost) {
			const savedSettings = loadDeploySettings()
			appName = appName || savedSettings.appName
			sshHost = sshHost || savedSettings.sshHost
		}

		const questions: prompts.PromptObject[] = []

		if (!appName) {
			questions.push({
				type: 'text',
				name: 'appName',
				message: 'Enter the Dokku application name:',
				validate: (value: string) => (value.trim() ? true : 'Application name is required'),
			})
		}

		if (!sshHost) {
			questions.push({
				type: 'text',
				name: 'sshHost',
				message: 'Enter the SSH host (e.g., dokku@example.com):',
				validate: (value: string) => (value.trim() ? true : 'SSH host is required'),
			})
		}

		if (questions.length > 0) {
			const response = await prompts(questions)

			if (!response.appName && !appName) {
				console.error('Error: No application name provided')
				process.exit(1)
			}

			if (!response.sshHost && !sshHost) {
				console.error('Error: No SSH host provided')
				process.exit(1)
			}

			appName = appName || response.appName
			sshHost = sshHost || response.sshHost
		}

		if (!noMeta) {
			await setDeployMeta(appName, sshHost)
		}

		console.log(`\nDeploying via: git push ${remote} ${refspec}`)
		await runCommand('git', ['push', remote, refspec])

		saveDeploySettings(appName, sshHost)
	} catch (error) {
		console.error('Error:', error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

main()
