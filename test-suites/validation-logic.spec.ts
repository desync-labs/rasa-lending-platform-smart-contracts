import { expect } from 'chai';
import { utils, constants } from 'ethers';
import { parseUnits } from '@ethersproject/units';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { RateMode, ProtocolErrors } from '../helpers/types';
import { impersonateAccountsHardhat } from '../helpers/misc-utils';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { waitForTx, evmSnapshot, evmRevert } from '../helpers/utilities/tx';
import { topUpNonPayableWithEther } from './helpers/utils/funds';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('ValidationLogic: Edge cases', (testEnv: TestEnv) => {
  const {
    RESERVE_INACTIVE,
    RESERVE_FROZEN,
    RESERVE_PAUSED,
    INVALID_AMOUNT,
    BORROWING_NOT_ENABLED,
    STABLE_BORROWING_NOT_ENABLED,
    COLLATERAL_SAME_AS_BORROWING_CURRENCY,
    AMOUNT_BIGGER_THAN_MAX_LOAN_SIZE_STABLE,
    NO_DEBT_OF_SELECTED_TYPE,
    HEALTH_FACTOR_NOT_BELOW_THRESHOLD,
    INVALID_INTEREST_RATE_MODE_SELECTED,
    UNDERLYING_BALANCE_ZERO,
    INCONSISTENT_FLASHLOAN_PARAMS,
    HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD,
    INCONSISTENT_EMODE_CATEGORY,
  } = ProtocolErrors;

  let snap: string;

  before(async () => {
    const { addressesProvider, oracle, rusd, eurs, weth } = testEnv;

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));

    await oracle.setAssetPrice(rusd.address, parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, parseUnits('1', 18));
    await oracle.setAssetPrice(weth.address, parseUnits('4000', 18));
  });

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  beforeEach(async () => {
    snap = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snap);
  });

  it('validateDeposit() when reserve is not active (revert expected)', async () => {
    const { pool, poolAdmin, configurator, helpersContract, users, rusd } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveActive(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(false);
    expect(configAfter.isFrozen).to.be.eq(false);

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('1000'));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await expect(
      pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0)
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateDeposit() when reserve is frozen (revert expected)', async () => {
    const { pool, poolAdmin, configurator, helpersContract, users, rusd } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveFreeze(rusd.address, true);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(true);
    expect(configAfter.isFrozen).to.be.eq(true);

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('1000'));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await expect(
      pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0)
    ).to.be.revertedWith(RESERVE_FROZEN);
  });

  it('validateBorrow() when reserve is not active (revert expected)', async () => {
    /**
     * Unclear how we should enter this stage with normal usage.
     * Can be done by sending rusd directly to RSRUSD contract after it have been deactivated.
     * If deposited normally it is not possible for us deactivate.
     */

    const { pool, poolAdmin, configurator, helpersContract, users, rusd, RSRUSD, eurs } = testEnv;
    const user = users[0];

    await eurs.connect(user.signer)['mint(uint256)'](utils.parseEther('10000'));
    await eurs.connect(user.signer).approve(pool.address, utils.parseEther('10000'));
    await pool
      .connect(user.signer)
      .deposit(eurs.address, utils.parseEther('10000'), user.address, 0);

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveActive(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(false);
    expect(configAfter.isFrozen).to.be.eq(false);

    // Transferring directly into RSRUSD such that we can borrow
    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('1000'));
    await rusd.connect(user.signer).transfer(RSRUSD.address, utils.parseEther('1000'));

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseEther('1000'), RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateBorrow() when reserve is frozen (revert expected)', async () => {
    const { pool, poolAdmin, configurator, helpersContract, users, rusd, eurs } = testEnv;
    const user = users[0];

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('1000'));
    await rusd.connect(user.signer).approve(pool.address, utils.parseEther('1000'));
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0);

    await eurs.connect(user.signer)['mint(uint256)'](utils.parseEther('10000'));
    await eurs.connect(user.signer).approve(pool.address, utils.parseEther('10000'));
    await pool
      .connect(user.signer)
      .deposit(eurs.address, utils.parseEther('10000'), user.address, 0);

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveFreeze(rusd.address, true);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(true);
    expect(configAfter.isFrozen).to.be.eq(true);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseEther('1000'), RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(RESERVE_FROZEN);
  });

  it('validateBorrow() when amount == 0 (revert expected)', async () => {
    const { pool, users, rusd } = testEnv;
    const user = users[0];

    await expect(
      pool.connect(user.signer).borrow(rusd.address, 0, RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(INVALID_AMOUNT);
  });

  it('validateBorrow() when borrowing is not enabled (revert expected)', async () => {
    const { pool, poolAdmin, configurator, helpersContract, users, rusd, eurs } = testEnv;
    const user = users[0];

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('1000'));
    await rusd.connect(user.signer).approve(pool.address, utils.parseEther('1000'));
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0);

    await eurs.connect(user.signer)['mint(uint256)'](utils.parseEther('10000'));
    await eurs.connect(user.signer).approve(pool.address, utils.parseEther('10000'));
    await pool
      .connect(user.signer)
      .deposit(eurs.address, utils.parseEther('10000'), user.address, 0);

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.borrowingEnabled).to.be.eq(true);

    // Disable borrowing
    await configurator.connect(poolAdmin.signer).setReserveStableRateBorrowing(rusd.address, false);
    await configurator.connect(poolAdmin.signer).setReserveBorrowing(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.borrowingEnabled).to.be.eq(false);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseEther('1000'), RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(BORROWING_NOT_ENABLED);
  });

  it('validateBorrow() when stableRateBorrowing is not enabled', async () => {
    const { pool, poolAdmin, configurator, helpersContract, users, rusd, RSRUSD, eurs } = testEnv;
    const user = users[0];

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('1000'));
    await rusd.connect(user.signer).approve(pool.address, utils.parseEther('1000'));
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0);

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.stableBorrowRateEnabled).to.be.eq(true);

    // Disable stable rate borrowing
    await configurator.connect(poolAdmin.signer).setReserveStableRateBorrowing(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.stableBorrowRateEnabled).to.be.eq(false);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseEther('500'), RateMode.Stable, 0, user.address)
    ).to.be.revertedWith(STABLE_BORROWING_NOT_ENABLED);
  });

  it('validateBorrow() borrowing when user has already a HF < threshold', async () => {
    const { pool, users, rusd, eurs, oracle } = testEnv;
    const user = users[0];
    const depositor = users[1];

    await rusd
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '2000'));
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '2000'),
        depositor.address,
        0
      );

    await eurs
      .connect(user.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '2000'));
    await eurs.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .deposit(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '2000'),
        user.address,
        0
      );

    await pool
      .connect(user.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '1000'),
        RateMode.Variable,
        0,
        user.address
      );

    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    await oracle.setAssetPrice(rusd.address, rusdPrice.mul(2));

    await expect(
      pool
        .connect(user.signer)
        .borrow(
          rusd.address,
          await convertToCurrencyDecimals(rusd.address, '200'),
          RateMode.Variable,
          0,
          user.address
        )
    ).to.be.revertedWith(HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD);
  });

  it('validateBorrow() stable borrowing where collateral is mostly the same currency is borrowing (revert expected)', async () => {
    // Stable borrowing
    // isUsingAsCollateral == true
    // ltv != 0
    // amount < RSToken Balance

    const { pool, users, rusd, RSRUSD, eurs } = testEnv;
    const user = users[0];

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('2000'));
    await rusd.connect(user.signer).approve(pool.address, utils.parseEther('1000'));
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0);
    await rusd.connect(user.signer).transfer(RSRUSD.address, utils.parseEther('1000'));

    await eurs.connect(user.signer)['mint(uint256)'](utils.parseEther('10000'));
    await eurs.connect(user.signer).approve(pool.address, utils.parseEther('10000'));
    await pool
      .connect(user.signer)
      .deposit(eurs.address, utils.parseEther('10000'), user.address, 0);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseEther('500'), RateMode.Stable, 0, user.address)
    ).to.be.revertedWith(COLLATERAL_SAME_AS_BORROWING_CURRENCY);
  });

  it('validateBorrow() stable borrowing when amount > maxLoanSizeStable (revert expected)', async () => {
    const { pool, users, rusd, RSRUSD, eurs } = testEnv;
    const user = users[0];

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('2000'));
    await rusd.connect(user.signer).approve(pool.address, utils.parseEther('1000'));
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0);
    await rusd.connect(user.signer).transfer(RSRUSD.address, utils.parseEther('1000'));

    await eurs.connect(user.signer)['mint(uint256)'](utils.parseEther('10000'));
    await eurs.connect(user.signer).approve(pool.address, utils.parseEther('10000'));
    await pool
      .connect(user.signer)
      .deposit(eurs.address, utils.parseEther('10000'), user.address, 0);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseEther('1500'), RateMode.Stable, 0, user.address)
    ).to.be.revertedWith(AMOUNT_BIGGER_THAN_MAX_LOAN_SIZE_STABLE);
  });

  it('validateLiquidationCall() when healthFactor > threshold (revert expected)', async () => {
    // Liquidation something that is not liquidatable
    const { pool, users, rusd, eurs } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    await rusd
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '500'));
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '500'),
        depositor.address,
        0
      );
    await eurs
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '500'));
    await eurs.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '500'),
        borrower.address,
        0
      );

    await pool
      .connect(borrower.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '250'),
        RateMode.Variable,
        0,
        borrower.address
      );

    // Try to liquidate the borrower
    await expect(
      pool
        .connect(depositor.signer)
        .liquidationCall(eurs.address, rusd.address, borrower.address, 0, false)
    ).to.be.revertedWith(HEALTH_FACTOR_NOT_BELOW_THRESHOLD);
  });

  it('validateRepay() when reserve is not active (revert expected)', async () => {
    // Unsure how we can end in this scenario. Would require that it could be deactivated after someone have borrowed
    const { pool, users, rusd, helpersContract, configurator, poolAdmin } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveActive(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(false);
    expect(configAfter.isFrozen).to.be.eq(false);

    await expect(
      pool
        .connect(user.signer)
        .repay(rusd.address, utils.parseEther('1'), RateMode.Variable, user.address)
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateRepay() the variable debt when is 0 (stableDebt > 0) (revert expected)', async () => {
    // (stableDebt > 0 && DataTypes.InterestRateMode(rateMode) == DataTypes.InterestRateMode.STABLE) ||
    // (variableDebt > 0 &&	DataTypes.InterestRateMode(rateMode) == DataTypes.InterestRateMode.VARIABLE),

    const { pool, users, rusd, RSRUSD, eurs } = testEnv;
    const user = users[0];

    // We need some debt
    await eurs.connect(user.signer)['mint(uint256)'](utils.parseEther('2000'));
    await eurs.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .deposit(eurs.address, utils.parseEther('2000'), user.address, 0);
    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('2000'));
    await rusd.connect(user.signer).transfer(RSRUSD.address, utils.parseEther('2000'));

    await pool
      .connect(user.signer)
      .borrow(rusd.address, utils.parseEther('250'), RateMode.Stable, 0, user.address);

    await expect(
      pool
        .connect(user.signer)
        .repay(rusd.address, utils.parseEther('250'), RateMode.Variable, user.address)
    ).to.be.revertedWith(NO_DEBT_OF_SELECTED_TYPE);
  });

  it('validateRepay() the stable debt when is 0 (variableDebt > 0) (revert expected)', async () => {
    // (stableDebt > 0 && DataTypes.InterestRateMode(rateMode) == DataTypes.InterestRateMode.STABLE) ||
    // (variableDebt > 0 &&	DataTypes.InterestRateMode(rateMode) == DataTypes.InterestRateMode.VARIABLE),

    const { pool, users, rusd } = testEnv;
    const user = users[0];

    // We need some debt
    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('2000'));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('2000'), user.address, 0);

    await pool
      .connect(user.signer)
      .borrow(rusd.address, utils.parseEther('250'), RateMode.Variable, 0, user.address);

    await expect(
      pool
        .connect(user.signer)
        .repay(rusd.address, utils.parseEther('250'), RateMode.Stable, user.address)
    ).to.be.revertedWith(NO_DEBT_OF_SELECTED_TYPE);
  });

  it('validateSwapRateMode() when reserve is not active', async () => {
    // Not clear when this would be useful in practice, as you should not be able to have debt if it is deactivated
    const { pool, poolAdmin, configurator, helpersContract, users, rusd, RSRUSD } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveActive(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(false);
    expect(configAfter.isFrozen).to.be.eq(false);

    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.Stable)
    ).to.be.revertedWith(RESERVE_INACTIVE);
    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.Variable)
    ).to.be.revertedWith(RESERVE_INACTIVE);
    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.None)
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateSwapRateMode() when reserve is frozen', async () => {
    // Not clear when this would be useful in practice, as you should not be able to have debt if it is deactivated
    const { pool, poolAdmin, configurator, helpersContract, users, rusd } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveFreeze(rusd.address, true);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(true);
    expect(configAfter.isFrozen).to.be.eq(true);

    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.Stable)
    ).to.be.revertedWith(RESERVE_FROZEN);
    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.Variable)
    ).to.be.revertedWith(RESERVE_FROZEN);
    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.None)
    ).to.be.revertedWith(RESERVE_FROZEN);
  });

  it('validateSwapRateMode() with currentRateMode not equal to stable or variable, (revert expected)', async () => {
    const { pool, helpersContract, users, rusd } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.None)
    ).to.be.revertedWith(INVALID_INTEREST_RATE_MODE_SELECTED);
  });

  it('validateSwapRateMode() from variable to stable with stableBorrowing disabled (revert expected)', async () => {
    const { pool, poolAdmin, configurator, helpersContract, users, rusd } = testEnv;
    const user = users[0];

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('1000'));
    await rusd.connect(user.signer).approve(pool.address, utils.parseEther('1000'));
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0);

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.stableBorrowRateEnabled).to.be.eq(true);

    // Disable stable rate borrowing
    await configurator.connect(poolAdmin.signer).setReserveStableRateBorrowing(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.stableBorrowRateEnabled).to.be.eq(false);

    // We need some variable debt, and then flip it

    await rusd
      .connect(user.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '5000'));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .deposit(rusd.address, await convertToCurrencyDecimals(rusd.address, '5000'), user.address, 0);

    await pool
      .connect(user.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '500'),
        RateMode.Variable,
        0,
        user.address
      );

    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.Variable)
    ).to.be.revertedWith(STABLE_BORROWING_NOT_ENABLED);
  });

  it('validateSwapRateMode() where collateral is mostly the same currency is borrowing (revert expected)', async () => {
    // SwapRate from variable to stable
    // isUsingAsCollateral == true
    // ltv != 0
    // stableDebt + variableDebt < RSToken

    const { pool, users, rusd, RSRUSD, eurs } = testEnv;
    const user = users[0];

    await rusd.connect(user.signer)['mint(uint256)'](utils.parseEther('2000'));
    await rusd.connect(user.signer).approve(pool.address, utils.parseEther('1000'));
    await pool.connect(user.signer).deposit(rusd.address, utils.parseEther('1000'), user.address, 0);
    await rusd.connect(user.signer).transfer(RSRUSD.address, utils.parseEther('1000'));

    await eurs.connect(user.signer)['mint(uint256)'](utils.parseEther('10000'));
    await eurs.connect(user.signer).approve(pool.address, utils.parseEther('10000'));
    await pool
      .connect(user.signer)
      .deposit(eurs.address, utils.parseEther('10000'), user.address, 0);

    await pool
      .connect(user.signer)
      .borrow(rusd.address, utils.parseEther('500'), RateMode.Variable, 0, user.address);

    await expect(
      pool.connect(user.signer).swapBorrowRateMode(rusd.address, RateMode.Variable)
    ).to.be.revertedWith(COLLATERAL_SAME_AS_BORROWING_CURRENCY);
  });

  it('validateRebalanceStableBorrowRate() when reserve is not active (revert expected)', async () => {
    const { pool, configurator, helpersContract, poolAdmin, users, rusd } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveActive(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(false);
    expect(configAfter.isFrozen).to.be.eq(false);

    await expect(
      pool.connect(user.signer).rebalanceStableBorrowRate(rusd.address, user.address)
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateSetUseReserveAsCollateral() when reserve is not active (revert expected)', async () => {
    /**
     * Since its not possible to deactivate a reserve with existing suppliers, making the user have
     * RSToken balance (aRUSD) its not technically possible to end up in this situation.
     * However, we impersonate the Pool to get some aRUSD and make the test possible
     */
    const { pool, configurator, helpersContract, poolAdmin, users, rusd, RSRUSD } = testEnv;
    const user = users[0];

    const configBefore = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configBefore.isActive).to.be.eq(true);
    expect(configBefore.isFrozen).to.be.eq(false);

    await configurator.connect(poolAdmin.signer).setReserveActive(rusd.address, false);

    const configAfter = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(configAfter.isActive).to.be.eq(false);
    expect(configAfter.isFrozen).to.be.eq(false);

    await impersonateAccountsHardhat([pool.address]);
    const poolSigner = await hre.ethers.getSigner(pool.address);
    await topUpNonPayableWithEther(user.signer, [pool.address], utils.parseEther('1'));
    expect(await RSRUSD.connect(poolSigner).mint(user.address, user.address, 1, 1));

    await expect(
      pool.connect(user.signer).setUserUseReserveAsCollateral(rusd.address, true)
    ).to.be.revertedWith(RESERVE_INACTIVE);

    await expect(
      pool.connect(user.signer).setUserUseReserveAsCollateral(rusd.address, false)
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateSetUseReserveAsCollateral() with userBalance == 0 (revert expected)', async () => {
    const { pool, users, rusd } = testEnv;
    const user = users[0];

    await expect(
      pool.connect(user.signer).setUserUseReserveAsCollateral(rusd.address, true)
    ).to.be.revertedWith(UNDERLYING_BALANCE_ZERO);

    await expect(
      pool.connect(user.signer).setUserUseReserveAsCollateral(rusd.address, false)
    ).to.be.revertedWith(UNDERLYING_BALANCE_ZERO);
  });

  it('validateFlashloan() with inconsistent params (revert expected)', async () => {
    const { pool, users, rusd, RSRUSD, eurs } = testEnv;
    const user = users[0];

    await expect(
      pool
        .connect(user.signer)
        .flashLoan(
          RSRUSD.address,
          [rusd.address, eurs.address],
          [0],
          [RateMode.Variable, RateMode.Variable],
          user.address,
          '0x00',
          0
        )
    ).to.be.revertedWith(INCONSISTENT_FLASHLOAN_PARAMS);
  });

  it('validateFlashloan() with inactive reserve (revert expected)', async () => {
    const {
      configurator,
      poolAdmin,
      pool,
      rusd,
      RSRUSD,
      eurs,
      users: [user],
    } = testEnv;

    expect(await configurator.connect(poolAdmin.signer).setReserveActive(rusd.address, false));

    await expect(
      pool
        .connect(user.signer)
        .flashLoan(
          RSRUSD.address,
          [rusd.address, eurs.address],
          [0, 0],
          [RateMode.Variable, RateMode.Variable],
          user.address,
          '0x00',
          0
        )
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateFlashLoanSimple() with paused reserve (revert expected)', async () => {
    const {
      configurator,
      poolAdmin,
      pool,
      weth,
      users: [user],
    } = testEnv;

    expect(await configurator.connect(poolAdmin.signer).setReservePause(weth.address, true));

    await expect(
      pool.connect(user.signer).flashLoanSimple(user.address, weth.address, 0, '0x10', 0)
    ).to.be.revertedWith(RESERVE_PAUSED);
  });

  it('validateFlashLoanSimple() with inactive reserve (revert expected)', async () => {
    const {
      configurator,
      poolAdmin,
      pool,
      weth,
      users: [user],
    } = testEnv;

    expect(await configurator.connect(poolAdmin.signer).setReserveActive(weth.address, false));

    await expect(
      pool.connect(user.signer).flashLoanSimple(user.address, weth.address, 0, '0x10', 0)
    ).to.be.revertedWith(RESERVE_INACTIVE);
  });

  it('validateSetUserEMode() to undefined emode category (revert expected)', async () => {
    const {
      pool,
      users: [user],
    } = testEnv;

    await expect(pool.connect(user.signer).setUserEMode(101)).to.be.revertedWith(
      INCONSISTENT_EMODE_CATEGORY
    );
  });

  it('validateSetUserEMode() with empty config', async () => {
    const {
      configurator,
      poolAdmin,
      pool,
      users: [user],
    } = testEnv;

    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory('101', '9800', '9900', '10100', constants.AddressZero, 'INCONSISTENT')
    );

    await pool.connect(user.signer).setUserEMode(101);
  });

  it('validateSetUserEMode() with categoryId == 0', async () => {
    const {
      rusd,
      pool,
      users: [user],
    } = testEnv;

    // Deposit to make sure config is not empty
    await rusd.connect(user.signer)['mint(uint256)'](parseUnits('1000', 18));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(rusd.address, parseUnits('1000', 18), user.address, 0);

    await pool.connect(user.signer).setUserEMode(0);

    expect(await pool.getUserEMode(user.address)).to.be.eq(0);
  });

  it('validateBorrow() with eMode > 0, borrowing asset not in category (revert expected)', async () => {
    const {
      configurator,
      poolAdmin,
      eurs,
      rusd,
      pool,
      users: [user, eursProvider],
    } = testEnv;

    await eurs.connect(eursProvider.signer)['mint(uint256)'](parseUnits('1000', 2));
    await eurs.connect(eursProvider.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(eursProvider.signer)
      .supply(eurs.address, parseUnits('1000', 2), eursProvider.address, 0);

    await rusd.connect(user.signer)['mint(uint256)'](parseUnits('1000', 18));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(rusd.address, parseUnits('1000', 18), user.address, 0);

    await configurator
      .connect(poolAdmin.signer)
      .setEModeCategory('101', '9800', '9900', '10100', constants.AddressZero, 'NO-ASSETS');

    await pool.connect(user.signer).setUserEMode(101);

    await expect(
      pool
        .connect(user.signer)
        .borrow(eurs.address, parseUnits('100', 2), RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(INCONSISTENT_EMODE_CATEGORY);
  });

  it('validateHFAndLtv() with HF < 1 (revert expected)', async () => {
    const {
      eurs,
      rusd,
      pool,
      oracle,
      users: [user, eursProvider],
    } = testEnv;

    await eurs.connect(eursProvider.signer)['mint(uint256)'](parseUnits('1000', 2));
    await eurs.connect(eursProvider.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(eursProvider.signer)
      .supply(eurs.address, parseUnits('1000', 2), eursProvider.address, 0);

    await rusd.connect(user.signer)['mint(uint256)'](parseUnits('1000', 18));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(rusd.address, parseUnits('1000', 18), user.address, 0);

    const userGlobalData = await pool.getUserAccountData(user.address);
    const eursPrice = await oracle.getAssetPrice(eurs.address);

    const amountEURSToBorrow = await convertToCurrencyDecimals(
      eurs.address,
      userGlobalData.availableBorrowsBase.div(eursPrice).toString()
    );

    await pool
      .connect(user.signer)
      .borrow(eurs.address, amountEURSToBorrow, RateMode.Variable, 0, user.address);

    await expect(
      pool.connect(user.signer).withdraw(rusd.address, parseUnits('500', 18), user.address)
    ).to.be.revertedWith(HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD);
  });

  it('validateHFAndLtv() with HF < 1 for 0 LTV asset (revert expected)', async () => {
    const {
      eurs,
      rusd,
      pool,
      oracle,
      poolAdmin,
      configurator,
      helpersContract,
      users: [user, eursProvider],
    } = testEnv;

    // Supply eurs
    await eurs.connect(eursProvider.signer)['mint(uint256)'](parseUnits('1000', 2));
    await eurs.connect(eursProvider.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(eursProvider.signer)
      .supply(eurs.address, parseUnits('1000', 2), eursProvider.address, 0);

    // Supply rusd
    await rusd.connect(user.signer)['mint(uint256)'](parseUnits('1000', 18));
    await rusd.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(rusd.address, parseUnits('1000', 18), user.address, 0);

    // Borrow eurs
    await pool
      .connect(user.signer)
      .borrow(eurs.address, parseUnits('500', 2), RateMode.Variable, 0, user.address);

    // Drop LTV
    const rusdData = await helpersContract.getReserveConfigurationData(rusd.address);

    await configurator
      .connect(poolAdmin.signer)
      .configureReserveAsCollateral(
        rusd.address,
        0,
        rusdData.liquidationThreshold,
        rusdData.liquidationBonus
      );

    // Withdraw all my rusd
    await expect(
      pool.connect(user.signer).withdraw(rusd.address, parseUnits('500', 18), user.address)
    ).to.be.revertedWith(HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD);
  });
});
