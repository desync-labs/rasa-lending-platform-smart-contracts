require("@nomicfoundation/hardhat-toolbox");

import { eNetwork } from '../../helpers/types';
import { MARKET_NAME } from '../../helpers/env';
import { getIncentivesV2, getProtocolDataProvider, getRASAOracle } from '../../helpers/contract-getters';
import { loadPoolConfig, getReserveAddresses, getParamPerNetwork, savePoolTokens, getChainlinkOracles } from '../../helpers/market-config-helpers';
import { initReservesByHelper, configureReservesByHelper, getPairsTokenAggregator } from '../../helpers/init-helpers';

import { task } from 'hardhat/config';

task(`add-reserves`, `Add new reserves from the ReservesConfig`).setAction(async (_, hre) => {
      const network = hre.network.name as eNetwork;

      const { poolAdmin } = await hre.getNamedAccounts();
      const poolConfig = loadPoolConfig(MARKET_NAME);

      const incentivesController = await getIncentivesV2();
      const dataProvider = await getProtocolDataProvider();
      const rasaOracle = await getRASAOracle();
      const treasuryAddress = getParamPerNetwork(poolConfig.ReserveFactorTreasuryAddress, network)!;
      const reservesAddresses = await getReserveAddresses(poolConfig, network);

      await initReservesByHelper(
        poolConfig.ReservesConfig,
        reservesAddresses,
        poolAdmin,
        treasuryAddress,
        incentivesController.address
      );

      console.log(`[add-reserves] Initialized all reserves`);

      await configureReservesByHelper(poolConfig.ReservesConfig, reservesAddresses);

      const reserveAssets = await getReserveAddresses(poolConfig, network);
      const oracleAggregators = await getChainlinkOracles(poolConfig, network);
    
      const [assets, sources] = getPairsTokenAggregator(reserveAssets, oracleAggregators);

      // todo: add only new reserves
      await rasaOracle.setAssetSources(assets, sources);

      // Save RSToken and Debt tokens artifacts
      await savePoolTokens(reservesAddresses, dataProvider.address);

      console.log(`[add-reserves] Configured all reserves`);
  });