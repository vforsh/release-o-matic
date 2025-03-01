import { vol } from 'memfs'
import path from 'path'
import { vi } from 'vitest'

export function mockFsExtra() {
	return {
		// Sync methods
		ensureDirSync: vi.fn((dirPath) => {
			vol.mkdirSync(dirPath, { recursive: true })
		}),
		readdirSync: vi.fn((dirPath) => {
			return vol.readdirSync(dirPath)
		}),
		copySync: vi.fn((src, dest) => {
			// For our test cases, we're only copying JSON files
			const content = vol.readFileSync(src, { encoding: 'utf-8' })
			vol.writeFileSync(dest, content, { encoding: 'utf-8' })
		}),
		existsSync: vi.fn((path) => {
			return vol.existsSync(path)
		}),
		readJsonSync: vi.fn((path) => {
			const content = vol.readFileSync(path, 'utf-8').toString()
			return JSON.parse(content)
		}),
		rmSync: vi.fn((path, options) => {
			if (options?.recursive) {
				vol.rmdirSync(path, { recursive: true })
			} else {
				vol.unlinkSync(path)
			}
		}),
		symlinkSync: vi.fn((target, path) => {
			vol.symlinkSync(target, path)
		}),
		utimesSync: vi.fn((path, atime, mtime) => {
			vol.utimesSync(path, atime, mtime)
		}),
		statSync: vi.fn((path) => {
			const stats = vol.statSync(path)
			return {
				...stats,
				isFile: () => stats.isFile(),
				isSymbolicLink: () => vol.lstatSync(path).isSymbolicLink(),
			}
		}),
		renameSync: vi.fn((oldPath, newPath) => {
			vol.renameSync(oldPath, newPath)
		}),
		outputJsonSync: vi.fn((file, data, options = {}) => {
			const content = JSON.stringify(data, null, options.spaces || 2)
			vol.mkdirSync(path.dirname(file), { recursive: true })
			vol.writeFileSync(file, content)
		}),
	}
}

// Helper function to reset the virtual filesystem and mocks
export function resetFsExtra() {
	vol.reset()
	vi.clearAllMocks()
}
