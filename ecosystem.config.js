module.exports = {
  name: 'release-o-matic',
  script: 'src/index.ts',
  interpreter: 'bun',

  deploy: {
    production: {
      'user': 'root',
      'host': ['robowhale.co'],
      'ref': 'origin/master',
      'repo': 'git@github.com:vforsh/release-o-matic.git',
      'path': '/var/www/html/papa-cherry-2/releases',
      'post-setup': '/root/.bun/bin/bun install',
      'post-deploy': 'chsh -s /usr/bin/bash; pm2 startOrRestart ecosystem.config.js;',
    },
  },
}
