import { ConfigNames, loadPoolConfig } from '../../helpers/market-config-helpers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { COMMON_DEPLOY_PARAMS } from '../../helpers/env';
import { V3_PERIPHERY_VERSION } from '../../helpers/constants';
import { POOL_ADDRESSES_PROVIDER_ID, POOL_PROXY_ID } from '../../helpers/deploy-ids';
import { checkRequiredEnvironment as checkRequiredEnvironment } from '../../helpers/market-config-helpers';
import { eNetwork } from '../../helpers/types';
import { MARKET_NAME } from '../../helpers/env';

const func: DeployFunction = async function ({
  getNamedAccounts,
  deployments,
  ...hre
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const poolConfig = await loadPoolConfig(MARKET_NAME as ConfigNames);
  const network = hre.network.name as eNetwork;

  // Deploy Mock Flash Loan Receiver if testnet deployment
  if (!hre.config.networks[network].live || poolConfig.TestnetMarket) {
    await deploy('MockFlashLoanReceiver', {
      from: deployer,
      args: [await (await deployments.get(POOL_ADDRESSES_PROVIDER_ID)).address],
      ...COMMON_DEPLOY_PARAMS,
    });
  }

  return true;
};

// This script can only be run successfully once per market, core version, and network
func.id = `PeripheryInit:${MARKET_NAME}:rasa-lending@${V3_PERIPHERY_VERSION}`;

func.tags = ['market', 'init-periphery'];

func.dependencies = ['before-deploy', 'core', 'periphery-pre', 'provider', 'init-pool', 'oracles'];

func.skip = async () => checkRequiredEnvironment();

export default func;
