import { task } from 'hardhat/config';
import { diff, formatters } from 'jsondiffpatch';

interface RSTokenConfig {
  revision: string;
  name: string;
  symbol: string;
  decimals: string;
  treasury: string;
  incentives: string;
  pool: string;
  underlying: string;
}

task(`upgrade-rstokens-and-review`)
  .addParam('revision')
  .setAction(async ({ revision }, { deployments, getNamedAccounts, ...hre }) => {
    const previousRSTokenConfigs: { [key: string]: RSTokenConfig } = await hre.run('review-rstokens', {
      log: true,
    });

    // Perform Action
    const tokensUpgraded = await hre.run('upgrade-rstokens', { revision });
    if (tokensUpgraded) {
    }

    const afterRSTokensConfig: { [key: string]: RSTokenConfig } = await hre.run('review-rstokens', {
      log: true,
    });

    // Checks
    const delta = diff(afterRSTokensConfig, previousRSTokenConfigs);
    if (delta) {
      console.log('=== Updated RSTokens, check new configuration differences ===');
      console.log(formatters.console.format(delta, afterRSTokensConfig));
    } else {
      console.log('- RSTokens are not upgraded, check logs, noop');
    }
  });
