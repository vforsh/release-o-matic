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
		copySync: vi.fn((src, dest, options = {}) => {
			// If source is a directory, copy recursively
			if (vol.statSync(src).isDirectory()) {
				vol.mkdirSync(dest, { recursive: true })
				const files = vol.readdirSync(src)
				files.forEach(file => {
					const srcFile = path.join(src, file)
					const destFile = path.join(dest, file)
					if (vol.statSync(srcFile).isDirectory()) {
						this.copySync(srcFile, destFile, options)
					} else {
						const content = vol.readFileSync(srcFile)
						vol.writeFileSync(destFile, content)
					}
				})
			} else {
				// Copy single file
				const content = vol.readFileSync(src)
				vol.writeFileSync(dest, content)
			}
		}),
		existsSync: vi.fn((path) => {
			return vol.existsSync(path)
		}),
		readJsonSync: vi.fn((path) => {
			const content = vol.readFileSync(path, 'utf-8').toString()
			return JSON.parse(content)
		}),
		rmSync: vi.fn((path, options) => {
			try {
				if (options?.recursive) {
					vol.rmdirSync(path, { recursive: true })
				} else {
					vol.unlinkSync(path)
				}
			} catch (error) {
				// If force option is true, ignore errors for non-existent files
				if (!options?.force || error.code !== 'ENOENT') {
					throw error
				}
			}
		}),
		symlinkSync: vi.fn((target, path) => {
			vol.symlinkSync(target, path)
		}),
		utimesSync: vi.fn((path, atime, mtime) => {
			vol.utimesSync(path, atime, mtime)
		}),
		statSync: vi.fn((path) => {
			const stats = vol.lstatSync(path)
			return {
				...stats,
				isDirectory: () => stats.isDirectory(),
				isFile: () => stats.isFile(),
				isSymbolicLink: () => stats.isSymbolicLink(),
				mtime: stats.mtime || new Date(),
			}
		}),
		renameSync: vi.fn((oldPath, newPath) => {
			const content = vol.readFileSync(oldPath)
			vol.writeFileSync(newPath, content)
			vol.unlinkSync(oldPath)
		}),
		outputJsonSync: vi.fn((file, data, options = {}) => {
			const content = JSON.stringify(data, null, options.spaces || 2)
			vol.mkdirSync(path.dirname(file), { recursive: true })
			vol.writeFileSync(file, content)
		}),
		writeFileSync: vi.fn((file, data, options = {}) => {
			vol.mkdirSync(path.dirname(file), { recursive: true })
			vol.writeFileSync(file, data, options)
		}),
		readlink: vi.fn((path) => {
			return Promise.resolve(vol.readlinkSync(path))
		}),
		readlinkSync: vi.fn((path) => {
			return vol.readlinkSync(path)
		}),
	}
}

// Helper function to reset the virtual filesystem and mocks
export function resetFsExtra() {
	vol.reset()
	vi.clearAllMocks()
}
