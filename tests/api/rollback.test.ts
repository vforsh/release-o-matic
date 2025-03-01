import { vol } from 'memfs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockEnv } from '../mocks/env'
import { mockFsExtra, resetFsExtra } from '../mocks/fs-extra'

// Mock file system operations
vi.mock('fs-extra', () => mockFsExtra())

// Mock environment variables
vi.mock('../../src/env', () => ({
	env: mockEnv,
}))

// Import the app after the mocks
import * as fse from 'fs-extra'

// Import the app after the mocks
import app from '../../src/index'
import { toReadableDateString } from '../../src/utils/date/readable-date-string'

describe('/rollback endpoints', () => {
	const GAME = 'test-game'
	const PLATFORM = 'web'
	const BUILDS_NUM = 5

	// Store build keys for use in tests
	let buildKeys: string[] = []

	const rollback = (pathname: string) => app.fetch(new Request(`http://localhost/rollback/${pathname}`))

	// Helper functions to get specific builds
	const getFirstBuild = () => buildKeys[0]
	const getLastBuild = () => buildKeys[buildKeys.length - 1]
	const getPreviousBuild = () => buildKeys[buildKeys.length - 2]

	/**
	 * Generate build info and file structure for multiple builds
	 * @param count Number of builds to generate
	 * @param startVersion Starting version number
	 * @returns Object containing file structure and array of build keys
	 */
	const generateBuilds = (count: number, startVersion = 1) => {
		const masterBuilds: Record<string, any> = {}
		const keys: string[] = []

		for (let i = 0; i < count; i++) {
			const version = startVersion + i
			const buildKey = `master-${version}`
			keys.push(buildKey)

			const builtAt = Date.now()

			masterBuilds[version.toString()] = {
				'build_info.json': JSON.stringify(
					{
						builtAt,
						builtAtReadable: toReadableDateString(builtAt),
						version,
						gitCommitHash: `commit${version}`,
						gitBranch: 'master',
					},
					null,
					2,
				),
				'index.html': `<html>Build ${version}</html>`,
			}
		}

		// Create initial file structure
		const fileStructure = {
			[mockEnv.GAME_BUILDS_DIR]: {
				[GAME]: {
					master: masterBuilds,
					prod: {
						[PLATFORM]: {},
					},
				},
			},
		}

		// Ensure the directory exists before writing files
		const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
		vol.mkdirSync(prodDir, { recursive: true })

		// Create the file structure
		vol.fromNestedJSON(fileStructure, '/')

		return { fileStructure, buildKeys: keys }
	}

	beforeEach(async () => {
		// Reset filesystem before each test
		resetFsExtra()

		// Generate builds and store build keys for tests
		const result = generateBuilds(BUILDS_NUM)
		buildKeys = result.buildKeys

		// Create the file structure
		vol.fromNestedJSON(result.fileStructure, '/')

		// Publish all builds in sequence
		for (const buildKey of buildKeys) {
			await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/${buildKey}`))
		}

		// Reset mock call history but keep filesystem state
		vi.clearAllMocks()
	})

	afterEach(() => {
		resetFsExtra()
		vi.clearAllMocks()
		buildKeys = []
	})

	describe('GET /rollback/:game/:platform/:buildKey?', () => {
		it('should rollback to a specific build successfully', async () => {
			// Get the first build (oldest)
			const firstBuild = getFirstBuild()
			const response = await rollback(`${GAME}/${PLATFORM}/${firstBuild}`)

			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toMatchObject({
				path: `prod/${PLATFORM}`,
				release: {
					key: firstBuild,
					index: `index_${firstBuild}.html`,
					files: `files_${firstBuild}.json`,
					gitBranch: expect.any(String),
					gitCommit: expect.stringMatching(/^commit\d+$/),
				},
			})

			// Verify releases.json was updated
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			const releases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases.current).toBe(firstBuild)

			// Verify index.html symlink was updated
			expect(fse.symlinkSync).toHaveBeenCalled()
		})

		it('should rollback to previous build when no buildKey provided', async () => {
			// By default, the last published build is current
			const lastBuild = getLastBuild()
			const previousBuild = getPreviousBuild()

			// Verify we're starting with the last build
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			const initialReleases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(initialReleases.current).toBe(lastBuild)

			// Perform rollback without specifying a build
			const response = await rollback(`${GAME}/${PLATFORM}`)

			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data.release.key).toBe(previousBuild)

			// Verify releases.json was updated to previous build
			const releases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases.current).toBe(previousBuild)
		})

		it('should fail with invalid build key format', async () => {
			const response = await rollback(`${GAME}/${PLATFORM}/invalid-key`)

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('invalid build key')
		})

		it('should fail if build does not exist', async () => {
			const response = await rollback(`${GAME}/${PLATFORM}/nonexistent-1`)

			expect(response.status).toBe(404)
			const data = await response.json()
			expect(data.message).toContain("doesn't exist")
		})

		it('should not rollback to current build', async () => {
			const firstBuild = getFirstBuild()

			// First rollback to the first build
			await rollback(`${GAME}/${PLATFORM}/${firstBuild}`)

			// Clear mocks
			vi.clearAllMocks()

			// Try to rollback to the same build again
			const response = await rollback(`${GAME}/${PLATFORM}/${firstBuild}`)

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('is current release')

			// Verify no files were modified
			expect(fse.writeFileSync).not.toHaveBeenCalled()
			expect(fse.symlinkSync).not.toHaveBeenCalled()
		})

		it('should fail if there are no previous builds', async () => {
			// Reset the filesystem to have no builds
			resetFsExtra()
			buildKeys = []

			const response = await rollback(`${GAME}/${PLATFORM}`)

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('there are no previous releases')
		})

		it('should allow sequential rollbacks through build history', async () => {
			// Start with at least 3 builds to test multiple rollbacks
			expect(buildKeys.length).toBeGreaterThanOrEqual(3)

			const lastBuild = getLastBuild()
			const previousBuild = getPreviousBuild()
			const firstBuild = getFirstBuild()

			// Verify we start with the last build
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			const initialReleases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(initialReleases.current).toBe(lastBuild)

			// First rollback (to previous build)
			const response1 = await rollback(`${GAME}/${PLATFORM}`)
			expect(response1.status).toBe(200)
			const data1 = await response1.json()
			expect(data1.release.key).toBe(previousBuild)

			// Verify intermediate state
			const intermediateReleases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(intermediateReleases.current).toBe(previousBuild)

			// Second rollback (to the build before previous)
			const response2 = await rollback(`${GAME}/${PLATFORM}`)
			expect(response2.status).toBe(200)
			const data2 = await response2.json()
			const expectedBuild = buildKeys[buildKeys.length - 3] // Two steps back from last
			expect(data2.release.key).toBe(expectedBuild)

			// Verify final state
			const finalReleases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(finalReleases.current).toBe(expectedBuild)
		})
	})
})
