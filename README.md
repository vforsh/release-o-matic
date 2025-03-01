## API Overview

This API provides endpoints for managing game deployments and releases:

### Deployment Management
- `/preDeploy/:game/:env/:version` - Prepares new build directory for deployment.
- `/postDeploy/:game/:env/:version` - Finalizes deployment, creates symlinks, and manages build info.
- `/deployments/:game/:env` - Lists all deployments for a specific game environment.
- `/deployments/:game/:env/:version` - Gets info about a specific deployment.

### Release Management
- `/publish/:game/:platform/:buildKey?` - Publishes a new build as a release.
- `/rollback/:game/:platform/:buildKey?` - Rolls back to a previous release.
- `/releases/:game/:platform` - Lists all releases for a game/platform.
- `/releases/:game/:platform/current` - Gets info about the current release.
- `/releases/:game/:platform/:buildKey` - Gets info about a specific release.

### Authentication
- Bearer token authentication can be enabled/disabled via environment variables.
- When enabled, all requests must include a valid bearer token.

### File Structure
- Stores each game build in its own directory with build info and assets.
- Manages releases through `releases.json` file and symlinks.
- Maintains deployment history and release states.


## How to Use

The deployment workflow consists of three main phases:

### 1. Deployment Phase
1. **Prepare for deployment**
   ```http
   GET /preDeploy/:game/:env/:version
   ```
   - Creates a new directory for your build
   - Returns the `newBuildDir` path for game files
   - Example: `/preDeploy/my-game/staging/42`

2. **Upload game files**
   - Copy game build files (index.html, assets, etc.) to the `newBuildDir`
   - Include `build_info.json` with version, git info, and build timestamp

3. **Finalize deployment**
   ```http
   GET /postDeploy/:game/:env/:version
   ```
   - Validates the deployment
   - Creates `latest` symlink
   - Manages old deployments cleanup
   - Example: `/postDeploy/my-game/staging/42`

### 2. Release Phase
1. **Publish the build**
   ```http
   GET /publish/:game/:platform/:buildKey
   ```
   - Publishes a deployed build as a release
   - Creates necessary symlinks and release info
   - Example: `/publish/my-game/facebook/staging-42`

2. **Verify the release**
   ```http
   GET /releases/:game/:platform/current
   ```
   - Confirms the current active release
   - Example: `/releases/my-game/facebook/current`

### 3. Rollback Phase
1. **Check available releases**
   ```http
   GET /releases/:game/:platform
   ```
   - Lists all available releases with their info
   - Shows release history for rollback selection
   - Example: `/releases/my-game/facebook`

2. **Perform rollback**
   ```http
   GET /rollback/:game/:platform/:buildKey
   ```
   - Reverts to a specific previous release
   - Updates the current release pointer
   - Updates necessary symlinks
   - Example: `/rollback/my-game/facebook/staging-41`
   
   Note: Omitting buildKey automatically rolls back to the previous release.

3. **Verify rollback**
   ```http
   GET /releases/:game/:platform/current
   ```
   - Confirms the active release after rollback
   - Example: `/releases/my-game/facebook/current`

### Additional Operations
- List all deployments: `GET /deployments/:game/:env`
- Check deployment details: `GET /deployments/:game/:env/:version`
- View release history: `GET /releases/:game/:platform`

### Important Notes
- Each deployment requires `build_info.json` and `index.html` files
- The system maintains complete deployment and release history
- Rollback operations are reversible
- Authentication requires a Bearer token when enabled


## API Deployment

This section describes how to deploy the API service itself.

Deployment is done with [PM2](https://pm2.keymetrics.io/docs/usage/deployment/).

You will need to install Bun and PM2 on the host machine. Refer to `package.json` for the Bun version used in the project.

Also, you will need to add SSH keys to host machine so it will be able to clone git repo with the project.

After that, you must run the following command to prepare the deployment:
```sh
pm2 deploy ecosystem.config.js production setup
```

Then you can deploy the app with the following command:
```sh
pm2 deploy ecosystem.config.js production
```


## Server Setup

You will need to set up a reverse proxy with your server software to forward requests to the port where the app is running.

I use Caddy as a web server, here is the section of my Caddyfile (by default it is located at `/etc/caddy/Caddyfile`):

```
your-domain.com {
	# Set this path to your site's directory.
	root * /var/www/html

	# ...more settings...

	# path relative to the root
	handle_path /papa-cherry-2/releases* {
		# notice that we have to specify the port here, use the same port as in the Bun server config
		reverse_proxy localhost:4000
	}
}
```


## Testing

Use `bun run test` instead of `bun test`. Because `bun test` uses the Bun test runner but we use `vitest` for the current project.