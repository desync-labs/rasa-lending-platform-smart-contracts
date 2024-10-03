import { getCommonNetworkConfig, hardhatNetworkSettings } from './helpers/hardhat-config-helpers';
import { eEthereumNetwork } from './helpers/types';
import { DEFAULT_NAMED_ACCOUNTS } from './helpers/constants';
import path from 'path';
import { HardhatUserConfig } from 'hardhat/types';
// @ts-ignore
import { COVERAGE_CHAINID, HARDHAT_CHAINID } from './helpers/constants';

require('./helpers/index.ts');
require('dotenv').config();

import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-deploy';
import '@tenderly/hardhat-tenderly';
import 'hardhat-contract-sizer';
import 'hardhat-dependency-compiler';
import '@nomicfoundation/hardhat-chai-matchers';

const DEFAULT_BLOCK_GAS_LIMIT = 12450000;
const HARDFORK = 'london';

const hardhatConfig = {
  gasReporter: {
    enabled: true,
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  solidity: {
    // Docs for the compiler https://docs.soliditylang.org/en/v0.8.10/using-the-compiler.html
    version: '0.8.10',
    settings: {
      optimizer: {
        enabled: true,
        runs: 100000,
      },
      evmVersion: 'london',
    },
  },
  typechain: {
    outDir: 'types',
    target: 'ethers-v5',
  },
  mocha: {
    timeout: 0,
    bail: true,
  },
  tenderly: {
    project: process.env.TENDERLY_PROJECT || '',
    username: process.env.TENDERLY_USERNAME || '',
    forkNetwork: '1', //Network id of the network we want to fork
  },
  networks: {
    local: {
      url: 'http://localhost:8555',
      chainId: COVERAGE_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
    },
    hardhat: hardhatNetworkSettings,
    ganache: {
      url: 'http://ganache:8545',
      accounts: {
        mnemonic: 'fox sight canyon orphan hotel grow hedgehog build bless august weather swarm',
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
      },
    },
    [eEthereumNetwork.lisk]: getCommonNetworkConfig(eEthereumNetwork.lisk, 1135),
    [eEthereumNetwork.sepolia]: getCommonNetworkConfig(eEthereumNetwork.sepolia, 11155111),
  },
  namedAccounts: {
    ...DEFAULT_NAMED_ACCOUNTS,
  },
};

export default hardhatConfig;
