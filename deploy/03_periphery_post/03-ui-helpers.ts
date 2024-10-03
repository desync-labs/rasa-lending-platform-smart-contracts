import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { COMMON_DEPLOY_PARAMS } from '../../helpers/env';
import { MARKET_NAME } from './../../helpers/env';
import { ZERO_ADDRESS, deployMockAggregator, eNetwork, loadPoolConfig } from '../../helpers';
import { parseUnits } from 'ethers/lib/utils';

const func: DeployFunction = async function ({
  getNamedAccounts,
  deployments,
  ...hre
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const network = hre.network.name as eNetwork;
  const { BaseTokenPriceInUsdProxyAggregator, UseMockedEACAggregatorProxy } = loadPoolConfig(MARKET_NAME);

  if (!UseMockedEACAggregatorProxy[network] && (
      BaseTokenPriceInUsdProxyAggregator[network] == ZERO_ADDRESS)) {
    console.log(
      '[Deployments] Skipping the deployment of UiPoolDataProvider due missing constant "oracleAggregatorProxy" configuration at ./helpers/constants.ts'
    );
    return;
  }
  // Deploy UiIncentiveDataProvider getter helper
  await deploy('UiIncentiveDataProviderV3', {
    from: deployer,
  });

  // Deploy UiPoolDataProvider getter helper
  if (UseMockedEACAggregatorProxy[network]) {
    const mockAgregator = await deployMockAggregator(parseUnits('1', 18).toString())
    await deploy('UiPoolDataProviderV3', {
      from: deployer,
      args: [mockAgregator.address],
      ...COMMON_DEPLOY_PARAMS,
    });
  } else {
    await deploy('UiPoolDataProviderV3', {
      from: deployer,
      args: [BaseTokenPriceInUsdProxyAggregator[network]],
      ...COMMON_DEPLOY_PARAMS,
    });
  }

};

func.tags = ['periphery-post', 'ui-helpers'];

export default func;
