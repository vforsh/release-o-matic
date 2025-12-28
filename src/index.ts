import * as fse from 'fs-extra'
import { globby, globbySync } from 'globby'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { without } from 'lodash-es'
import path from 'path'
import { z } from 'zod'
import { env as ENV } from './env'
import { fromReadableDateString, toReadableDateString } from './utils/date/readable-date-string'
import { getErrorLog } from './utils/error/utils'

/**
 * Build key is a string that consists of env and build number
 * For example: `master-12` or `develop-12`
 */
type BuildKey = `${string}-${number}`

function isBuildKey(key: string): key is BuildKey {
	return /^[a-zA-Z0-9_-]+-\d+$/.test(key)
}

function createBuildKey(env: string, version: number | string): BuildKey {
	return `${env}-${version.toString()}` as BuildKey
}

function parseBuildKey(key: BuildKey): { env: string; version: number } {
	const [env, version] = key.split('-')
	return {
		env,
		version: parseInt(version),
	}
}

const buildInfoSchema = z.object({
	version: z.number().describe('build version'),
	builtAt: z.number().describe('build timestamp'),
	builtAtReadable: z.string().describe('build timestamp in readable format'),
	gitCommitHash: z.string().describe('git commit hash'),
	gitBranch: z.string().describe('git branch'),
})

type BuildInfo = z.infer<typeof buildInfoSchema>

type DeployInfo = BuildInfo & {
	deployedAt: string
}

export type ReleaseInfo = {
	key: BuildKey
	index: string
	files: string
	releasedAt: string
	builtAt: string
	gitBranch: string
	gitCommit: string
}

type Releases = {
	current: string | null
	builds: ReleaseInfo[]
}

const openApiSpec = {
	openapi: '3.0.3',
	info: {
		title: 'Release-o-matic API',
		version: '1.0.0',
		description: 'API for managing game build deployments and releases.',
	},
	servers: [
		{
			url: '/',
			description: 'Default server',
		},
	],
	components: {
		securitySchemes: {
			bearerAuth: {
				type: 'http',
				scheme: 'bearer',
			},
		},
		schemas: {
			BuildInfo: {
				type: 'object',
				required: ['version', 'builtAt', 'builtAtReadable', 'gitCommitHash', 'gitBranch'],
				properties: {
					version: { type: 'integer', description: 'Build version number.' },
					builtAt: { type: 'integer', description: 'Build timestamp.' },
					builtAtReadable: { type: 'string', description: 'Human readable build timestamp.' },
					gitCommitHash: { type: 'string', description: 'Git commit hash used for the build.' },
					gitBranch: { type: 'string', description: 'Git branch used for the build.' },
				},
			},
			DeploymentSummary: {
				type: 'object',
				required: ['version', 'gitBranch', 'gitCommitHash', 'builtAt', 'deployedAt'],
				properties: {
					version: { type: 'integer', description: 'Deployed build version.' },
					gitBranch: { type: 'string' },
					gitCommitHash: { type: 'string' },
					builtAt: { type: 'integer', description: 'Build timestamp.' },
					deployedAt: { type: 'string', description: 'Readable deployment timestamp.' },
				},
			},
			DeploymentDetail: {
				type: 'object',
				required: ['version', 'gitBranch', 'gitCommitHash', 'builtAt', 'builtAtReadable', 'deployedAt'],
				properties: {
					version: { type: 'integer' },
					gitBranch: { type: 'string' },
					gitCommitHash: { type: 'string' },
					builtAt: { type: 'integer' },
					builtAtReadable: { type: 'string' },
					deployedAt: { type: 'string' },
					isCurrent: {
						type: 'boolean',
						description: 'Indicates whether this deployment is the current one.',
					},
				},
			},
			ReleaseInfo: {
				type: 'object',
				required: ['key', 'index', 'files', 'releasedAt', 'builtAt', 'gitBranch', 'gitCommit'],
				properties: {
					key: { type: 'string', description: 'Composite build key (env-version).' },
					index: { type: 'string', description: 'Index html filename for the release.' },
					files: { type: 'string', description: 'Manifest filename for the release files.' },
					releasedAt: { type: 'string', description: 'Readable release timestamp.' },
					builtAt: { type: 'string', description: 'Readable build timestamp.' },
					gitBranch: { type: 'string' },
					gitCommit: { type: 'string' },
				},
			},
			ReleasesOverview: {
				type: 'object',
				required: ['current', 'builds'],
				properties: {
					current: { type: ['string', 'null'], description: 'Current release build key.' },
					builds: {
						type: 'array',
						items: { $ref: '#/components/schemas/ReleaseInfo' },
					},
				},
			},
			ReleaseDetail: {
				type: 'object',
				required: [
					'key',
					'index',
					'files',
					'releasedAt',
					'builtAt',
					'gitBranch',
					'gitCommit',
					'isCurrent',
					'filesList',
				],
				properties: {
					key: { type: 'string' },
					index: { type: 'string' },
					files: { type: 'string' },
					releasedAt: { type: 'string' },
					builtAt: { type: 'string' },
					gitBranch: { type: 'string' },
					gitCommit: { type: 'string' },
					isCurrent: { type: 'boolean' },
					filesList: {
						type: 'array',
						items: { type: 'string' },
						description: 'List of files included in the release.',
					},
				},
			},
			ErrorResponse: {
				type: 'object',
				required: ['message'],
				properties: {
					message: { type: 'string' },
				},
			},
			HealthResponse: {
				type: 'object',
				required: ['status', 'timestamp', 'uptime'],
				properties: {
					status: { type: 'string', example: 'ok' },
					buildVersion: { type: ['string', 'null'] },
					deployedAt: { type: ['string', 'null'] },
					timestamp: { type: 'number' },
					uptime: { type: 'number' },
				},
			},
			PreDeployResponse: {
				type: 'object',
				required: ['newBuildVersion', 'newBuildDir', 'builds'],
				properties: {
					newBuildVersion: { type: 'integer' },
					newBuildDir: { type: 'string', description: 'Host path where the new build should be placed.' },
					builds: {
						type: 'array',
						items: { type: 'integer' },
						description: 'Existing build versions for the environment.',
					},
				},
			},
			PostDeployResponse: {
				type: 'object',
				required: ['buildVersion', 'buildDir', 'buildDirAlias'],
				properties: {
					buildVersion: { type: 'string' },
					buildDir: { type: 'string', description: 'Relative path to the deployed build directory.' },
					buildDirAlias: {
						type: 'string',
						description: 'Relative path to the alias (symlink) for the deployment.',
					},
				},
			},
			PublishResponse: {
				type: 'object',
				required: ['path', 'release'],
				properties: {
					path: { type: 'string', description: 'Filesystem path where the release assets were placed.' },
					release: { $ref: '#/components/schemas/ReleaseInfo' },
				},
			},
			RollbackResponse: {
				type: 'object',
				required: ['path', 'release'],
				properties: {
					path: { type: 'string', description: 'Relative path to the release directory.' },
					release: { $ref: '#/components/schemas/ReleaseInfo' },
				},
			},
		},
	},
	paths: {
		'/health': {
			get: {
				summary: 'Health check',
				description: 'Returns service health status and metadata.',
				responses: {
					200: {
						description: 'Service is healthy.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/HealthResponse' },
							},
						},
					},
				},
			},
		},
		'/': {
			get: {
				summary: 'Get builds root path',
				description: 'Returns the configured root directory for game builds.',
				security: [{ bearerAuth: [] }],
				responses: {
					200: {
						description: 'Root path returned as plain text.',
						content: {
							'text/plain': {
								schema: { type: 'string' },
							},
						},
					},
				},
			},
		},
		'/env': {
			get: {
				summary: 'Get environment configuration',
				description: 'Returns the effective runtime environment configuration.',
				security: [{ bearerAuth: [] }],
				responses: {
					200: {
						description: 'Environment variables as configured for the service.',
						content: {
							'application/json': {
								schema: { type: 'object' },
							},
						},
					},
				},
			},
		},
		'/preDeploy/{game}/{env}/{version}': {
			get: {
				summary: 'Prepare deployment',
				description: 'Prepares a new build directory for deployment into a specific environment.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{
						name: 'game',
						in: 'path',
						required: true,
						schema: { type: 'string' },
						description: 'Game identifier.',
					},
					{
						name: 'env',
						in: 'path',
						required: true,
						schema: { type: 'string' },
						description: 'Environment name.',
					},
					{
						name: 'version',
						in: 'path',
						required: true,
						schema: { type: 'integer' },
						description: 'Build version.',
					},
				],
				responses: {
					200: {
						description: 'Build directory prepared.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/PreDeployResponse' },
							},
						},
					},
					400: {
						description: 'Invalid request.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/postDeploy/{game}/{env}/{version}': {
			get: {
				summary: 'Finalize deployment',
				description: 'Updates symlinks and cleans old deployments after a successful build deploy.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'env', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'version', in: 'path', required: true, schema: { type: 'string' } },
				],
				responses: {
					200: {
						description: 'Deployment finalized.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/PostDeployResponse' },
							},
						},
					},
					400: {
						description: 'Invalid request.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
					404: {
						description: 'Build not found.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/deployments/{game}/{env}': {
			get: {
				summary: 'List deployments',
				description: 'Returns deployment history for a specific environment.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'env', in: 'path', required: true, schema: { type: 'string' } },
				],
				responses: {
					200: {
						description: 'List of deployments.',
						content: {
							'application/json': {
								schema: {
									type: 'array',
									items: { $ref: '#/components/schemas/DeploymentSummary' },
								},
							},
						},
					},
					404: {
						description: 'Environment not found.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/deployments/{game}/{env}/current': {
			get: {
				summary: 'Get current deployment',
				description: 'Returns details for the current deployment in the environment.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'env', in: 'path', required: true, schema: { type: 'string' } },
				],
				responses: {
					200: {
						description: 'Current deployment details.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/DeploymentDetail' },
							},
						},
					},
					404: {
						description: 'No current deployment or environment missing.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
					500: {
						description: 'Unexpected error.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/deployments/{game}/{env}/{version}': {
			get: {
				summary: 'Get deployment details',
				description: 'Returns details about a specific deployed build.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'env', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'version', in: 'path', required: true, schema: { type: 'string' } },
				],
				responses: {
					200: {
						description: 'Deployment details.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/DeploymentDetail' },
							},
						},
					},
					404: {
						description: 'Deployment not found.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
					500: {
						description: 'Unexpected error.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/releases/{game}/{platform}': {
			get: {
				summary: 'List releases',
				description: 'Returns releases published for a game and platform.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
				],
				responses: {
					200: {
						description: 'Releases overview.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ReleasesOverview' },
							},
						},
					},
				},
			},
		},
		'/releases/{game}/{platform}/current': {
			get: {
				summary: 'Get current release',
				description: 'Returns details of the current release for the platform.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
				],
				responses: {
					200: {
						description: 'Current release info.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ReleaseInfo' },
							},
						},
					},
					404: {
						description: 'Current release not found.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/releases/{game}/{platform}/{buildKey}': {
			get: {
				summary: 'Get release details',
				description: 'Returns metadata and file listing for a release.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'buildKey', in: 'path', required: true, schema: { type: 'string' } },
				],
				responses: {
					200: {
						description: 'Release details.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ReleaseDetail' },
							},
						},
					},
					404: {
						description: 'Release not found.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/publish/{game}/{platform}/{buildKey}': {
			get: {
				summary: 'Publish a build',
				description:
					'Publishes a build to the given platform. If buildKey is omitted the latest build is used.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
					{
						name: 'buildKey',
						in: 'path',
						required: false,
						schema: { type: 'string' },
						description: 'Build key (env-version). Defaults to the latest build from master/main.',
					},
				],
				responses: {
					200: {
						description: 'Build published.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/PublishResponse' },
							},
						},
					},
					400: {
						description: 'Invalid request.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
					404: {
						description: 'Build not found.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/rollback/{game}/{platform}/{buildKey}': {
			get: {
				summary: 'Rollback to a previous release',
				description:
					'Switches the current release to the provided build key or the previous release when omitted.',
				security: [{ bearerAuth: [] }],
				parameters: [
					{ name: 'game', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
					{
						name: 'buildKey',
						in: 'path',
						required: false,
						schema: { type: 'string' },
						description: 'Build key to rollback to. Defaults to the previously published build.',
					},
				],
				responses: {
					200: {
						description: 'Rollback successful.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/RollbackResponse' },
							},
						},
					},
					400: {
						description: 'Invalid request.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
					404: {
						description: 'Release not found.',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ErrorResponse' },
							},
						},
					},
				},
			},
		},
		'/openapi.json': {
			get: {
				summary: 'OpenAPI specification',
				description: 'Returns the OpenAPI 3.0 document describing all API endpoints.',
				responses: {
					200: {
						description: 'OpenAPI specification.',
						content: {
							'application/json': {
								schema: { type: 'object' },
							},
						},
					},
				},
			},
		},
	},
}

const app = new Hono()

app.get('/openapi.json', (c) => c.json(openApiSpec))

// Add health endpoint
app.get('/health', (c) => {
	const buildVersion = ENV.BUILD_VERSION ?? null
	const deployedAt = ENV.DEPLOYED_AT ?? null

	return c.json({
		status: 'ok',
		buildVersion,
		deployedAt,
		timestamp: Date.now(),
		uptime: process.uptime(),
	})
})

// Add logger middleware to all routes
app.use(
	logger((str, ...rest) => {
		const time = toReadableDateString(Date.now(), 'ms')
		console.log(`[${time}]`, str, ...rest)
		return str
	}),
)

// Add auth middleware to all routes except /health
app.use(async function authMiddleware(c: any, next: any) {
	// Skip auth for health endpoint
	if (c.req.path === '/health' || c.req.path === '/openapi.json') {
		return await next()
	}

	if (!ENV.AUTH_REQUIRED) {
		return await next()
	}

	const authHeader = c.req.header('Authorization')

	if (!authHeader) {
		return c.json({ message: 'Authorization header is required' }, 401)
	}

	const [type, token] = authHeader.split(' ')

	if (type !== 'Bearer') {
		return c.json({ message: 'Bearer token is required' }, 401)
	}

	if (token !== ENV.BEARER_TOKEN) {
		return c.json({ message: 'Invalid token' }, 401)
	}

	return await next()
})

app.get('/', (c) => c.text(ENV.GAME_BUILDS_DIR))

app.get('/env', (c) => {
	return c.json(ENV)
})

// готовим новый билд к деплою в конкретное окружение
// endpoint возвращает директорию `newBuildDir`, в которую нужно положить билд (например, используя rsync)
app.get('/preDeploy/:game/:env/:version', (c) => {
	const game = c.req.param('game')

	const env = c.req.param('env')

	const build = parseInt(c.req.param('version'))

	if (!Number.isInteger(build) || build <= 0) {
		return c.json({ message: 'invalid version, must be a positive integer' }, 400)
	}

	const envDir = path.join(ENV.GAME_BUILDS_DIR, game, env)

	const buildDir = path.join(envDir, build.toString())

	fse.ensureDirSync(envDir)

	const existingBuilds = fse
		.readdirSync(envDir)
		.filter((item) => isEmptyDir(path.join(envDir, item)) === false)
		.map((item) => parseInt(item))
		.filter((item) => Number.isInteger(item))
		.sort((a, b) => a - b)

	if (existingBuilds.includes(build)) {
		return c.json(
			{
				message: `version #${build} already exists`,
				newBuildVersion: existingBuilds.at(-1)! + 1,
				builds: existingBuilds,
			},
			400,
		)
	}

	fse.ensureDirSync(buildDir)

	const lastBuildVersion = existingBuilds.at(-1)
	if (lastBuildVersion) {
		fse.copySync(path.join(envDir, lastBuildVersion.toString()), buildDir)
	} else {
		fse.ensureDirSync(buildDir)
	}

	return c.json({
		newBuildVersion: build,
		newBuildDir: buildDir.replace(ENV.GAME_BUILDS_DIR, ENV.GAME_BUILDS_DIR_HOST),
		builds: existingBuilds,
	})
})

// колбек после успешного деплоя нового билда в конкретное окружение
app.get('/postDeploy/:game/:env/:version', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const env = c.req.param('env')!

	const envDir = path.join(gameDir, env)

	const deployedBuildVersion = c.req.param('version')

	if (deployedBuildVersion === undefined) {
		return c.json({ message: `build #${deployedBuildVersion} doesn't exist` }, 404)
	}

	const deployedBuildDir = path.join(envDir, deployedBuildVersion.toString())

	if (!fse.existsSync(deployedBuildDir)) {
		return c.json({ message: `build directory '${deployedBuildDir}' doesn't exist` }, 404)
	}

	// ensure that the build_info.json is present
	if (!fse.existsSync(path.join(deployedBuildDir, 'build_info.json'))) {
		return c.json({ message: `build '${deployedBuildVersion}' doesn't have build_info.json` }, 404)
	}

	// ensure that the index.html is present
	if (!fse.existsSync(path.join(deployedBuildDir, 'index.html'))) {
		return c.json({ message: `build '${deployedBuildVersion}' doesn't have index.html` }, 404)
	}

	const buildInfoPath = path.join(deployedBuildDir, 'build_info.json')
	const buildInfo = fse.existsSync(buildInfoPath) ? (fse.readJsonSync(buildInfoPath) as BuildInfo) : null
	if (!buildInfo) {
		return c.json({ message: `build info file '${deployedBuildDir}/build_info.json' is missing` }, 404)
	}

	const buildInfoResult = buildInfoSchema.safeParse(buildInfo)
	if (!buildInfoResult.success) {
		return c.json({ message: `build info file is invalid`, errors: buildInfoResult.error.errors }, 400)
	}

	let symlinkPath = path.join(envDir, 'latest')
	fse.rmSync(symlinkPath, { force: true })
	fse.symlinkSync(path.relative(envDir, deployedBuildDir), symlinkPath)

	const time = toReadableDateString(Date.now(), 'ms')
	console.log(
		`[${time}] Created symlink: ${path.relative(ENV.GAME_BUILDS_DIR, symlinkPath)} -> ${path.relative(ENV.GAME_BUILDS_DIR, deployedBuildDir)}`,
	)

	// Update modified date for deployed build dir
	const currentTime = new Date()
	try {
		fse.utimesSync(deployedBuildDir, currentTime, currentTime)
		console.log(
			`[${time}] Updated modified date for ${path.relative(ENV.GAME_BUILDS_DIR, deployedBuildDir)} to ${toReadableDateString(currentTime.getTime())}`,
		)
	} catch (error) {
		console.error(
			`[${time}] Failed to update modified date for ${path.relative(ENV.GAME_BUILDS_DIR, deployedBuildDir)}:`,
			error,
		)
	}

	const removedPaths = removeOldDeployments(envDir, { buildsNumToKeep: 10 })
	console.log(`[${time}] Removed ${removedPaths.length} deployments: ${removedPaths.join(', ')}`)

	return c.json({
		buildVersion: deployedBuildVersion,
		buildDir: path.relative(ENV.GAME_BUILDS_DIR, deployedBuildDir),
		buildDirAlias: path.relative(ENV.GAME_BUILDS_DIR, symlinkPath),
	})
})

// инфо о всех задеплоенных билдах для конкретного окружения
app.get('/deployments/:game/:env', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const env = c.req.param('env')

	const envDir = path.join(gameDir, env)

	if (!fse.existsSync(envDir)) {
		return c.json({ message: `environment '${env}' doesn't exist` }, 404)
	}

	const existingBuilds = fse
		.readdirSync(envDir)
		.filter(
			(buildVersionStr) =>
				Number.isInteger(parseInt(buildVersionStr)) &&
				fse.statSync(path.join(envDir, buildVersionStr)).isDirectory() &&
				fse.existsSync(path.join(envDir, buildVersionStr, 'build_info.json')),
		)
		.sort((a, b) => parseInt(b) - parseInt(a))
		.reduce((acc, version) => {
			const dirpath = path.join(envDir, version)
			const modifiedAt = fse.statSync(dirpath).mtime
			const buildInfo = fse.readJsonSync(path.join(dirpath, 'build_info.json')) as BuildInfo

			acc.push({
				version: parseInt(version),
				gitBranch: buildInfo.gitBranch,
				gitCommitHash: buildInfo.gitCommitHash,
				builtAt: buildInfo.builtAt,
				deployedAt: toReadableDateString(modifiedAt.getTime()),
			} as DeployInfo)

			return acc
		}, [] as DeployInfo[])

	return c.json(existingBuilds)
})

// инфо о текущем (последнем) задеплоенном билде
app.get('/deployments/:game/:env/current', (c) => {
	const game = c.req.param('game')
	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)
	const env = c.req.param('env')
	const envDir = path.join(gameDir, env)

	if (!fse.existsSync(envDir)) {
		return c.json({ message: `environment '${env}' doesn't exist` }, 404)
	}

	// Check if 'latest' symlink exists
	const latestSymlinkPath = path.join(envDir, 'latest')
	if (!fse.existsSync(latestSymlinkPath)) {
		return c.json({ message: `no current deployment for environment '${env}'` }, 404)
	}

	// Get the actual build directory the symlink points to
	const currentBuildPath = fse.realpathSync(latestSymlinkPath)
	const version = path.basename(currentBuildPath)

	if (!Number.isInteger(parseInt(version))) {
		return c.json({ message: `invalid current deployment for environment '${env}'` }, 500)
	}

	try {
		const modifiedAt = fse.statSync(currentBuildPath).mtime
		const buildInfo = fse.readJsonSync(path.join(currentBuildPath, 'build_info.json')) as BuildInfo

		const deployInfo: DeployInfo = {
			version: parseInt(version),
			gitBranch: buildInfo.gitBranch,
			gitCommitHash: buildInfo.gitCommitHash,
			builtAt: buildInfo.builtAt,
			builtAtReadable: buildInfo.builtAtReadable,
			deployedAt: toReadableDateString(modifiedAt.getTime()),
		}

		return c.json(deployInfo)
	} catch (error) {
		return c.json(
			{
				message: `error reading current deployment info: ${error instanceof Error ? error.message : String(error)}`,
				path: currentBuildPath,
			},
			500,
		)
	}
})

// инфо о конкретном задеплоенном билде
app.get('/deployments/:game/:env/:version', (c) => {
	const game = c.req.param('game')
	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const env = c.req.param('env')
	const envDir = path.join(gameDir, env)
	if (!fse.existsSync(envDir)) {
		return c.json({ message: `environment '${env}' doesn't exist` }, 404)
	}

	const version = c.req.param('version')
	const buildDir = path.join(envDir, version)
	if (!fse.existsSync(buildDir)) {
		return c.json({ message: `build #${version} doesn't exist in environment '${env}'` }, 404)
	}

	try {
		const modifiedAt = fse.statSync(buildDir).mtime
		const buildInfo = fse.readJsonSync(path.join(buildDir, 'build_info.json')) as BuildInfo

		// Check if this is the current deployment
		const latestSymlinkPath = path.join(envDir, 'latest')
		let isCurrent = false

		if (fse.existsSync(latestSymlinkPath)) {
			const currentBuildPath = fse.realpathSync(latestSymlinkPath)
			isCurrent = currentBuildPath === buildDir
		}

		const deployInfo: DeployInfo & { isCurrent: boolean } = {
			version: parseInt(version),
			gitBranch: buildInfo.gitBranch,
			gitCommitHash: buildInfo.gitCommitHash,
			builtAt: buildInfo.builtAt,
			builtAtReadable: buildInfo.builtAtReadable,
			deployedAt: toReadableDateString(modifiedAt.getTime()),
			isCurrent,
		}

		return c.json(deployInfo)
	} catch (error) {
		return c.json(
			{
				message: `error reading deployments info (${getErrorLog(error)})`,
				path: buildDir,
			},
			500,
		)
	}
})

// инфо о всех релизах для указанной игры и платформы
app.get('/releases/:game/:platform', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	// директория с релизами для указанной платформы
	const releasesDir = path.join(gameDir, 'prod', platform)
	if (!fse.existsSync(releasesDir)) {
		const emptyReleases: Releases = {
			current: null,
			builds: [],
		}

		return c.json(emptyReleases)
	}

	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		const emptyReleases: Releases = {
			current: null,
			builds: [],
		}

		return c.json(emptyReleases)
	}

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	return c.json(releases)
})

// инфо о текущем релизе
app.get('/releases/:game/:platform/current', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	const releasesDir = path.join(gameDir, `prod`, platform)
	if (!fse.existsSync(releasesDir)) {
		return c.json({ message: `platform '${platform}' doesn't exist` }, 404)
	}

	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return c.json({ message: `there are no published builds for platform '${platform}'` }, 404)
	}

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	return c.json(releases.builds.find((item) => item.key === releases.current))
})

// инфо о конкретном релизе, например, `master-11`
app.get('/releases/:game/:platform/:buildKey', (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	const releasesDir = path.join(gameDir, `prod`, platform)
	if (!fse.existsSync(releasesDir)) {
		return c.json({ message: `platform '${platform}' doesn't exist` }, 404)
	}

	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return c.json({ message: `there are no published builds for platform '${platform}'` }, 404)
	}

	const buildKey = c.req.param('buildKey')

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	const release = releases.builds.find((item) => item.key === buildKey)
	if (!release) {
		return c.json({ message: `release '${buildKey}' doesn't exist` }, 404)
	}

	// @ts-expect-error
	const filesJsonPath = path.join(releasesDir)
	const files = fse.readJsonSync(path.join(releasesDir, `files_${buildKey}.json`))

	return c.json({
		...release,
		isCurrent: releases.current === buildKey,
		filesList: files,
	})
})

// публикация нового билда
app.get('/publish/:game/:platform/:buildKey?', async (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	let buildKey = c.req.param('buildKey') || getLatestBuildKey(gameDir, 'master') || getLatestBuildKey(gameDir, 'main')

	if (!buildKey) {
		return c.json({ message: `build doesn't exist` }, 400)
	}

	if (!isBuildKey(buildKey)) {
		return c.json({ message: `invalid build key: ${buildKey}` }, 400)
	}

	let releasesJsonPath = path.join(gameDir, `prod/${platform}/releases.json`)
	let releases: Releases = fse.existsSync(releasesJsonPath)
		? fse.readJsonSync(releasesJsonPath)
		: {
				current: '',
				builds: [],
			}

	const existingRelease = releases.builds.find((item) => item.key === buildKey)
	if (existingRelease) {
		return c.json({ message: `'${buildKey}' was already released at ${existingRelease.releasedAt}` }, 400)
	}

	const { env, version } = parseBuildKey(buildKey)

	let srcDir = path.join(gameDir, env, version.toString())

	if (!fse.existsSync(srcDir)) {
		return c.json({ message: `build '${buildKey}' doesn't exist` }, 404)
	}

	// ensure that the build_info.json is present
	if (!fse.existsSync(path.join(srcDir, 'build_info.json'))) {
		return c.json({ message: `build '${buildKey}' doesn't have build_info.json` }, 404)
	}

	// ensure that the index.html is present
	if (!fse.existsSync(path.join(srcDir, 'index.html'))) {
		return c.json({ message: `build '${buildKey}' doesn't have index.html` }, 404)
	}

	let destDir = path.join(gameDir, `prod/${platform}`)

	let destDirTemp = path.join(gameDir, `prod/${platform}_temp`)

	// копируем билд во временную папку
	fse.ensureDirSync(destDirTemp)
	fse.copySync(srcDir, destDirTemp, {})

	let buildInfo = fse.readJsonSync(path.join(destDirTemp, 'build_info.json')) as BuildInfo

	// build_info.json нам уже не нужен, удаляем его
	fse.rmSync(path.join(destDirTemp, 'build_info.json'))

	// переименовываем index.html в index_${buildKey}.html (например, index_master-11.html)
	fse.renameSync(path.join(destDirTemp, 'index.html'), path.join(destDirTemp, `index_${buildKey}.html`))

	// создаем файл files_${buildKey}.json, в котором будут перечислены все файлы билда
	let filesJsonPath = path.join(destDirTemp, `files_${buildKey}.json`)
	let files = globbySync(path.join(destDirTemp, '**/*'))
	files = [filesJsonPath, ...files]
	files = files.map((filepath) => path.relative(destDirTemp, filepath))
	fse.outputJsonSync(path.join(destDirTemp, `files_${buildKey}.json`), files, { spaces: '\t' })

	// копируем все файлы в финальную папку
	fse.copySync(destDirTemp, destDir)

	// удаляем временную папку
	fse.rmSync(destDirTemp, { recursive: true })

	// обновляем releases.json
	let newRelease = createNewRelease(buildKey, buildInfo)
	releases.current = newRelease.key
	releases.builds.unshift(newRelease)
	fse.outputJsonSync(releasesJsonPath, releases, { spaces: '\t' })

	// @ts-expect-error
	let removedReleases = await removeOldReleases(releasesJsonPath, { buildsNumToKeep: 5 })

	updateIndexHtmlSymlink(destDir, newRelease.key)

	return c.json({
		path: destDir,
		release: newRelease,
	})
})

// откат к какому-то из прошлых релизов
app.get('/rollback/:game/:platform/:buildKey?', async (c) => {
	const game = c.req.param('game')

	const gameDir = path.join(ENV.GAME_BUILDS_DIR, game)

	const platform = c.req.param('platform')

	let buildKey = c.req.param('buildKey') || getPreviousReleaseBuildKey(gameDir, platform)

	if (!buildKey) {
		return c.json({ message: `there are no previous releases` }, 400)
	}

	if (!isBuildKey(buildKey)) {
		return c.json({ message: `invalid build key: ${buildKey}` }, 400)
	}

	let releasesDir = path.join(gameDir, `prod/${platform}`)
	let releasesJsonPath = path.join(releasesDir, 'releases.json')
	let releases = fse.readJsonSync(releasesJsonPath) as Releases

	if (releases.current === buildKey) {
		return c.json({ message: `build ${buildKey} is current release` }, 400)
	}

	let release = releases.builds.find((item) => item.key === buildKey)
	if (!release) {
		return c.json({ message: `release '${buildKey}' doesn't exist` }, 404)
	}

	// update releases.json
	releases.current = buildKey
	fse.outputJsonSync(releasesJsonPath, releases, { spaces: '\t' })

	// update index.html symlink
	updateIndexHtmlSymlink(releasesDir, buildKey)

	return c.json({
		path: path.relative(gameDir, releasesDir),
		release: release,
	})
})

function isEmptyDir(dirPath: string): boolean {
	return fse.statSync(dirPath).isDirectory() && fse.readdirSync(dirPath).length === 0
}

function getLatestBuildKey(gameDir: string, env: string): BuildKey | undefined {
	const builds = fse
		.readdirSync(path.join(gameDir, env))
		.filter((item) => Number.isInteger(parseInt(item)) && fse.statSync(path.join(gameDir, env, item)).isDirectory())
		.sort((a, b) => parseInt(b) - parseInt(a))

	if (builds.length === 0) {
		return undefined
	}

	return createBuildKey(env, builds[0])
}

/**
 * @return {string} - key of the build that was published before the current one or undefined if there are no previous builds
 */
function getPreviousReleaseBuildKey(gameDir: string, platform: string): BuildKey | undefined {
	const releasesDir = path.join(gameDir, `prod/${platform}`)
	const releasesJsonPath = path.join(releasesDir, 'releases.json')
	if (!fse.existsSync(releasesJsonPath)) {
		return undefined
	}

	const releases = fse.readJsonSync(releasesJsonPath) as Releases

	// sort builds by date from newest to oldest
	const releasesSortedByDate = releases.builds.sort((a, b) => {
		return fromReadableDateString(b.releasedAt) - fromReadableDateString(a.releasedAt)
	})

	const currentRelease = releasesSortedByDate.find((item) => item.key === releases.current)
	if (!currentRelease) {
		return undefined
	}

	const currentReleaseIndex = releasesSortedByDate.indexOf(currentRelease)

	const previousRelease = releasesSortedByDate.at(currentReleaseIndex + 1)

	return previousRelease?.key
}

function createNewRelease(buildKey: BuildKey, buildInfo: BuildInfo): ReleaseInfo {
	return {
		key: buildKey,
		index: `index_${buildKey}.html`,
		files: `files_${buildKey}.json`,
		releasedAt: toReadableDateString(Date.now()),
		builtAt: buildInfo.builtAtReadable,
		gitBranch: buildInfo.gitBranch,
		gitCommit: buildInfo.gitCommitHash,
	}
}

/**
 * Removes old deployments from the environment directory
 * @param envDir - path to the environment directory
 * @param options - options
 * @returns array of removed paths
 */
function removeOldDeployments(envDir: string, options: { buildsNumToKeep: number }): string[] {
	const allBuilds = fse
		.readdirSync(envDir)
		.filter((item) => Number.isInteger(parseInt(item)) && fse.statSync(path.join(envDir, item)).isDirectory())
		.sort((a, b) => parseInt(b) - parseInt(a))

	// @ts-expect-error
	const buildsToKeep = allBuilds.slice(0, options.buildsNumToKeep)

	const buildsToRemove = allBuilds.slice(options.buildsNumToKeep)

	const removedPaths: string[] = []

	buildsToRemove.forEach((build) => {
		const buildPath = path.join(envDir, build)
		fse.rmSync(buildPath, { recursive: true })
		removedPaths.push(buildPath)
	})

	return removedPaths
}

/**
 * @returns object with removedBuilds array that contains removed build keys
 */
async function removeOldReleases(releasesJsonPath: string, options: { buildsNumToKeep: number }) {
	let releases = fse.readJsonSync(releasesJsonPath) as Releases

	// sort builds by date from newest to oldest
	let builds = releases.builds.sort(
		(a, b) => fromReadableDateString(b.releasedAt) - fromReadableDateString(a.releasedAt),
	)

	// keep only the newest N builds
	let buildsToKeep = builds.slice(0, options.buildsNumToKeep)

	let buildsToRemove = without(builds, ...buildsToKeep)

	if (buildsToRemove.length === 0) {
		return { removedBuilds: [] }
	}

	let releasesDir = path.dirname(releasesJsonPath)
	let filesAll = await globby(path.join(releasesDir, '**/*'))
	let filesToKeep = buildsToKeep.flatMap((item) => fse.readJSONSync(path.join(releasesDir, item.files)))
	filesToKeep.push('index.html')
	filesToKeep.push('releases.json')
	filesToKeep = filesToKeep.map((item) => path.join(releasesDir, item))

	let filesToRemove = without(filesAll, ...filesToKeep)
	filesToRemove.forEach((item) => fse.rmSync(item))

	// update releases.json
	releases.builds = buildsToKeep
	fse.outputJSONSync(releasesJsonPath, releases, { spaces: '\t' })

	return { removedBuilds: buildsToRemove.map((item) => item.key) }
}

function updateIndexHtmlSymlink(dir: string, buildKey: string): void {
	let target = `./index_${buildKey}.html`
	let filepath = path.join(dir, 'index.html')

	// remove existing symlink (if present)
	fse.rmSync(filepath, { force: true })

	// create new symlink
	fse.symlinkSync(target, filepath)
}

export default {
	fetch: app.fetch,
	port: 4000,
}
