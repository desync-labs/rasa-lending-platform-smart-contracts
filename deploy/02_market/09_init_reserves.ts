import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { V3_CORE_VERSION } from '../../helpers/constants';
import {
  checkRequiredEnvironment,
  ConfigNames,
  getReserveAddresses,
  getTreasuryAddress,
  loadPoolConfig,
  savePoolTokens,
} from '../../helpers/market-config-helpers';
import { eNetwork, IRASAConfiguration } from '../../helpers/types';
import { configureReservesByHelper, initReservesByHelper } from '../../helpers/init-helpers';
import { POOL_ADDRESSES_PROVIDER_ID, POOL_DATA_PROVIDER } from '../../helpers/deploy-ids';
import { MARKET_NAME } from '../../helpers/env';

const func: DeployFunction = async function ({
  getNamedAccounts,
  deployments,
  ...hre
}: HardhatRuntimeEnvironment) {
  const network = hre.network.name as eNetwork;
  const { deployer } = await getNamedAccounts();

  const poolConfig = (await loadPoolConfig(MARKET_NAME as ConfigNames)) as IRASAConfiguration;

  const addressProviderArtifact = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const {
    ReservesConfig,
    RateStrategies,
  } = poolConfig;

  // Deploy Rate Strategies
  for (const strategy in RateStrategies) {
    const strategyData = RateStrategies[strategy];
    const args = [
      addressProviderArtifact.address,
      strategyData.optimalUsageRatio,
      strategyData.baseVariableBorrowRate,
      strategyData.variableRateSlope1,
      strategyData.variableRateSlope2,
      strategyData.stableRateSlope1,
      strategyData.stableRateSlope2,
      strategyData.baseStableRateOffset,
      strategyData.stableRateExcessOffset,
      strategyData.optimalStableToTotalDebtRatio,
    ];
    await deployments.deploy(`ReserveStrategy-${strategyData.name}`, {
      from: deployer,
      args: args,
      contract: 'DefaultReserveInterestRateStrategy',
      log: true,
    });
  }

  // Deploy Reserves RSTokens

  const treasuryAddress = await getTreasuryAddress(poolConfig, network);
  const incentivesController = await deployments.get('IncentivesProxy');
  const reservesAddresses = await getReserveAddresses(poolConfig, network);

  if (Object.keys(reservesAddresses).length == 0) {
    console.warn('[WARNING] Skipping initialization. Empty asset list.');
    return;
  }

  await initReservesByHelper(
    ReservesConfig,
    reservesAddresses,
    deployer,
    treasuryAddress,
    incentivesController.address
  );
  deployments.log(`[Deployment] Initialized all reserves`);

  await configureReservesByHelper(ReservesConfig, reservesAddresses);

  // Save RSToken and Debt tokens artifacts
  const dataProvider = await deployments.get(POOL_DATA_PROVIDER);
  await savePoolTokens(reservesAddresses, dataProvider.address);

  deployments.log(`[Deployment] Configured all reserves`);
  return true;
};

// This script can only be run successfully once per market, core version, and network
func.id = `ReservesInit:${MARKET_NAME}:rasa-lending@${V3_CORE_VERSION}`;

func.tags = ['market', 'init-reserves'];
func.dependencies = ['before-deploy', 'core', 'periphery-pre', 'provider', 'init-pool', 'oracles'];

func.skip = async () => checkRequiredEnvironment();

export default func;
