import { ZERO_ADDRESS } from "../../helpers";
import {
  IRASAConfiguration,
  eEthereumNetwork
} from "../../helpers/types";

import {
  strategyWETH,
  strategyLSK,
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

export const EthereumMarket: IRASAConfiguration = {
  MarketId: "Ethereum Market",
  ProviderId: 50,
  OracleQuoteCurrency: "USD",
  OracleQuoteUnit: "18",
  WrappedNativeTokenSymbol: "WETH",
  OracleQuoteCurrencyAddress: ZERO_ADDRESS,
  TestnetMarket: false,
  ReservesConfig: {
    WETH: strategyWETH,
    LSK: strategyLSK,
    USDT: strategyUSDT
  },
  ReserveAssets: {
    [eEthereumNetwork.lisk]: {
      WETH: '0x4200000000000000000000000000000000000006',
      LSK: '0xac485391EB2d7D88253a7F1eF18C37f4242D1A24',
      USDT: '0x05D032ac25d322df992303dCa074EE7392C117b9'
    }
  },
  StkRASAProxy: {},
  UseMockedEACAggregatorProxy: {
    [eEthereumNetwork.lisk]: false,
  },
  BaseTokenPriceInUsdProxyAggregator: {
    [eEthereumNetwork.lisk]: '0xE4Fbc2b3fE1553FF9b8159C7522f328eCF828F32',
  },
  PriceAggregator: {
    [eEthereumNetwork.lisk]: {
      WETH: '0xE4Fbc2b3fE1553FF9b8159C7522f328eCF828F32',
      LSK: '0x7542c75242494947Db0B5ccd48051284808a01d6',
      USDT: '0x544609AE882AEdbf65b529b18AFbf2866E4A1acF'
    },
  },
  ReserveFactorTreasuryAddress: {
    [eEthereumNetwork.lisk]: ZERO_ADDRESS,
  },
  FallbackOracle: {
    [eEthereumNetwork.lisk]: ZERO_ADDRESS,
  },
  IncentivesConfig: {
    enabled: {},
    rewards: {
      [eEthereumNetwork.lisk]: {
        StkRASA: ZERO_ADDRESS,
      },
    },
    rewardsOracle: {
      [eEthereumNetwork.lisk]: {
        StkRASA: ZERO_ADDRESS,
      }
    },
    incentivesInput: {},
  },
  EModes: {
    StableEMode: {
      id: "1",
      ltv: "9700",
      liquidationThreshold: "9750",
      liquidationBonus: "10100",
      label: "Stablecoins",
      assets: ['USDT']
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

export default EthereumMarket;
