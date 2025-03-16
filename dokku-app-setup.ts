#!/usr/bin/env bun

import { $, chalk, fs } from 'zx'

// Silence verbose output from commands
$.verbose = false

// Required Configuration
const DOKKU_USER = 'dokku'
const DOKKU_HOST = 'robowhale.ru'
const APP_NAME = 'release-o-matic'
const DOMAINS = ['release-o-matic.robowhale.ru']
const GIT_REMOTE_NAME = 'dokku'

// Storage Configuration
// Format: "host_dir:container_dir"
// const STORAGE_MOUNTS = ['/var/www/html:/app/data']
const STORAGE_MOUNTS = [] as string[]

/**
 * Log a message with color
 */
const log = {
	info: (message: string) => console.log(chalk.blue(`${message}`)),
	success: (message: string) => console.log(chalk.green(`${message}`)),
	warning: (message: string) => console.log(chalk.yellow(`${message}`)),
	error: (message: string) => console.log(chalk.red(`${message}`)),
}

/**
 * Execute a command on the Dokku server
 */
async function dokkuCmd(command: string) {
	try {
		const result = await $`ssh ${DOKKU_USER}@${DOKKU_HOST} ${command}`
		return result.stdout.trim()
	} catch (error) {
		log.error(`Failed to execute command on Dokku server: ${command}`)
		throw error
	}
}

/**
 * Check if Dokku is installed on the target server
 */
async function checkDokkuInstalled() {
	log.info('Checking if Dokku is installed on the target server...')

	try {
		const version = await dokkuCmd('version')
		log.success(`Dokku is installed. Version: ${version}`)
		return true
	} catch (error) {
		log.error('Dokku is not installed on the target server or SSH connection failed.')
		log.error('Please make sure Dokku is installed and SSH is properly configured.')
		return false
	}
}

/**
 * Check if a Dokku plugin is installed
 */
async function checkPluginInstalled(pluginName: string) {
	try {
		const plugins = await dokkuCmd('plugin:list')
		return plugins.includes(pluginName)
	} catch (error) {
		log.error(`Failed to check if plugin ${pluginName} is installed.`)
		throw error
	}
}

/**
 * Create a Dokku application
 */
async function createApp() {
	log.info(`Creating Dokku application: ${APP_NAME}`)

	try {
		// Check if app already exists
		const apps = await dokkuCmd('apps:list')
		if (apps.split('\n').includes(APP_NAME)) {
			log.warning(`Application ${APP_NAME} already exists. Skipping creation.`)
			return
		}

		await dokkuCmd(`apps:create ${APP_NAME}`)
		log.success(`Application ${APP_NAME} created successfully.`)
	} catch (error) {
		log.error(`Failed to create application ${APP_NAME}.`)
		throw error
	}
}

/**
 * Set up domains for the application
 */
async function setupDomains() {
	log.info(`Setting up domains for ${APP_NAME}: ${DOMAINS.join(', ')}`)

	try {
		// Clear existing domains
		await dokkuCmd(`domains:clear ${APP_NAME}`)

		// Add each domain
		for (const domain of DOMAINS) {
			await dokkuCmd(`domains:add ${APP_NAME} ${domain}`)
		}

		log.success(`Domains set up successfully for ${APP_NAME}.`)
	} catch (error) {
		log.error(`Failed to set up domains for ${APP_NAME}.`)
		throw error
	}
}

/**
 * Set up storage mounts for the application
 */
async function setupStorage() {
	if (STORAGE_MOUNTS.length === 0) {
		log.info('No storage mounts defined. Skipping storage setup.')
		return
	}

	log.info(`Setting up storage mounts for ${APP_NAME}`)

	try {
		// Check if storage plugin is installed
		const storageInstalled = await checkPluginInstalled('storage')
		if (!storageInstalled) {
			log.error('The dokku-storage plugin is not installed.')
			log.info('Install it with: dokku plugin:install https://github.com/dokku/dokku-storage.git')
			throw new Error('Missing required plugin: dokku-storage')
		}

		// Set up each storage mount
		for (const mount of STORAGE_MOUNTS) {
			const [hostDir, containerDir] = mount.split(':')

			if (!hostDir || !containerDir) {
				log.error(`Invalid storage mount format: ${mount}. Expected format: "host_dir:container_dir"`)
				continue
			}

			// Create host directory if it doesn't exist
			// await dokkuCmd(`mkdir -p ${hostDir}`)

			// Set up the mount
			await dokkuCmd(`storage:mount ${APP_NAME} ${hostDir}:${containerDir}`)

			log.success(`Storage mount created: ${hostDir} -> ${containerDir}`)
		}

		log.success(`Storage mounts set up successfully for ${APP_NAME}.`)
	} catch (error) {
		log.error(`Failed to set up storage mounts for ${APP_NAME}.`)
		throw error
	}
}

/**
 * Set up git remote for the application
 */
async function setupGitRemote() {
	log.info(`Setting up git remote for ${APP_NAME}`)

	try {
		// Check if git is initialized
		const gitInitialized = await fs.exists('.git').catch(() => false)
		if (!gitInitialized) {
			log.warning('Git repository not initialized. Initializing...')
			await $`git init`
			log.success('Git repository initialized.')
		}

		// Check if remote already exists
		const remotesResult = await $`git remote`
		const remotes = remotesResult.stdout.trim()

		if (remotes && remotes.split('\n').includes(GIT_REMOTE_NAME)) {
			log.info(`Git remote ${GIT_REMOTE_NAME} already exists. Keeping existing remote.`)
			return
		}

		// Add the remote
		await $`git remote add ${GIT_REMOTE_NAME} ${DOKKU_USER}@${DOKKU_HOST}:${APP_NAME}`

		log.success(`Git remote ${GIT_REMOTE_NAME} set up successfully.`)
	} catch (error) {
		log.error(`Failed to set up git remote for ${APP_NAME}.`)
		throw error
	}
}

/**
 * Get the current git branch
 */
async function getCurrentGitBranch(defaultBranch = 'master') {
	try {
		const result = await $`git rev-parse --abbrev-ref HEAD`
		return result.stdout.trim() || defaultBranch
	} catch (error) {
		log.warning(`Could not determine current git branch, defaulting to "${defaultBranch}"`)
		return defaultBranch
	}
}

/**
 * Main function to run the script
 */
async function main() {
	console.log(chalk.bold.blue('🚀 Dokku Application Setup'))
	console.log(chalk.gray('=============================================='))

	try {
		// Check if Dokku is installed
		const dokkuInstalled = await checkDokkuInstalled()
		if (!dokkuInstalled) {
			process.exit(1)
		}

		// Create the application
		await createApp()

		// Set up domains
		await setupDomains()

		// Set up storage
		await setupStorage()

		// Set up git remote
		await setupGitRemote()

		// Get current branch for deployment instructions
		const currentBranch = await getCurrentGitBranch()

		console.log(chalk.gray('=============================================='))
		console.log(chalk.bold.blue('✅ Dokku Application Setup - Completed'))
		console.log(`\nℹ️  Deploy your app with '${chalk.bold.green(`git push ${GIT_REMOTE_NAME} ${currentBranch}`)}'`)
	} catch (error) {
		if (error instanceof Error) {
			log.error(`Setup failed: ${error.message}`)
		} else {
			log.error(`Setup failed with an unknown error`)
		}
		process.exit(1)
	}
}

// Run the script
main()
