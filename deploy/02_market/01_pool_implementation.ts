import { DeployFunction } from 'hardhat-deploy/types';
import { COMMON_DEPLOY_PARAMS } from '../../helpers/env';
import { POOL_ADDRESSES_PROVIDER_ID, POOL_IMPL_ID } from '../../helpers/deploy-ids';
import { MARKET_NAME } from '../../helpers/env';
import {
  ConfigNames,
  eNetwork,
  getPool,
  getPoolLibraries,
  loadPoolConfig,
  waitForTx,
} from '../../helpers';

const func: DeployFunction = async function ({
  getNamedAccounts,
  deployments,
  ...hre
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const poolConfig = await loadPoolConfig(MARKET_NAME as ConfigNames);
  const network = hre.network.name as eNetwork;

  const { address: addressesProviderAddress } = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const commonLibraries = await getPoolLibraries();

  // Deploy common Pool contract
  const poolArtifact = await deploy(POOL_IMPL_ID, {
    contract: 'Pool',
    from: deployer,
    args: [addressesProviderAddress],
    libraries: {
      ...commonLibraries,
    },
    ...COMMON_DEPLOY_PARAMS,
  });

  // Initialize implementation
  const pool = await getPool(poolArtifact.address);
  await waitForTx(await pool.initialize(addressesProviderAddress));
  console.log('Initialized Pool Implementation');
};

func.id = 'PoolImplementation';
func.tags = ['market'];

export default func;
