import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * https://vitest.dev/config/
 */
export default defineConfig({
	resolve: {
		alias: {
			'@vforsh/rmatic-client': path.resolve(__dirname, 'packages/client/src/index.ts'),
		},
	},
	test: {
		// Include pattern for test files
		include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],

		// Exclude patterns
		exclude: ['**/node_modules/**', '**/dist/**'],

		// Environment configuration
		environment: 'node',

		// Global test timeout
		testTimeout: 10000,

		// Disable watch mode by default
		watch: false,

		// Enable globals
		globals: true,
	},
})
