import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { COMMON_DEPLOY_PARAMS } from '../../helpers/env';
import {
  RSTOKEN_IMPL_ID,
  DELEGATION_AWARE_RSTOKEN_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from '../../helpers/deploy-ids';
import {
  RSToken,
  DelegationAwareRSToken,
  PoolAddressesProvider,
  StableDebtToken,
  VariableDebtToken,
} from '../../types';
import { V3_CORE_VERSION, ZERO_ADDRESS } from '../../helpers/constants';
import { getContract, waitForTx } from '../../helpers';
import { MARKET_NAME } from '../../helpers/env';

const func: DeployFunction = async function ({
  getNamedAccounts,
  deployments,
  ...hre
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const { address: addressesProvider } = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const addressesProviderInstance = (await getContract(
    'PoolAddressesProvider',
    addressesProvider
  )) as PoolAddressesProvider;

  const poolAddress = await addressesProviderInstance.getPool();

  const RSTokenArtifact = await deploy(RSTOKEN_IMPL_ID, {
    contract: 'RSToken',
    from: deployer,
    args: [poolAddress],
    ...COMMON_DEPLOY_PARAMS,
  });

  const RSToken = (await hre.ethers.getContractAt(
    RSTokenArtifact.abi,
    RSTokenArtifact.address
  )) as RSToken;
  await waitForTx(
    await RSToken.initialize(
      poolAddress, // initializingPool
      ZERO_ADDRESS, // treasury
      ZERO_ADDRESS, // underlyingAsset
      ZERO_ADDRESS, // incentivesController
      0, // RSTokenDecimals
      'RSTOKEN_IMPL', // RSTokenName
      'RSTOKEN_IMPL', // RSTokenSymbol
      '0x00' // params
    )
  );

  console.log(1)

  const delegationAwareRSTokenArtifact = await deploy(DELEGATION_AWARE_RSTOKEN_IMPL_ID, {
    contract: 'DelegationAwareRSToken',
    from: deployer,
    args: [poolAddress],
    ...COMMON_DEPLOY_PARAMS,
  });

  const delegationAwareRSToken = (await hre.ethers.getContractAt(
    delegationAwareRSTokenArtifact.abi,
    delegationAwareRSTokenArtifact.address
  )) as DelegationAwareRSToken;
  await waitForTx(
    await delegationAwareRSToken.initialize(
      poolAddress, // initializingPool
      ZERO_ADDRESS, // treasury
      ZERO_ADDRESS, // underlyingAsset
      ZERO_ADDRESS, // incentivesController
      0, // RSTokenDecimals
      'DELEGATION_AWARE_RSTOKEN_IMPL', // RSTokenName
      'DELEGATION_AWARE_RSTOKEN_IMPL', // RSTokenSymbol
      '0x00' // params
    )
  );

  const stableDebtTokenArtifact = await deploy(STABLE_DEBT_TOKEN_IMPL_ID, {
    contract: 'StableDebtToken',
    from: deployer,
    args: [poolAddress],
    ...COMMON_DEPLOY_PARAMS,
  });

  const stableDebtToken = (await hre.ethers.getContractAt(
    stableDebtTokenArtifact.abi,
    stableDebtTokenArtifact.address
  )) as StableDebtToken;
  await waitForTx(
    await stableDebtToken.initialize(
      poolAddress, // initializingPool
      ZERO_ADDRESS, // underlyingAsset
      ZERO_ADDRESS, // incentivesController
      0, // debtTokenDecimals
      'STABLE_DEBT_TOKEN_IMPL', // debtTokenName
      'STABLE_DEBT_TOKEN_IMPL', // debtTokenSymbol
      '0x00' // params
    )
  );

  const variableDebtTokenArtifact = await deploy(VARIABLE_DEBT_TOKEN_IMPL_ID, {
    contract: 'VariableDebtToken',
    from: deployer,
    args: [poolAddress],
    ...COMMON_DEPLOY_PARAMS,
  });

  const variableDebtToken = (await hre.ethers.getContractAt(
    variableDebtTokenArtifact.abi,
    variableDebtTokenArtifact.address
  )) as VariableDebtToken;
  await waitForTx(
    await variableDebtToken.initialize(
      poolAddress, // initializingPool
      ZERO_ADDRESS, // underlyingAsset
      ZERO_ADDRESS, // incentivesController
      0, // debtTokenDecimals
      'VARIABLE_DEBT_TOKEN_IMPL', // debtTokenName
      'VARIABLE_DEBT_TOKEN_IMPL', // debtTokenSymbol
      '0x00' // params
    )
  );

  return true;
};

func.id = `TokenImplementations:${MARKET_NAME}:rasa-lending@${V3_CORE_VERSION}`;

func.tags = ['market', 'tokens'];

export default func;
