---
name: rmatic
description: Programmatic game deployment and release management using the @vforsh/rmatic-client TypeScript library. Use when deploying game builds to staging environments, publishing releases to production platforms, managing release rollbacks, or checking deployment status. Triggers on requests involving game deployments, build versioning, release publishing (vk, web, steam platforms), or rollback operations. Focus on programmatic TypeScript/JavaScript usage, not CLI commands.
---

# rmatic Client

Programmatic interface for Release-o-matic game deployment system.

## Installation

```bash
npm install @vforsh/rmatic-client
```

## Client Setup

```typescript
import { createClient } from '@vforsh/rmatic-client'

const client = createClient({
  baseUrl: 'https://release-api.example.com', // required
  token: process.env.RMATIC_TOKEN,            // optional auth
  timeoutMs: 30000,                           // optional, default 30000
})
```

**Configuration priority:** Flags > Environment Variables > Config File
- `RMATIC_BASE_URL`, `RMATIC_TOKEN` - environment variables
- `~/.config/rmatic/config.json` - config file

## build_info.json

**Every deployed build MUST contain a `build_info.json` file in its root directory.** Deployments will fail without it.

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | Build version number (positive integer) |
| `builtAt` | `number` | Unix timestamp in milliseconds when build was created |
| `builtAtReadable` | `string` | Human-readable timestamp (e.g., "2024-03-20 12:00:00") |
| `gitCommitHash` | `string` | Full git commit SHA |
| `gitBranch` | `string` | Git branch name (e.g., "master", "develop") |

```json
{
  "version": 123,
  "builtAt": 1711003200000,
  "builtAtReadable": "2024-03-20 12:00:00",
  "gitCommitHash": "f51781c2767c36048cb8b175f5bd74ef5cde835b",
  "gitBranch": "master"
}
```

## API Methods

### Health Check

```typescript
const health = await client.health()
// { status: "ok", buildVersion: "1.2.3" | null, deployedAt: string | null, timestamp: number, uptime: number }
```

### Deployments (Staging)

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

### Pre/Post Deploy

```typescript
// Prepare deployment directory
const prep = await client.preDeploy({ game: 'my-game', env: 'staging', version: 43 })
// { newBuildVersion, newBuildDir, builds: number[] }

// ... upload files to prep.newBuildDir via rsync/scp ...

// Finalize deployment (updates 'latest' symlink)
const deployed = await client.postDeploy({ game: 'my-game', env: 'staging', version: 43 })
// { buildVersion, buildDir, buildDirAlias }
```

### Releases (Production)

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

### Publish

```typescript
const published = await client.publish({
  game: 'my-game',
  platform: 'vk',
  buildKey: 'master-123', // optional - uses latest master/main if omitted
})
// { path, release: ReleaseInfo }
```

### Rollback

```typescript
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
