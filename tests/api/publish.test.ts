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

describe('/publish endpoints', () => {
	const GAME = 'test-game'
	const PLATFORM = 'web'
	const BUILD_VERSION_1 = 123
	const BUILD_VERSION_2 = 124
	const BUILD_KEY_1 = `master-${BUILD_VERSION_1}`
	const BUILD_KEY_2 = `master-${BUILD_VERSION_2}`

	// Test data
	const buildInfo1 = {
		version: BUILD_VERSION_1,
		builtAt: Date.now() - 1000, // 1 second earlier
		builtAtReadable: '2024-03-20 12:00:00',
		gitCommitHash: 'abc123',
		gitBranch: 'master',
	}

	const buildInfo2 = {
		version: BUILD_VERSION_2,
		builtAt: Date.now(),
		builtAtReadable: '2024-03-20 12:00:01',
		gitCommitHash: 'def456',
		gitBranch: 'master',
	}

	const publish = (pathname: string) => app.fetch(new Request(`http://localhost/publish/${pathname}`))

	beforeEach(() => {
		// Reset filesystem before each test
		resetFsExtra()

		// Define file structure for initial setup
		const fileStructure = {
			[mockEnv.GAME_BUILDS_DIR]: {
				[GAME]: {
					master: {
						[BUILD_VERSION_1.toString()]: {
							'build_info.json': JSON.stringify(buildInfo1),
							'index.html': '<html>Test Build 1</html>',
						},
						[BUILD_VERSION_2.toString()]: {
							'build_info.json': JSON.stringify(buildInfo2),
							'index.html': '<html>Test Build 2</html>',
						},
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
			const response = await publish(`${GAME}/${PLATFORM}/${BUILD_KEY_1}`)

			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toMatchObject({
				path: expect.stringContaining(`prod/${PLATFORM}`),
				release: {
					key: BUILD_KEY_1,
					index: `index_${BUILD_KEY_1}.html`,
					files: `files_${BUILD_KEY_1}.json`,
					gitBranch: buildInfo1.gitBranch,
					gitCommit: buildInfo1.gitCommitHash,
				},
			})

			// Verify files were created
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			expect(fse.existsSync(path.join(prodDir, `index_${BUILD_KEY_1}.html`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, `files_${BUILD_KEY_1}.json`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, 'releases.json'))).toBe(true)

			// Verify releases.json content
			const releases = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases).toMatchObject({
				current: BUILD_KEY_1,
				builds: [
					{
						key: BUILD_KEY_1,
						index: `index_${BUILD_KEY_1}.html`,
						files: `files_${BUILD_KEY_1}.json`,
						gitBranch: buildInfo1.gitBranch,
						gitCommit: buildInfo1.gitCommitHash,
					},
				],
			})

			// Verify symlink was created
			expect(fse.existsSync(path.join(prodDir, 'index.html'))).toBe(true)
		})

		it('should fail if build does not exist', async () => {
			const response = await publish(`${GAME}/${PLATFORM}/master-999`)

			expect(response.status).toBe(404)
			const data = await response.json()
			expect(data.message).toContain("doesn't exist")

			// Verify no files were created
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			expect(fse.existsSync(prodDir)).toBe(false)
		})

		it('should fail if build was already released', async () => {
			// First publish
			await publish(`${GAME}/${PLATFORM}/${BUILD_KEY_1}`)

			// Reset mock call history but keep filesystem state
			vi.clearAllMocks()

			// Try to publish same build again
			const response = await publish(`${GAME}/${PLATFORM}/${BUILD_KEY_1}`)

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('was already released')
		})

		it('should use latest master build if buildKey is not provided', async () => {
			const response = await publish(`${GAME}/${PLATFORM}`)

			expect(response.status).toBe(200)
			const data = await response.json()
			expect(data.release.key).toBe(BUILD_KEY_2) // Latest build from master
		})

		it('should fail with invalid build key format', async () => {
			const response = await publish(`${GAME}/${PLATFORM}/invalid-key`)

			expect(response.status).toBe(400)
			const data = await response.json()
			expect(data.message).toContain('invalid build key')
		})

		it('should handle consecutive publishes correctly', async () => {
			// First publish
			const response1 = await publish(`${GAME}/${PLATFORM}/${BUILD_KEY_1}`)
			expect(response1.status).toBe(200)
			const data1 = await response1.json()

			// Verify first publish response
			expect(data1).toMatchObject({
				path: expect.stringContaining(`prod/${PLATFORM}`),
				release: {
					key: BUILD_KEY_1,
					index: `index_${BUILD_KEY_1}.html`,
					files: `files_${BUILD_KEY_1}.json`,
					gitBranch: buildInfo1.gitBranch,
					gitCommit: buildInfo1.gitCommitHash,
				},
			})

			// Verify files after first publish
			const prodDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', PLATFORM)
			expect(fse.existsSync(path.join(prodDir, `index_${BUILD_KEY_1}.html`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, `files_${BUILD_KEY_1}.json`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, 'releases.json'))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, 'index.html'))).toBe(true)

			// Verify releases.json after first publish
			const releases1 = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases1).toMatchObject({
				current: BUILD_KEY_1,
				builds: [
					{
						key: BUILD_KEY_1,
						index: `index_${BUILD_KEY_1}.html`,
						files: `files_${BUILD_KEY_1}.json`,
						gitBranch: buildInfo1.gitBranch,
						gitCommit: buildInfo1.gitCommitHash,
					},
				],
			})

			// Second publish
			const response2 = await publish(`${GAME}/${PLATFORM}/${BUILD_KEY_2}`)
			expect(response2.status).toBe(200)
			const data2 = await response2.json()

			// Verify second publish response
			expect(data2).toMatchObject({
				path: expect.stringContaining(`prod/${PLATFORM}`),
				release: {
					key: BUILD_KEY_2,
					index: `index_${BUILD_KEY_2}.html`,
					files: `files_${BUILD_KEY_2}.json`,
					gitBranch: buildInfo2.gitBranch,
					gitCommit: buildInfo2.gitCommitHash,
				},
			})

			// Verify files after second publish
			expect(fse.existsSync(path.join(prodDir, `index_${BUILD_KEY_2}.html`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, `files_${BUILD_KEY_2}.json`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, 'releases.json'))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, 'index.html'))).toBe(true)

			// Verify first build files still exist
			expect(fse.existsSync(path.join(prodDir, `index_${BUILD_KEY_1}.html`))).toBe(true)
			expect(fse.existsSync(path.join(prodDir, `files_${BUILD_KEY_1}.json`))).toBe(true)

			// Verify releases.json after second publish
			const releases2 = fse.readJsonSync(path.join(prodDir, 'releases.json'))
			expect(releases2).toMatchObject({
				current: BUILD_KEY_2,
				builds: [
					{
						key: BUILD_KEY_2,
						index: `index_${BUILD_KEY_2}.html`,
						files: `files_${BUILD_KEY_2}.json`,
						gitBranch: buildInfo2.gitBranch,
						gitCommit: buildInfo2.gitCommitHash,
					},
					{
						key: BUILD_KEY_1,
						index: `index_${BUILD_KEY_1}.html`,
						files: `files_${BUILD_KEY_1}.json`,
						gitBranch: buildInfo1.gitBranch,
						gitCommit: buildInfo1.gitCommitHash,
					},
				],
			})

			// Verify symlink points to latest build
			const symlinkTarget = await fse.readlink(path.join(prodDir, 'index.html'))
			const resolvedSymlinkTarget = path.resolve(prodDir, symlinkTarget)
			expect(resolvedSymlinkTarget).toBe(path.join(prodDir, `index_${BUILD_KEY_2}.html`))
		})
	})
})
