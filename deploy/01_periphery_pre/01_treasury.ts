import { POOL_ADMIN } from './../../helpers/constants';
import { getProxyImplementationBySlot } from './../../helpers/utilities/tx';
import { getFirstSigner } from './../../helpers/utilities/signer';
import { eNetwork } from './../../helpers/types';
import { MARKET_NAME } from './../../helpers/env';
import {
  loadPoolConfig,
  getParamPerNetwork,
  isTestnetMarket,
} from './../../helpers/market-config-helpers';
import { ZERO_ADDRESS } from '../../helpers/constants';
import { TREASURY_CONTROLLER_ID, TREASURY_IMPL_ID } from '../../helpers/deploy-ids';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { COMMON_DEPLOY_PARAMS } from '../../helpers/env';
import { TREASURY_PROXY_ID } from '../../helpers/deploy-ids';
import { InitializableAdminUpgradeabilityProxy, waitForTx } from '../../helpers';
import {
  EcosystemReserveController__factory,
  EcosystemReserveV2,
  EcosystemReserveV2__factory,
  InitializableAdminUpgradeabilityProxy__factory,
} from '../../types';
import { getAddress } from 'ethers/lib/utils';

/**
 * @notice A treasury proxy can be deployed per network or per market.
 * You need to take care to upgrade this proxy to the desired implementation.
 */

const func: DeployFunction = async function ({
  getNamedAccounts,
  deployments,
  ...hre
}: HardhatRuntimeEnvironment) {
  const { deploy, save } = deployments;
  const { deployer } = await getNamedAccounts();
  const { ReserveFactorTreasuryAddress } = await loadPoolConfig(MARKET_NAME);

  const network = hre.network.name as eNetwork;
  const treasuryAddress = getParamPerNetwork(ReserveFactorTreasuryAddress, network);
  let treasuryOwner = POOL_ADMIN[network];

  if (isTestnetMarket(await loadPoolConfig(MARKET_NAME))) {
    treasuryOwner = deployer;
  }

  if (treasuryAddress && getAddress(treasuryAddress) !== ZERO_ADDRESS) {
    const treasuryContract = await EcosystemReserveV2__factory.connect(
      treasuryAddress,
      await getFirstSigner()
    );
    const controller = await treasuryContract.getFundsAdmin();
    const impl = await getProxyImplementationBySlot(treasuryAddress);

    await save(TREASURY_PROXY_ID, {
      address: treasuryAddress,
      abi: InitializableAdminUpgradeabilityProxy__factory.abi,
    });
    await save(TREASURY_CONTROLLER_ID, {
      address: controller,
      abi: EcosystemReserveController__factory.abi,
    });
    await save(TREASURY_IMPL_ID, {
      address: impl,
      abi: EcosystemReserveV2__factory.abi,
    });

    return true;
  }

  // Deploy Treasury proxy
  const treasuryProxyArtifact = await deploy(TREASURY_PROXY_ID, {
    from: deployer,
    contract: 'InitializableAdminUpgradeabilityProxy',
    args: [],
  });

  // Deploy Treasury Controller
  const treasuryController = await deploy(TREASURY_CONTROLLER_ID, {
    from: deployer,
    contract: 'EcosystemReserveController',
    args: [treasuryOwner],
    ...COMMON_DEPLOY_PARAMS,
  });

  // Deploy Treasury implementation and initialize proxy
  const treasuryImplArtifact = await deploy(TREASURY_IMPL_ID, {
    from: deployer,
    contract: 'EcosystemReserveV2',
    args: [],
    ...COMMON_DEPLOY_PARAMS,
  });

  const treasuryImpl = (await hre.ethers.getContractAt(
    treasuryImplArtifact.abi,
    treasuryImplArtifact.address
  )) as EcosystemReserveV2;

  // Call to initialize at implementation contract to prevent other calls.
  await waitForTx(await treasuryImpl.initialize(ZERO_ADDRESS));

  // Initialize proxy
  const proxy = (await hre.ethers.getContractAt(
    treasuryProxyArtifact.abi,
    treasuryProxyArtifact.address
  )) as InitializableAdminUpgradeabilityProxy;

  const initializePayload = treasuryImpl.interface.encodeFunctionData('initialize', [
    treasuryController.address,
  ]);

  await waitForTx(
    await proxy['initialize(address,address,bytes)'](
      treasuryImplArtifact.address,
      treasuryOwner,
      initializePayload
    )
  );

  return true;
};

func.tags = ['periphery-pre', 'TreasuryProxy'];
func.dependencies = [];
func.id = 'Treasury';

export default func;
