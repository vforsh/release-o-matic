import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import { vol } from 'memfs'
import { mockFsExtra } from './mocks/fs-extra'

// Setup mocks before importing the actual module
vi.mock('fs-extra', () => mockFsExtra())

// Import the mocked module after setting up the mock
import * as fse from 'fs-extra'

describe('fs-extra Operations', () => {
	const testDir = '/test'
	const testFile = path.join(testDir, 'test.json')
	const testContent = { hello: 'world' }

	beforeEach(() => {
		// Reset the virtual filesystem and mocks before each test
		vol.reset()
		vi.clearAllMocks()
	})

	describe('Directory Operations', () => {
		it('should create directory and ensure it exists', () => {
			fse.ensureDirSync(testDir)
			expect(fse.existsSync(testDir)).toBe(true)
			expect(fse.ensureDirSync).toHaveBeenCalledWith(testDir)
		})

		it('should list directory contents', () => {
			// Create test directory and files
			fse.ensureDirSync(testDir)
			fse.outputJsonSync(path.join(testDir, 'file1.json'), { test: 1 })
			fse.outputJsonSync(path.join(testDir, 'file2.json'), { test: 2 })

			const contents = fse.readdirSync(testDir)
			expect(contents).toHaveLength(2)
			expect(contents).toContain('file1.json')
			expect(contents).toContain('file2.json')
			expect(fse.readdirSync).toHaveBeenCalledWith(testDir)
		})

		it('should remove directory recursively', () => {
			// Create nested directory structure
			fse.ensureDirSync(path.join(testDir, 'nested'))
			fse.outputJsonSync(path.join(testDir, 'nested/file.json'), { test: true })

			fse.rmSync(testDir, { recursive: true })
			expect(fse.existsSync(testDir)).toBe(false)
			expect(fse.rmSync).toHaveBeenCalledWith(testDir, { recursive: true })
		})
	})

	describe('File Operations', () => {
		it('should write and read JSON files', () => {
			fse.outputJsonSync(testFile, testContent)
			const content = fse.readJsonSync(testFile)
			expect(content).toEqual(testContent)

			// Verify the function was called with the correct file and content
			const outputJsonCall = vi.mocked(fse.outputJsonSync).mock.calls[0]
			expect(outputJsonCall[0]).toBe(testFile)
			expect(outputJsonCall[1]).toEqual(testContent)

			expect(fse.readJsonSync).toHaveBeenCalledWith(testFile)
		})

		it('should copy files', () => {
			const destFile = path.join(testDir, 'copy.json')
			fse.outputJsonSync(testFile, testContent)

			fse.copySync(testFile, destFile)
			const content = fse.readJsonSync(destFile)
			expect(content).toEqual(testContent)
			expect(fse.copySync).toHaveBeenCalledWith(testFile, destFile)
		})

		it('should rename files', () => {
			const newFile = path.join(testDir, 'renamed.json')
			fse.outputJsonSync(testFile, testContent)

			fse.renameSync(testFile, newFile)
			expect(fse.existsSync(testFile)).toBe(false)
			expect(fse.existsSync(newFile)).toBe(true)
			expect(fse.renameSync).toHaveBeenCalledWith(testFile, newFile)
		})

		it('should check if files exist', () => {
			fse.outputJsonSync(testFile, testContent)
			expect(fse.existsSync(testFile)).toBe(true)
			expect(fse.existsSync('/nonexistent')).toBe(false)
			expect(fse.existsSync).toHaveBeenCalledWith(testFile)
		})

		it('should get file stats', () => {
			fse.outputJsonSync(testFile, testContent)
			const stats = fse.statSync(testFile)
			expect(stats.isFile()).toBe(true)
			expect(fse.statSync).toHaveBeenCalledWith(testFile)
		})

		it('should update file timestamps', () => {
			fse.outputJsonSync(testFile, testContent)
			const time = new Date()

			fse.utimesSync(testFile, time, time)
			const stats = fse.statSync(testFile)
			expect(stats.mtime.getTime()).toBe(time.getTime())
			expect(fse.utimesSync).toHaveBeenCalledWith(testFile, time, time)
		})
	})

	describe('Symlink Operations', () => {
		it('should create and verify symlinks', () => {
			const linkPath = path.join(testDir, 'link.json')
			fse.outputJsonSync(testFile, testContent)

			fse.symlinkSync(testFile, linkPath)
			expect(fse.existsSync(linkPath)).toBe(true)
			const stats = fse.statSync(linkPath)
			expect(stats.isSymbolicLink()).toBe(true)
			expect(fse.symlinkSync).toHaveBeenCalledWith(testFile, linkPath)
		})
	})

	describe('Complex Operations', () => {
		it('should handle nested directory structures', () => {
			const nestedDir = path.join(testDir, 'level1/level2')
			const nestedFile = path.join(nestedDir, 'test.json')

			// Create nested structure
			fse.ensureDirSync(nestedDir)
			fse.outputJsonSync(nestedFile, testContent)

			// Verify structure
			expect(fse.existsSync(nestedDir)).toBe(true)
			expect(fse.existsSync(nestedFile)).toBe(true)

			// Read content
			const content = fse.readJsonSync(nestedFile)
			expect(content).toEqual(testContent)

			// Remove structure
			fse.rmSync(testDir, { recursive: true })
			expect(fse.existsSync(testDir)).toBe(false)
		})

		it('should handle file copying with directory creation', () => {
			const sourceDir = path.join(testDir, 'source')
			const destDir = path.join(testDir, 'dest')
			const sourceFile = path.join(sourceDir, 'test.json')
			const destFile = path.join(destDir, 'test.json')

			// Create source structure
			fse.ensureDirSync(sourceDir)
			fse.outputJsonSync(sourceFile, testContent)

			// Copy to destination
			fse.ensureDirSync(destDir)
			fse.copySync(sourceFile, destFile)

			// Verify copy
			expect(fse.existsSync(destFile)).toBe(true)
			const content = fse.readJsonSync(destFile)
			expect(content).toEqual(testContent)
		})
	})
})
