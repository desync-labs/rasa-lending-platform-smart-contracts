import {
  eContractid,
  IRASAConfiguration,
  iMultiPoolsAssets,
  IReserveParams,
  tEthereumAddress,
} from './types';
import { BigNumberish } from 'ethers';
import {
  ACL_MANAGER_ID,
  RSTOKEN_IMPL_ID,
  DELEGATION_AWARE_RSTOKEN_IMPL_ID,
  L2_POOL_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_CONFIGURATOR_IMPL_ID,
  POOL_CONFIGURATOR_PROXY_ID,
  POOL_DATA_PROVIDER,
  POOL_IMPL_ID,
  RESERVES_SETUP_HELPER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from './deploy-ids';
import { chunk, isValidAddress } from './utilities/utils';
import { waitForTx } from './utilities/tx';
import {
  ProtocolDataProvider,
  ACLManager,
  Pool,
  PoolAddressesProvider,
  PoolAddressesProviderRegistry,
  PoolConfigurator,
} from '../types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { MARKET_NAME } from './env';
import { ConfigNames, isL2PoolSupported, loadPoolConfig } from './market-config-helpers';
import { ZERO_ADDRESS } from './constants';

declare var hre: HardhatRuntimeEnvironment;

export const initReservesByHelper = async (
  reservesParams: iMultiPoolsAssets<IReserveParams>,
  tokenAddresses: { [symbol: string]: tEthereumAddress },
  admin: tEthereumAddress,
  treasuryAddress: tEthereumAddress,
  incentivesController: tEthereumAddress
) => {
  const poolConfig = (await loadPoolConfig(MARKET_NAME as ConfigNames)) as IRASAConfiguration;
  const addressProviderArtifact = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = (
    await hre.ethers.getContractAt(addressProviderArtifact.abi, addressProviderArtifact.address)
  ).connect(await hre.ethers.getSigner(admin)) as PoolAddressesProvider;

  const poolArtifact = await hre.deployments.get(
    isL2PoolSupported(poolConfig) ? L2_POOL_IMPL_ID : POOL_IMPL_ID
  );
  const pool = (await hre.ethers.getContractAt(
    poolArtifact.abi,
    await addressProvider.getPool()
  )) as any as Pool;

  // CHUNK CONFIGURATION
  const initChunks = 3;

  // Initialize variables for future reserves initialization
  let reserveTokens: string[] = [];
  let reserveInitDecimals: string[] = [];
  let reserveSymbols: string[] = [];

  let initInputParams: {
    RSTokenImpl: string;
    stableDebtTokenImpl: string;
    variableDebtTokenImpl: string;
    underlyingAssetDecimals: BigNumberish;
    interestRateStrategyAddress: string;
    underlyingAsset: string;
    treasury: string;
    incentivesController: string;
    underlyingAssetName: string;
    RSTokenName: string;
    RSTokenSymbol: string;
    variableDebtTokenName: string;
    variableDebtTokenSymbol: string;
    stableDebtTokenName: string;
    stableDebtTokenSymbol: string;
    params: string;
  }[] = [];

  let strategyAddresses: Record<string, tEthereumAddress> = {};
  let strategyAddressPerAsset: Record<string, string> = {};
  let RSTokenType: Record<string, string> = {};
  let delegationAwareRSTokenImplementationAddress = '';
  let RSTokenImplementationAddress = '';
  let stableDebtTokenImplementationAddress = '';
  let variableDebtTokenImplementationAddress = '';

  stableDebtTokenImplementationAddress = (await hre.deployments.get(STABLE_DEBT_TOKEN_IMPL_ID))
    .address;
  variableDebtTokenImplementationAddress = await (
    await hre.deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID)
  ).address;

  RSTokenImplementationAddress = (await hre.deployments.get(RSTOKEN_IMPL_ID)).address;

  const delegatedAwareReserves = Object.entries(reservesParams).filter(
    ([_, { RSTokenImpl }]) => RSTokenImpl === eContractid.DelegationAwareRSToken
  ) as [string, IReserveParams][];

  if (delegatedAwareReserves.length > 0) {
    delegationAwareRSTokenImplementationAddress = (
      await hre.deployments.get(DELEGATION_AWARE_RSTOKEN_IMPL_ID)
    ).address;
  }

  const reserves = Object.entries(reservesParams).filter(
    ([_, { RSTokenImpl }]) =>
      RSTokenImpl === eContractid.DelegationAwareRSToken || RSTokenImpl === eContractid.RSToken
  ) as [string, IReserveParams][];

  for (let [symbol, params] of reserves) {
    if (!tokenAddresses[symbol]) {
      console.log(`- Skipping init of ${symbol} due token address is not set at markets config`);
      continue;
    }
    const poolReserve = await pool.getReserveData(tokenAddresses[symbol]);
    if (poolReserve.RSTokenAddress !== ZERO_ADDRESS) {
      console.log(`- Skipping init of ${symbol} due is already initialized`);
      continue;
    }
    const { strategy, RSTokenImpl, reserveDecimals } = params;
    if (!strategyAddresses[strategy.name]) {
      // Strategy does not exist, load it
      strategyAddresses[strategy.name] = (
        await hre.deployments.get(`ReserveStrategy-${strategy.name}`)
      ).address;
    }
    strategyAddressPerAsset[symbol] = strategyAddresses[strategy.name];
    console.log('Strategy address for asset %s: %s', symbol, strategyAddressPerAsset[symbol]);

    if (RSTokenImpl === eContractid.RSToken) {
      RSTokenType[symbol] = 'generic';
    } else if (RSTokenImpl === eContractid.DelegationAwareRSToken) {
      RSTokenType[symbol] = 'delegation aware';
    }

    reserveInitDecimals.push(reserveDecimals);
    reserveTokens.push(tokenAddresses[symbol]);
    reserveSymbols.push(symbol);
  }

  for (let i = 0; i < reserveSymbols.length; i++) {
    let RSTokenToUse: string;
    if (RSTokenType[reserveSymbols[i]] === 'generic') {
      RSTokenToUse = RSTokenImplementationAddress;
    } else {
      RSTokenToUse = delegationAwareRSTokenImplementationAddress;
    }

    initInputParams.push({
      RSTokenImpl: RSTokenToUse,
      stableDebtTokenImpl: stableDebtTokenImplementationAddress,
      variableDebtTokenImpl: variableDebtTokenImplementationAddress,
      underlyingAssetDecimals: reserveInitDecimals[i],
      interestRateStrategyAddress: strategyAddressPerAsset[reserveSymbols[i]],
      underlyingAsset: reserveTokens[i],
      treasury: treasuryAddress,
      incentivesController,
      underlyingAssetName: reserveSymbols[i],
      RSTokenName: `RASA ${reserveSymbols[i]}`,
      RSTokenSymbol: `RS${reserveSymbols[i]}`,
      variableDebtTokenName: `RASA Variable Debt ${reserveSymbols[i]}`,
      variableDebtTokenSymbol: `variableDebt${reserveSymbols[i]}`,
      stableDebtTokenName: `RASA Stable Debt ${reserveSymbols[i]}`,
      stableDebtTokenSymbol: `stableDebt$${reserveSymbols[i]}`,
      params: '0x10',
    });
  }

  // Deploy init reserves per chunks
  const chunkedSymbols = chunk(reserveSymbols, initChunks);
  const chunkedInitInputParams = chunk(initInputParams, initChunks);

  const proxyArtifact = await hre.deployments.get(POOL_CONFIGURATOR_PROXY_ID);
  const configuratorArtifact = await hre.deployments.get(POOL_CONFIGURATOR_IMPL_ID);
  const configurator = (
    await hre.ethers.getContractAt(configuratorArtifact.abi, proxyArtifact.address)
  ).connect(await hre.ethers.getSigner(admin)) as PoolConfigurator;

  console.log(`- Reserves initialization in ${chunkedInitInputParams.length} txs`);
  for (let chunkIndex = 0; chunkIndex < chunkedInitInputParams.length; chunkIndex++) {
    const tx = await waitForTx(await configurator.initReserves(chunkedInitInputParams[chunkIndex]));

    console.log(
      `  - Reserve ready for: ${chunkedSymbols[chunkIndex].join(', ')}`,
      `\n    - Tx hash: ${tx.transactionHash}`
    );
  }
};

export const getPairsTokenAggregator = (
  allAssetsAddresses: {
    [tokenSymbol: string]: tEthereumAddress;
  },
  aggregatorsAddresses: { [tokenSymbol: string]: tEthereumAddress }
): [string[], string[]] => {
  const { ETH, USD, ...assetsAddressesWithoutEth } = allAssetsAddresses;

  const pairs = Object.entries(assetsAddressesWithoutEth).map(([tokenSymbol, tokenAddress]) => {
    const aggregatorAddressIndex = Object.keys(aggregatorsAddresses).findIndex(
      (value) => value === tokenSymbol
    );
    const [, aggregatorAddress] = (
      Object.entries(aggregatorsAddresses) as [string, tEthereumAddress][]
    )[aggregatorAddressIndex];
    if (!aggregatorAddress) throw `Missing aggregator for ${tokenSymbol}`;
    if (!tokenAddress) throw `Missing token address for ${tokenSymbol}`;
    return [tokenAddress, aggregatorAddress];
  }) as [string, string][];

  const mappedPairs = pairs.map(([asset]) => asset);
  const mappedAggregators = pairs.map(([, source]) => source);

  return [mappedPairs, mappedAggregators];
};

export const configureReservesByHelper = async (
  reservesParams: iMultiPoolsAssets<IReserveParams>,
  tokenAddresses: { [symbol: string]: tEthereumAddress }
) => {
  const { deployer } = await hre.getNamedAccounts();
  const addressProviderArtifact = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = (await hre.ethers.getContractAt(
    addressProviderArtifact.abi,
    addressProviderArtifact.address
  )) as PoolAddressesProvider;

  const aclManagerArtifact = await hre.deployments.get(ACL_MANAGER_ID);
  const aclManager = (await hre.ethers.getContractAt(
    aclManagerArtifact.abi,
    await addressProvider.getACLManager()
  )) as ACLManager;

  const reservesSetupArtifact = await hre.deployments.get(RESERVES_SETUP_HELPER_ID);
  const reservesSetupHelper = (
    await hre.ethers.getContractAt(reservesSetupArtifact.abi, reservesSetupArtifact.address)
  ).connect(await hre.ethers.getSigner(deployer));

  const protocolDataArtifact = await hre.deployments.get(POOL_DATA_PROVIDER);
  const protocolDataProvider = (await hre.ethers.getContractAt(
    protocolDataArtifact.abi,
    (
      await hre.deployments.get(POOL_DATA_PROVIDER)
    ).address
  )) as ProtocolDataProvider;

  const tokens: string[] = [];
  const symbols: string[] = [];

  const inputParams: {
    asset: string;
    baseLTV: BigNumberish;
    liquidationThreshold: BigNumberish;
    liquidationBonus: BigNumberish;
    reserveFactor: BigNumberish;
    borrowCap: BigNumberish;
    supplyCap: BigNumberish;
    stableBorrowingEnabled: boolean;
    borrowingEnabled: boolean;
    flashLoanEnabled: boolean;
  }[] = [];

  for (const [
    assetSymbol,
    {
      baseLTVAsCollateral,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      borrowCap,
      supplyCap,
      stableBorrowRateEnabled,
      borrowingEnabled,
      flashLoanEnabled,
    },
  ] of Object.entries(reservesParams) as [string, IReserveParams][]) {
    if (!tokenAddresses[assetSymbol]) {
      console.log(
        `- Skipping init of ${assetSymbol} due token address is not set at markets config`
      );
      continue;
    }
    if (baseLTVAsCollateral === '-1') continue;

    const assetAddressIndex = Object.keys(tokenAddresses).findIndex(
      (value) => value === assetSymbol
    );
    const [, tokenAddress] = (Object.entries(tokenAddresses) as [string, string][])[
      assetAddressIndex
    ];
    const { usageAsCollateralEnabled: alreadyEnabled } =
      await protocolDataProvider.getReserveConfigurationData(tokenAddress);

    if (alreadyEnabled) {
      console.log(`- Reserve ${assetSymbol} is already enabled as collateral, skipping`);
      continue;
    }
    // Push data

    inputParams.push({
      asset: tokenAddress,
      baseLTV: baseLTVAsCollateral,
      liquidationThreshold,
      liquidationBonus,
      reserveFactor,
      borrowCap,
      supplyCap,
      stableBorrowingEnabled: stableBorrowRateEnabled,
      borrowingEnabled: borrowingEnabled,
      flashLoanEnabled: flashLoanEnabled,
    });

    tokens.push(tokenAddress);
    symbols.push(assetSymbol);
  }
  if (tokens.length) {
    // Set RSTokenAndRatesDeployer as temporal admin
    const aclAdmin = await hre.ethers.getSigner(await addressProvider.getACLAdmin());
    await waitForTx(await aclManager.connect(aclAdmin).addRiskAdmin(reservesSetupHelper.address));

    // Deploy init per chunks
    const enableChunks = 20;
    const chunkedSymbols = chunk(symbols, enableChunks);
    const chunkedInputParams = chunk(inputParams, enableChunks);
    const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();

    console.log(`- Configure reserves in ${chunkedInputParams.length} txs`);
    for (let chunkIndex = 0; chunkIndex < chunkedInputParams.length; chunkIndex++) {
      const tx = await waitForTx(
        await reservesSetupHelper.configureReserves(
          poolConfiguratorAddress,
          chunkedInputParams[chunkIndex]
        )
      );
      console.log(
        `  - Init for: ${chunkedSymbols[chunkIndex].join(', ')}`,
        `\n    - Tx hash: ${tx.transactionHash}`
      );
    }
    // Remove ReservesSetupHelper from risk admins
    await waitForTx(
      await aclManager.connect(aclAdmin).removeRiskAdmin(reservesSetupHelper.address)
    );
  }
};

export const addMarketToRegistry = async (
  providerId: number,
  addressesProvider: tEthereumAddress
) => {
  const providerRegistry = await hre.deployments.get('PoolAddressesProviderRegistry');
  const providerRegistryInstance = (await hre.ethers.getContractAt(
    providerRegistry.abi,
    providerRegistry.address
  )) as PoolAddressesProviderRegistry;

  const providerRegistryOwner = await providerRegistryInstance.owner();

  if (!isValidAddress(addressesProvider)) {
    throw Error(
      '[add-market-to-registry] Input parameter "addressesProvider" is missing or is not an address.'
    );
  }

  const signer = await hre.ethers.getSigner(providerRegistryOwner);

  // 1. Set the provider at the Registry
  await waitForTx(
    await providerRegistryInstance
      .connect(signer)
      .registerAddressesProvider(addressesProvider, providerId)
  );
  console.log(
    `Added LendingPoolAddressesProvider with address "${addressesProvider}" to registry located at ${providerRegistry.address}`
  );
};
