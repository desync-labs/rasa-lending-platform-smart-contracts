import { ORACLE_ID } from '../../helpers/deploy-ids';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { V3_CORE_VERSION } from '../../helpers/constants';
import { waitForTx } from '../../helpers/utilities/tx';
import { PoolAddressesProvider } from '../../types';
import { POOL_ADDRESSES_PROVIDER_ID } from '../../helpers/deploy-ids';
import { getAddress } from '@ethersproject/address';
import { checkRequiredEnvironment } from '../../helpers/market-config-helpers';
import { MARKET_NAME } from '../../helpers/env';

const func: DeployFunction = async function ({
  getNamedAccounts,
  deployments,
  ...hre
}: HardhatRuntimeEnvironment) {
  const { deployer } = await getNamedAccounts();
  const addressesProviderArtifact = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressesProviderInstance = (
    await hre.ethers.getContractAt(addressesProviderArtifact.abi, addressesProviderArtifact.address)
  ).connect(await hre.ethers.getSigner(deployer)) as PoolAddressesProvider;

  // 1. Set price oracle
  const configPriceOracle = (await deployments.get(ORACLE_ID)).address;
  const statePriceOracle = await addressesProviderInstance.getPriceOracle();
  if (getAddress(configPriceOracle) === getAddress(statePriceOracle)) {
    console.log('[addresses-provider] Price oracle already set. Skipping tx.');
  } else {
    await waitForTx(await addressesProviderInstance.setPriceOracle(configPriceOracle));
    console.log(`[Deployment] Added PriceOracle ${configPriceOracle} to PoolAddressesProvider`);
  }

  return true;
};

// This script can only be run successfully once per market, core version, and network
func.id = `InitOracles:${MARKET_NAME}:rasa-lending@${V3_CORE_VERSION}`;

func.tags = ['market', 'oracles'];

func.dependencies = ['before-deploy', 'core', 'periphery-pre', 'provider'];

func.skip = async () => checkRequiredEnvironment();

export default func;
