import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import {
  getMockFlashLoanReceiver,
  getStableDebtToken,
  getVariableDebtToken,
} from '../helpers/contract-getters';
import { ProtocolErrors } from '../helpers/types';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { MockFlashLoanReceiver } from '../types/MockFlashLoanReceiver';
import { TestEnv, makeSuite } from './helpers/make-suite';
import './helpers/utils/wadraymath';

makeSuite('Pool: Authorized FlashLoan', (testEnv: TestEnv) => {
  let _mockFlashLoanReceiver = {} as MockFlashLoanReceiver;

  const {
    COLLATERAL_BALANCE_IS_ZERO,
    ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE,
    INVALID_FLASHLOAN_EXECUTOR_RETURN,
  } = ProtocolErrors;

  before(async () => {
    _mockFlashLoanReceiver = await getMockFlashLoanReceiver();
  });

  it('Authorize a flash borrower', async () => {
    const { deployer, aclManager } = testEnv;
    const flashBorrowerRole = await aclManager.FLASH_BORROWER_ROLE();
    await expect(aclManager.addFlashBorrower(deployer.address))
      .to.emit(aclManager, 'RoleGranted')
      .withArgs(flashBorrowerRole, deployer.address, deployer.address);
  });

  it('Deposits WETH into the reserve', async () => {
    const { pool, weth } = testEnv;
    const userAddress = await pool.signer.getAddress();
    const amountToDeposit = utils.parseEther('1');

    expect(await weth['mint(uint256)'](amountToDeposit));

    expect(await weth.approve(pool.address, MAX_UINT_AMOUNT));

    expect(await pool.deposit(weth.address, amountToDeposit, userAddress, '0'));
  });

  it('Takes WETH flash loan with mode = 0, returns the funds correctly', async () => {
    const { pool, helpersContract, weth } = testEnv;

    expect(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        [utils.parseEther('0.8')],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    );

    const reserveData = await helpersContract.getReserveData(weth.address);

    const currentLiquidityRate = reserveData.liquidityRate;
    const currentLiquidityIndex = reserveData.liquidityIndex;

    const totalLiquidity = reserveData.totalRSToken.add(
      reserveData.accruedToTreasuryScaled.rayMul(reserveData.liquidityIndex)
    );

    expect(totalLiquidity).to.be.equal('1000000000000000000');
    expect(currentLiquidityRate).to.be.equal('0');
    expect(currentLiquidityIndex).to.be.equal('1000000000000000000000000000');
  });

  it('Takes an ETH flash loan with mode = 0 as big as the available liquidity', async () => {
    const { pool, helpersContract, weth } = testEnv;

    expect(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        ['1000000000000000000'],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    );

    const reserveData = await helpersContract.getReserveData(weth.address);

    const currentLiquidityRate = reserveData.liquidityRate;
    const currentLiquidityIndex = reserveData.liquidityIndex;

    const totalLiquidity = reserveData.totalRSToken.add(
      reserveData.accruedToTreasuryScaled.rayMul(reserveData.liquidityIndex)
    );

    expect(totalLiquidity).to.be.equal('1000000000000000000');
    expect(currentLiquidityRate).to.be.equal('0');
    expect(currentLiquidityIndex).to.be.equal('1000000000000000000000000000');
  });

  it('Takes WETH flashloan, does not return the funds with mode = 0 (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [utils.parseEther('0.8')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Takes WETH flash loan, simulating a receiver as EOA (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));
    expect(await _mockFlashLoanReceiver.setSimulateEOA(true));

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [utils.parseEther('0.8')],
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
    expect(await _mockFlashLoanReceiver.setSimulateEOA(false));
    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [utils.parseEther('0.8')],
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

    const amountToDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    // Top up user
    expect(await rusd.connect(caller.signer)['mint(uint256)'](amountToDeposit));

    expect(await rusd.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(
      await pool.connect(caller.signer).deposit(rusd.address, amountToDeposit, caller.address, '0')
    );

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

    expect(
      await pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [utils.parseEther('0.0571')],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    );
    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      weth.address
    );

    const wethDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await wethDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('57100000000000000', 'Invalid user debt');
  });

  it('Tries to take a flashloan that is bigger than the available liquidity (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];

    await expect(
      pool.connect(caller.signer).flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        ['1000000000000000001'], //slightly higher than the available liquidity
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

    const amountToDeposit = await convertToCurrencyDecimals(eurs.address, '1000');

    // Top up user
    expect(await eurs['mint(uint256)'](amountToDeposit));

    expect(await eurs.approve(pool.address, MAX_UINT_AMOUNT));

    expect(await pool.deposit(eurs.address, amountToDeposit, userAddress, '0'));
  });

  it('Takes out a 500 EURS flashloan, returns the funds correctly', async () => {
    const { eurs, pool, helpersContract, deployer: depositor } = testEnv;

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(false));

    const flashloanAmount = await convertToCurrencyDecimals(eurs.address, '500');

    expect(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [eurs.address],
        [flashloanAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    );

    const reserveData = await helpersContract.getReserveData(eurs.address);
    const userData = await helpersContract.getUserReserveData(eurs.address, depositor.address);

    const totalLiquidity = reserveData.totalRSToken.add(
      reserveData.accruedToTreasuryScaled.rayMul(reserveData.liquidityIndex)
    );

    const expectedLiquidity = await convertToCurrencyDecimals(eurs.address, '1000');

    expect(totalLiquidity).to.be.equal(expectedLiquidity, 'Invalid total liquidity');
    expect(reserveData.liquidityRate).to.be.equal('0', 'Invalid liquidity rate');
    expect(reserveData.liquidityIndex).to.be.equal(
      utils.parseUnits('1', 27),
      'Invalid liquidity index'
    );
    expect(userData.currentRSTokenBalance).to.be.equal(expectedLiquidity, 'Invalid user balance');
  });

  it('Takes out a 500 EURS flashloan with mode = 0, does not return the funds (revert expected)', async () => {
    const { eurs, pool, users } = testEnv;
    const caller = users[2];

    const flashloanAmount = await convertToCurrencyDecimals(eurs.address, '500');

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

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

  it('Caller deposits 5 WETH as collateral, Takes a EURS flashloan with mode = 2, does not return the funds. A loan for caller is created', async () => {
    const { eurs, pool, weth, users, helpersContract } = testEnv;

    const caller = users[2];

    const amountToDeposit = await convertToCurrencyDecimals(weth.address, '5');

    // Top up user
    expect(await weth.connect(caller.signer)['mint(uint256)'](amountToDeposit));

    expect(await weth.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(
      await pool.connect(caller.signer).deposit(weth.address, amountToDeposit, caller.address, '0')
    );

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

    const flashloanAmount = await convertToCurrencyDecimals(eurs.address, '500');

    expect(
      await pool
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
    );
    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      eurs.address
    );

    const eursDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await eursDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('50000', 'Invalid user debt');
  });

  it('Caller deposits 1000 RUSD as collateral, Takes a WETH flashloan with mode = 0, does not approve the transfer of the funds (revert expected)', async () => {
    const { rusd, pool, weth, users } = testEnv;
    const caller = users[3];

    const amountToDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    // Top up user
    expect(await rusd.connect(caller.signer)['mint(uint256)'](amountToDeposit));

    expect(await rusd.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(
      await pool.connect(caller.signer).deposit(rusd.address, amountToDeposit, caller.address, '0')
    );

    const flashAmount = utils.parseEther('0.8');

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(false));
    expect(await _mockFlashLoanReceiver.setAmountToApprove(flashAmount.div(2)));

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

    const flashAmount = utils.parseEther('0.0571');

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

    expect(
      await pool
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
    );

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      weth.address
    );

    const wethDebtToken = await getStableDebtToken(stableDebtTokenAddress);

    const callerDebt = await wethDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal(flashAmount, 'Invalid user debt');
  });

  it('Caller takes a WETH flashloan with mode = 1 onBehalfOf user without allowance (revert expected)', async () => {
    const { rusd, pool, weth, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    const amountToDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    // Top up user
    expect(await rusd.connect(onBehalfOf.signer)['mint(uint256)'](amountToDeposit));

    // Deposit 1000 rusd for onBehalfOf user
    expect(await rusd.connect(onBehalfOf.signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(
      await pool
        .connect(onBehalfOf.signer)
        .deposit(rusd.address, amountToDeposit, onBehalfOf.address, '0')
    );

    const flashAmount = utils.parseEther('0.0571');

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

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

    const flashAmount = utils.parseEther('0.0571');

    const reserveData = await pool.getReserveData(weth.address);

    const stableDebtToken = await getStableDebtToken(reserveData.stableDebtTokenAddress);

    // Deposited for onBehalfOf user already, delegate borrow allowance
    expect(
      await stableDebtToken
        .connect(onBehalfOf.signer)
        .approveDelegation(caller.address, flashAmount)
    );

    expect(await _mockFlashLoanReceiver.setFailExecutionTransfer(true));

    expect(
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
        )
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
