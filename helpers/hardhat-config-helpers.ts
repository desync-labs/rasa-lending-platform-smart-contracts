import fs from 'fs';
import path from 'path';
import { HardhatNetworkForkingUserConfig } from 'hardhat/types';
import {
  iParamsPerNetwork,
  eEthereumNetwork,
  eNetwork
} from './types';
const { accounts } = require('../test-wallets.js');

require('dotenv').config();

export const DEFAULT_BLOCK_GAS_LIMIT = 12450000;
export const DEFAULT_GAS_PRICE = 1001030;
export const INFURA_KEY = process.env.INFURA_KEY || '';
export const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';
export const TENDERLY_FORK_ID = process.env.TENDERLY_FORK_ID || '';
export const FORK = (process.env.FORK || '') as eNetwork;
export const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER
  ? parseInt(process.env.FORK_BLOCK_NUMBER)
  : 0;
const MNEMONIC_PATH = "m/44'/60'/1'/0";
const MNEMONIC = process.env.MNEMONIC || '';

export const NETWORKS_RPC_URL: iParamsPerNetwork<string> = {
  [eEthereumNetwork.coverage]: 'http://localhost:8555',
  [eEthereumNetwork.hardhat]: 'http://localhost:8545',
  [eEthereumNetwork.sepolia]: `https://sepolia.infura.io/v3/${INFURA_KEY}`,
  [eEthereumNetwork.lisk]: `https://rpc.api.lisk.com/`
};

export const LIVE_NETWORKS: iParamsPerNetwork<boolean> = {
  [eEthereumNetwork.lisk]: true,
};

export const buildForkConfig = (): HardhatNetworkForkingUserConfig | undefined => {
  let forkMode: HardhatNetworkForkingUserConfig | undefined;
  if (FORK && NETWORKS_RPC_URL[FORK]) {
    forkMode = {
      url: NETWORKS_RPC_URL[FORK] as string,
    };
    if (FORK_BLOCK_NUMBER) {
      forkMode.blockNumber = FORK_BLOCK_NUMBER;
    }
  }
  return forkMode;
};

export const loadTasks = (taskFolders: string[]): void =>
  taskFolders.forEach((folder) => {
    const tasksPath = path.join(__dirname, '../tasks', folder);
    fs.readdirSync(tasksPath)
      .filter((pth) => pth.includes('.ts') || pth.includes('.js'))
      .forEach((task) => {
        require(`${tasksPath}/${task}`);
      });
  });

export const getCommonNetworkConfig = (networkName: eNetwork, chainId?: number) => ({
  url: NETWORKS_RPC_URL[networkName] || '',
  blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
  chainId,
  // gasPrice: undefined,
  ...((!!MNEMONICS[networkName] || !!MNEMONIC) && {
    accounts: {
      mnemonic: MNEMONICS[networkName] || MNEMONIC,
      path: MNEMONIC_PATH,
      initialIndex: 0,
      count: 10,
    },
  }),
  live: LIVE_NETWORKS.lisk || false,
});

const MNEMONICS: iParamsPerNetwork<string> = {
  [eEthereumNetwork.lisk]: process.env.MNEMONIC,
};

export const hardhatNetworkSettings = {
  gasPrice: 'auto',
  initialBaseFeePerGas: '0',
  blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
  throwOnTransactionFailures: true,
  throwOnCallFailures: true,
  chainId: 31337,
  forking: buildForkConfig(),
  saveDeployments: true,
  allowUnlimitedContractSize: true,
  tags: ['local'],
  accounts: accounts.map(({ secretKey, balance }: { secretKey: string; balance: string }) => ({
    privateKey: secretKey,
    balance,
  })),
};

export const DETERMINISTIC_DEPLOYMENT = process.env.DETERMINISTIC_DEPLOYMENT
  ? process.env.DETERMINISTIC_DEPLOYMENT === 'true'
  : null;

export const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY || '';
