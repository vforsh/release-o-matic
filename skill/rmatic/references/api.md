# rmatic API Reference

## Health Check

```typescript
const health = await client.health()
// { status: "ok", buildVersion: "1.2.3" | null, deployedAt: string | null, timestamp: number, uptime: number }
```

## Deployments (Staging)

```typescript
// List all deployments (newest first)
const deployments = await client.deployments.list({ game: 'my-game', env: 'staging' })
// DeployInfo[] - { version, gitBranch, gitCommitHash, builtAt, builtAtReadable?, deployedAt }

// Get current active deployment
const current = await client.deployments.current({ game: 'my-game', env: 'staging' })

// Get specific deployment
const detail = await client.deployments.get({ game: 'my-game', env: 'staging', version: 42 })
// DeploymentDetail - includes isCurrent: boolean
```

## Pre/Post Deploy

```typescript
// Prepare deployment directory
const prep = await client.preDeploy({ game: 'my-game', env: 'staging', version: 43 })
// { newBuildVersion, newBuildDir, builds: number[] }

// ... upload files to prep.newBuildDir via rsync/scp ...

// Finalize deployment (updates 'latest' symlink)
const deployed = await client.postDeploy({ game: 'my-game', env: 'staging', version: 43 })
// { buildVersion, buildDir, buildDirAlias }
```

## Releases (Production)

```typescript
// List all releases for a platform
const releases = await client.releases.list({ game: 'my-game', platform: 'vk' })
// { current: string | null, builds: ReleaseInfo[] }

// Get current release
const current = await client.releases.current({ game: 'my-game', platform: 'vk' })
// ReleaseInfo - { key, index, files, releasedAt, builtAt, gitBranch, gitCommit }

// Get specific release with file list
const release = await client.releases.get({ game: 'my-game', platform: 'vk', buildKey: 'master-123' })
// ReleaseWithFilesResponse - includes isCurrent, filesList[]
```

## Publish & Rollback

```typescript
const published = await client.publish({
  game: 'my-game',
  platform: 'vk',
  buildKey: 'master-123', // optional - uses latest master/main if omitted
})
// { path, release: ReleaseInfo }

const rolledback = await client.rollback({
  game: 'my-game',
  platform: 'vk',
  buildKey: 'master-120', // optional - uses most recent previous if omitted
})
// { path, release: ReleaseInfo }
```

## Error Handling

```typescript
import {
  RmaticError,        // base error
  RmaticConfigError,  // invalid config (missing baseUrl, etc.)
  RmaticHttpError,    // HTTP errors (status, method, url, body)
  RmaticNetworkError, // network/timeout errors (kind: 'network' | 'timeout')
} from '@vforsh/rmatic-client'

try {
  await client.publish({ game: 'my-game', platform: 'vk' })
} catch (error) {
  if (error instanceof RmaticHttpError) {
    console.error(`API Error ${error.status}: ${error.message}`, error.body)
  } else if (error instanceof RmaticNetworkError) {
    console.error(error.kind === 'timeout' ? 'Request timed out' : 'Network error')
  }
}
```

Common status codes: 400 (bad request/already released), 401/403 (auth), 404 (not found), 500 (server error)

## Type Exports

```typescript
import type {
  DeployInfo,
  DeploymentDetail,
  HealthResponse,
  PostDeployResponse,
  PreDeployResponse,
  PublishResponse,
  ReleaseInfo,
  ReleaseWithFilesResponse,
  ReleasesResponse,
  RollbackResponse,
} from '@vforsh/rmatic-client'
```

## Directory Structure

```
GAME_BUILDS_DIR/
├── {game}/
│   ├── {env}/                    # staging, develop
│   │   ├── 1/
│   │   │   ├── build_info.json   # REQUIRED
│   │   │   └── ...
│   │   ├── latest -> 1/          # symlink to current
│   └── prod/{platform}/          # vk, web, steam
│       ├── index.html            # symlink to current
│       ├── index_{buildKey}.html
│       ├── files_{buildKey}.json
│       └── releases.json
```

Build keys format: `{branch}-{version}` (e.g., `master-123`)
