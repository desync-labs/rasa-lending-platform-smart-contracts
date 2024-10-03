import { Signer } from 'ethers';
import {
  getPool,
  getPoolAddressesProvider,
  getProtocolDataProvider,
  getRSToken,
  getMintableERC20,
  getPoolConfiguratorProxy,
  getPoolAddressesProviderRegistry,
  getWETHMocked,
  getVariableDebtToken,
  getStableDebtToken,
  getRASAOracle,
  getACLManager,
  getFallbackOracle,
} from '../../helpers/contract-getters';
import { tEthereumAddress } from '../../helpers/types';
import { Pool } from '../../types/Pool';
import { ProtocolDataProvider } from '../../types/ProtocolDataProvider';
import { MintableERC20 } from '../../types/MintableERC20';
import { RSToken } from '../../types/RSToken';
import { PoolConfigurator } from '../../types/PoolConfigurator';

import { PriceOracle } from '../../types/PriceOracle';
import { PoolAddressesProvider } from '../../types/PoolAddressesProvider';
import { PoolAddressesProviderRegistry } from '../../types/PoolAddressesProviderRegistry';
import { WETH9Mocked } from '../../types/WETH9Mocked';
import { RASAOracle, ACLManager, StableDebtToken, VariableDebtToken } from '../../types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { usingTenderly } from '../../helpers/tenderly-utils';
import { waitForTx, evmSnapshot, evmRevert } from '../../helpers/utilities/tx';
import { getEthersSigners } from '../../helpers/utilities/signer';

declare var hre: HardhatRuntimeEnvironment;

export interface SignerWithAddress {
  signer: Signer;
  address: tEthereumAddress;
}
export interface TestEnv {
  deployer: SignerWithAddress;
  poolAdmin: SignerWithAddress;
  emergencyAdmin: SignerWithAddress;
  riskAdmin: SignerWithAddress;
  users: SignerWithAddress[];
  pool: Pool;
  configurator: PoolConfigurator;
  oracle: PriceOracle;
  rasaOracle: RASAOracle;
  helpersContract: ProtocolDataProvider;
  weth: WETH9Mocked;
  RSWETH: RSToken;
  rusd: MintableERC20;
  RSRUSD: RSToken;
  RSCgo: RSToken;
  variableDebtRUSD: VariableDebtToken;
  stableDebtRUSD: StableDebtToken;
  RSEurs: RSToken;
  eurs: MintableERC20;
  cgo: MintableERC20;
  addressesProvider: PoolAddressesProvider;
  registry: PoolAddressesProviderRegistry;
  aclManager: ACLManager;
}

let HardhatSnapshotId: string = '0x1';
const setHardhatSnapshotId = (id: string) => {
  HardhatSnapshotId = id;
};

const testEnv: TestEnv = {
  deployer: {} as SignerWithAddress,
  poolAdmin: {} as SignerWithAddress,
  emergencyAdmin: {} as SignerWithAddress,
  riskAdmin: {} as SignerWithAddress,
  users: [] as SignerWithAddress[],
  pool: {} as Pool,
  configurator: {} as PoolConfigurator,
  helpersContract: {} as ProtocolDataProvider,
  oracle: {} as PriceOracle,
  rasaOracle: {} as RASAOracle,
  weth: {} as WETH9Mocked,
  RSWETH: {} as RSToken,
  rusd: {} as MintableERC20,
  RSRUSD: {} as RSToken,
  variableDebtRUSD: {} as VariableDebtToken,
  stableDebtRUSD: {} as StableDebtToken,
  RSEurs: {} as RSToken,
  eurs: {} as MintableERC20,
  cgo: {} as MintableERC20,
  addressesProvider: {} as PoolAddressesProvider,
  registry: {} as PoolAddressesProviderRegistry,
  aclManager: {} as ACLManager,
} as TestEnv;

export async function initializeMakeSuite() {
  const [_deployer, ...restSigners] = await getEthersSigners();
  const deployer: SignerWithAddress = {
    address: await _deployer.getAddress(),
    signer: _deployer,
  };

  for (const signer of restSigners) {
    testEnv.users.push({
      signer,
      address: await signer.getAddress(),
    });
  }
  testEnv.deployer = deployer;
  testEnv.poolAdmin = deployer;
  testEnv.emergencyAdmin = testEnv.users[1];
  testEnv.riskAdmin = testEnv.users[2];
  testEnv.pool = await getPool();
  testEnv.configurator = await getPoolConfiguratorProxy();

  testEnv.addressesProvider = await getPoolAddressesProvider();

  testEnv.registry = await getPoolAddressesProviderRegistry();
  testEnv.aclManager = await getACLManager();

  testEnv.oracle = await getFallbackOracle();
  testEnv.rasaOracle = await getRASAOracle();

  testEnv.helpersContract = await getProtocolDataProvider();

  const allTokens = await testEnv.helpersContract.getAllRSTokens();
  const RSRUSDAddress = allTokens.find((RSToken) => RSToken.symbol.includes('RUSD'))?.tokenAddress;
  const RSEursAddress = allTokens.find((RSToken) => RSToken.symbol.includes('EURS'))?.tokenAddress;
  const RSWEthAddress = allTokens.find((RSToken) => RSToken.symbol.includes('WETH'))?.tokenAddress;
  const RSCgoAddress = allTokens.find((RSToken) => RSToken.symbol.includes('CGO'))?.tokenAddress;

  const reservesTokens = await testEnv.helpersContract.getAllReservesTokens();

  const rusdAddress = reservesTokens.find((token) => token.symbol === 'RUSD')?.tokenAddress;
  const {
    variableDebtTokenAddress: variableDebtRUSDAddress,
    stableDebtTokenAddress: stableDebtRUSDAddress,
  } = await testEnv.helpersContract.getReserveTokensAddresses(rusdAddress || '');
  const eursAddress = reservesTokens.find((token) => token.symbol === 'EURS')?.tokenAddress;
  const cgoAddress = reservesTokens.find((token) => token.symbol === 'CGO')?.tokenAddress;
  const wethAddress = reservesTokens.find((token) => token.symbol === 'WETH')?.tokenAddress;

  if (!RSRUSDAddress || !RSWEthAddress) {
    throw 'Missing mandatory RSTokens';
  }
  if (!rusdAddress || !eursAddress || !cgoAddress || !wethAddress) {
    throw 'Missing mandatory tokens';
  }

  testEnv.RSRUSD = await getRSToken(RSRUSDAddress);
  testEnv.variableDebtRUSD = await getVariableDebtToken(variableDebtRUSDAddress);
  testEnv.stableDebtRUSD = await getStableDebtToken(stableDebtRUSDAddress);
  testEnv.RSEurs = await getRSToken(RSEursAddress);
  testEnv.RSWETH = await getRSToken(RSWEthAddress);
  testEnv.RSCgo = await getRSToken(RSCgoAddress);

  testEnv.rusd = await getMintableERC20(rusdAddress);
  testEnv.cgo = await getMintableERC20(cgoAddress);
  testEnv.eurs = await getMintableERC20(eursAddress);
  testEnv.weth = await getWETHMocked(wethAddress);

  // Setup admins
  await waitForTx(await testEnv.aclManager.addRiskAdmin(testEnv.riskAdmin.address));
  await waitForTx(await testEnv.aclManager.addEmergencyAdmin(testEnv.emergencyAdmin.address));
}

const setSnapshot = async () => {
  if (usingTenderly()) {
    setHardhatSnapshotId((await hre.tenderlyNetwork.getHead()) || '0x1');
    return;
  }
  setHardhatSnapshotId(await evmSnapshot());
};

const revertHead = async () => {
  if (usingTenderly()) {
    await hre.tenderlyNetwork.setHead(HardhatSnapshotId);
    return;
  }
  await evmRevert(HardhatSnapshotId);
};

export function makeSuite(name: string, tests: (testEnv: TestEnv) => void) {
  describe(name, () => {
    before(async () => {
      await setSnapshot();
    });
    tests(testEnv);
    after(async () => {
      await revertHead();
    });
  });
}
