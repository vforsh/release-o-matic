module.exports = {
  name: 'release-o-matic',
  script: 'src/index.ts',
  interpreter: 'bun',

  deploy: {
    production: {
      'user': 'root',
      'host': ['robowhale.ru'],
      'ref': 'origin/master',
      'repo': 'git@github.com:vforsh/release-o-matic.git',
      'path': '/var/www/html/papa-cherry-2/releases',
      'post-deploy': '/root/.bun/bin/bun install && /root/.bun/bin/pm2 startOrRestart ecosystem.config.js',
    },
  },
}
