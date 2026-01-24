# Deployment

## Prerequisites
- Ensure you are on the `master` branch with the desired changes committed.
- You must have access to the Dokku remote configured as `dokku`.

## Deploy
Run the deploy script from the repo root:

```
npm run deploy
```

This uses `./scripts/dokku-deploy.ts` and pushes to the Dokku remote. On success it outputs the app URL and writes deployment metadata to `.env.deploy`.

## Related tasks
- Update env vars without redeploy:
  - `npm run deploy-env`
  - `npm run deploy-env:no-restart` (no restart)
