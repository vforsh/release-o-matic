# @vforsh/rmatic-client

Node-only TypeScript client for the Release-o-matic API.

## Install

```
npm install @vforsh/rmatic-client
```

## Usage

```ts
import { createClient } from '@vforsh/rmatic-client'

const client = createClient({
	baseUrl: 'https://release-o-matic.example.com',
	token: process.env.RMATIC_TOKEN,
})

const health = await client.health()
const releases = await client.releases.list({ game: 'papa-cherry-2', platform: 'vk' })
```

## Configuration

- `baseUrl` (required)
- `token` (optional bearer token)
- `timeoutMs` (optional, default 30s)
- `fetch` (optional override for testing)
