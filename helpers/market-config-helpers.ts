import { getAddress } from 'ethers/lib/utils';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import Bluebird from 'bluebird';
import {
  iParamsPerNetwork,
  eNetwork,
  PoolConfiguration,
  IBaseConfiguration,
  ITokenAddress,
  tEthereumAddress,
  ICommonConfiguration,
  SubTokenOutput,
  AssetType,
} from './types';
import { isValidAddress } from './utilities/utils';
import { ProtocolDataProvider } from '../types';
import {
  RSTOKEN_PREFIX,
  STABLE_DEBT_PREFIX,
  TREASURY_PROXY_ID,
  VARIABLE_DEBT_PREFIX,
  TESTNET_TOKEN_PREFIX,
  TESTNET_REWARD_TOKEN_PREFIX,
  TESTNET_PRICE_AGGR_PREFIX
} from './deploy-ids';
import { ZERO_ADDRESS } from './constants';
import { POOL_DATA_PROVIDER } from '.';
import { ENABLE_REWARDS } from './env';
import EthereumMarket from '../markets/eth';
import TestMarket from '../markets/test';

declare var hre: HardhatRuntimeEnvironment;

export enum ConfigNames {
  Commons = 'Commons',
  Test = 'Test',
  Ethereum = 'Ethereum'
}

export const getParamPerNetwork = <T>(
  param: iParamsPerNetwork<T> | undefined,
  network: eNetwork
): T | undefined => {
  if (!param) return undefined;

  return param[network];
};

export const getRequiredParamPerNetwork = <T>(
  poolConfig: PoolConfiguration,
  key: keyof PoolConfiguration,
  network: eNetwork
): T => {
  const mapNetworkToValue = poolConfig[key] as iParamsPerNetwork<T>;
  if (!mapNetworkToValue) throw `[config] missing required parameter ${key} at market config`;

  const value = mapNetworkToValue[network];
  if (!value) throw `[config] missing required value at ${key}.${network}`;

  return value;
};

export const getAddressFromConfig = (
  param: iParamsPerNetwork<string | undefined>,
  network: eNetwork,
  key?: string
): tEthereumAddress => {
  const value = getParamPerNetwork<tEthereumAddress | undefined>(param, network);
  if (!value || !isValidAddress(value)) {
    throw Error(
      `Input parameter ${key ? `"${key}"` : ''} is missing or is not an address.`
    );
  }
  return value;
};

export const loadPoolConfig = (configName: ConfigNames): PoolConfiguration => {
  switch (configName) {
    case ConfigNames.Ethereum:
      return EthereumMarket;
    case ConfigNames.Test:
      return TestMarket;
    default:
      throw new Error(
        `Unsupported pool configuration: ${configName} is not one of the supported configs ${Object.values(
          ConfigNames
        )}`
      );
  }
};

export const checkRequiredEnvironment = () => {
  if (!process.env.MARKET_NAME) {
    console.error(`Skipping Market deployment due missing "MARKET_NAME" environment variable.`);
    return true;
  }
  return false;
};

export const savePoolTokens = async (
  reservesConfig: ITokenAddress,
  dataProviderAddress: tEthereumAddress
) => {
  const dataProviderArtifact = await hre.deployments.get(POOL_DATA_PROVIDER);
  const dataProvider = (await hre.ethers.getContractAt(
    dataProviderArtifact.abi,
    dataProviderAddress
  )) as ProtocolDataProvider;

  const RSTokenArtifact = await hre.deployments.getExtendedArtifact('RSToken');
  const variableDebtTokenArtifact = await hre.deployments.getExtendedArtifact('VariableDebtToken');
  const stableDebtTokenArtifact = await hre.deployments.getExtendedArtifact('StableDebtToken');
  return Bluebird.each(Object.keys(reservesConfig), async (tokenSymbol) => {
    const { RSTokenAddress, variableDebtTokenAddress, stableDebtTokenAddress } =
      await dataProvider.getReserveTokensAddresses(reservesConfig[tokenSymbol]);

    await hre.deployments.save(`${tokenSymbol}${RSTOKEN_PREFIX}`, {
      address: RSTokenAddress,
      ...RSTokenArtifact,
    });
    await hre.deployments.save(`${tokenSymbol}${VARIABLE_DEBT_PREFIX}`, {
      address: variableDebtTokenAddress,
      ...variableDebtTokenArtifact,
    });
    await hre.deployments.save(`${tokenSymbol}${STABLE_DEBT_PREFIX}`, {
      address: stableDebtTokenAddress,
      ...stableDebtTokenArtifact,
    });
  });
};

export const getReserveAddresses = async (poolConfig: IBaseConfiguration, network: eNetwork) => {

  const isLive = hre.config.networks[network].live;

  if (isLive && !poolConfig.TestnetMarket) {
    console.log('[NOTICE] Using ReserveAssets from configuration file');

    return getParamPerNetwork<ITokenAddress>(poolConfig.ReserveAssets, network) || {};
  }
  console.log(
    '[WARNING] Using deployed Testnet tokens instead of ReserveAssets from configuration file'
  );
  const reservesKeys = Object.keys(poolConfig.ReservesConfig);
  const allDeployments = await hre.deployments.all();
  const testnetTokenKeys = Object.keys(allDeployments).filter(
    (key) =>
      key.includes(TESTNET_TOKEN_PREFIX) &&
      reservesKeys.includes(key.replace(TESTNET_TOKEN_PREFIX, ''))
  );
  return testnetTokenKeys.reduce<ITokenAddress>((acc, key) => {
    const symbol = key.replace(TESTNET_TOKEN_PREFIX, '');
    acc[symbol] = allDeployments[key].address;
    return acc;
  }, {});
    // console.log('[NOTICE] Using ReserveAssets from configuration file');
    // return getParamPerNetwork<ITokenAddress>(poolConfig.ReserveAssets, network) || {};
};

export const getSubTokensByPrefix = async (prefix: string): Promise<SubTokenOutput[]> => {
  const allDeployments = await hre.deployments.all();
  const tokenKeys = Object.keys(allDeployments).filter((key) => key.includes(prefix));

  if (!tokenKeys.length) {
    return [];
  }

  return tokenKeys.reduce<SubTokenOutput[]>((acc, key) => {
    acc.push({
      symbol: key.replace(prefix, ''),
      artifact: allDeployments[key],
    });
    return acc;
  }, []);
};

export const getSymbolsByPrefix = async (prefix: string): Promise<string[]> => {
  const allDeployments = await hre.deployments.all();
  const tokenKeys = Object.keys(allDeployments).filter((key) => key.includes(prefix));

  if (!tokenKeys.length) {
    return [];
  }

  return tokenKeys.reduce<string[]>((acc, key) => {
    acc.push(key.replace(prefix, ''));
    return acc;
  }, []);
};

export const getChainlinkOracles = async (poolConfig: PoolConfiguration, network: eNetwork) => {
  const isLive = hre.config.networks[network].live;
  if (isLive) {

    console.log('[NOTICE] Using PriceAggregator from configuration file');

    return getParamPerNetwork<ITokenAddress>(poolConfig.PriceAggregator, network) || {};
  }
  console.log(
    '[WARNING] Using deployed Mock Price Aggregators instead of PriceAggregator from configuration file'
  );
  let rewardKeys: string[] = [];

  if (isIncentivesEnabled(poolConfig)) {
    rewardKeys = await getSymbolsByPrefix(TESTNET_REWARD_TOKEN_PREFIX);
  }

  const reservesKeys = Object.keys(poolConfig.ReservesConfig);
  const allDeployments = await hre.deployments.all();
  const testnetKeys = Object.keys(allDeployments).filter(
    (key) =>
      key.includes(TESTNET_PRICE_AGGR_PREFIX) &&
      (reservesKeys.includes(key.replace(TESTNET_PRICE_AGGR_PREFIX, '')) ||
        rewardKeys.includes(key.replace(TESTNET_PRICE_AGGR_PREFIX, '')))
  );
  return testnetKeys.reduce<ITokenAddress>((acc, key) => {
    const symbol = key.replace(TESTNET_PRICE_AGGR_PREFIX, '');
    acc[symbol] = allDeployments[key].address;
    return acc;
  }, {});

};

export const getTreasuryAddress = async (
  poolConfig: IBaseConfiguration,
  network: eNetwork
): Promise<tEthereumAddress> => {
  const treasuryConfigAddress = getParamPerNetwork<string>(
    poolConfig.ReserveFactorTreasuryAddress,
    network
  );

  if (treasuryConfigAddress && getAddress(treasuryConfigAddress) !== getAddress(ZERO_ADDRESS)) {
    return treasuryConfigAddress;
  }

  console.log(
    '[WARNING] Using latest deployed Treasury proxy instead of ReserveFactorTreasuryAddress from configuration file'
  );

  const deployedTreasury = await hre.deployments.get(TREASURY_PROXY_ID);

  return deployedTreasury.address;
};

export const isProductionMarket = (poolConfig: ICommonConfiguration): boolean => {
  const network = hre.network.name as eNetwork;

  return hre.config.networks[network].live && !poolConfig.TestnetMarket;
};

export const isTestnetMarket = (poolConfig: ICommonConfiguration): boolean =>
  !isProductionMarket(poolConfig);

export const getReserveAddress = async (poolConfig: ICommonConfiguration, symbol: string) => {
  const network = hre.network.name as eNetwork;

  let assetAddress = poolConfig.ReserveAssets?.[network]?.[symbol];

  const isZeroOrNull = !assetAddress || assetAddress === ZERO_ADDRESS;

  if (!assetAddress || isZeroOrNull) {
    throw `Missing asset address for asset ${symbol}`;
  }

  return assetAddress;
};

export const getOracleByAsset = async (poolConfig: ICommonConfiguration, symbol: string) => {
  const network = hre.network.name as eNetwork;
  const oracleAddress = poolConfig.PriceAggregator[network]?.[symbol];

  if (!oracleAddress) {
    throw `Missing oracle address for ${symbol}`;
  }

  return oracleAddress;
};

export const isL2PoolSupported = (poolConfig: ICommonConfiguration) => {
  const network = hre.network.name as eNetwork;

  return !!getParamPerNetwork<boolean>(poolConfig.L2PoolEnabled, network);
};

export const getPrefixByAssetType = (assetType: AssetType) => {
  switch (assetType) {
    case AssetType.RSToken:
      return RSTOKEN_PREFIX;
    case AssetType.VariableDebtToken:
      return VARIABLE_DEBT_PREFIX;
    case AssetType.StableDebtToken:
      return STABLE_DEBT_PREFIX;
  }
};

export const isIncentivesEnabled = (poolConfig: ICommonConfiguration) => {
  const network = hre.network.name as eNetwork;

  if (ENABLE_REWARDS !== undefined) {
    return !!ENABLE_REWARDS;
  }

  return !!getParamPerNetwork(poolConfig.IncentivesConfig.enabled, network);
};
