import { ZERO_ADDRESS } from "../../helpers";
import {
  IRASAConfiguration,
  eEthereumNetwork
} from "../../helpers/types";

import {
  strategyEURS,
  strategyRUSD,
  strategyWETH,
  strategyUSDT
} from "./reservesConfigs";
import {
  rateStrategyStableOne,
  rateStrategyStableTwo,
  rateStrategyVolatileOne,
} from "./rateStrategies";
// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const EthMarket: IRASAConfiguration = {
  MarketId: "Test Market",
  ProviderId: 50,
  OracleQuoteCurrency: "USD",
  OracleQuoteUnit: "18",
  WrappedNativeTokenSymbol: "WETH",
  OracleQuoteCurrencyAddress: ZERO_ADDRESS,
  TestnetMarket: true,
  ReservesConfig: {
    EURS: strategyEURS,
    RUSD: strategyRUSD,
    WETH: strategyWETH,
    USDT: strategyUSDT
  },
  ReserveAssets: {
    [eEthereumNetwork.sepolia]: {
      RUSD: '0x0000000000000000000000000000000000000000',
      EURS: '0x0000000000000000000000000000000000000000',
      WETH: '0x0000000000000000000000000000000000000000',
      USDT: '0x0000000000000000000000000000000000000000'
    },
    [eEthereumNetwork.hardhat]: {
      RUSD: '0x0000000000000000000000000000000000000000',
      EURS: '0x0000000000000000000000000000000000000000',
      WETH: '0x0000000000000000000000000000000000000000',
      USDT: '0x0000000000000000000000000000000000000000'
    },
  },
  StkRASAProxy: {},
  UseMockedEACAggregatorProxy: {
    [eEthereumNetwork.sepolia]: false,
    [eEthereumNetwork.hardhat]: false
  },
  BaseTokenPriceInUsdProxyAggregator: {
    [eEthereumNetwork.sepolia]: ZERO_ADDRESS,
    [eEthereumNetwork.hardhat]: '0x0000000000000000000000000000000000000000'
  },
  PriceAggregator: {
    [eEthereumNetwork.hardhat]: {
      RUSD: '0x0000000000000000000000000000000000000000',
      EURS: '0x0000000000000000000000000000000000000000',
      WETH: '0x0000000000000000000000000000000000000000',
      USDT: '0x0000000000000000000000000000000000000000'
    },
  },
  ReserveFactorTreasuryAddress: {
    [eEthereumNetwork.sepolia]: ZERO_ADDRESS,
    [eEthereumNetwork.hardhat]: ZERO_ADDRESS,
  },
  FallbackOracle: {
    [eEthereumNetwork.sepolia]: ZERO_ADDRESS,
    [eEthereumNetwork.hardhat]: ZERO_ADDRESS,
  },
  IncentivesConfig: {
    enabled: {},
    rewards: {
      [eEthereumNetwork.sepolia]: {
        StkRASA: ZERO_ADDRESS,
      },
      [eEthereumNetwork.hardhat]: {
        StkRASA: ZERO_ADDRESS,
      },
    },
    rewardsOracle: {
      [eEthereumNetwork.sepolia]: {
        StkRASA: ZERO_ADDRESS,
      },
      [eEthereumNetwork.hardhat]: {
        StkRASA: ZERO_ADDRESS,
      },
    },
    incentivesInput: {},
  },
  EModes: {
    StableEMode: {
      id: '1',
      ltv: '9800',
      liquidationThreshold: '9850',
      liquidationBonus: '10100',
      label: 'Stable-EMode',
      assets: ['EURS', 'RUSD'],
    },
  },
  L2PoolEnabled: {},
  FlashLoanPremiums: {
    total: 0.0005e4,
    protocol: 0.0004e4,
  },
  RateStrategies: {
    rateStrategyVolatileOne,
    rateStrategyStableOne,
    rateStrategyStableTwo,
  },
};

export default EthMarket;
