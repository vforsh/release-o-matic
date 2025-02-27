import * as fse from 'fs-extra'
import { globby, globbySync } from 'globby'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { without } from 'lodash-es'
import path from 'path'
import { z } from 'zod'
import { env as ENV } from './env'
import { fromReadableDateString, toReadableDateString } from './utils/date/readable-date-string'
import { getErrorLog } from './utils/error/utils'

/**
 * Build key is a string that consists of env and build number
 * For example: `master-12` or `develop-12`
 */
type BuildKey = `${string}-${number}`

function isBuildKey(key: string): key is BuildKey {
	return /^[a-zA-Z0-9_-]+-\d+$/.test(key)
}

function createBuildKey(env: string, version: number | string): BuildKey {
	return `${env}-${version.toString()}` as BuildKey
}

function parseBuildKey(key: BuildKey): { env: string; version: number } {
	const [env, version] = key.split('-')
	return {
		env,
		version: parseInt(version),
	}
}

const buildInfoSchema = z.object({
	version: z.number().describe('build version'),
	builtAt: z.number().describe('build timestamp'),
	builtAtReadable: z.string().describe('build timestamp in readable format'),
	gitCommitHash: z.string().describe('git commit hash'),
	gitBranch: z.string().describe('git branch'),
})

type BuildInfo = z.infer<typeof buildInfoSchema>

type DeployInfo = BuildInfo & {
	deployedAt: string
}

type ReleaseInfo = {
	key: BuildKey
	index: string
	files: string
	releasedAt: string
	builtAt: string
	gitBranch: string
	gitCommit: string
}

type Releases = {
	current: string | null
	builds: ReleaseInfo[]
}

const app = new Hono()

// Add logger and auth middleware
app.use(
	logger((str, ...rest) => {
		const time = toReadableDateString(Date.now(), 'ms')
		console.log(`[${time}]`, str, ...rest)
		return str
	}),
)

// Add auth middleware
app.use(async function authMiddleware(c: any, next: any) {
	if (!ENV.AUTH_REQUIRED) {
		return await next()
	}

	const authHeader = c.req.header('Authorization')

	if (!authHeader) {
		return c.json({ message: 'Authorization header is required' }, 401)
	}

	const [type, token] = authHeader.split(' ')

	if (type !== 'Bearer') {
		return c.json({ message: 'Bearer token is required' }, 401)
	}

	if (token !== ENV.BEARER_TOKEN) {
		return c.json({ message: 'Invalid token' }, 401)
	}

	return await next()
})

app.get('/', (c) => c.text(ENV.GAME_BUILDS_DIR))

app.get('/env', (c) => {
	return c.json(ENV)
})

// готовим новый билд к деплою в конкретное окружение
// endpoint возвращает директорию `newBuildDir`, в которую нужно положить билд (например, используя rsync)
app.get('/preDeploy/:game/:env/:version', (c) => {
	const game = c.req.param('game')

	const env = c.req.param('env')

	const build = parseInt(c.req.param('version'))

	if (!Number.isInteger(build) || build <= 0) {
		return c.json({ message: 'invalid version, must be a positive integer' }, 400)
	}

	const envDir = path.join(ENV.GAME_BUILDS_DIR, game, env)

	const buildDir = path.join(envDir, build.toString())

	fse.ensureDirSync(envDir)

	const existingBuilds = fse
		.readdirSync(envDir)
		.filter((item) => isEmptyDir(path.join(envDir, item)) === false)
		.map((item) => parseInt(item))
		.filter((item) => Number.isInteger(item))
		.sort((a, b) => a - b)

	if (existingBuilds.includes(build)) {
		return c.json(
			{
				message: `version #${build} already exists`,
				newBuildVersion: existingBuilds.at(-1)! + 1,
				builds: existingBuilds,
			},
			400,
		)
	}

	fse.ensureDirSync(buildDir)

	const lastBuildVersion = existingBuilds.at(-1)
	if (lastBuildVersion) {
		fse.copySync(path.join(envDir, lastBuildVersion.toString()), buildDir)
	} else {
		fse.ensureDirSync(buildDir)
	}

	return c.json({
		newBuildVersion: build,
		newBuildDir: buildDir,
		builds: existingBuilds,
	})
})

// колбек после успешного деплоя нового билда в конкретное окружение
app.get('/postDeploy/:game/:env/:version', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const env = c.req.param('env')!

	const envDir = path.join(gameDir, env)

	const deployedBuildVersion = c.req.param('version')

	if (deployedBuildVersion === undefined) {
		return c.json({ message: `build #${deployedBuildVersion} doesn't exist` }, 404)
	}

	const deployedBuildDir = path.join(envDir, deployedBuildVersion.toString())

	if (!fse.existsSync(deployedBuildDir)) {
		return c.json({ message: `build directory '${deployedBuildDir}' doesn't exist` }, 404)
	}

	const buildInfoPath = path.join(deployedBuildDir, 'build_info.json')
	const buildInfo = fse.existsSync(buildInfoPath) ? (fse.readJsonSync(buildInfoPath) as BuildInfo) : null
	if (!buildInfo) {
		return c.json({ message: `build info file '${deployedBuildDir}/build_info.json' is missing` }, 404)
	}

	const buildInfoResult = buildInfoSchema.safeParse(buildInfo)
	if (!buildInfoResult.success) {
		return c.json({ message: `build info file is invalid`, errors: buildInfoResult.error.errors }, 400)
	}

	let symlinkPath = path.join(envDir, 'latest')
	fse.rmSync(symlinkPath, { force: true })
	fse.symlinkSync(deployedBuildDir, symlinkPath)

	const time = toReadableDateString(Date.now(), 'ms')
	console.log(
		`[${time}] Created symlink: ${path.relative(ENV.WEB_SERVER_DIR, symlinkPath)} -> ${path.relative(ENV.WEB_SERVER_DIR, deployedBuildDir)}`,
	)

	// Update modified date for deployed build dir
	const currentTime = new Date()
	try {
		fse.utimesSync(deployedBuildDir, currentTime, currentTime)
		console.log(
			`[${time}] Updated modified date for ${path.relative(ENV.WEB_SERVER_DIR, deployedBuildDir)} to ${toReadableDateString(currentTime.getTime())}`,
		)
	} catch (error) {
		console.error(
			`[${time}] Failed to update modified date for ${path.relative(ENV.WEB_SERVER_DIR, deployedBuildDir)}:`,
			error,
		)
	}

	const removedPaths = removeOldDeployments(envDir, { buildsNumToKeep: 10 })
	console.log(`[${time}] Removed ${removedPaths.length} deployments: ${removedPaths.join(', ')}`)

	return c.json({
		buildVersion: deployedBuildVersion,
		buildDir: path.relative(ENV.WEB_SERVER_DIR, deployedBuildDir),
		buildDirAlias: path.relative(ENV.WEB_SERVER_DIR, symlinkPath),
	})
})

// инфо о всех задеплоенных билдах для конкретного окружения
app.get('/deployments/:game/:env', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const env = c.req.param('env')

	const envDir = path.join(gameDir, env)

	if (!fse.existsSync(envDir)) {
		return c.json({ message: `environment '${env}' doesn't exist` }, 404)
	}

	const existingBuilds = fse
		.readdirSync(envDir)
		.filter((item) => Number.isInteger(parseInt(item)) && fse.statSync(path.join(envDir, item)).isDirectory())
		.sort((a, b) => parseInt(b) - parseInt(a))
		.reduce((acc, version) => {
			const dirpath = path.join(envDir, version)
			const modifiedAt = fse.statSync(dirpath).mtime
			const buildInfo = fse.readJsonSync(path.join(dirpath, 'build_info.json')) as BuildInfo

			acc.push({
				version: parseInt(version),
				gitBranch: buildInfo.gitBranch,
				gitCommitHash: buildInfo.gitCommitHash,
				builtAt: buildInfo.builtAt,
				deployedAt: toReadableDateString(modifiedAt.getTime()),
			} as DeployInfo)

			return acc
		}, [] as DeployInfo[])

	return c.json(existingBuilds)
})

// инфо о текущем (последнем) задеплоенном билде
app.get('/deployments/:game/:env/current', (c) => {
	const game = c.req.param('game')
	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)
	const env = c.req.param('env')
	const envDir = path.join(gameDir, env)

	if (!fse.existsSync(envDir)) {
		return c.json({ message: `environment '${env}' doesn't exist` }, 404)
	}

	// Check if 'latest' symlink exists
	const latestSymlinkPath = path.join(envDir, 'latest')
	if (!fse.existsSync(latestSymlinkPath)) {
		return c.json({ message: `no current deployment for environment '${env}'` }, 404)
	}

	// Get the actual build directory the symlink points to
	const currentBuildPath = fse.realpathSync(latestSymlinkPath)
	const version = path.basename(currentBuildPath)

	if (!Number.isInteger(parseInt(version))) {
		return c.json({ message: `invalid current deployment for environment '${env}'` }, 500)
	}

	try {
		const modifiedAt = fse.statSync(currentBuildPath).mtime
		const buildInfo = fse.readJsonSync(path.join(currentBuildPath, 'build_info.json')) as BuildInfo

		const deployInfo: DeployInfo = {
			version: parseInt(version),
			gitBranch: buildInfo.gitBranch,
			gitCommitHash: buildInfo.gitCommitHash,
			builtAt: buildInfo.builtAt,
			builtAtReadable: buildInfo.builtAtReadable,
			deployedAt: toReadableDateString(modifiedAt.getTime()),
		}

		return c.json(deployInfo)
	} catch (error) {
		return c.json(
			{
				message: `error reading current deployment info: ${error instanceof Error ? error.message : String(error)}`,
				path: currentBuildPath,
			},
			500,
		)
	}
})

// инфо о конкретном задеплоенном билде
app.get('/deployments/:game/:env/:version', (c) => {
	const game = c.req.param('game')
	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const env = c.req.param('env')
	const envDir = path.join(gameDir, env)
	if (!fse.existsSync(envDir)) {
		return c.json({ message: `environment '${env}' doesn't exist` }, 404)
	}

	const version = c.req.param('version')
	const buildDir = path.join(envDir, version)
	if (!fse.existsSync(buildDir)) {
		return c.json({ message: `build #${version} doesn't exist in environment '${env}'` }, 404)
	}

	try {
		const modifiedAt = fse.statSync(buildDir).mtime
		const buildInfo = fse.readJsonSync(path.join(buildDir, 'build_info.json')) as BuildInfo

		// Check if this is the current deployment
		const latestSymlinkPath = path.join(envDir, 'latest')
		let isCurrent = false

		if (fse.existsSync(latestSymlinkPath)) {
			const currentBuildPath = fse.realpathSync(latestSymlinkPath)
			isCurrent = currentBuildPath === buildDir
		}

		const deployInfo: DeployInfo & { isCurrent: boolean } = {
			version: parseInt(version),
			gitBranch: buildInfo.gitBranch,
			gitCommitHash: buildInfo.gitCommitHash,
			builtAt: buildInfo.builtAt,
			builtAtReadable: buildInfo.builtAtReadable,
			deployedAt: toReadableDateString(modifiedAt.getTime()),
			isCurrent,
		}

		return c.json(deployInfo)
	} catch (error) {
		return c.json(
			{
				message: `error reading deployments info (${getErrorLog(error)})`,
				path: buildDir,
			},
			500,
		)
	}
})

// инфо о всех релизах для указанной игры и платформы
app.get('/releases/:game/:platform', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	// директория с релизами для указанной платформы
	const releasesDir = path.join(gameDir, 'prod', platform)
	if (!fse.existsSync(releasesDir)) {
		const emptyReleases: Releases = {
			current: null,
			builds: [],
		}

		return c.json(emptyReleases)
	}

	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		const emptyReleases: Releases = {
			current: null,
			builds: [],
		}

		return c.json(emptyReleases)
	}

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	return c.json(releases)
})

// инфо о текущем релизе
app.get('/releases/:game/:platform/current', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	const releasesDir = path.join(gameDir, `prod`, platform)
	if (!fse.existsSync(releasesDir)) {
		return c.json({ message: `platform '${platform}' doesn't exist` }, 404)
	}

	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return c.json({ message: `there are no published builds for platform '${platform}'` }, 404)
	}

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	return c.json(releases.builds.find((item) => item.key === releases.current))
})

// инфо о конкретном релизе, например, `master-11`
app.get('/releases/:game/:platform/:buildKey', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	const releasesDir = path.join(gameDir, `prod`, platform)
	if (!fse.existsSync(releasesDir)) {
		return c.json({ message: `platform '${platform}' doesn't exist` }, 404)
	}

	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return c.json({ message: `there are no published builds for platform '${platform}'` }, 404)
	}

	const buildKey = c.req.param('buildKey')

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	const release = releases.builds.find((item) => item.key === buildKey)
	if (!release) {
		return c.json({ message: `release '${buildKey}' doesn't exist` }, 404)
	}

	// @ts-expect-error
	const filesJsonPath = path.join(releasesDir)
	const files = fse.readJsonSync(path.join(releasesDir, `files_${buildKey}.json`))

	return c.json({
		...release,
		isCurrent: releases.current === buildKey,
		filesList: files,
	})
})

// публикация нового билда
app.get('/publish/:game/:platform/:buildKey?', async (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	let buildKey = c.req.param('buildKey') || getLatestMasterBuildKey(gameDir)

	if (!buildKey) {
		return c.json({ message: `build doesn't exist` }, 400)
	}

	if (!isBuildKey(buildKey)) {
		return c.json({ message: `invalid build key: ${buildKey}` }, 400)
	}

	let releasesJsonPath = path.join(gameDir, `prod/${platform}/releases.json`)
	let releases: Releases = fse.existsSync(releasesJsonPath)
		? fse.readJsonSync(releasesJsonPath)
		: {
				current: '',
				builds: [],
			}

	const existingRelease = releases.builds.find((item) => item.key === buildKey)
	if (existingRelease) {
		return c.json({ message: `'${buildKey}' was already released at ${existingRelease.releasedAt}` }, 400)
	}

	const { env, version } = parseBuildKey(buildKey)

	let srcDir = path.join(gameDir, env, version.toString())

	if (!fse.existsSync(srcDir)) {
		return c.json({ message: `build '${buildKey}' doesn't exist` }, 404)
	}

	let destDir = path.join(gameDir, `prod/${platform}`)

	let destDirTemp = path.join(gameDir, `prod/${platform}_temp`)

	// копируем билд во временную папку
	fse.ensureDirSync(destDirTemp)
	fse.copySync(srcDir, destDirTemp, {})

	let buildInfo = fse.readJsonSync(path.join(destDirTemp, 'build_info.json')) as BuildInfo

	// build_info.json нам уже не нужен, удаляем его
	fse.rmSync(path.join(destDirTemp, 'build_info.json'))

	// переименовываем index.html в index_${buildKey}.html (например, index_master-11.html)
	fse.renameSync(path.join(destDirTemp, 'index.html'), path.join(destDirTemp, `index_${buildKey}.html`))

	// создаем файл files_${buildKey}.json, в котором будут перечислены все файлы билда
	let filesJsonPath = path.join(destDirTemp, `files_${buildKey}.json`)
	let files = globbySync(path.join(destDirTemp, '**/*'))
	files = [filesJsonPath, ...files]
	files = files.map((filepath) => path.relative(destDirTemp, filepath))
	fse.outputJsonSync(path.join(destDirTemp, `files_${buildKey}.json`), files, { spaces: '\t' })

	// копируем все файлы в финальную папку
	fse.copySync(destDirTemp, destDir)

	// удаляем временную папку
	fse.rmSync(destDirTemp, { recursive: true })

	// обновляем releases.json
	let newRelease = createNewRelease(buildKey, buildInfo)
	releases.current = newRelease.key
	releases.builds.unshift(newRelease)
	fse.outputJsonSync(releasesJsonPath, releases, { spaces: '\t' })

	// @ts-expect-error
	let removedReleases = await removeOldReleases(releasesJsonPath)

	updateIndexHtmlSymlink(destDir, newRelease.key)

	return c.json({
		path: destDir,
		release: newRelease,
	})
})

// откат к какому-то из прошлых релизов
app.get('/rollback/:game/:platform/:buildKey?', async (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	let buildKey = c.req.param('buildKey') || getPreviousBuildKey(gameDir, platform)

	if (!buildKey) {
		return c.json({ message: `there are no previous builds` }, 400)
	}

	if (!isBuildKey(buildKey)) {
		return c.json({ message: `invalid build key: ${buildKey}` }, 400)
	}

	let releasesDir = `prod/${platform}`
	let releasesJsonPath = path.join(gameDir, `${releasesDir}/releases.json`)
	let releases = fse.readJsonSync(releasesJsonPath) as Releases

	if (releases.current === buildKey) {
		return c.json({ message: `build ${buildKey} is current release` }, 304)
	}

	let release = releases.builds.find((item) => item.key === buildKey)
	if (!release) {
		return c.json({ message: `release '${buildKey}' doesn't exist` }, 404)
	}

	// update releases.json
	releases.current = buildKey
	fse.outputJsonSync(releasesJsonPath, releases, { spaces: '\t' })

	// update index.html symlink
	updateIndexHtmlSymlink(releasesDir, buildKey)

	return c.json({
		path: releasesDir,
		release: release,
	})
})

function isEmptyDir(dirPath: string): boolean {
	return fse.statSync(dirPath).isDirectory() && fse.readdirSync(dirPath).length === 0
}

function getLatestMasterBuildKey(gameDir: string): BuildKey | undefined {
	const masterDir = path.join(gameDir, 'master')
	const buildInfoPath = path.join(masterDir, 'build_info.json')
	if (!fse.existsSync(buildInfoPath)) {
		return undefined
	}

	const buildInfo = fse.readJsonSync(buildInfoPath) as BuildInfo

	return createBuildKey('master', buildInfo.version)
}

/**
 * @return {string} - key of the build that was published before the current one or undefined if there are no previous builds
 */
function getPreviousBuildKey(gameDir: string, platform: string): string | undefined {
	const releasesDir = path.join(gameDir, `prod/${platform}`)
	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return undefined
	}

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	// sort builds by date from newest to oldest
	const buildsSortedByDate = releases.builds.sort((a, b) => {
		return fromReadableDateString(b.releasedAt) - fromReadableDateString(a.releasedAt)
	})

	const currentBuild = buildsSortedByDate.find((item) => item.key === releases.current)
	if (!currentBuild) {
		return undefined
	}

	const currentBuildIndex = buildsSortedByDate.indexOf(currentBuild)

	const previousBuild = buildsSortedByDate.at(currentBuildIndex - 1)

	return previousBuild?.key
}

function createNewRelease(buildKey: BuildKey, buildInfo: BuildInfo): ReleaseInfo {
	return {
		key: buildKey,
		index: `index_${buildKey}.html`,
		files: `files_${buildKey}.json`,
		releasedAt: toReadableDateString(Date.now()),
		builtAt: buildInfo.builtAtReadable,
		gitBranch: buildInfo.gitBranch,
		gitCommit: buildInfo.gitCommitHash,
	}
}

/**
 * Removes old deployments from the environment directory
 * @param envDir - path to the environment directory
 * @param options - options
 * @returns array of removed paths
 */
function removeOldDeployments(envDir: string, options: { buildsNumToKeep: number }): string[] {
	const allBuilds = fse
		.readdirSync(envDir)
		.filter((item) => Number.isInteger(parseInt(item)) && fse.statSync(path.join(envDir, item)).isDirectory())
		.sort((a, b) => parseInt(b) - parseInt(a))

	// @ts-expect-error
	const buildsToKeep = allBuilds.slice(0, options.buildsNumToKeep)

	const buildsToRemove = allBuilds.slice(options.buildsNumToKeep)

	const removedPaths: string[] = []

	buildsToRemove.forEach((build) => {
		const buildPath = path.join(envDir, build)
		fse.rmSync(buildPath, { recursive: true })
		removedPaths.push(buildPath)
	})

	return removedPaths
}

async function removeOldReleases(releasesJsonPath: string, buildsNumToKeep = 5) {
	let releases = fse.readJsonSync(releasesJsonPath) as Releases
	let builds = releases.builds
	let buildsToKeep = builds.slice(-buildsNumToKeep)
	let buildsToRemove = without(builds, ...buildsToKeep)

	if (buildsToRemove.length === 0) {
		return { removedBuilds: [] }
	}

	let releasesDir = path.dirname(releasesJsonPath)
	let filesAll = await globby(path.join(releasesDir, '**/*'))
	let filesToKeep = buildsToKeep.flatMap((item) => fse.readJSONSync(path.join(releasesDir, item.files)))
	filesToKeep.push('index.html')
	filesToKeep.push('releases.json')
	filesToKeep = filesToKeep.map((item) => path.join(releasesDir, item))

	let filesToRemove = without(filesAll, ...filesToKeep)
	filesToRemove.forEach((item) => fse.rmSync(item))

	// update releases.json
	releases.builds = buildsToKeep
	fse.outputJSONSync(releasesJsonPath, releases, { spaces: '\t' })

	return { removedBuilds: buildsToRemove.map((item) => item.key) }
}

function updateIndexHtmlSymlink(dir: string, buildKey: string): void {
	let target = path.join(dir, `index_${buildKey}.html`)
	let filepath = path.join(dir, 'index.html')

	// remove existing symlink (if present)
	fse.rmSync(filepath, { force: true })

	// create new symlink
	fse.symlinkSync(target, filepath)
}

export default {
	fetch: app.fetch,
	port: 4000,
}
