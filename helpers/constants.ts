// ----------------
// MATH
// ----------------

import { BigNumber } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';

import {eEthereumNetwork} from './types';

export const V3_CORE_VERSION = '1.0.0';
export const V3_PERIPHERY_VERSION = '1.0.0';

export const PERCENTAGE_FACTOR = '10000';
export const HALF_PERCENTAGE = '5000';
export const oneEther = parseEther('1');
export const oneRay = parseUnits('1', 27);
export const MAX_UINT_AMOUNT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ONE_ADDRESS = '0x0000000000000000000000000000000000000001';

export const WRAPPED_NATIVE_TOKEN_PER_NETWORK: { [network: string]: string } = {
  [eEthereumNetwork.lisk]: '0x4200000000000000000000000000000000000006'
};

export const ZERO_BYTES_32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const EMPTY_STORAGE_SLOT =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

export const POOL_ADMIN: Record<string, string> = {
  [eEthereumNetwork.lisk]: '0xCDeCF21e8bf321094Bb483B64f761a8f8191760d'
};

export const EMERGENCY_ADMIN: Record<string, string> = {
  [eEthereumNetwork.lisk]: '0xCDeCF21e8bf321094Bb483B64f761a8f8191760d'
};

export const DEFAULT_NAMED_ACCOUNTS = {
  deployer: {
    default: 0,
  },
  aclAdmin: {
    default: 0,
  },
  emergencyAdmin: {
    default: 0,
  },
  poolAdmin: {
    default: 0,
  },
  addressesProviderRegistryOwner: {
    default: 0,
  },
  treasuryProxyAdmin: {
    default: 0,
  },
  incentivesProxyAdmin: {
    default: 0,
  },
  incentivesEmissionManager: {
    default: 0,
  },
  incentivesRewardsVault: {
    default: 0,
  },
};

export const MULTISIG_ADDRESS: { [key: string]: string } = {
  [eEthereumNetwork.lisk]: ZERO_ADDRESS
};

export const WAD = BigNumber.from(10).pow(18).toString();
export const HALF_WAD = BigNumber.from(WAD).div(2).toString();
export const RAY = BigNumber.from(10).pow(27).toString();
export const HALF_RAY = BigNumber.from(RAY).div(2).toString();
export const WAD_RAY_RATIO = parseUnits('1', 9).toString();
export const MAX_BORROW_CAP = '68719476735';
export const MAX_SUPPLY_CAP = '68719476735';
export const MAX_UNBACKED_MINT_CAP = '68719476735';
export const ONE_YEAR = '31536000';
// ----------------
// PROTOCOL GLOBAL PARAMS
// ----------------
export const TEST_SNAPSHOT_ID = '0x1';
export const HARDHAT_CHAINID = 31337;
export const COVERAGE_CHAINID = 1337;

export const MOCK_CHAINLINK_AGGREGATORS_PRICES: { [key: string]: string } = {
  WETH: '2500000000000000000000',
  USDT: '100000000000000000000'
};