/** PM2 Config file */

/**
 * @deployment Full RASA Lending testnet deployment in fork mode
 * @description This config file allows to deploy RASA Lending at
 *              multiple networks and distributed in parallel processes.
 */

const commons = {
  script: 'npm',
  restart_delay: 100000000000,
  autorestart: false,
  env: {
    SKIP_COMPILE: 'true',
  },
};

module.exports = {
  apps: [
    {
      name: 'eth-sepolia-testnet',
      args: 'run deploy:eth:sepolia',
      ...commons,
    },
  ],
};
