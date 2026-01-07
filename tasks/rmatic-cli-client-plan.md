# `rmatic` CLI + client library — implementation plan

This document defines the plan to add:

- A **CLI** (`rmatic`) that talks to the Release-o-matic HTTP API.
- A **Node-only TypeScript client library** usable from other projects so they don’t do raw HTTP requests.

Design is aligned with the CLI UX guidelines in [CLI Guidelines (condensed)](https://raw.githubusercontent.com/steipete/agent-scripts/refs/heads/main/skills/create-cli/references/cli-guidelines.md) (help, output, errors, configuration precedence, interactivity, composability).

## Context (current API)

The server already exposes (see `README.md`):

- `GET /health`
- `GET /publish/:game/:platform/:buildKey?`
- `GET /rollback/:game/:platform/:buildKey?`
- `GET /releases/:game/:platform`
- `GET /releases/:game/:platform/current`
- `GET /releases/:game/:platform/:buildKey`

Auth:

- If enabled, server requires `Authorization: Bearer <token>`.
- Base URL is **always configured client-side** (external service).

## Goals / non-goals

### Goals

- Provide an ergonomic **typed client** (Node 20+, ESM-only) with:
  - `createClient({ baseUrl, token })`
  - per-endpoint methods (`health`, `publish`, `rollback`, `releases.*`)
  - consistent errors (no leaking raw `fetch`/HTTP details)
- Provide a human-first **CLI** (`rmatic`) that is:
  - scriptable via `--plain` and `--json`
  - friendly in interactive terminals (examples-first help, confirmations for risky ops)
  - robust (early validation, actionable error messages, correct stdout/stderr split)
- Configuration precedence: **flags > env vars > config file**.

### Non-goals (for v1)

- No browser-compatible client (Node-only).
- No server changes required.
- No full-screen TUI.

## Packaging / repo layout (workspaces)

Convert repo to a small monorepo using workspaces (Bun + Node tooling compatible):

- `packages/client/`
  - npm package: **`@vforsh/rmatic-client`** (recommended)
  - exports: `createClient`, error types, response types
- `packages/cli/`
  - npm package: either **`rmatic`** (if available) or **`@vforsh/rmatic`**
  - `bin`: `rmatic`
  - depends on `@vforsh/rmatic-client`

Notes:

- ESM-only everywhere (per requirement: Node 20+, ESM yes, CJS no).
- Root package can remain the server (current `release-o-matic`) and be marked `"private": true` once workspaces are added.

## Configuration (flags > env > config file)

### Environment variables (confirmed)

- `RMATIC_BASE_URL` (e.g. `https://example.com`)
- `RMATIC_TOKEN` (bearer token)

### CLI flags (global)

- `--base-url <url>`: overrides `RMATIC_BASE_URL`
- `--token <token>`: overrides `RMATIC_TOKEN` (note: token via flags may leak in shell history; CLI should mention env/config alternatives)
- `--json`: machine-readable JSON output
- `--plain`: stable, line-oriented output (pipe-friendly)
- `-q, --quiet`: reduce non-essential output
- `-v, --verbose`: more progress/details (stderr)
- `--debug`: include stack traces / extra diagnostics (stderr)
- `--no-color`: disable color
- `--timeout <ms>`: request timeout (default e.g. 30s)
- `--no-input`: never prompt; if a prompt would be required, fail with an actionable error
- `-f, --force`: skip confirmations for risky actions (rollback)

### Config file

User-level config file (read-only, never modified unless explicitly implemented later):

- Path (XDG-first):
  - `$XDG_CONFIG_HOME/rmatic/config.json`, else
  - `~/.config/rmatic/config.json`

Example `config.json`:

```json
{
  "baseUrl": "https://release-o-matic.example.com",
  "token": "…"
}
```

Precedence is strictly:

1. Flags
2. Environment variables
3. Config file

## Client library (`@vforsh/rmatic-client`)

### Public API

Export:

- `createClient(options)`
  - `baseUrl: string`
  - `token?: string`
  - `timeoutMs?: number`
  - `fetch?: typeof fetch` (optional injection for testing)
- `RmaticError` (base)
- `RmaticConfigError` (bad baseUrl, missing required config, etc.)
- `RmaticHttpError` (non-2xx; includes `status`, `method`, `url`, and parsed `body` when JSON)
- `RmaticNetworkError` (DNS, connection, timeout)
- Types:
  - `ReleaseInfo` (mirror server type)
  - `ReleasesResponse` (`{ current: string|null; builds: ReleaseInfo[] }`)
  - `ReleaseWithFilesResponse` (release + `isCurrent` + `filesList`)
  - `PublishResponse` / `RollbackResponse`
  - `HealthResponse`

### Endpoint methods (v1)

- `health()`
- `publish({ game, platform, buildKey? })`
- `rollback({ game, platform, buildKey? })`
- `releases.list({ game, platform })`
- `releases.current({ game, platform })`
- `releases.get({ game, platform, buildKey })`

All methods should:

- Validate inputs early (guard clauses; avoid nesting).
- Build URL via `new URL(path, baseUrl)` to avoid double-slash bugs.
- Attach `Authorization` header only if a token is present.
- Parse JSON responses; on parse failure, surface a good error.

### Error handling contract

- Default behavior: **throw typed errors** (no `{ ok: false }` results) to keep call sites clean.
- No stack traces by default in consumer-facing surfaces; stack remains available via `error.cause` and in CLI `--debug`.
- `RmaticHttpError` should expose:
  - `status: number`
  - `body?: unknown` (best-effort parsed JSON)
  - `message` derived from server `{ message }` when available

### Retries / idempotency

- Default: **no retries** (publish/rollback change state; safe-by-default).
- Optional future: allow opt-in retries for `health` and `releases.*` only.

### Testing

- Unit tests for:
  - URL building, header behavior (token/no token)
  - error mapping (4xx/5xx/network/timeout)
- Integration-ish tests can reuse existing Hono `app.fetch` style by injecting a custom `fetch` that calls the app (no real network).

## CLI (`rmatic`)

### Command structure

Use subcommands (Git-like) with consistent global flags:

- `rmatic health`
- `rmatic publish <game> <platform> [buildKey]`
- `rmatic rollback <game> <platform> [buildKey]`
- `rmatic releases list <game> <platform>`
- `rmatic releases current <game> <platform>`
- `rmatic releases get <game> <platform> <buildKey>`

Help:

- `rmatic -h|--help`
- `rmatic help`
- `rmatic help <subcommand>`
- `rmatic <subcommand> --help`

### Output rules

Per guidelines:

- **stdout**: primary output (including `--plain` and `--json`)
- **stderr**: logs, progress, warnings, prompts, errors

Modes:

- Default (human): concise summaries + “next steps” when useful.
- `--plain`: stable, line-oriented output designed for piping.
  - Example: `releases list` prints one build key per line, newest first.
- `--json`: structured output; always valid JSON; no extra text on stdout.

Color:

- Use color only when stdout is a TTY.
- Respect `NO_COLOR`, `TERM=dumb`, and `--no-color`.

### Interactivity (rollback safety)

Rollback is state-changing and high-risk:

- If interactive (stdin is a TTY) and neither `--force` nor `--no-input`:
  - prompt for confirmation, showing:
    - current release (from `releases.current`)
    - target release (explicit buildKey, or the computed “previous” best-effort by inspecting `releases.list`)
- If `--no-input` and confirmation would be required:
  - exit non-zero with an actionable message: “pass `--force` to proceed non-interactively”

Publish:

- No prompt by default (server already prevents republishing same build key).

### Exit codes

Keep a small, stable set:

- `0`: success
- `1`: generic error / unexpected failure
- `2`: usage/config error (missing base URL, invalid args)
- `3`: auth error (401/403)
- `4`: not found (404)
- `5`: conflict / invalid state (400 where it represents “already released/current release”)
- `6`: network/timeout

### Examples (help-first)

Each command help should start with examples, e.g.:

- `rmatic --base-url https://… --token $RMATIC_TOKEN health`
- `rmatic publish papa-cherry-2 vk master-21`
- `rmatic releases list papa-cherry-2 vk --plain`
- `rmatic rollback papa-cherry-2 vk --force`

### Implementation details

- Use a real CLI parsing library (recommendation: `cac` or `commander`), ensuring:
  - consistent global flags shared across subcommands
  - correct `--help` behavior
  - nice error messages on missing args
- Use the client library internally; CLI should not do raw HTTP.
- Guard clauses (“return early”) in command handlers to reduce nesting.

### Testing

- CLI unit tests for:
  - argument parsing and config precedence
  - `--json` and `--plain` output stability (snapshots)
  - non-interactive behavior with `--no-input`
- Integration tests can stub the client or inject a fake `fetch` into the client.

## Implementation steps (phased)

### Phase 0 — skeleton & tooling

- Add workspaces + `packages/cli`, `packages/client`.
- Decide final npm names:
  - prefer `rmatic` for CLI if available; otherwise `@vforsh/rmatic`.
  - client: `@vforsh/rmatic-client`.
- Add TypeScript configs per-package (ESM).

### Phase 1 — client library

- Implement `createClient` + typed endpoint wrappers.
- Implement typed error classes + mapping from `fetch` errors and HTTP responses.
- Add tests.

### Phase 2 — CLI

- Implement command tree + global flags + config loader (flags/env/config file).
- Implement output modes (`--plain`, `--json`) and stdout/stderr discipline.
- Implement rollback confirmation flow with `--force` / `--no-input`.
- Add CLI tests.

### Phase 3 — docs & publishing

- Add README docs for:
  - installing CLI and client
  - config file and env vars
  - example workflows (publish / releases / rollback / health)
- Add release scripts (per-package) for publishing from this repo:
  - `npm publish --access public` (scoped packages)
  - ensure `files` field and `exports` are correct

## Decisions (confirmed)

- CLI npm package name: **prefer `rmatic`** if available; otherwise use **`@vforsh/rmatic`**.
- Default timeout: **30s**.
- `releases list --plain`: prints **only release keys**, one per line (newest first).

