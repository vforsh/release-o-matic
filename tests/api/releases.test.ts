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

// Import the app and types after the mocks
import * as fse from 'fs-extra'
import app, { type ReleaseInfo } from '../../src/index'

describe('/releases endpoints', () => {
	const GAME = 'test-game'
	const PLATFORM = 'web'
	const BUILD_KEY_1 = 'master-123'
	const BUILD_KEY_2 = 'master-124'

	// Test data
	const release1: ReleaseInfo = {
		key: BUILD_KEY_1,
		index: `index_${BUILD_KEY_1}.html`,
		files: `files_${BUILD_KEY_1}.json`,
		releasedAt: '2024-03-20 12:00:00',
		builtAt: '2024-03-20 11:00:00',
		gitBranch: 'master',
		gitCommit: 'abc123',
	}

	const release2: ReleaseInfo = {
		key: BUILD_KEY_2,
		index: `index_${BUILD_KEY_2}.html`,
		files: `files_${BUILD_KEY_2}.json`,
		releasedAt: '2024-03-20 13:00:00',
		builtAt: '2024-03-20 12:00:00',
		gitBranch: 'master',
		gitCommit: 'def456',
	}

	const releases = {
		current: BUILD_KEY_2,
		builds: [release2, release1],
	}

	const files1 = ['index.html', 'main.js', 'style.css']
	const files2 = ['index.html', 'main.js', 'style.css', 'extra.js']

	const getReleases = (pathname: string) => app.fetch(new Request(`http://localhost/releases/${pathname}`))

	beforeEach(() => {
		// Reset filesystem before each test
		resetFsExtra()

		// Define file structure for initial setup
		const fileStructure = {
			[mockEnv.GAME_BUILDS_DIR]: {
				[GAME]: {
					prod: {
						[PLATFORM]: {
							'releases.json': JSON.stringify(releases),
							[`files_${BUILD_KEY_1}.json`]: JSON.stringify(files1),
							[`files_${BUILD_KEY_2}.json`]: JSON.stringify(files2),
							[`index_${BUILD_KEY_1}.html`]: '<html>Release 1</html>',
							[`index_${BUILD_KEY_2}.html`]: '<html>Release 2</html>',
							'index.html': '<html>Current Release</html>',
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

	describe('GET /releases/:game/:platform', () => {
		it('should return all releases for a game/platform', async () => {
			const response = await getReleases(`${GAME}/${PLATFORM}`)
			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toEqual(releases)
		})

		it('should return empty releases object if platform directory does not exist', async () => {
			const response = await getReleases(`${GAME}/nonexistent`)
			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toEqual({
				current: null,
				builds: [],
			})
		})

		it('should return empty releases object if releases.json does not exist', async () => {
			// Create empty platform directory without releases.json
			const platformDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', 'empty')
			fse.ensureDirSync(platformDir)

			const response = await getReleases(`${GAME}/empty`)
			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toEqual({
				current: null,
				builds: [],
			})
		})
	})

	describe('GET /releases/:game/:platform/current', () => {
		it('should return the current release', async () => {
			const response = await getReleases(`${GAME}/${PLATFORM}/current`)
			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toEqual(release2)
		})

		it('should return 404 if platform does not exist', async () => {
			const response = await getReleases(`${GAME}/nonexistent/current`)
			expect(response.status).toBe(404)

			const data = await response.json()
			expect(data.message).toContain("doesn't exist")
		})

		it('should return 404 if no releases exist', async () => {
			// Create empty platform directory without releases.json
			const platformDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', 'empty')
			fse.ensureDirSync(platformDir)

			const response = await getReleases(`${GAME}/empty/current`)
			expect(response.status).toBe(404)

			const data = await response.json()
			expect(data.message).toContain('no published builds')
		})
	})

	describe('GET /releases/:game/:platform/:buildKey', () => {
		it('should return a specific release with its files', async () => {
			const response = await getReleases(`${GAME}/${PLATFORM}/${BUILD_KEY_1}`)
			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toEqual({
				...release1,
				isCurrent: false,
				filesList: files1,
			})
		})

		it('should indicate if the release is current', async () => {
			const response = await getReleases(`${GAME}/${PLATFORM}/${BUILD_KEY_2}`)
			expect(response.status).toBe(200)

			const data = await response.json()
			expect(data).toEqual({
				...release2,
				isCurrent: true,
				filesList: files2,
			})
		})

		it('should return 404 if platform does not exist', async () => {
			const response = await getReleases(`${GAME}/nonexistent/${BUILD_KEY_1}`)
			expect(response.status).toBe(404)

			const data = await response.json()
			expect(data.message).toContain("doesn't exist")
		})

		it('should return 404 if release does not exist', async () => {
			const response = await getReleases(`${GAME}/${PLATFORM}/master-999`)
			expect(response.status).toBe(404)

			const data = await response.json()
			expect(data.message).toContain("doesn't exist")
		})

		it('should return 404 if no releases exist', async () => {
			// Create empty platform directory without releases.json
			const platformDir = path.join(mockEnv.GAME_BUILDS_DIR, GAME, 'prod', 'empty')
			fse.ensureDirSync(platformDir)

			const response = await getReleases(`${GAME}/empty/${BUILD_KEY_1}`)
			expect(response.status).toBe(404)

			const data = await response.json()
			expect(data.message).toContain('no published builds')
		})
	})
}) 