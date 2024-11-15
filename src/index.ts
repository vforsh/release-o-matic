import path from 'path'
import { Hono } from 'hono'
import * as fse from 'fs-extra'
import { globby } from 'globby'
import { without } from 'lodash-es'
import { Result } from 'true-myth'

type Releases = {
	current: string;
	builds: ReleaseInfo[]
}

type ReleaseInfo = {
	key: string,
	index: string,
	files: string,
	releasedAt: number,
}

// const gameRoot = process.env.NODE_ENV === 'development'
// 	? path.join(__dirname, '../test/papa-cherry-2')
// 	: path.join(__dirname, '../../../')

const gameRoot = path.join(__dirname, '../test/papa-cherry-2')

// TODO deploy and setup Caddy
// TODO configure and test CDN
// TODO add logger
// TODO add tests

const app = new Hono()

app.get('/', (c) => c.redirect('/list'))

app.get('/env', (c) => {
	let envStr = JSON.stringify(process.env)
	let envParsed = JSON.parse(envStr)
	return c.json(envParsed)
})

// инфо о всех билдах
app.get('/:platform', (c) => {
	const releasesDir = path.join(gameRoot, `prod/${c.req.param('platform')}`)
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
	const releasesDir = path.join(gameRoot, `prod/${c.req.param('platform')}`)
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

// инфо о конкретном билде
app.get('/:platform/:build', (c) => {
	const releasesDir = path.join(gameRoot, `prod/${c.req.param('platform')}`)
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

// публикация нового билда
app.get('/:platform/publish/:build', async (c) => {
	// TODO auth bearer check
	
	let platform = c.req.param('platform')
	
	// TODO implement getLatestMasterBuildKey()
	let buildKey = c.req.param('build') /* || getLatestMasterBuildKey() */
	
	let srcDir = path.join(gameRoot, 'master')
	
	let destDir = path.join(gameRoot, `prod/${platform}`)
	
	let destDirTemp = path.join(gameRoot, `prod/${platform}_temp`)
	
	// копируем билд во временную папку
	fse.ensureDirSync(destDirTemp)
	fse.copySync(srcDir, destDirTemp, {})
	
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
	
	let releasesJsonPath = path.join(gameRoot, `prod/${platform}/releases.json`)
	let newRelease = updateReleasesJson(releasesJsonPath, buildKey)
	// console.log('newRelease', newRelease)
	
	let removedReleases = await removeOldReleases(releasesJsonPath)
	// console.log('removedReleases', removedReleases)
	
	updateSymlink(destDir, newRelease.key)
	
	// let cdnRefreshResult = await refreshCdn(destDir, buildKey)
	// console.log(`cdn refresh`, cdnRefreshResult)
	
	return c.json({
		path: destDir,
	})
})

// откат к какому-то из прошлых билдов
app.get('/:platform/rollback/:build', async (c) => {
	// TODO auth bearer check for prod env
	
	// TODO implement getPreviousBuildKey()
	let buildKey = c.req.param('build') /* || getPreviousBuildKey() */
	
	let releasesDir = `prod/${c.req.param('platform')}`
	let releasesJsonPath = path.join(gameRoot, `${releasesDir}/releases.json`)
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
	
	// refresh CDN
	// await refreshCdn(releasesDir, buildKey)
	
	return c.json(release)
})

function updateReleasesJson(filepath: string, newBuildKey: string) {
	let releases: Releases = fse.existsSync(filepath)
		? fse.readJsonSync(filepath)
		: { current: '', builds: [] }
	
	let newRelease: ReleaseInfo = {
		key: newBuildKey,
		index: `index_${newBuildKey}.html`,
		files: `files_${newBuildKey}.json`,
		releasedAt: Date.now(),
	}
	
	releases.current = newRelease.key
	releases.builds.unshift(newRelease)
	
	fse.outputJsonSync(filepath, releases, { spaces: '\t' })
	
	return newRelease
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

/**
 * @link https://developers.selectel.ru/docs/cloud-services/cdn_api/
 */
async function refreshCdn(releaseDir: string, latestRelease: string) {
	const apiBaseUrl = 'https://api.selectel.ru/cdn/v2'
	const projectId = 'd0b6cd63-4ae4-4ed8-9149-b8ad1b128e85'
	const resourceId = 'f8e18776-b614-416b-a3c3-f0863c9e270f'
	const token = process.env.SELECTEL_TOKEN
	
	const purgeResult = await purgeIndexHtml()
	
	const prefetchResult = await prefetchNewFiles(releaseDir, latestRelease)
	
	return {
		purge: purgeResult,
		prefetch: prefetchResult,
	}
	
	async function purgeIndexHtml(): Promise<Result<
		{ status: string, path: string },
		{ status: string, message: string }
	>> {
		let url = `${apiBaseUrl}/projects/${projectId}/resources/${resourceId}/purge`
		
		let paths = [
			path.join(releaseDir, 'index.html'),
		].map(item => ensureLeadingSlash(item))
		
		let response = await fetch(url, {
			method: 'PUT',
			// @ts-expect-error
			headers: {
				'X-Token': token,
			},
			body: JSON.stringify({
				paths,
			}),
		})
		
		if (response.ok) {
			return Result.ok({
				status: `${response.status} ${response.statusText}`,
				path: paths[0],
			})
		} else {
			return Result.err({
				status: `${response.status} ${response.statusText}`,
				message: (await response.json()).error.message,
			})
		}
	}
	
	async function prefetchNewFiles(releaseDir: string, latestRelease: string): Promise<Result<
		{ status: string },
		{ status: string; message: string }
	>> {
		let url = `${apiBaseUrl}/projects/${projectId}/resources/${resourceId}/prefetch`
		
		// TODO get list of new files from the latest release
		let paths = [].map(item => ensureLeadingSlash(item))
		
		let response = await fetch(url, {
			method: 'PUT',
			// @ts-expect-error
			headers: {
				'X-Token': token,
			},
			body: JSON.stringify({
				paths,
			}),
		})
		
		if (response.ok) {
			return Result.ok({ status: `${response.status} ${response.statusText}` })
		} else {
			return Result.err({
				status: `${response.status} ${response.statusText}`,
				message: (await response.json()).error.message,
			})
		}
	}
	
	function ensureLeadingSlash(filepath: string): string {
		return filepath.startsWith('/') ? filepath : '/' + filepath
	}
}

export default {
	fetch: app.fetch,
	port: 4000,
}
