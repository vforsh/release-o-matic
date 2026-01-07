export type ReleaseInfo = {
	key: string
	index: string
	files: string
	releasedAt: string
	builtAt: string
	gitBranch: string
	gitCommit: string
}

export type ReleasesResponse = {
	current: string | null
	builds: ReleaseInfo[]
}

export type ReleaseWithFilesResponse = ReleaseInfo & {
	isCurrent: boolean
	filesList: string[]
}

export type PublishResponse = {
	path: string
	release: ReleaseInfo
}

export type RollbackResponse = {
	path: string
	release: ReleaseInfo
}

export type HealthResponse = {
	status: string
	buildVersion: string | null
	deployedAt: string | null
	timestamp: number
	uptime: number
}
