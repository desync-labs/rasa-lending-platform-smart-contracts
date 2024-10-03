import { evmSnapshot, evmRevert, advanceTimeAndBlock } from '../helpers/utilities/tx';
import { ZERO_ADDRESS } from '../helpers/constants';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { TransactionReceipt } from '@ethersproject/providers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { RateMode } from '../helpers/types';
import { Pool, RSToken, MintableERC20__factory } from '../types';
import { makeSuite, SignerWithAddress, TestEnv } from './helpers/make-suite';
import {
  supply,
  transfer,
  withdraw,
  getRSTokenEvent,
  transferFrom,
  printRSTokenEvents,
} from './helpers/utils/tokenization-events';

const DEBUG = false;

let balances = {
  balance: {},
};

const log = (str: string) => {
  if (DEBUG) console.log(str);
};

const printBalance = async (name: string, RSToken: any, userAddress: string) => {
  console.log(
    name,
    'balanceOf',
    await ethers.utils.formatEther(await RSToken.balanceOf(userAddress)),
    'scaledBalance',
    await ethers.utils.formatEther(await RSToken.scaledBalanceOf(userAddress))
  );
};

const increaseSupplyIndex = async (
  pool: Pool,
  borrower: SignerWithAddress,
  collateral: string,
  assetToIncrease: string
) => {
  const collateralToken = MintableERC20__factory.connect(collateral, borrower.signer);
  const borrowingToken = MintableERC20__factory.connect(assetToIncrease, borrower.signer);

  await collateralToken
    .connect(borrower.signer)
    ['mint(uint256)'](await convertToCurrencyDecimals(collateralToken.address, '10000000'));
  await collateralToken.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
  await pool
    .connect(borrower.signer)
    .supply(
      collateral,
      await convertToCurrencyDecimals(collateral, '100000'),
      borrower.address,
      '0'
    );

  const { RSTokenAddress } = await pool.getReserveData(assetToIncrease);
  const availableLiquidity = await borrowingToken.balanceOf(RSTokenAddress);
  await pool
    .connect(borrower.signer)
    .borrow(
      assetToIncrease,
      availableLiquidity.percentMul('20'),
      RateMode.Variable,
      0,
      borrower.address
    );

  await advanceTimeAndBlock(10000000000);
};

const updateBalances = (balances: any, RSToken: RSToken, receipt: TransactionReceipt) => {
  let events = getRSTokenEvent(RSToken, receipt, 'Transfer');
  for (const ev of events) {
    if (ev.from == ZERO_ADDRESS || ev.to == ZERO_ADDRESS) continue;
    balances.balance[ev.from] = balances.balance[ev.from]?.sub(ev.value);
    balances.balance[ev.to] = balances.balance[ev.to]?.add(ev.value);
  }
  events = getRSTokenEvent(RSToken, receipt, 'Mint');
  for (const ev of events) {
    balances.balance[ev.onBehalfOf] = balances.balance[ev.onBehalfOf]?.add(ev.value);
  }
  events = getRSTokenEvent(RSToken, receipt, 'Burn');
  for (const ev of events) {
    balances.balance[ev.from] = balances.balance[ev.from]?.sub(ev.value.add(ev.balanceIncrease));
    balances.balance[ev.from] = balances.balance[ev.from]?.add(ev.balanceIncrease);
  }
};

makeSuite('RSToken: Events', (testEnv: TestEnv) => {
  let alice, bob, eve, borrower, borrower2;

  let snapId;

  before(async () => {
    const { users, pool, rusd, weth } = testEnv;
    [alice, bob, eve, borrower, borrower2] = users;

    const amountToMint = await convertToCurrencyDecimals(rusd.address, '10000000');
    const usersToInit = [alice, bob, eve, borrower, borrower2];
    for (const user of usersToInit) {
      await rusd.connect(user.signer)['mint(uint256)'](amountToMint);
      await weth.connect(user.signer)['mint(uint256)'](amountToMint);
      await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
      await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    }
  });

  beforeEach(async () => {
    snapId = await evmSnapshot();

    // Init balances
    balances = {
      balance: {
        [alice.address]: BigNumber.from(0),
        [bob.address]: BigNumber.from(0),
        [eve.address]: BigNumber.from(0),
      },
    };
  });

  afterEach(async () => {
    await evmRevert(snapId);
  });

  it('Alice and Bob supplies 1000, Alice transfer 500 to Bob, and withdraws 500 (without index change)', async () => {
    await testMultipleSupplyAndTransferAndWithdraw(false);
  });

  it('Alice and Bob supplies 1000, Alice transfer 500 to Bob, and withdraws 500 (with index change)', async () => {
    await testMultipleSupplyAndTransferAndWithdraw(true);
  });

  const testMultipleSupplyAndTransferAndWithdraw = async (indexChange: boolean) => {
    const { pool, rusd, RSRUSD, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await RSRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await RSRUSD.balanceOf(bob.address);

    log('- Alice supplies 1000 RUSD');
    rcpt = await supply(pool, alice, rusd.address, '1000', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Bob supplies 1000 RUSD');
    rcpt = await supply(pool, bob, rusd.address, '1000', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice transfers 500 aRUSD to Bob');
    const [fromScaledBefore, toScaledBefore] = await Promise.all([
      RSRUSD.scaledBalanceOf(alice.address),
      RSRUSD.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, rusd.address, '500', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);
    balanceTransferEv = getRSTokenEvent(RSRUSD, rcpt, 'BalanceTransfer')[0];
    expect(await RSRUSD.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await RSRUSD.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice withdraws 500 RUSD to Bob');
    rcpt = await withdraw(pool, alice, rusd.address, '500', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', RSRUSD, alice.address);
      await printBalance('bob', RSRUSD, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, rusd.address, '1', alice.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const aliceBalanceAfter = await RSRUSD.balanceOf(alice.address);

    rcpt = await supply(pool, bob, rusd.address, '1', bob.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const bobBalanceAfter = await RSRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 1000, supplies 200, transfers 100 out, withdraws 50 withdraws 100 to Bob, withdraws 200 (without index change)', async () => {
    await testMultipleSupplyAndWithdrawalsOnBehalf(false);
  });

  it('Alice supplies 1000, supplies 200, transfers 100 out, withdraws 50 withdraws 100 to Bob, withdraws 200 (with index change)', async () => {
    await testMultipleSupplyAndWithdrawalsOnBehalf(true);
  });

  const testMultipleSupplyAndWithdrawalsOnBehalf = async (indexChange: boolean) => {
    const { pool, rusd, RSRUSD, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await RSRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await RSRUSD.balanceOf(bob.address);

    log('- Alice supplies 1000 RUSD');
    rcpt = await supply(pool, alice, rusd.address, '1000', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice supplies 200 RUSD');
    rcpt = await supply(pool, alice, rusd.address, '200', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice transfers 100 aRUSD to Bob');
    const [fromScaledBefore, toScaledBefore] = await Promise.all([
      RSRUSD.scaledBalanceOf(alice.address),
      RSRUSD.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, rusd.address, '100', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);
    balanceTransferEv = getRSTokenEvent(RSRUSD, rcpt, 'BalanceTransfer')[0];
    expect(await RSRUSD.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await RSRUSD.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice withdraws 50 RUSD');
    rcpt = await withdraw(pool, alice, rusd.address, '50', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice withdraws 100 RUSD to Bob');
    rcpt = await withdraw(pool, alice, rusd.address, '100', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice withdraws 300 RUSD');
    rcpt = await withdraw(pool, alice, rusd.address, '300', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', RSRUSD, alice.address);
      await printBalance('bob', RSRUSD, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, rusd.address, '1', alice.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const aliceBalanceAfter = await RSRUSD.balanceOf(alice.address);

    rcpt = await supply(pool, bob, rusd.address, '1', bob.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const bobBalanceAfter = await RSRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 1000, supplies 200 to Bob, Bob supplies 100, Alice transfers 100 out, Alice withdraws 100, Alice withdraws 200 to Bob (without index change)', async () => {
    await testMultipleSupplyOnBehalfOfAndWithdrawals(false);
  });

  it('Alice supplies 1000, supplies 200 to Bob, Bob supplies 100, Alice transfers 100 out, Alice withdraws 100, Alice withdraws 200 to Bob (with index change)', async () => {
    await testMultipleSupplyOnBehalfOfAndWithdrawals(true);
  });

  const testMultipleSupplyOnBehalfOfAndWithdrawals = async (indexChange: boolean) => {
    const { pool, rusd, RSRUSD, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await RSRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await RSRUSD.balanceOf(bob.address);

    log('- Alice supplies 1000 RUSD');
    rcpt = await supply(pool, alice, rusd.address, '1000', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice supplies 200 RUSD to Bob');
    rcpt = await supply(pool, alice, rusd.address, '200', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Bob supplies 100 RUSD');
    rcpt = await supply(pool, bob, rusd.address, '100', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice transfers 100 aRUSD to Bob');
    const [fromScaledBefore, toScaledBefore] = await Promise.all([
      RSRUSD.scaledBalanceOf(alice.address),
      RSRUSD.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, rusd.address, '100', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);
    balanceTransferEv = getRSTokenEvent(RSRUSD, rcpt, 'BalanceTransfer')[0];
    expect(await RSRUSD.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await RSRUSD.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice withdraws 200 RUSD to Bob');
    rcpt = await withdraw(pool, alice, rusd.address, '200', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', RSRUSD, alice.address);
      await printBalance('bob', RSRUSD, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, rusd.address, '1', alice.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const aliceBalanceAfter = await RSRUSD.balanceOf(alice.address);

    rcpt = await supply(pool, bob, rusd.address, '1', bob.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const bobBalanceAfter = await RSRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 1000, transfers 100 to Bob, transfers 500 to itself, Bob transfers 500 from Alice to itself, withdraws 400 to Bob (without index change)', async () => {
    await testMultipleTransfersAndWithdrawals(false);
  });

  it('Alice supplies 1000, transfers 100 to Bob, transfers 500 to itself, Bob transfers 500 from Alice to itself, withdraws 400 to Bob  (with index change)', async () => {
    await testMultipleTransfersAndWithdrawals(true);
  });

  const testMultipleTransfersAndWithdrawals = async (indexChange: boolean) => {
    const { pool, rusd, RSRUSD, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await RSRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await RSRUSD.balanceOf(bob.address);

    log('- Alice supplies 1000 RUSD');
    rcpt = await supply(pool, alice, rusd.address, '1000', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice transfers 100 RUSD to Bob');
    let [fromScaledBefore, toScaledBefore] = await Promise.all([
      RSRUSD.scaledBalanceOf(alice.address),
      RSRUSD.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, rusd.address, '100', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);
    balanceTransferEv = getRSTokenEvent(RSRUSD, rcpt, 'BalanceTransfer')[0];
    expect(await RSRUSD.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await RSRUSD.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice transfers 500 RUSD to itself');
    fromScaledBefore = await RSRUSD.scaledBalanceOf(alice.address);
    rcpt = await transfer(pool, alice, rusd.address, '500', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);
    expect(await RSRUSD.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore,
      'Scaled balance should remain the same'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Bob transfersFrom Alice 500 RUSD to Alice');
    fromScaledBefore = await RSRUSD.scaledBalanceOf(alice.address);
    expect(
      await RSRUSD
        .connect(alice.signer)
        .approve(bob.address, await convertToCurrencyDecimals(rusd.address, '500'))
    );
    rcpt = await transferFrom(pool, bob, alice.address, rusd.address, '500', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);
    expect(await RSRUSD.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore,
      'Scaled balance should remain the same'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of RUSD');
      await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);
    }

    log('- Alice withdraws 400 RUSD to Bob');
    rcpt = await withdraw(pool, alice, rusd.address, '200', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', RSRUSD, alice.address);
      await printBalance('bob', RSRUSD, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, rusd.address, '1', alice.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const aliceBalanceAfter = await RSRUSD.balanceOf(alice.address);

    rcpt = await supply(pool, bob, rusd.address, '1', bob.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const bobBalanceAfter = await RSRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 300000, withdraws 200000 to Bob, withdraws 5 to Bob', async () => {
    const { pool, rusd, RSRUSD, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await RSRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await RSRUSD.balanceOf(bob.address);

    log('- Alice supplies 300000 RUSD');
    rcpt = await supply(pool, alice, rusd.address, '300000', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Increase index due to great borrow of RUSD');
    await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);

    log('- Alice withdraws 200000 RUSD to Bob');
    rcpt = await withdraw(pool, alice, rusd.address, '200000', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Increase index due to great borrow of RUSD');
    await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);

    log('- Alice withdraws 5 RUSD to Bob');
    rcpt = await withdraw(pool, alice, rusd.address, '5', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', RSRUSD, alice.address);
      await printBalance('bob', RSRUSD, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, rusd.address, '1', alice.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const aliceBalanceAfter = await RSRUSD.balanceOf(alice.address);

    rcpt = await supply(pool, bob, rusd.address, '1', bob.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const bobBalanceAfter = await RSRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  });

  it('Bob supplies 1000, Alice supplies 200 on behalf of Bob, Bob withdraws 200 on behalf of Alice', async () => {
    const { pool, rusd, RSRUSD, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await RSRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await RSRUSD.balanceOf(bob.address);

    log('- Bob supplies 1000 RUSD');
    rcpt = await supply(pool, bob, rusd.address, '1000', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Increase index due to great borrow of RUSD');
    await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);

    log('- Alice supplies 200 RUSD to Bob');
    rcpt = await supply(pool, alice, rusd.address, '200', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Increase index due to great borrow of RUSD');
    await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);

    log('- Bob withdraws 200 RUSD to Alice');
    rcpt = await withdraw(pool, bob, rusd.address, '200', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', RSRUSD, alice.address);
      await printBalance('bob', RSRUSD, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, rusd.address, '1', alice.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const aliceBalanceAfter = await RSRUSD.balanceOf(alice.address);

    rcpt = await supply(pool, bob, rusd.address, '1', bob.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const bobBalanceAfter = await RSRUSD.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  });

  it('Alice supplies 1000 RUSD and approves RSRUSD to Bob, Bob transfers 500 to himself and 300 to Eve, index change, principal goes back to Alice', async () => {
    const { pool, rusd, RSRUSD, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await RSRUSD.balanceOf(alice.address);
    let bobBalanceBefore = await RSRUSD.balanceOf(bob.address);
    let eveBalanceBefore = await RSRUSD.balanceOf(eve.address);

    log('- Alice supplies 1000 RUSD');
    rcpt = await supply(pool, alice, rusd.address, '1000', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Alice approves RSRUSD to Bob');
    await RSRUSD.connect(alice.signer).approve(bob.address, MAX_UINT_AMOUNT);

    log('- Bob transfers 500 RSRUSD from Alice to himself');
    rcpt = await transferFrom(pool, bob, alice.address, rusd.address, '500', bob.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Bob transfers 300 RSRUSD from Alice to Eve');
    rcpt = await transferFrom(pool, bob, alice.address, rusd.address, '300', eve.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Increase index due to great borrow of RUSD');
    await increaseSupplyIndex(pool, borrower, weth.address, rusd.address);

    log('- Bob transfers 500 back to Alice');
    rcpt = await transfer(pool, bob, rusd.address, '500', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    log('- Eve transfers 500 back to Alice');
    rcpt = await transfer(pool, eve, rusd.address, '300', alice.address, DEBUG);
    updateBalances(balances, RSRUSD, rcpt);

    if (DEBUG) {
      await printBalance('alice', RSRUSD, alice.address);
      await printBalance('bob', RSRUSD, bob.address);
      await printBalance('eve', RSRUSD, eve.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, rusd.address, '1', alice.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const aliceBalanceAfter = await RSRUSD.balanceOf(alice.address);

    rcpt = await supply(pool, bob, rusd.address, '1', bob.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const bobBalanceAfter = await RSRUSD.balanceOf(bob.address);

    rcpt = await supply(pool, eve, rusd.address, '1', eve.address, false);
    updateBalances(balances, RSRUSD, rcpt);
    const eveBalanceAfter = await RSRUSD.balanceOf(eve.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
    expect(eveBalanceAfter).to.be.closeTo(eveBalanceBefore.add(balances.balance[eve.address]), 2);
  });
});
