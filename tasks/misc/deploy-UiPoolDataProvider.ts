import { deployContract } from './../../helpers/utilities/tx';
import { task } from 'hardhat/config';
import { loadPoolConfig, ConfigNames, getOracleByAsset } from '../../helpers/market-config-helpers';
import { MARKET_NAME } from '../../helpers/env';

task(`deploy-UiPoolDataProvider`, `Deploys the UiPoolDataProviderV3 contract`).setAction(
  async (_, hre) => {
    if (!hre.network.config.chainId) {
      throw new Error('INVALID_CHAIN_ID');
    }

    const poolConfig = await loadPoolConfig(MARKET_NAME as ConfigNames);
    const oralceAggregatorProxy = await getOracleByAsset(poolConfig, poolConfig.WrappedNativeTokenSymbol);

    console.log(
      `\n- UiPoolDataProviderV3 price aggregator: ${oralceAggregatorProxy}`
    );
  
    console.log(`\n- UiPoolDataProviderV3 deployment`);
    const artifact = await deployContract('UiPoolDataProviderV3', [
      oralceAggregatorProxy,
    ]);

    console.log('UiPoolDataProviderV3:', artifact.address);
    console.log('Network:', hre.network.name);
  }
);
