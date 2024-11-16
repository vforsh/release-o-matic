import path from 'path'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import * as fse from 'fs-extra'
import { globby } from 'globby'
import { without } from 'lodash-es'
import { Result } from 'true-myth'
import { env } from './env'
import { toReadableDateString, fromReadableDateString } from './utils/date/readable-date-string'

type Releases = {
	current: string;
	builds: ReleaseInfo[]
}

type ReleaseInfo = {
	key: string,
	index: string,
	files: string,
	releasedAt: string,
	builtAt: string,
	gitBranch: string,
	gitCommit: string,
}

type BuildInfo = {
	version: number,
	branch: string,
	commit: string,
	builtAt: string
}

const GAME_ROOT = env.GAME_BUILDS_DIR

// TODO use bearer auth
// TODO add README - why this does exist, how to setup deployment with PM2
// TODO add tests

const app = new Hono()

// TODO setup custom logger - https://hono.dev/docs/middleware/builtin/logger#example
app.use(logger())

app.get('/', (c) => c.text(GAME_ROOT))

app.get('/env', (c) => {
	// TODO auth bearer check
	
	return c.json(env)
})

// инфо о всех билдах
app.get('/:platform', (c) => {
	const releasesDir = path.join(GAME_ROOT, `prod/${c.req.param('platform')}`)
	if (!fse.existsSync(releasesDir)) {
		return c.json({ message: `platform doesn't exist` }, 404)
	}
	
	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return c.json({
			current: '',
			builds: [],
		})
	}
	
	const releases = fse.readJsonSync(releasesJsonPath) as Releases
	
	return c.json(releases)
})

// инфо о текущем билде
// TODO use same controller as for '/:platform/:build'
app.get('/:platform/current', (c) => {
	const releasesDir = path.join(GAME_ROOT, `prod/${c.req.param('platform')}`)
	if (!fse.existsSync(releasesDir)) {
		return c.json({ message: `platform doesn't exist` }, 404)
	}
	
	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return c.json({ message: `there are no published build` }, 404)
	}
	
	const releases = fse.readJsonSync(releasesJsonPath) as Releases
	
	return c.json(releases.builds.find(item => item.key === releases.current))
})

// публикация нового билда
app.get('/:platform/publish/:build?', async (c) => {
	// TODO auth bearer check
	
	let platform = c.req.param('platform')
	
	let buildKey = c.req.param('build') || getLatestMasterBuildKey()
	
	if (!buildKey) {
		return c.json({ message: `master build doesn't exist` }, 400)
	}
	
	let releasesJsonPath = path.join(GAME_ROOT, `prod/${platform}/releases.json`)
	let releases: Releases = fse.existsSync(releasesJsonPath) ? fse.readJsonSync(releasesJsonPath) : {
		current: '',
		builds: [],
	}
	
	if (releases.current === buildKey) {
		return c.json({ message: `'${buildKey}' is already a current release` }, 400)
	}
	
	let srcDir = path.join(GAME_ROOT, 'master')
	
	let destDir = path.join(GAME_ROOT, `prod/${platform}`)
	
	let destDirTemp = path.join(GAME_ROOT, `prod/${platform}_temp`)
	
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
	let files = await globby(path.join(destDirTemp, '**/*'))
	files = [filesJsonPath, ...files]
	files = files.map(filepath => path.relative(destDirTemp, filepath))
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
	
	let removedReleases = await removeOldReleases(releasesJsonPath)
	
	updateSymlink(destDir, newRelease.key)
	
	return c.json({
		path: destDir,
		release: newRelease,
	})
})

// инфо о конкретном билде
app.get('/:platform/:build', (c) => {
	const releasesDir = path.join(GAME_ROOT, `prod/${c.req.param('platform')}`)
	if (!fse.existsSync(releasesDir)) {
		return c.json({ message: `platform doesn't exist` }, 404)
	}
	
	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return c.json({ message: `there are no published build` }, 404)
	}
	
	const buildKey = c.req.param('build')
	
	const releases = fse.readJsonSync(releasesJsonPath) as Releases
	
	const release = releases.builds.find(item => item.key === buildKey)
	if (!release) {
		return c.json({ message: `build doesn't exist` }, 404)
	}
	
	const filesJsonPath = path.join(releasesDir)
	const files = fse.readJsonSync(path.join(releasesDir, `files_${buildKey}.json`))
	
	return c.json({
		...release,
		isCurrent: releases.current === buildKey,
		filesList: files,
	})
})

// откат к какому-то из прошлых билдов
app.get('/:platform/rollback/:build?', async (c) => {
	// TODO auth bearer check for prod env
	
	let platform = c.req.param('platform')
	
	let buildKey = c.req.param('build') || getPreviousBuildKey(platform)
	
	if (!buildKey) {
		return c.json({ message: `there are no previous builds` }, 400)
	}
	
	let releasesDir = `prod/${platform}`
	let releasesJsonPath = path.join(GAME_ROOT, `${releasesDir}/releases.json`)
	let releases = fse.readJsonSync(releasesJsonPath) as Releases
	
	if (releases.current === buildKey) {
		return c.json({ message: `build ${buildKey} is already active` }, 304)
	}
	
	let release = releases.builds.find(item => item.key === buildKey)
	if (!release) {
		return c.json({ message: `build '${buildKey}' doesn't exist` }, 404)
	}
	
	// update releases.json
	releases.current = buildKey
	fse.outputJsonSync(releasesJsonPath, releases, { spaces: '\t' })
	
	// update index.html symlink
	updateSymlink(releasesDir, buildKey)
	
	return c.json({
		path: '',
		release: release,
	})
})

function getLatestMasterBuildKey(): string | undefined {
	const masterDir = path.join(GAME_ROOT, 'master')
	const buildInfoPath = path.join(masterDir, 'build_info.json')
	if (!fse.existsSync(buildInfoPath)) {
		return undefined
	}
	
	const buildInfo = fse.readJsonSync(buildInfoPath) as BuildInfo
	
	return 'master-' + buildInfo.version
}

/**
 * @return {string} - key of the build that was published before the current one or undefined if there are no previous builds
 */
function getPreviousBuildKey(platform: string): string | undefined {
	const releasesDir = path.join(GAME_ROOT, `prod/${platform}`)
	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return undefined
	}
	
	const releases = fse.readJsonSync(releasesJsonPath) as Releases
	
	// sort builds by date from newest to oldest
	const buildsSortedByDate = releases.builds.sort((a, b) => {
		return fromReadableDateString(b.releasedAt) - fromReadableDateString(a.releasedAt)
	})
	
	const currentBuild = buildsSortedByDate.find(item => item.key === releases.current)
	if (!currentBuild) {
		return undefined
	}
	
	const currentBuildIndex = buildsSortedByDate.indexOf(currentBuild)
	
	const previousBuild = buildsSortedByDate.at(currentBuildIndex - 1)
	
	return previousBuild?.key
}

function createNewRelease(buildKey: string, buildInfo: BuildInfo): ReleaseInfo {
	return {
		key: buildKey,
		index: `index_${buildKey}.html`,
		files: `files_${buildKey}.json`,
		releasedAt: toReadableDateString(Date.now()),
		builtAt: buildInfo.builtAt,
		gitBranch: buildInfo.branch,
		gitCommit: buildInfo.commit,
	}
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
	let filesToKeep = buildsToKeep.flatMap(item => fse.readJSONSync(path.join(releasesDir, item.files)))
	filesToKeep.push('index.html')
	filesToKeep.push('releases.json')
	filesToKeep = filesToKeep.map(item => path.join(releasesDir, item))
	
	let filesToRemove = without(filesAll, ...filesToKeep)
	filesToRemove.forEach((item) => fse.rmSync(item))
	
	// update releases.json
	releases.builds = buildsToKeep
	fse.outputJSONSync(releasesJsonPath, releases, { spaces: '\t' })
	
	return { removedBuilds: buildsToRemove.map(item => item.key) }
}

function updateSymlink(dir: string, buildKey: string): void {
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
