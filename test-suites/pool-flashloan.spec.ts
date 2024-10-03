import { deployDefaultReserveInterestRateStrategy } from '../helpers/contract-deployments';
import { expect } from 'chai';
import { BigNumber, ethers, Event, utils } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { MockFlashLoanReceiver } from '../types/MockFlashLoanReceiver';
import { ProtocolErrors } from '../helpers/types';

import {
  getMockFlashLoanReceiver,
  getStableDebtToken,
  getVariableDebtToken,
} from '../helpers/contract-getters';
import { TestEnv, makeSuite } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import { waitForTx } from '../helpers/utilities/tx';
import { MockRSTokenRepayment__factory } from '../types';

makeSuite('Pool: FlashLoan', (testEnv: TestEnv) => {
  let _mockFlashLoanReceiver = {} as MockFlashLoanReceiver;

  const {
    COLLATERAL_BALANCE_IS_ZERO,
    ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE,
    INVALID_FLASHLOAN_EXECUTOR_RETURN,
    FLASHLOAN_DISABLED,
    BORROWING_NOT_ENABLED,
  } = ProtocolErrors;

  const TOTAL_PREMIUM = 9;
  const PREMIUM_TO_PROTOCOL = 3000;

  before(async () => {
    const { eurs, RSEurs, pool, configurator, deployer } = testEnv;
    _mockFlashLoanReceiver = await getMockFlashLoanReceiver();

    const RSTokenRepayImpl = await new MockRSTokenRepayment__factory(deployer.signer).deploy(
      pool.address
    );

    await configurator.updateRSToken({
      asset: eurs.address,
      treasury: await RSEurs.RESERVE_TREASURY_ADDRESS(),
      incentivesController: await RSEurs.getIncentivesController(),
      name: await RSEurs.name(),
      symbol: await RSEurs.symbol(),
      implementation: RSTokenRepayImpl.address,
      params: '0x',
    });
  });

  it('Configurator sets total premium = 9 bps, premium to protocol = 30%', async () => {
    const { configurator, pool } = testEnv;
    await configurator.updateFlashloanPremiumTotal(TOTAL_PREMIUM);
    await configurator.updateFlashloanPremiumToProtocol(PREMIUM_TO_PROTOCOL);

    expect(await pool.FLASHLOAN_PREMIUM_TOTAL()).to.be.equal(TOTAL_PREMIUM);
    expect(await pool.FLASHLOAN_PREMIUM_TO_PROTOCOL()).to.be.equal(PREMIUM_TO_PROTOCOL);
  });
  it('Deposits WETH into the reserve', async () => {
    const { pool, weth, cgo, rusd } = testEnv;
    const userAddress = await pool.signer.getAddress();
    const amountToDeposit = ethers.utils.parseEther('1');

    await weth['mint(uint256)'](amountToDeposit);

    await weth.approve(pool.address, MAX_UINT_AMOUNT);

    await pool.deposit(weth.address, amountToDeposit, userAddress, '0');

    await cgo['mint(uint256)'](amountToDeposit);

    await cgo.approve(pool.address, MAX_UINT_AMOUNT);

    await pool.deposit(cgo.address, amountToDeposit, userAddress, '0');
    await rusd['mint(uint256)'](amountToDeposit);

    await rusd.approve(pool.address, MAX_UINT_AMOUNT);

    await pool.deposit(rusd.address, amountToDeposit, userAddress, '0');
  });

  it('Takes WETH + RUSD flash loan with mode = 0, returns the funds correctly', async () => {
    const { pool, helpersContract, weth, RSWETH, rusd, RSRUSD } = testEnv;

    const wethFlashBorrowedAmount = ethers.utils.parseEther('0.8');
    const rusdFlashBorrowedAmount = ethers.utils.parseEther('0.3');
    const wethTotalFees = wethFlashBorrowedAmount.mul(TOTAL_PREMIUM).div(10000);
    const wethFeesToProtocol = wethTotalFees.mul(PREMIUM_TO_PROTOCOL).div(10000);
    const wethFeesToLp = wethTotalFees.sub(wethFeesToProtocol);
    const rusdTotalFees = rusdFlashBorrowedAmount.mul(TOTAL_PREMIUM).div(10000);
    const rusdFeesToProtocol = rusdTotalFees.mul(PREMIUM_TO_PROTOCOL).div(10000);
    const rusdFeesToLp = rusdTotalFees.sub(rusdFeesToProtocol);

    const wethLiquidityIndexAdded = wethFeesToLp
      .mul(BigNumber.from(10).pow(27))
      .div(await RSWETH.totalSupply());

    const rusdLiquidityIndexAdded = rusdFeesToLp
      .mul(ethers.BigNumber.from(10).pow(27))
      .div(await RSRUSD.totalSupply());

    let wethReserveData = await helpersContract.getReserveData(weth.address);
    let rusdReserveData = await helpersContract.getReserveData(rusd.address);

    const wethLiquidityIndexBefore = wethReserveData.liquidityIndex;
    const rusdLiquidityIndexBefore = rusdReserveData.liquidityIndex;

    const wethTotalLiquidityBefore = wethReserveData.totalRSToken;

    const rusdTotalLiquidityBefore = rusdReserveData.totalRSToken;

    const wethReservesBefore = await RSWETH.balanceOf(await RSWETH.RESERVE_TREASURY_ADDRESS());
    const rusdReservesBefore = await RSRUSD.balanceOf(await RSRUSD.RESERVE_TREASURY_ADDRESS());

    const tx = await waitForTx(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address, rusd.address],
        [wethFlashBorrowedAmount, rusdFlashBorrowedAmount],
        [0, 0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    );

    await pool.mintToTreasury([weth.address, rusd.address]);

    wethReserveData = await helpersContract.getReserveData(weth.address);
    rusdReserveData = await helpersContract.getReserveData(rusd.address);

    const wethCurrentLiquidityRate = wethReserveData.liquidityRate;
    const wethCurrentLiquidityIndex = wethReserveData.liquidityIndex;
    const rusdCurrentLiquidityRate = rusdReserveData.liquidityRate;
    const rusdCurrentLiquidityIndex = rusdReserveData.liquidityIndex;

    const wethTotalLiquidityAfter = wethReserveData.totalRSToken;

    const rusdTotalLiquidityAfter = rusdReserveData.totalRSToken;

    const wethReservesAfter = await RSWETH.balanceOf(await RSWETH.RESERVE_TREASURY_ADDRESS());
    const rusdReservesAfter = await RSRUSD.balanceOf(await RSRUSD.RESERVE_TREASURY_ADDRESS());

    expect(wethTotalLiquidityBefore.add(wethTotalFees)).to.be.closeTo(wethTotalLiquidityAfter, 2);
    expect(wethCurrentLiquidityRate).to.be.equal(0);
    expect(wethCurrentLiquidityIndex).to.be.equal(
      wethLiquidityIndexBefore.add(wethLiquidityIndexAdded)
    );
    expect(wethReservesAfter).to.be.equal(wethReservesBefore.add(wethFeesToProtocol));

    expect(rusdTotalLiquidityBefore.add(rusdTotalFees)).to.be.closeTo(rusdTotalLiquidityAfter, 2);
    expect(rusdCurrentLiquidityRate).to.be.equal(0);
    expect(rusdCurrentLiquidityIndex).to.be.equal(
      rusdLiquidityIndexBefore.add(rusdLiquidityIndexAdded)
    );
    expect(rusdReservesAfter).to.be.equal(rusdReservesBefore.add(rusdFeesToProtocol));

    // Check event values for `ReserveDataUpdated`
    const reserveDataUpdatedEvents = tx.events?.filter(
      ({ event }) => event === 'ReserveDataUpdated'
    ) as Event[];
    for (const reserveDataUpdatedEvent of reserveDataUpdatedEvents) {
      const reserveData = await helpersContract.getReserveData(
        reserveDataUpdatedEvent.args?.reserve
      );
      expect(reserveData.liquidityRate).to.be.eq(reserveDataUpdatedEvent.args?.liquidityRate);
      expect(reserveData.stableBorrowRate).to.be.eq(reserveDataUpdatedEvent.args?.stableBorrowRate);
      expect(reserveData.variableBorrowRate).to.be.eq(
        reserveDataUpdatedEvent.args?.variableBorrowRate
      );
      expect(reserveData.liquidityIndex).to.be.eq(reserveDataUpdatedEvent.args?.liquidityIndex);
      expect(reserveData.variableBorrowIndex).to.be.eq(
        reserveDataUpdatedEvent.args?.variableBorrowIndex
      );
    }
  });

  it('Takes an authorized CGO flash loan with mode = 0, returns the funds correctly, premium should be 0', async () => {
    const {
      pool,
      helpersContract,
      cgo,
      aclManager,
      users: [, , , authorizedUser],
    } = testEnv;

    expect(await aclManager.addFlashBorrower(authorizedUser.address));

    const flashBorrowedAmount = ethers.utils.parseEther('0.8');
    const totalFees = BigNumber.from(0);

    let reserveData = await helpersContract.getReserveData(cgo.address);

    const totalLiquidityBefore = reserveData.totalRSToken;

    await expect(
      pool
        .connect(authorizedUser.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [cgo.address],
          [flashBorrowedAmount],
          [0],
          _mockFlashLoanReceiver.address,
          '0x10',
          '0'
        )
    )
      .to.emit(_mockFlashLoanReceiver, 'ExecutedWithSuccess')
      .withArgs([cgo.address], [flashBorrowedAmount], [0]);

    await pool.mintToTreasury([cgo.address]);

    reserveData = await helpersContract.getReserveData(cgo.address);

    const totalLiquidityAfter = reserveData.totalRSToken;

    expect(totalLiquidityBefore.add(totalFees)).to.be.closeTo(totalLiquidityAfter, 2);
  });

  it('Takes an ETH flashloan with mode = 0 as big as the available liquidity', async () => {
    const { pool, helpersContract, weth, RSWETH, deployer } = testEnv;

    let reserveData = await helpersContract.getReserveData(weth.address);

    const totalLiquidityBefore = reserveData.totalRSToken;

    const flashBorrowedAmount = totalLiquidityBefore;

    const totalFees = flashBorrowedAmount.mul(TOTAL_PREMIUM).div(10000);
    const feesToProtocol = totalFees.mul(PREMIUM_TO_PROTOCOL).div(10000);
    const feesToLp = totalFees.sub(feesToProtocol);
    const liquidityIndexBefore = reserveData.liquidityIndex;
    const liquidityIndexAdded = feesToLp
      .mul(BigNumber.from(10).pow(27))
      .div((await RSWETH.totalSupply()).toString())
      .mul(liquidityIndexBefore)
      .div(BigNumber.from(10).pow(27));

    const reservesBefore = await RSWETH.balanceOf(await RSWETH.RESERVE_TREASURY_ADDRESS());

    await expect(
      pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        [flashBorrowedAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    )
      .to.emit(pool, 'FlashLoan')
      .withArgs(
        _mockFlashLoanReceiver.address,
        deployer.address,
        weth.address,
        flashBorrowedAmount,
        0,
        flashBorrowedAmount.mul(9).div(10000),
        0
      );
    await pool.mintToTreasury([weth.address]);

    reserveData = await helpersContract.getReserveData(weth.address);

    const currentLiquidityRate = reserveData.liquidityRate;
    const currentLiquidityIndex = reserveData.liquidityIndex;

    const totalLiquidityAfter = reserveData.totalRSToken;

    const reservesAfter = await RSWETH.balanceOf(await RSWETH.RESERVE_TREASURY_ADDRESS());
    expect(totalLiquidityBefore.add(totalFees)).to.be.closeTo(totalLiquidityAfter, 2);
    expect(currentLiquidityRate).to.be.equal(0);
    expect(currentLiquidityIndex).to.be.equal(liquidityIndexBefore.add(liquidityIndexAdded));
    expect(
      reservesAfter.sub(feesToProtocol).mul(liquidityIndexBefore).div(currentLiquidityIndex)
    ).to.be.closeTo(reservesBefore, 2);
  });

  it('Disable ETH flashloan and takes an ETH flashloan (revert expected)', async () => {
    const { pool, configurator, helpersContract, weth, deployer } = testEnv;

    expect(await configurator.setReserveFlashLoaning(weth.address, false));

    let wethFlashLoanEnabled = await helpersContract.getFlashLoanEnabled(weth.address);
    expect(wethFlashLoanEnabled).to.be.equal(false);

    let reserveData = await helpersContract.getReserveData(weth.address);

    const totalLiquidityBefore = reserveData.totalRSToken;

    const flashBorrowedAmount = totalLiquidityBefore;

    await expect(
      pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        [flashBorrowedAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    ).to.be.revertedWith(FLASHLOAN_DISABLED);

    await expect(configurator.setReserveFlashLoaning(weth.address, true))
      .to.emit(configurator, 'ReserveFlashLoaning')
      .withArgs(weth.address, true);

    wethFlashLoanEnabled = await helpersContract.getFlashLoanEnabled(weth.address);
    expect(wethFlashLoanEnabled).to.be.equal(true);
  });

  it('Takes WETH flashloan, does not return the funds with mode = 0 (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [ethers.utils.parseEther('0.8')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Takes WETH flashloan, simulating a receiver as EOA (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);
    await _mockFlashLoanReceiver.setSimulateEOA(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [ethers.utils.parseEther('0.8')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(INVALID_FLASHLOAN_EXECUTOR_RETURN);
  });

  it('Takes a WETH flashloan with an invalid mode (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setSimulateEOA(false);
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [ethers.utils.parseEther('0.8')],
          [4],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Caller deposits 1000 RUSD as collateral, Takes WETH flashloan with mode = 2, does not return the funds. A variable loan for caller is created', async () => {
    const { rusd, pool, weth, users, helpersContract } = testEnv;

    const caller = users[1];

    await rusd
      .connect(caller.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));

    await rusd.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const amountToDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    await pool.connect(caller.signer).deposit(rusd.address, amountToDeposit, caller.address, '0');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    let reserveData = await helpersContract.getReserveData(weth.address);

    let totalLiquidityBefore = reserveData.totalRSToken;

    const borrowAmount = ethers.utils.parseEther('0.0571');

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [borrowAmount],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    )
      .to.emit(pool, 'FlashLoan')
      .withArgs(
        _mockFlashLoanReceiver.address,
        caller.address,
        weth.address,
        borrowAmount,
        2,
        0,
        0
      );

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      weth.address
    );
    reserveData = await helpersContract.getReserveData(weth.address);

    const totalLiquidityAfter = reserveData.totalRSToken;

    expect(totalLiquidityAfter).to.be.closeTo(totalLiquidityBefore, 2);

    const wethDebtToken = await getVariableDebtToken(variableDebtTokenAddress);
    const callerDebt = await wethDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('57100000000000000', 'Invalid user debt');
    // repays debt for later, so no interest accrue
    await weth
      .connect(caller.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '1000'));
    await weth.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(caller.signer).repay(weth.address, MAX_UINT_AMOUNT, 2, caller.address);
  });
  it('Tries to take a flashloan that is bigger than the available liquidity (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];

    await expect(
      pool.connect(caller.signer).flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        ['1004415000000000000'], //slightly higher than the available liquidity
        [2],
        caller.address,
        '0x10',
        '0'
      ),
      ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
    ).to.be.reverted;
  });

  it('Tries to take a flashloan using a non contract address as receiver (revert expected)', async () => {
    const { pool, deployer, weth, users } = testEnv;
    const caller = users[1];

    await expect(
      pool.flashLoan(
        deployer.address,
        [weth.address],
        ['1000000000000000000'],
        [2],
        caller.address,
        '0x10',
        '0'
      )
    ).to.be.reverted;
  });

  it('Deposits EURS into the reserve', async () => {
    const { eurs, pool } = testEnv;
    const userAddress = await pool.signer.getAddress();

    await eurs['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '1000'));

    await eurs.approve(pool.address, MAX_UINT_AMOUNT);

    const amountToDeposit = await convertToCurrencyDecimals(eurs.address, '1000');
    await pool.deposit(eurs.address, amountToDeposit, userAddress, '0');

  });

  it('Takes out a 500 EURS flashloan, returns the funds correctly', async () => {
    const { eurs, RSEurs, pool, helpersContract, deployer: depositor } = testEnv;

    await _mockFlashLoanReceiver.setFailExecutionTransfer(false);

    const flashBorrowedAmount = await convertToCurrencyDecimals(eurs.address, '600');
    const totalFees = flashBorrowedAmount.mul(TOTAL_PREMIUM).div(10000);
    const feesToProtocol = totalFees.mul(PREMIUM_TO_PROTOCOL).div(10000);
    const feesToLp = totalFees.sub(feesToProtocol);
    const liquidityIndexAdded = feesToLp
      .mul(ethers.BigNumber.from(10).pow(27))
      .div(await RSEurs.totalSupply());

    let reserveData = await helpersContract.getReserveData(eurs.address);

    const liquidityIndexBefore = reserveData.liquidityIndex;
    const totalLiquidityBefore = reserveData.totalRSToken;
    const reservesBefore = await RSEurs.balanceOf(await RSEurs.RESERVE_TREASURY_ADDRESS());

    const tx = await pool.flashLoan(
      _mockFlashLoanReceiver.address,
      [eurs.address],
      [flashBorrowedAmount],
      [0],
      _mockFlashLoanReceiver.address,
      '0x10',
      '0'
    );
    await waitForTx(tx);

    await pool.mintToTreasury([eurs.address]);

    reserveData = await helpersContract.getReserveData(eurs.address);

    const currentLiquidityRate = reserveData.liquidityRate;
    const currentLiquidityIndex = reserveData.liquidityIndex;
    const totalLiquidityAfter = reserveData.totalRSToken;
    const reservesAfter = await RSEurs.balanceOf(await RSEurs.RESERVE_TREASURY_ADDRESS());

    expect(totalLiquidityBefore.add(totalFees)).to.be.closeTo(totalLiquidityAfter, 2);
    expect(currentLiquidityRate).to.be.equal(0);
    expect(currentLiquidityIndex).to.be.equal(liquidityIndexBefore.add(liquidityIndexAdded));
    expect(reservesAfter).to.be.equal(reservesBefore.add(feesToProtocol));

    // Check handleRepayment is correctly called at flash loans
    await expect(tx)
      .to.emit(
        MockRSTokenRepayment__factory.connect(RSEurs.address, depositor.signer),
        'MockRepayment'
      )
      .withArgs(
        _mockFlashLoanReceiver.address,
        _mockFlashLoanReceiver.address,
        flashBorrowedAmount.add(totalFees)
      );
  });

  it('Takes out a 500 EURS flashloan with mode = 0, does not return the funds (revert expected)', async () => {
    const { eurs, pool, users } = testEnv;
    const caller = users[2];

    const flashloanAmount = await convertToCurrencyDecimals(eurs.address, '500');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [eurs.address],
          [flashloanAmount],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(COLLATERAL_BALANCE_IS_ZERO);
  });

  it('Caller deposits 5 WETH as collateral, Takes a EURS flashloan with mode = 2, does not return the funds. A loan for caller is created, premium should be 0', async () => {
    const { eurs, pool, weth, users, helpersContract } = testEnv;

    const caller = users[2];

    await weth
      .connect(caller.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '5'));

    await weth.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const amountToDeposit = await convertToCurrencyDecimals(weth.address, '5');

    await pool.connect(caller.signer).deposit(weth.address, amountToDeposit, caller.address, '0');

    const flashloanAmount = await convertToCurrencyDecimals(eurs.address, '500');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(false);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [eurs.address],
          [flashloanAmount],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    )
      .to.emit(_mockFlashLoanReceiver, 'ExecutedWithSuccess')
      .withArgs([eurs.address], [flashloanAmount], [0]);

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      eurs.address
    );

    const eursDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await eursDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('50000', 'Invalid user debt');
  });

  it('Disable EURS borrowing. Caller deposits 5 WETH as collateral, Takes a EURS flashloan with mode = 2, does not return the funds. Revert creating borrow position (revert expected)', async () => {
    const { eurs, pool, weth, configurator, users, helpersContract } = testEnv;

    const caller = users[2];

    expect(await configurator.setReserveStableRateBorrowing(eurs.address, false));
    expect(await configurator.setReserveBorrowing(eurs.address, false));

    let eursConfiguration = await helpersContract.getReserveConfigurationData(eurs.address);
    expect(eursConfiguration.borrowingEnabled).to.be.equal(false);

    await weth
      .connect(caller.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '5'));

    await weth.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const amountToDeposit = await convertToCurrencyDecimals(weth.address, '5');

    await pool.connect(caller.signer).deposit(weth.address, amountToDeposit, caller.address, '0');

    const flashloanAmount = await convertToCurrencyDecimals(eurs.address, '500');

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [eurs.address],
          [flashloanAmount],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(BORROWING_NOT_ENABLED);
  });

  it('Caller deposits 1000 RUSD as collateral, Takes a WETH flashloan with mode = 0, does not approve the transfer of the funds', async () => {
    const { rusd, pool, weth, users } = testEnv;
    const caller = users[3];

    await rusd
      .connect(caller.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));

    await rusd.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const amountToDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    await pool.connect(caller.signer).deposit(rusd.address, amountToDeposit, caller.address, '0');

    const flashAmount = ethers.utils.parseEther('0.8');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(false);
    await _mockFlashLoanReceiver.setAmountToApprove(flashAmount.div(2));

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [flashAmount],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Caller takes a WETH flashloan with mode = 1', async () => {
    const { pool, weth, users, helpersContract } = testEnv;

    const caller = users[3];

    const flashAmount = ethers.utils.parseEther('0.0571');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [flashAmount],
          [1],
          caller.address,
          '0x10',
          '0'
        )
    )
      .to.emit(pool, 'FlashLoan')
      .withArgs(_mockFlashLoanReceiver.address, caller.address, weth.address, flashAmount, 1, 0, 0);

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      weth.address
    );

    const wethDebtToken = await getStableDebtToken(stableDebtTokenAddress);

    const callerDebt = await wethDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('57100000000000000', 'Invalid user debt');
  });

  it('Caller takes a WETH flashloan with mode = 1 onBehalfOf user without allowance', async () => {
    const { rusd, pool, weth, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    // Deposit 1000 rusd for onBehalfOf user
    await rusd
      .connect(onBehalfOf.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));

    await rusd.connect(onBehalfOf.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const amountToDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    await pool
      .connect(onBehalfOf.signer)
      .deposit(rusd.address, amountToDeposit, onBehalfOf.address, '0');

    const flashAmount = ethers.utils.parseEther('0.0571');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [flashAmount],
          [1],
          onBehalfOf.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Caller takes a WETH flashloan with mode = 1 onBehalfOf user with allowance. A loan for onBehalfOf is creatd.', async () => {
    const { pool, weth, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    const flashAmount = ethers.utils.parseEther('0.0571');

    const reserveData = await pool.getReserveData(weth.address);

    const stableDebtToken = await getStableDebtToken(reserveData.stableDebtTokenAddress);

    // Deposited for onBehalfOf user already, delegate borrow allowance
    await stableDebtToken.connect(onBehalfOf.signer).approveDelegation(caller.address, flashAmount);

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await pool
      .connect(caller.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        [flashAmount],
        [1],
        onBehalfOf.address,
        '0x10',
        '0'
      );

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      weth.address
    );

    const wethDebtToken = await getStableDebtToken(stableDebtTokenAddress);

    const onBehalfOfDebt = await wethDebtToken.balanceOf(onBehalfOf.address);

    expect(onBehalfOfDebt.toString()).to.be.equal(
      '57100000000000000',
      'Invalid onBehalfOf user debt'
    );
  });
});
