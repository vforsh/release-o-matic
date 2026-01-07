# rmatic CLI

CLI for the Release-o-matic API.

## Install

```
npm install -g @vforsh/rmatic
```

## Configuration

Config precedence: flags > env vars > config file.

- `RMATIC_BASE_URL`
- `RMATIC_TOKEN`

Config file (read-only):

```
$XDG_CONFIG_HOME/rmatic/config.json
# or ~/.config/rmatic/config.json
```

Example:

```json
{
	"baseUrl": "https://release-o-matic.example.com",
	"token": "..."
}
```

## Usage

```
rmatic --base-url https://… --token $RMATIC_TOKEN health
rmatic init --interactive
rmatic publish papa-cherry-2 vk master-21
rmatic releases list papa-cherry-2 vk --plain
rmatic rollback papa-cherry-2 vk --force
rmatic deploy pre papa-cherry-2 staging 42
rmatic deploy post papa-cherry-2 staging 42
rmatic deployments list papa-cherry-2 staging
```
