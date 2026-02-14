export const openApiDocument = {
        openapi: '3.1.0',
        info: {
                title: 'Release-o-matic API',
                version: '1.0.0',
                description:
                        'Operations for preparing, deploying, publishing, and rolling back game builds. All endpoints except /health may require a Bearer token when AUTH_REQUIRED is enabled.',
        },
        servers: [{ url: '/' }],
        tags: [
                { name: 'Health' },
                { name: 'Environment' },
                { name: 'Deployments' },
                { name: 'Releases' },
        ],
        components: {
                securitySchemes: {
                        bearerAuth: {
                                type: 'http',
                                scheme: 'bearer',
                                bearerFormat: 'token',
                        },
                },
                schemas: {
                        ErrorResponse: {
                                type: 'object',
                                properties: {
                                        message: { type: 'string' },
                                },
                        },
                        HealthResponse: {
                                type: 'object',
                                properties: {
                                        status: { type: 'string', example: 'ok' },
                                        buildVersion: { type: ['string', 'null'] },
                                        deployedAt: { type: ['string', 'null'] },
                                        timestamp: { type: 'integer' },
                                        uptime: { type: 'number' },
                                },
                                required: ['status', 'timestamp', 'uptime'],
                        },
                        Env: {
                                type: 'object',
                                properties: {
                                        BEARER_TOKEN: { type: 'string' },
                                        GAME_BUILDS_DIR: { type: 'string' },
                                        GAME_BUILDS_DIR_HOST: { type: 'string' },
                                        BUILD_VERSION: { type: 'string', nullable: true },
                                        DEPLOYED_AT: { type: 'string', nullable: true },
                                        AUTH_REQUIRED: { type: 'boolean' },
                                },
                        },
                        BuildInfo: {
                                type: 'object',
                                properties: {
                                        version: { type: 'integer' },
                                        builtAt: { type: 'integer' },
                                        builtAtReadable: { type: 'string' },
                                        gitCommitHash: { type: 'string' },
                                        gitBranch: { type: 'string' },
                                },
                                required: ['version', 'builtAt', 'builtAtReadable', 'gitCommitHash', 'gitBranch'],
                        },
                        DeployInfo: {
                                type: 'object',
                                properties: {
                                        version: { type: 'integer' },
                                        gitBranch: { type: 'string' },
                                        gitCommitHash: { type: 'string' },
                                        builtAt: { type: 'integer' },
                                        builtAtReadable: { type: 'string', nullable: true },
                                        deployedAt: { type: 'string' },
                                        isCurrent: { type: 'boolean', nullable: true },
                                },
                                required: ['version', 'gitBranch', 'gitCommitHash', 'builtAt', 'deployedAt'],
                        },
                        ReleaseInfo: {
                                type: 'object',
                                properties: {
                                        key: { type: 'string', description: 'Combination of environment and build version (e.g. master-12).' },
                                        index: { type: 'string' },
                                        files: { type: 'string' },
                                        releasedAt: { type: 'string' },
                                        builtAt: { type: 'string' },
                                        gitBranch: { type: 'string' },
                                        gitCommit: { type: 'string' },
                                },
                                required: ['key', 'index', 'files', 'releasedAt', 'builtAt', 'gitBranch', 'gitCommit'],
                        },
                        Releases: {
                                type: 'object',
                                properties: {
                                        current: { type: ['string', 'null'] },
                                        builds: { type: 'array', items: { $ref: '#/components/schemas/ReleaseInfo' } },
                                },
                                required: ['current', 'builds'],
                        },
                        PublishResponse: {
                                type: 'object',
                                properties: {
                                        path: { type: 'string' },
                                        release: { $ref: '#/components/schemas/ReleaseInfo' },
                                },
                                required: ['path', 'release'],
                        },
                        RollbackResponse: {
                                type: 'object',
                                properties: {
                                        path: { type: 'string' },
                                        release: { $ref: '#/components/schemas/ReleaseInfo' },
                                },
                                required: ['path', 'release'],
                        },
                        ReleaseWithFiles: {
                                allOf: [
                                        { $ref: '#/components/schemas/ReleaseInfo' },
                                        {
                                                type: 'object',
                                                properties: {
                                                        isCurrent: { type: 'boolean' },
                                                        filesList: { type: 'array', items: { type: 'string' } },
                                                },
                                                required: ['isCurrent', 'filesList'],
                                        },
                                ],
                        },
                        PreDeployResponse: {
                                type: 'object',
                                properties: {
                                        newBuildVersion: { type: 'integer' },
                                        newBuildDir: { type: 'string' },
                                        builds: { type: 'array', items: { type: 'integer' } },
                                },
                                required: ['newBuildVersion', 'newBuildDir', 'builds'],
                        },
                        PostDeployResponse: {
                                type: 'object',
                                properties: {
                                        buildVersion: { type: 'string' },
                                        buildDir: { type: 'string' },
                                        buildDirAlias: { type: 'string' },
                                },
                                required: ['buildVersion', 'buildDir', 'buildDirAlias'],
                        },
                },
        },
        security: [{ bearerAuth: [] }],
        paths: {
                '/health': {
                        get: {
                                tags: ['Health'],
                                summary: 'Readiness probe',
                                description: 'Returns process uptime and build metadata. Authentication is not required.',
                                security: [],
                                responses: {
                                        200: {
                                                description: 'Application is running',
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
                                tags: ['Environment'],
                                summary: 'Base directory',
                                description: 'Returns the configured GAME_BUILDS_DIR value.',
                                responses: {
                                        200: {
                                                description: 'Directory path',
                                                content: { 'text/plain': { schema: { type: 'string' } } },
                                        },
                                },
                        },
                },
                '/env': {
                        get: {
                                tags: ['Environment'],
                                summary: 'Environment configuration',
                                description: 'Returns resolved environment variables as seen by the service.',
                                responses: {
                                        200: {
                                                description: 'Configuration snapshot',
                                                content: {
                                                        'application/json': {
                                                                schema: { $ref: '#/components/schemas/Env' },
                                                        },
                                                },
                                        },
                                },
                        },
                },
                '/preDeploy/{game}/{env}/{version}': {
                        get: {
                                tags: ['Deployments'],
                                summary: 'Prepare a build for deployment',
                                description: 'Creates a new build directory, cloning the latest deployment as a starting point when available.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'env', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'version', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Directory prepared for upload',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/PreDeployResponse' } } },
                                        },
                                        400: {
                                                description: 'Invalid or duplicate version',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/postDeploy/{game}/{env}/{version}': {
                        get: {
                                tags: ['Deployments'],
                                summary: 'Finalize deployment',
                                description: 'Validates build artifacts, updates the latest symlink, and prunes old deployments.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'env', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'version', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Deployment promoted',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/PostDeployResponse' } } },
                                        },
                                        400: {
                                                description: 'Invalid build info',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                        404: {
                                                description: 'Missing build resources',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/deployments/{game}/{env}': {
                        get: {
                                tags: ['Deployments'],
                                summary: 'List deployments',
                                description: 'Returns deployment history for an environment, ordered from newest to oldest.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'env', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Deployments for the environment',
                                                content: {
                                                        'application/json': {
                                                                schema: {
                                                                        type: 'array',
                                                                        items: { $ref: '#/components/schemas/DeployInfo' },
                                                                },
                                                        },
                                                },
                                        },
                                        404: {
                                                description: 'Environment not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/deployments/{game}/{env}/current': {
                        get: {
                                tags: ['Deployments'],
                                summary: 'Current deployment',
                                description: 'Returns information about the build that the latest symlink points to.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'env', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Current deployment information',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/DeployInfo' } } },
                                        },
                                        404: {
                                                description: 'No current deployment',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                        500: {
                                                description: 'Failed to read current deployment',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/deployments/{game}/{env}/{version}': {
                        get: {
                                tags: ['Deployments'],
                                summary: 'Deployment details',
                                description: 'Returns deployment metadata for a specific build version.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'env', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'version', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Deployment metadata',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/DeployInfo' } } },
                                        },
                                        404: {
                                                description: 'Deployment not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                        500: {
                                                description: 'Error reading build info',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/releases/{game}/{platform}': {
                        get: {
                                tags: ['Releases'],
                                summary: 'List releases',
                                description: 'Returns all releases for a platform. Responds with an empty list if no releases are present.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Release list',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/Releases' } } },
                                        },
                                },
                        },
                },
                '/releases/{game}/{platform}/current': {
                        get: {
                                tags: ['Releases'],
                                summary: 'Current release',
                                description: 'Returns metadata for the current release of a platform.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Current release',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ReleaseInfo' } } },
                                        },
                                        404: {
                                                description: 'Platform or release not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/releases/{game}/{platform}/{buildKey}': {
                        get: {
                                tags: ['Releases'],
                                summary: 'Release details',
                                description: 'Returns metadata and file list for a specific release.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'buildKey', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Release metadata',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ReleaseWithFiles' } } },
                                        },
                                        404: {
                                                description: 'Release not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/publish/{game}/{platform}': {
                        get: {
                                tags: ['Releases'],
                                summary: 'Publish the latest build',
                                description: 'Promotes the latest build from the master/main branch to a release for the platform.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Release created',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/PublishResponse' } } },
                                        },
                                        400: {
                                                description: 'Build unavailable or already released',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                        404: {
                                                description: 'Build not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/publish/{game}/{platform}/{buildKey}': {
                        get: {
                                tags: ['Releases'],
                                summary: 'Publish a specific build',
                                description: 'Promotes the provided build key to a release for the platform.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'buildKey', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Release created',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/PublishResponse' } } },
                                        },
                                        400: {
                                                description: 'Build unavailable or already released',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                        404: {
                                                description: 'Build not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/rollback/{game}/{platform}': {
                        get: {
                                tags: ['Releases'],
                                summary: 'Rollback to the previous release',
                                description: 'Moves the current release pointer to the previous build for the platform.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Rollback applied',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/RollbackResponse' } } },
                                        },
                                        400: {
                                                description: 'Rollback unavailable',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                        404: {
                                                description: 'Release not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
                '/rollback/{game}/{platform}/{buildKey}': {
                        get: {
                                tags: ['Releases'],
                                summary: 'Rollback to a specific release',
                                description: 'Points the current release symlink to the provided build key.',
                                parameters: [
                                        { name: 'game', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'platform', in: 'path', required: true, schema: { type: 'string' } },
                                        { name: 'buildKey', in: 'path', required: true, schema: { type: 'string' } },
                                ],
                                responses: {
                                        200: {
                                                description: 'Rollback applied',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/RollbackResponse' } } },
                                        },
                                        400: {
                                                description: 'Rollback unavailable',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                        404: {
                                                description: 'Release not found',
                                                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
                                        },
                                },
                        },
                },
        },
} as const
