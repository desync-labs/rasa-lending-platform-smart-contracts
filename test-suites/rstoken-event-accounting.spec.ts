import { MockRSTokenRepayment } from './../types/mocks/tokens/MockRSTokenRepayment';
import { ZERO_ADDRESS } from '../helpers/constants';
import { waitForTx, increaseTime } from '../helpers/utilities/tx';
import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { RateMode } from '../helpers/types';
import { makeSuite } from './helpers/make-suite';
import { getRSTokenEvent, getVariableDebtTokenEvent } from './helpers/utils/tokenization-events';
import { MockRSTokenRepayment__factory } from '../types';

makeSuite('RSToken: Mint and Burn Event Accounting', (testEnv) => {
  let firstRUSDDeposit;
  let secondRUSDDeposit;
  let thirdRUSDDeposit;
  let accruedInterest1: BigNumber = BigNumber.from(0);
  let accruedInterest2: BigNumber = BigNumber.from(0);
  let accruedInterest3: BigNumber = BigNumber.from(0);

  let firstRUSDBorrow;
  let secondRUSDBorrow;
  let accruedDebt1: BigNumber = BigNumber.from(0);
  let accruedDebt2: BigNumber = BigNumber.from(0);
  let accruedDebt3: BigNumber = BigNumber.from(0);
  let RSTokenRepayImpl: MockRSTokenRepayment;

  const transferEventSignature = utils.keccak256(
    utils.toUtf8Bytes('Transfer(address,address,uint256)')
  );

  before('User 0 deposits 100 RUSD, user 1 deposits 1 WETH, borrows 50 RUSD', async () => {
    const { rusd, configurator, RSRUSD, deployer, pool } = testEnv;
    firstRUSDDeposit = await convertToCurrencyDecimals(rusd.address, '10000');
    secondRUSDDeposit = await convertToCurrencyDecimals(rusd.address, '20000');
    thirdRUSDDeposit = await convertToCurrencyDecimals(rusd.address, '50000');

    RSTokenRepayImpl = await new MockRSTokenRepayment__factory(deployer.signer).deploy(pool.address);

    await configurator.updateRSToken({
      asset: rusd.address,
      treasury: await RSRUSD.RESERVE_TREASURY_ADDRESS(),
      incentivesController: await RSRUSD.getIncentivesController(),
      name: await RSRUSD.name(),
      symbol: await RSRUSD.symbol(),
      implementation: RSTokenRepayImpl.address,
      params: '0x',
    });
  });

  it('User 1 supplies RUSD', async () => {
    const {
      rusd,
      RSRUSD,
      users: [depositor],
      pool,
      helpersContract,
    } = testEnv;

    // mints RUSD to depositor
    await waitForTx(
      await rusd
        .connect(depositor.signer)
        ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '10000'))
    );

    // approve protocol to access depositor wallet
    await waitForTx(await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT));

    const rusdReserveData = await helpersContract.getReserveData(rusd.address);

    const expectedBalanceIncrease = 0;

    await expect(
      pool.connect(depositor.signer).deposit(rusd.address, firstRUSDDeposit, depositor.address, '0')
    )
      .to.emit(RSRUSD, 'Mint')
      .withArgs(
        depositor.address,
        depositor.address,
        firstRUSDDeposit,
        expectedBalanceIncrease,
        rusdReserveData.liquidityIndex
      );

    const RSRUSDBalance = await RSRUSD.balanceOf(depositor.address);
    expect(RSRUSDBalance).to.be.equal(firstRUSDDeposit);
  });

  it('User 1 supplies RUSD on behalf of user 2', async () => {
    const {
      rusd,
      RSRUSD,
      users: [depositor, receiver],
      pool,
      helpersContract,
    } = testEnv;

    // mints RUSD to depositor
    await waitForTx(
      await rusd
        .connect(depositor.signer)
        ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '10000'))
    );

    // approve protocol to access depositor wallet
    await waitForTx(await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT));

    const rusdReserveData = await helpersContract.getReserveData(rusd.address);

    const expectedBalanceIncrease = 0;

    await expect(
      pool.connect(depositor.signer).deposit(rusd.address, firstRUSDDeposit, receiver.address, '0')
    )
      .to.emit(RSRUSD, 'Mint')
      .withArgs(
        depositor.address,
        receiver.address,
        firstRUSDDeposit,
        expectedBalanceIncrease,
        rusdReserveData.liquidityIndex
      );

    const RSRUSDBalance = await RSRUSD.balanceOf(receiver.address);
    expect(RSRUSDBalance).to.be.equal(firstRUSDDeposit);
  });

  it('User 2 supplies ETH,and borrows RUSD', async () => {
    const {
      rusd,
      weth,
      users: [, borrower],
      pool,
      helpersContract,
    } = testEnv;

    // user 2 deposits 100 ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '20000');

    // mints WETH to borrower
    await waitForTx(
      await weth
        .connect(borrower.signer)
        ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '20000'))
    );

    // approve protocol to access the borrower wallet
    await waitForTx(await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT));

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .deposit(weth.address, amountETHtoDeposit, borrower.address, '0')
    );

    // Borrow RUSD
    firstRUSDBorrow = await convertToCurrencyDecimals(rusd.address, '5000');

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(rusd.address, firstRUSDBorrow, RateMode.Variable, '0', borrower.address)
    );

    const borrowerWethData = await helpersContract.getUserReserveData(
      weth.address,
      borrower.address
    );
    const borrowerRUSDData = await helpersContract.getUserReserveData(rusd.address, borrower.address);
    expect(borrowerWethData.currentRSTokenBalance).to.be.equal(amountETHtoDeposit);
    expect(borrowerRUSDData.currentVariableDebt).to.be.equal(firstRUSDBorrow);
  });

  it('User 2 borrows more RUSD - confirm mint event includes accrued interest', async () => {
    const {
      rusd,
      variableDebtRUSD,
      users: [, borrower],
      pool,
      helpersContract,
    } = testEnv;
    await increaseTime(86400);

    // execute borrow
    secondRUSDBorrow = await convertToCurrencyDecimals(rusd.address, '2000');
    const borrowTx = await pool
      .connect(borrower.signer)
      .borrow(rusd.address, secondRUSDBorrow, RateMode.Variable, '0', borrower.address);
    const borrowReceipt = await borrowTx.wait();

    const borrowerRUSDData = await helpersContract.getUserReserveData(rusd.address, borrower.address);
    accruedDebt1 = borrowerRUSDData.currentVariableDebt.sub(firstRUSDBorrow).sub(secondRUSDBorrow);
    const totalMinted = secondRUSDBorrow.add(accruedDebt1);

    // get transfer event
    const rawTransferEvents = borrowReceipt.logs.filter(
      (log) => log.topics[0] === transferEventSignature
    );
    expect(rawTransferEvents.length).to.equal(2, 'Incorrect number of Transfer Events');
    const parsedTransferEvent = variableDebtRUSD.interface.parseLog(rawTransferEvents[0]);

    // get mint event
    const parsedMintEvents = getVariableDebtTokenEvent(variableDebtRUSD, borrowReceipt, 'Mint');
    expect(parsedMintEvents.length).to.equal(1, 'Incorrect number of Mint Events');
    const parsedMintEvent = parsedMintEvents[0];

    // check transfer event parameters
    expect(parsedTransferEvent.args.from).to.equal(ZERO_ADDRESS);
    expect(parsedTransferEvent.args.to).to.equal(borrower.address);
    expect(parsedTransferEvent.args.value).to.be.closeTo(totalMinted, 2);

    // check mint event parameters
    expect(parsedMintEvent.caller).to.equal(borrower.address);
    expect(parsedMintEvent.onBehalfOf).to.equal(borrower.address);
    expect(parsedMintEvent.value).to.be.closeTo(totalMinted, 2);
    expect(parsedMintEvent.balanceIncrease).to.be.closeTo(accruedDebt1, 2);
  });

  it('User 1 - supplies more RUSD - confirm mint event includes accrued interest', async () => {
    const {
      rusd,
      RSRUSD,
      users: [depositor],
      pool,
    } = testEnv;

    await increaseTime(86400);

    // mints RUSD to depositor
    await waitForTx(
      await rusd
        .connect(depositor.signer)
        ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '20000'))
    );

    // user 1 deposits 2000 RUSD
    const depositTx = await waitForTx(
      await pool
        .connect(depositor.signer)
        .deposit(rusd.address, secondRUSDDeposit, depositor.address, '0')
    );

    const RSRUSDBalance = await RSRUSD.balanceOf(depositor.address);
    accruedInterest1 = RSRUSDBalance.sub(firstRUSDDeposit).sub(secondRUSDDeposit);
    const totalMinted = secondRUSDDeposit.add(accruedInterest1);

    // get transfer event
    const rawTransferEvents = depositTx.logs.filter(
      (log) => log.topics[0] === transferEventSignature
    );
    expect(rawTransferEvents.length).to.equal(2, 'Incorrect number of Transfer Events');
    const parsedTransferEvent = RSRUSD.interface.parseLog(rawTransferEvents[1]);

    // get mint event
    const parsedMintEvents = getRSTokenEvent(RSRUSD, depositTx, 'Mint');
    expect(parsedMintEvents.length).to.equal(1, 'Incorrect number of Mint Events');
    const parsedMintEvent = parsedMintEvents[0];

    // check transfer event parameters
    expect(parsedTransferEvent.args.from).to.equal(ZERO_ADDRESS);
    expect(parsedTransferEvent.args.to).to.equal(depositor.address);
    expect(parsedTransferEvent.args.value).to.be.closeTo(totalMinted, 2);

    // check mint event parameters
    expect(parsedMintEvent.caller).to.equal(depositor.address);
    expect(parsedMintEvent.onBehalfOf).to.equal(depositor.address);
    expect(parsedMintEvent.value).to.be.closeTo(totalMinted, 2);
    expect(parsedMintEvent.balanceIncrease).to.be.closeTo(accruedInterest1, 2);
  });

  it('User 1 supplies more RUSD again - confirm mint event includes accrued interest', async () => {
    const {
      rusd,
      RSRUSD,
      users: [depositor],
      pool,
      helpersContract,
    } = testEnv;

    await increaseTime(86400);

    // mints RUSD to depositor
    await waitForTx(
      await rusd
        .connect(depositor.signer)
        ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '50000'))
    );

    // user 1 deposits 2000 RUSD
    const depositTx = await pool
      .connect(depositor.signer)
      .deposit(rusd.address, thirdRUSDDeposit, depositor.address, '0');
    const depositReceipt = await depositTx.wait();

    const RSRUSDBalance = await RSRUSD.balanceOf(depositor.address);
    accruedInterest2 = RSRUSDBalance
      .sub(firstRUSDDeposit)
      .sub(secondRUSDDeposit)
      .sub(thirdRUSDDeposit)
      .sub(accruedInterest1);
    const rusdReserveData = await helpersContract.getReserveData(rusd.address);
    const totalMinted = thirdRUSDDeposit.add(accruedInterest2);

    // get transfer event
    const rawTransferEvents = depositReceipt.logs.filter(
      (log) => log.topics[0] === transferEventSignature
    );
    expect(rawTransferEvents.length).to.equal(2, 'Incorrect number of Transfer Events');
    const parsedTransferEvent = RSRUSD.interface.parseLog(rawTransferEvents[1]);

    // get mint event
    const parsedMintEvents = getRSTokenEvent(RSRUSD, depositReceipt, 'Mint');
    expect(parsedMintEvents.length).to.equal(1, 'Incorrect number of Mint Events');
    const parsedMintEvent = parsedMintEvents[0];

    // check transfer event
    expect(parsedTransferEvent.args.from).to.equal(ZERO_ADDRESS);
    expect(parsedTransferEvent.args.to).to.be.equal(depositor.address);
    expect(parsedTransferEvent.args.value).to.be.closeTo(totalMinted, 2);

    // check mint event
    expect(parsedMintEvent.caller).to.equal(depositor.address);
    expect(parsedMintEvent.onBehalfOf).to.equal(depositor.address);
    expect(parsedMintEvent.value).to.be.closeTo(totalMinted, 2);
    expect(parsedMintEvent.balanceIncrease).to.be.closeTo(accruedInterest2, 2);
    expect(parsedMintEvent.index).to.equal(rusdReserveData.liquidityIndex);
  });

  it('User 2 repays all remaining RUSD', async () => {
    const {
      rusd,
      RSRUSD,
      variableDebtRUSD,
      users: [, borrower],
      pool,
      helpersContract,
    } = testEnv;

    await increaseTime(86400);

    //mints RUSD to borrower
    await waitForTx(
      await rusd
        .connect(borrower.signer)
        ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '50000'))
    );

    // approve protocol to access depositor wallet
    await waitForTx(await rusd.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT));

    const rusdBalanceBefore = await rusd.balanceOf(borrower.address);

    // repay rusd loan
    const repayTx = await pool
      .connect(borrower.signer)
      .repay(rusd.address, MAX_UINT_AMOUNT, RateMode.Variable, borrower.address);

    const repayReceipt = await repayTx.wait();

    const rusdBalanceAfter = await rusd.balanceOf(borrower.address);
    const rusdRepaid = rusdBalanceBefore.sub(rusdBalanceAfter);
    accruedDebt3 = rusdRepaid
      .sub(firstRUSDBorrow)
      .sub(accruedDebt1)
      .sub(secondRUSDBorrow)
      .sub(accruedDebt2);
    const borrowerRUSDData = await helpersContract.getUserReserveData(rusd.address, borrower.address);
    const totalBurned = rusdRepaid.sub(accruedDebt3);

    // get transfer event
    const rawTransferEvents = repayReceipt.logs.filter(
      (log) => log.topics[0] === transferEventSignature
    );
    expect(rawTransferEvents.length).to.equal(2, 'Incorrect number of Transfer Events');
    const parsedTransferEvent = variableDebtRUSD.interface.parseLog(rawTransferEvents[0]);

    // get burn event
    const parsedBurnEvents = getVariableDebtTokenEvent(variableDebtRUSD, repayReceipt, 'Burn');
    expect(parsedBurnEvents.length).to.equal(1, 'Incorrect number of Burn Events');
    const parsedBurnEvent = parsedBurnEvents[0];

    // check burn parameters
    expect(parsedTransferEvent.args.from).to.equal(borrower.address);
    expect(parsedTransferEvent.args.to).to.equal(ZERO_ADDRESS);
    expect(parsedTransferEvent.args.value).to.be.closeTo(totalBurned, 2);

    // check burn parameters
    expect(parsedBurnEvent.from).to.equal(borrower.address);
    expect(parsedBurnEvent.value).to.be.closeTo(totalBurned, 2);
    expect(parsedBurnEvent.balanceIncrease).to.be.closeTo(accruedDebt3, 2);
    expect(borrowerRUSDData.currentVariableDebt).to.be.equal(0);

    // check handleRepayment function is correctly called
    await expect(repayTx)
      .to.emit(RSTokenRepayImpl.attach(RSRUSD.address), 'MockRepayment')
      .withArgs(borrower.address, borrower.address, rusdRepaid);
  });

  it('User 1 withdraws all deposited funds and interest', async () => {
    const {
      rusd,
      RSRUSD,
      users: [depositor],
      pool,
      helpersContract,
    } = testEnv;
    const rusdBalanceBefore = await rusd.balanceOf(depositor.address);

    const withdrawTx = await pool
      .connect(depositor.signer)
      .withdraw(rusd.address, MAX_UINT_AMOUNT, depositor.address);
    const withdrawReceipt = await withdrawTx.wait();

    const RSRUSDBalance = await RSRUSD.balanceOf(depositor.address);
    expect(RSRUSDBalance).to.be.equal(0);

    const rusdBalanceAfter = await rusd.balanceOf(depositor.address);
    const rusdWithdrawn = rusdBalanceAfter.sub(rusdBalanceBefore);
    accruedInterest3 = rusdWithdrawn
      .sub(firstRUSDDeposit)
      .sub(accruedInterest1)
      .sub(secondRUSDDeposit)
      .sub(accruedInterest2)
      .sub(thirdRUSDDeposit);
    const totalBurned = rusdWithdrawn.sub(accruedInterest3);
    const rusdReserveData = await helpersContract.getReserveData(rusd.address);

    // get transfer event
    const rawTransferEvents = withdrawReceipt.logs.filter(
      (log) => log.topics[0] === transferEventSignature
    );
    expect(rawTransferEvents.length).to.equal(2, 'Incorrect number of Transfer Events');
    const parsedTransferEvent = RSRUSD.interface.parseLog(rawTransferEvents[0]);

    // get burn event
    const parsedBurnEvents = getRSTokenEvent(RSRUSD, withdrawReceipt, 'Burn');
    expect(parsedBurnEvents.length).to.equal(1, 'Incorrect number of Burn Events');
    const parsedBurnEvent = parsedBurnEvents[0];

    // check transfer parameters
    expect(parsedTransferEvent.args.from).to.equal(depositor.address);
    expect(parsedTransferEvent.args.to).to.equal(ZERO_ADDRESS);
    expect(parsedTransferEvent.args.value).to.be.closeTo(totalBurned, 2);

    // check burn parameters
    expect(parsedBurnEvent.from).to.equal(depositor.address);
    expect(parsedBurnEvent.target).to.equal(depositor.address);
    expect(parsedBurnEvent.value).to.be.closeTo(totalBurned, 2);
    expect(parsedBurnEvent.balanceIncrease).to.be.closeTo(accruedInterest3, 2);
    expect(parsedBurnEvent.index).to.equal(rusdReserveData.liquidityIndex);
  });

  it('User 2 borrows, pass time and repay RUSD less than accrued debt', async () => {
    const {
      rusd,
      variableDebtRUSD,
      users: [depositor, borrower],
      pool,
    } = testEnv;

    // User 1 - Deposit RUSD
    await waitForTx(
      await pool
        .connect(depositor.signer)
        .deposit(rusd.address, firstRUSDDeposit, depositor.address, '0')
    );

    // User 2 - Borrow RUSD
    const borrowAmount = await convertToCurrencyDecimals(rusd.address, '8000');
    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(rusd.address, borrowAmount, RateMode.Variable, '0', borrower.address)
    );

    const debtBalanceBefore = await variableDebtRUSD.balanceOf(borrower.address);

    await increaseTime(86400);

    // repay a very small amount - less than accrued debt
    const smallRepay = BigNumber.from('100000');

    // approve protocol to access depositor wallet
    await waitForTx(await rusd.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT));

    // repay RUSD loan
    const repayTx = await pool
      .connect(borrower.signer)
      .repay(rusd.address, smallRepay, RateMode.Variable, borrower.address);
    const repayReceipt = await repayTx.wait();

    const debtBalanceAfter = await variableDebtRUSD.balanceOf(borrower.address);
    const totalMinted = debtBalanceAfter.sub(debtBalanceBefore);

    // get transfer event
    const rawTransferEvents = repayReceipt.logs.filter(
      (log) => log.topics[0] === transferEventSignature
    );
    expect(rawTransferEvents.length).to.equal(2, 'Incorrect number of Transfer Events');
    const parsedTransferEvent = variableDebtRUSD.interface.parseLog(rawTransferEvents[0]);

    // get mint event
    const parsedMintEvents = getVariableDebtTokenEvent(variableDebtRUSD, repayReceipt, 'Mint');
    expect(parsedMintEvents.length).to.equal(1, 'Incorrect number of Mint Events');
    const parsedMintEvent = parsedMintEvents[0];

    // check transfer event
    expect(parsedTransferEvent.args.from).to.equal(ZERO_ADDRESS);
    expect(parsedTransferEvent.args.to).to.equal(borrower.address);
    expect(parsedTransferEvent.args.value).to.be.closeTo(totalMinted, 2);

    // check mint event
    expect(parsedMintEvent.caller).to.equal(borrower.address);
    expect(parsedMintEvent.onBehalfOf).to.equal(borrower.address);
    expect(parsedMintEvent.value).to.be.closeTo(totalMinted, 2);
    expect(parsedMintEvent.balanceIncrease).to.be.closeTo(totalMinted.add(smallRepay), 2);
  });

  it('User 1 withdraws amount less than accrued interest', async () => {
    const {
      rusd,
      RSRUSD,
      users: [depositor],
      pool,
      helpersContract,
    } = testEnv;

    // repay a very small amount - less than accrued debt
    const smallWithdrawal = BigNumber.from('100000');

    const withdrawTx = await pool
      .connect(depositor.signer)
      .withdraw(rusd.address, smallWithdrawal, depositor.address);
    const withdrawReceipt = await withdrawTx.wait();

    const RSTokenSupplyAfter = await RSRUSD.balanceOf(depositor.address);
    const rusdReserveData = await helpersContract.getReserveData(rusd.address);
    const totalMinted = RSTokenSupplyAfter.sub(firstRUSDDeposit);

    // get transfer event
    const rawTransferEvents = withdrawReceipt.logs.filter(
      (log) => log.topics[0] === transferEventSignature
    );
    expect(rawTransferEvents.length).to.equal(2, 'Incorrect number of Transfer Events');
    const parsedTransferEvent = RSRUSD.interface.parseLog(rawTransferEvents[0]);

    // get mint event
    const parsedMintEvents = getRSTokenEvent(RSRUSD, withdrawReceipt, 'Mint');
    expect(parsedMintEvents.length).to.equal(1, 'Incorrect number of Mint Events');
    const parsedMintEvent = parsedMintEvents[0];

    // check transfer event
    expect(parsedTransferEvent.args.from).to.equal(ZERO_ADDRESS);
    expect(parsedTransferEvent.args.to).to.equal(depositor.address);
    expect(parsedTransferEvent.args.value).to.be.closeTo(totalMinted, 2);

    // check mint event
    expect(parsedMintEvent.caller).to.equal(depositor.address);
    expect(parsedMintEvent.onBehalfOf).to.equal(depositor.address);
    expect(parsedMintEvent.value).to.be.closeTo(totalMinted, 2);
    expect(parsedMintEvent.balanceIncrease).to.be.closeTo(totalMinted.add(smallWithdrawal), 2);
    expect(parsedMintEvent.index).to.equal(rusdReserveData.liquidityIndex);
  });
});
