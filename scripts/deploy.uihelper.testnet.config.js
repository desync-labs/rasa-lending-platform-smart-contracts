/** PM2 Config file */

/**
 * @deployment Deployment of UiPoolDataProvider UI helper
 * @description This config file allows to deploy UiPoolDataProvider contract at
 *              multiple networks and distributed in parallel processes.
 */

const commons = {
  script: 'npx',
  args: 'hardhat deploy-UiPoolDataProvider',
  restart_delay: 100000000000,
  autorestart: false,
};

module.exports = {
  apps: [
    // {
    //   name: 'optimism-testnet-ui-helper',
    //   env: {
    //     HARDHAT_NETWORK: 'optimism-testnet',
    //   },
    //   ...commons,
    // },
  ],
};
