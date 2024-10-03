import { getRSToken, getPoolAddressesProvider } from '../../helpers/contract-getters';
import { POOL_ADDRESSES_PROVIDER_ID } from '../../helpers/deploy-ids';
import { getAddressFromJson } from '../../helpers/utilities/tx';
import { getProtocolDataProvider } from '../../helpers/contract-getters';
import { task } from 'hardhat/config';
import { FORK } from '../../helpers/hardhat-config-helpers';

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

task(`review-rstokens`)
  .addFlag('log')
  .setAction(async ({ log }, { deployments, getNamedAccounts, ...hre }) => {
    console.log('start review');
    const network = FORK ? FORK : hre.network.name;

    const poolAddressesProvider = await getPoolAddressesProvider(
      await getAddressFromJson(network, POOL_ADDRESSES_PROVIDER_ID)
    );

    const protocolDataProvider = await getProtocolDataProvider(
      await poolAddressesProvider.getPoolDataProvider()
    );

    const reserves = await protocolDataProvider.getAllRSTokens();

    const RSTokenConfigs: { [key: string]: RSTokenConfig } = {};
    for (let x = 0; x < reserves.length; x++) {
      const [symbol, asset] = reserves[x];

      const RSToken = await getRSToken(asset);

      RSTokenConfigs[symbol] = {
        name: await RSToken.name(),
        symbol: await RSToken.symbol(),
        decimals: (await RSToken.decimals()).toString(),
        revision: (await RSToken.RSTOKEN_REVISION()).toString(),
        treasury: await RSToken.RESERVE_TREASURY_ADDRESS(),
        incentives: await RSToken.getIncentivesController(),
        underlying: await RSToken.UNDERLYING_ASSET_ADDRESS(),
        pool: await RSToken.POOL(),
      };
    }
    if (log) {
      console.log('RSTokens Config:');
      console.table(RSTokenConfigs);
    }
    return RSTokenConfigs;
  });
