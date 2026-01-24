/**
 * Release metadata as returned by the API.
 */
export type ReleaseInfo = {
	key: string
	index: string
	files: string
	releasedAt: string
	builtAt: string
	gitBranch: string
	gitCommit: string
}

/**
 * Deployment metadata for a given environment.
 */
export type DeployInfo = {
	version: number
	gitBranch: string
	gitCommitHash: string
	builtAt: number
	builtAtReadable?: string
	deployedAt: string
}

/**
 * Deployment details including whether it is current.
 */
export type DeploymentDetail = DeployInfo & {
	isCurrent: boolean
}

/**
 * Version guard error when attempting to deploy an older build.
 */
export type DeployVersionError = {
	message: string
	latestVersion: number
	expectedVersion: number
}

/**
 * Releases listing response.
 */
export type ReleasesResponse = {
	current: string | null
	builds: ReleaseInfo[]
}

/**
 * Release details with file list.
 */
export type ReleaseWithFilesResponse = ReleaseInfo & {
	isCurrent: boolean
	filesList: string[]
}

/**
 * Publish endpoint response.
 */
export type PublishResponse = {
	path: string
	release: ReleaseInfo
}

/**
 * Rollback endpoint response.
 */
export type RollbackResponse = {
	path: string
	release: ReleaseInfo
}

/**
 * Health endpoint response.
 */
export type HealthResponse = {
	status: string
	buildVersion: string | null
	deployedAt: string | null
	timestamp: number
	uptime: number
}

/**
 * Pre-deploy endpoint response.
 */
export type PreDeployResponse = {
	newBuildVersion: number
	newBuildDir: string
	builds: number[]
}

/**
 * Post-deploy endpoint response.
 */
export type PostDeployResponse = {
	buildVersion: string
	buildDir: string
	buildDirAlias: string
}
