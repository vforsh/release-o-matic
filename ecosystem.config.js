const BUN_DIR = '/root/.bun/bin'
const BUN = `${BUN_DIR}/bun`

const HOST = `robowhale.ru`
const DEPLOY_DIR = `/var/www/html/papa-cherry-2/releases`

/**
 * @link https://pm2.keymetrics.io/docs/usage/deployment/
 */
module.exports = {
  name: 'release-o-matic',
  script: 'src/index.ts',
  interpreter: BUN,

  deploy: {
    production: {
      'user': 'root',
      'host': [HOST],
      'ref': 'origin/master',
      'repo': 'git@github.com:vforsh/release-o-matic.git',
      'path': DEPLOY_DIR,
      "pre-deploy-local": `scp .env.prod root@${HOST}:${DEPLOY_DIR}/source/.env`,
      'post-deploy': `${BUN} install && ${BUN_DIR}/pm2 startOrRestart ecosystem.config.js`,
    },
  },
}
