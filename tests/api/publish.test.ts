import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockEnv } from '../mocks/env'
import { mockFsExtra, resetFsExtra } from '../mocks/fs-extra'
import { vol } from 'memfs'

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

describe('/publish endpoints', () => {
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

	beforeEach(() => {
		// Reset filesystem before each test
		resetFsExtra()

		// Define file structure for initial setup
		const fileStructure = {
			[mockEnv.GAME_BUILDS_DIR]: {
				[GAME]: {
					master: {
						[BUILD_VERSION.toString()]: {
							'build_info.json': JSON.stringify(buildInfo),
							'index.html': '<html>Test</html>',
						},
						'build_info.json': JSON.stringify(buildInfo),
					},
				},
			},
		}

		// Create the file structure
		vol.fromNestedJSON(fileStructure, '/')
	})

	afterEach(() => {
		resetFsExtra()
		vi.clearAllMocks()
	})

	describe('GET /publish/:game/:platform/:buildKey?', () => {
		it('should publish a new build successfully', async () => {
			const response = await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/${BUILD_KEY}`))

			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toMatchObject({
				path: expect.stringContaining(`prod/${PLATFORM}`),
				release: {
					key: BUILD_KEY,
					index: `index_${BUILD_KEY}.html`,
					files: `files_${BUILD_KEY}.json`,
					gitBranch: buildInfo.gitBranch,
					gitCommit: buildInfo.gitCommitHash,
				},
			})

			// Verify files were created
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			expect(fse.existsSync(path.join(prodDir, `index_${BUILD_KEY}.html`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, `files_${BUILD_KEY}.json`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, 'releases.json'))).toBe(true)

			// Verify releases.json content
			const releases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases).toMatchObject({
				current: BUILD_KEY,
				builds: [
					{
						key: BUILD_KEY,
						index: `index_${BUILD_KEY}.html`,
						files: `files_${BUILD_KEY}.json`,
						gitBranch: buildInfo.gitBranch,
						gitCommit: buildInfo.gitCommitHash,
					},
				],
			})

			// Verify symlink was created
			expect(fse.existsSync(path.join(prodDir, 'index.html'))).toBe(true)
		})

		it('should fail if build does not exist', async () => {
			const response = await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/master-999`))

			expect(response.status).toBe(404)
			const data = await response.json()
			expect(data.message).toContain("doesn't exist")

			// Verify no files were created
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			expect(fse.existsSync(prodDir)).toBe(false)
		})

		it('should fail if build was already released', async () => {
			// First publish
			await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/${BUILD_KEY}`))

			// Reset mock call history but keep filesystem state
			vi.clearAllMocks()

			// Try to publish same build again
			const response = await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/${BUILD_KEY}`))

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('was already released')

			// Verify no additional files were created
			expect(fse.writeFileSync).not.toHaveBeenCalled()
			expect(fse.outputJsonSync).not.toHaveBeenCalled()
		})

		it('should use latest master build if buildKey is not provided', async () => {
			const response = await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}`))

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.release.key).toBe(BUILD_KEY)

			// Verify master/build_info.json was read
			expect(fse.readJsonSync).toHaveBeenCalledWith(
				path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'master', 'build_info.json'),
			)
		})

		it('should fail with invalid build key format', async () => {
			const response = await app.fetch(new Request(`http://localhost/publish/${GAME}/${PLATFORM}/invalid-key`))

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('invalid build key')
		})
	})
})
