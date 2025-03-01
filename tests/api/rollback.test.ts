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

describe('/rollback endpoints', () => {
	const GAME = 'test-game'
	const PLATFORM = 'web'
	const BUILD_VERSION = 123
	const BUILD_KEY = `master-${BUILD_VERSION}`

	// Test data
	const buildInfo = {
		version: BUILD_VERSION,
		builtAt: Date.now(),
		builtAtReadable: '2024-03-20 12:00:00',
		gitCommitHash: 'abc123',
		gitBranch: 'master',
	}

	beforeEach(async () => {
		// Reset filesystem before each test
		resetFsExtra()

		// Set up initial build directory structure and files
		const buildDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'master', BUILD_VERSION.toString())
		const masterDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'master')
		const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)

		// Create necessary directories and files for the first build
		fse.ensureDirSync(buildDir)
		fse.outputJsonSync(path.join(buildDir, 'build_info.json'), buildInfo)
		fse.writeFileSync(path.join(buildDir, 'index.html'), '<html>Test</html>')
		fse.outputJsonSync(path.join(masterDir, 'build_info.json'), buildInfo)

		// First publish a build to have something to rollback to
		await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/${BUILD_KEY}`))

		// Ensure the prod directory exists and has the necessary files
		fse.ensureDirSync(prodDir)
		fse.writeFileSync(path.join(prodDir, `index_${BUILD_KEY}.html`), '<html>Test</html>')
		fse.outputJsonSync(path.join(prodDir, `files_${BUILD_KEY}.json`), ['index.html'])

		// Publish another build to make the first one "previous"
		const newBuildVersion = BUILD_VERSION + 1
		const newBuildKey = `master-${newBuildVersion}`
		const newBuildDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'master', newBuildVersion.toString())

		// Create new build directory and files
		fse.ensureDirSync(newBuildDir)
		fse.outputJsonSync(path.join(newBuildDir, 'build_info.json'), {
			...buildInfo,
			version: newBuildVersion,
			gitCommitHash: 'def456',
		})
		fse.writeFileSync(path.join(newBuildDir, 'index.html'), '<html>New Test</html>')

		// Publish the new build
		await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/${newBuildKey}`))

		// Reset mock call history but keep filesystem state
		vi.clearAllMocks()
	})

	afterEach(() => {
		resetFsExtra()
		vi.clearAllMocks()
	})

	describe('GET /rollback/:game/:platform/:buildKey?', () => {
		it('should rollback to a specific build successfully', async () => {
			const response = await app.fetch(new Request(`http://localhost/rollback/${GAME}/${PLATFORM}/${BUILD_KEY}`))

			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toMatchObject({
				path: `prod/${PLATFORM}`,
				release: {
					key: BUILD_KEY,
					index: `index_${BUILD_KEY}.html`,
					files: `files_${BUILD_KEY}.json`,
					gitBranch: buildInfo.gitBranch,
					gitCommit: buildInfo.gitCommitHash,
				},
			})

			// Verify releases.json was updated
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			const releases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases.current).toBe(BUILD_KEY)

			// Verify index.html symlink was updated
			expect(fse.symlinkSync).toHaveBeenCalled()
		})

		it('should rollback to previous build when no buildKey provided', async () => {
			const response = await app.fetch(new Request(`http://localhost/rollback/${GAME}/${PLATFORM}`))

			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data.release.key).toBe(BUILD_KEY)

			// Verify releases.json was updated
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			const releases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases.current).toBe(BUILD_KEY)
		})

		it('should fail with invalid build key format', async () => {
			const response = await app.fetch(new Request(`http://localhost/rollback/${GAME}/${PLATFORM}/invalid-key`))

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('invalid build key')
		})

		it('should fail if build does not exist', async () => {
			const response = await app.fetch(new Request(`http://localhost/rollback/${GAME}/${PLATFORM}/master-999`))

			expect(response.status).toBe(404)
			const data = await response.json()
			expect(data.message).toContain("doesn't exist")
		})

		it('should not rollback to current build', async () => {
			// First rollback to BUILD_KEY
			await app.fetch(new Request(`http://localhost/rollback/${GAME}/${PLATFORM}/${BUILD_KEY}`))

			// Clear mocks
			vi.clearAllMocks()

			// Try to rollback to the same build again
			const response = await app.fetch(new Request(`http://localhost/rollback/${GAME}/${PLATFORM}/${BUILD_KEY}`))

			// Note: Changed from 304 to 400 since Hono doesn't support 304 with body
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

			const response = await app.fetch(new Request(`http://localhost/rollback/${GAME}/${PLATFORM}`))

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('there are no previous builds')
		})
	})
})
