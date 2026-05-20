const path = require('path')
const root = __dirname

module.exports = {
  apps: [
    {
      name: 'runmob-api',
      script: path.join(root, 'node_modules/.bin/tsx'),
      args: path.join(root, 'apps/api/src/index.ts'),
      cwd: root,
      env_file: path.join(root, '.env'),
      env: { NODE_ENV: 'production', PORT: '3001' },
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
    },
    {
      name: 'runmob-scraper',
      script: path.join(root, 'node_modules/.bin/tsx'),
      args: path.join(root, 'apps/scraper/src/index.ts'),
      cwd: root,
      env_file: path.join(root, '.env'),
      env: { NODE_ENV: 'production' },
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 5,
    },
  ],
}
