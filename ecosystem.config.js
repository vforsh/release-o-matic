const BUN_DIR = '/root/.bun/bin'
const BUN = `${BUN_DIR}/bun`

module.exports = {
  name: 'release-o-matic',
  script: 'src/index.ts',
  interpreter: BUN,

  deploy: {
    production: {
      'user': 'root',
      'host': ['robowhale.ru'],
      'ref': 'origin/master',
      'repo': 'git@github.com:vforsh/release-o-matic.git',
      'path': '/var/www/html/papa-cherry-2/releases',
      'post-deploy': `${BUN} install && ${BUN_DIR}/pm2 startOrRestart ecosystem.config.js`,
    },
  },
}
