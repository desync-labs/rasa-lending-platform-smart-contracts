import { evmSnapshot, evmRevert, advanceTimeAndBlock } from '../helpers/utilities/tx';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from '@ethersproject/bignumber';
import { TransactionReceipt } from '@ethersproject/providers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { RateMode } from '../helpers/types';
import { Pool, StableDebtToken, MintableERC20__factory } from '../types';
import { makeSuite, SignerWithAddress, TestEnv } from './helpers/make-suite';
import {
  supply,
  stableBorrow,
  repayStableBorrow,
  getStableDebtTokenEvent,
} from './helpers/utils/tokenization-events';

const DEBUG = false;

let balances = {
  balance: {},
};

const log = (str: string) => {
  if (DEBUG) console.log(str);
};

const printBalance = async (name: string, debtToken: StableDebtToken, userAddress: string) => {
  console.log(
    name,
    'balanceOf',
    await ethers.utils.formatEther(await debtToken.balanceOf(userAddress))
  );
};

const increaseSupplyIndex = async (
  pool: Pool,
  depositor: SignerWithAddress,
  collateral: string,
  assetToIncrease: string
) => {
  const collateralToken = MintableERC20__factory.connect(collateral, depositor.signer);
  const borrowingToken = MintableERC20__factory.connect(assetToIncrease, depositor.signer);

  await collateralToken
    .connect(depositor.signer)
    ['mint(uint256)'](await convertToCurrencyDecimals(collateralToken.address, '10000000'));
  await collateralToken.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
  await pool
    .connect(depositor.signer)
    .deposit(
      collateral,
      await convertToCurrencyDecimals(collateral, '100000'),
      depositor.address,
      '0'
    );

  const { RSTokenAddress } = await pool.getReserveData(assetToIncrease);
  const availableLiquidity = await borrowingToken.balanceOf(RSTokenAddress);
  await pool
    .connect(depositor.signer)
    .borrow(
      assetToIncrease,
      availableLiquidity.percentMul('20'),
      RateMode.Variable,
      0,
      depositor.address
    );

  await advanceTimeAndBlock(10000000);
};

const updateBalances = (
  balances: any,
  stableDebtRUSD: StableDebtToken,
  receipt: TransactionReceipt
) => {
  let events = getStableDebtTokenEvent(stableDebtRUSD, receipt, 'Mint');
  for (const ev of events) {
    balances.balance[ev.onBehalfOf] = balances.balance[ev.onBehalfOf]?.add(ev.amount);
  }
  events = getStableDebtTokenEvent(stableDebtRUSD, receipt, 'Burn');
  for (const ev of events) {
    balances.balance[ev.from] = balances.balance[ev.from]?.sub(ev.amount.add(ev.balanceIncrease));
    balances.balance[ev.from] = balances.balance[ev.from]?.add(ev.balanceIncrease);
  }
};

makeSuite('StableDebtToken: Events', (testEnv: TestEnv) => {
  let alice, bob, depositor, depositor2;

  let snapId;

  before(async () => {
    const { users, pool, rusd, weth } = testEnv;
    [alice, bob, depositor, depositor2] = users;

    const amountToMint = await convertToCurrencyDecimals(rusd.address, '10000000');
    const usersToInit = [alice, bob, depositor, depositor2];
    for (const user of usersToInit) {
      await rusd.connect(user.signer)['mint(uint256)'](amountToMint);
      await weth.connect(user.signer)['mint(uint256)'](amountToMint);
      await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
      await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    }

    // Depositors
    await pool.connect(depositor.signer).supply(weth.address, amountToMint, depositor.address, '0');
    await pool.connect(depositor.signer).supply(rusd.address, amountToMint, depositor.address, '0');
    await pool
      .connect(depositor2.signer)
      .supply(weth.address, amountToMint, depositor2.address, '0');
    await pool
      .connect(depositor2.signer)
      .supply(rusd.address, amountToMint, depositor2.address, '0');
  });

  beforeEach(async () => {
    snapId = await evmSnapshot();

    // Init balances
    balances = {
      balance: {
        [alice.address]: BigNumber.from(0),
        [bob.address]: BigNumber.from(0),
      },
    };
  });

  afterEach(async () => {
    await evmRevert(snapId);
  });

  it('Alice borrows 100 RUSD, borrows 50 RUSD, repays 20 RUSD, repays 10 RUSD, borrows 100 RUSD, repays 220 RUSD (without index change)', async () => {
    await testMultipleBorrowsAndRepays(false);
  });

  it('Alice borrows 100 RUSD, borrows 50 RUSD, repays 20 RUSD, repays 10 RUSD, borrows 100 RUSD, repays 220 RUSD (with index change)', async () => {
    await testMultipleBorrowsAndRepays(true);
  });

  const testMultipleBorrowsAndRepays = async (indexChange: boolean) => {
    const { pool, rusd, stableDebtRUSD, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await stableDebtRUSD.balanceOf(alice.address);

    log('- Alice supplies 1000 WETH');
    await supply(pool, alice, weth.address, '100000', alice.address, false);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 100 RUSD');
    rcpt = await stableBorrow(pool, alice, rusd.address, '100', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 50 RUSD more');
    rcpt = await stableBorrow(pool, alice, rusd.address, '50', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', stableDebtRUSD, alice.address);
    }

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice repays 20 RUSD');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '20', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice repays 10 RUSD');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '10', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor2, weth.address, rusd.address);
    }

    log('- Alice borrows 100 RUSD more');
    rcpt = await stableBorrow(pool, alice, rusd.address, '100', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor2, weth.address, rusd.address);
    }

    log('- Alice repays 220 RUSD');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '220', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    // Check final balances
    rcpt = await stableBorrow(pool, alice, rusd.address, '1', alice.address);
    updateBalances(balances, stableDebtRUSD, rcpt);
    const aliceBalanceAfter = await stableDebtRUSD.balanceOf(alice.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
  };

  it('Alice borrows 100 RUSD, Bob borrows 100 RUSD, Alice borrows 50 RUSD, repays 150 RUSD and repays 100 RUSD on behalf of Bob, borrows 10 RUSD more (without index change)', async () => {
    await testMultipleBorrowsAndRepaysOnBehalf(false);
  });

  it('Alice borrows 100 RUSD, Bob borrows 100 RUSD, Alice borrows 50 RUSD, repays 150 RUSD and repays 100 RUSD on behalf of Bob, borrows 10 RUSD more (with index change)', async () => {
    await testMultipleBorrowsAndRepaysOnBehalf(true);
  });

  const testMultipleBorrowsAndRepaysOnBehalf = async (indexChange: boolean) => {
    const { pool, rusd, stableDebtRUSD, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await stableDebtRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await stableDebtRUSD.balanceOf(bob.address);

    log('- Alice supplies 1000 WETH');
    await supply(pool, alice, weth.address, '1000', alice.address, false);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 100 RUSD');
    rcpt = await stableBorrow(pool, alice, rusd.address, '100', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Bob supplies 1000 WETH');
    await supply(pool, bob, weth.address, '1000', bob.address, false);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Bob borrows 100 RUSD');
    rcpt = await stableBorrow(pool, bob, rusd.address, '100', bob.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 50 RUSD more');
    rcpt = await stableBorrow(pool, alice, rusd.address, '50', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice repays 150 RUSD');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '150', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice repays 50 RUSD on behalf of Bob');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '50', bob.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice repays 50 RUSD on behalf of Bob');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '50', bob.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 10 RUSD more');
    rcpt = await stableBorrow(pool, alice, rusd.address, '10', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    if (DEBUG) {
      await printBalance('alice', stableDebtRUSD, alice.address);
      await printBalance('bob', stableDebtRUSD, bob.address);
    }

    // Check final balances
    rcpt = await stableBorrow(pool, alice, rusd.address, '1', alice.address);
    updateBalances(balances, stableDebtRUSD, rcpt);
    const aliceBalanceAfter = await stableDebtRUSD.balanceOf(alice.address);

    rcpt = await stableBorrow(pool, bob, rusd.address, '1', bob.address);
    updateBalances(balances, stableDebtRUSD, rcpt);
    const bobBalanceAfter = await stableDebtRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      5
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 5);
  };

  it('Alice borrows 100 RUSD, Bob borrows 100 RUSD on behalf of Alice, Bob borrows 50 RUSD, Alice borrows 50 RUSD, repays 250 RUSD and repays 50 RUSD on behalf of Bob, borrows 10 RUSD more (without index change)', async () => {
    await testMultipleBorrowsOnBehalfAndRepaysOnBehalf(false);
  });

  it('Alice borrows 100 RUSD, Bob borrows 100 RUSD on behalf of Alice, Bob borrows 50 RUSD, Alice borrows 50 RUSD, repays 250 RUSD and repays 50 RUSD on behalf of Bob, borrows 10 RUSD more (with index change)', async () => {
    await testMultipleBorrowsOnBehalfAndRepaysOnBehalf(true);
  });

  const testMultipleBorrowsOnBehalfAndRepaysOnBehalf = async (indexChange: boolean) => {
    const { pool, rusd, stableDebtRUSD, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await stableDebtRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await stableDebtRUSD.balanceOf(bob.address);

    log('- Alice supplies 1000 WETH');
    await supply(pool, alice, weth.address, '1000', alice.address, false);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 100 RUSD');
    rcpt = await stableBorrow(pool, alice, rusd.address, '100', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Bob borrows 100 RUSD on behalf of Alice');
    await stableDebtRUSD.connect(alice.signer).approveDelegation(bob.address, MAX_UINT_AMOUNT);
    rcpt = await stableBorrow(pool, bob, rusd.address, '100', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Bob supplies 1000 WETH');
    await supply(pool, bob, weth.address, '1000', bob.address, false);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Bob borrows 50 RUSD');
    rcpt = await stableBorrow(pool, bob, rusd.address, '50', bob.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 50 RUSD');
    rcpt = await stableBorrow(pool, alice, rusd.address, '50', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice repays 250 RUSD');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '250', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice repays 50 RUSD on behalf of Bob');
    rcpt = await repayStableBorrow(pool, alice, rusd.address, '50', bob.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    log('- Alice borrows 10 RUSD more');
    rcpt = await stableBorrow(pool, alice, rusd.address, '10', alice.address, DEBUG);
    updateBalances(balances, stableDebtRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, depositor, weth.address, rusd.address);
    }

    if (DEBUG) {
      await printBalance('alice', stableDebtRUSD, alice.address);
      await printBalance('bob', stableDebtRUSD, bob.address);
    }

    // Check final balances
    rcpt = await stableBorrow(pool, alice, rusd.address, '1', alice.address);
    updateBalances(balances, stableDebtRUSD, rcpt);
    const aliceBalanceAfter = await stableDebtRUSD.balanceOf(alice.address);

    rcpt = await stableBorrow(pool, bob, rusd.address, '1', bob.address);
    updateBalances(balances, stableDebtRUSD, rcpt);
    const bobBalanceAfter = await stableDebtRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      5
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 5);
  };
});
