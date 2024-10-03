/** PM2 Config file */

/**
 * @deployment Full RASA Lending production in main mode
 * @description This config file allows to deploy RASA Lending at
 *              multiple networks and distributed in parallel processes.
 */

const commons = {
  script: 'npm',
  restart_delay: 100000000000,
  autorestart: false,
  env: {
    SKIP_COMPILE: 'true',
    DETERMINISTIC_DEPLOYMENT: 'false',
  },
};

module.exports = {
  apps: [
    {
      name: 'eth-main',
      args: 'run deploy:market:eth:main',
      ...commons,
    },
  ],
};
