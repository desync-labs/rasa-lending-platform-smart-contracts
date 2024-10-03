import { expect } from 'chai';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { TestEnv, makeSuite } from './helpers/make-suite';
import { evmRevert, evmSnapshot } from '../helpers/utilities/tx';
import { parseEther, parseUnits } from 'ethers/lib/utils';

makeSuite('LTV validation', (testEnv: TestEnv) => {
  const { LTV_VALIDATION_FAILED, USER_IN_ISOLATION_MODE_OR_LTV_ZERO } = ProtocolErrors;

  let snap: string;
  before(async () => {
    snap = await evmSnapshot();
  });

  it('User 1 deposits 10 RUSD, 10 EURS, user 2 deposits 0.071 WETH', async () => {
    const {
      pool,
      oracle,
      rusd,
      eurs,
      weth,
      users: [user1, user2],
    } = testEnv;

    await oracle.setAssetPrice(rusd.address, parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, parseUnits('1', 18));
    await oracle.setAssetPrice(weth.address, parseUnits('4000', 18));

    const rusdAmount = await convertToCurrencyDecimals(rusd.address, '10');
    const eursAmount = await convertToCurrencyDecimals(eurs.address, '10');
    const wethAmount = await convertToCurrencyDecimals(weth.address, '0.071');

    await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await eurs.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await weth.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await rusd.connect(user1.signer)['mint(uint256)'](rusdAmount);
    await eurs.connect(user1.signer)['mint(uint256)'](eursAmount);
    await weth.connect(user2.signer)['mint(uint256)'](wethAmount);

    await pool.connect(user1.signer).deposit(rusd.address, rusdAmount, user1.address, 0);

    await pool.connect(user1.signer).deposit(eurs.address, eursAmount, user1.address, 0);

    await pool.connect(user2.signer).deposit(weth.address, wethAmount, user2.address, 0);
  });

  it('Sets the LTV of RUSD to 0', async () => {
    const {
      configurator,
      rusd,
      helpersContract,
      users: [],
    } = testEnv;

    expect(await configurator.configureReserveAsCollateral(rusd.address, 0, 8000, 10500))
      .to.emit(configurator, 'CollateralConfigurationChanged')
      .withArgs(rusd.address, 0, 8000, 10500);

    const ltv = (await helpersContract.getReserveConfigurationData(rusd.address)).ltv;

    expect(ltv).to.be.equal(0);
  });

  it('Borrows 0.000414 WETH', async () => {
    const {
      pool,
      weth,
      users: [user1],
    } = testEnv;
    const borrowedAmount = await convertToCurrencyDecimals(weth.address, '0.000414');

    expect(
      await pool.connect(user1.signer).borrow(weth.address, borrowedAmount, 1, 0, user1.address)
    );
  });

  it('Tries to withdraw EURS (revert expected)', async () => {
    const {
      pool,
      eurs,
      users: [user1],
    } = testEnv;

    const withdrawnAmount = await convertToCurrencyDecimals(eurs.address, '1');

    await expect(
      pool.connect(user1.signer).withdraw(eurs.address, withdrawnAmount, user1.address)
    ).to.be.revertedWith(LTV_VALIDATION_FAILED);
  });

  it('Withdraws RUSD', async () => {
    const {
      pool,
      rusd,
      RSRUSD,
      users: [user1],
    } = testEnv;

    const RSRUSDBalanceBefore = await RSRUSD.balanceOf(user1.address);

    const withdrawnAmount = await convertToCurrencyDecimals(rusd.address, '1');

    expect(await pool.connect(user1.signer).withdraw(rusd.address, withdrawnAmount, user1.address));

    const RSRUSDBalanceAfter = await RSRUSD.balanceOf(user1.address);

    expect(RSRUSDBalanceAfter).to.be.eq(RSRUSDBalanceBefore.sub(withdrawnAmount));
  });

  it('User 1 deposit rusd, RUSD ltv drops to 0, then tries borrow', async () => {
    await evmRevert(snap);
    const {
      pool,
      rusd,
      weth,
      users: [user1, user2],
      configurator,
      helpersContract,
    } = testEnv;

    const rusdAmount = await convertToCurrencyDecimals(rusd.address, '10');
    const wethAmount = await convertToCurrencyDecimals(weth.address, '10');
    const borrowWethAmount = await convertToCurrencyDecimals(weth.address, '5');

    await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await weth.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await rusd.connect(user1.signer)['mint(uint256)'](rusdAmount);
    await weth.connect(user2.signer)['mint(uint256)'](wethAmount);

    await pool.connect(user1.signer).supply(rusd.address, rusdAmount, user1.address, 0);
    await pool.connect(user2.signer).supply(weth.address, wethAmount, user2.address, 0);

    // Set RUSD LTV = 0
    expect(await configurator.configureReserveAsCollateral(rusd.address, 0, 8000, 10500))
      .to.emit(configurator, 'CollateralConfigurationChanged')
      .withArgs(rusd.address, 0, 8000, 10500);
    const ltv = (await helpersContract.getReserveConfigurationData(rusd.address)).ltv;
    expect(ltv).to.be.equal(0);

    // Borrow all the weth because of issue in collateral needed.
    await expect(
      pool
        .connect(user1.signer)
        .borrow(weth.address, borrowWethAmount, RateMode.Variable, 0, user1.address)
    ).to.be.revertedWith(LTV_VALIDATION_FAILED);

    const userData = await pool.getUserAccountData(user1.address);
    expect(userData.totalCollateralBase).to.be.eq(parseUnits('10', 18));
    expect(userData.totalDebtBase).to.be.eq(0);
  });

  it('User 1 deposit rusd as collateral, ltv drops to 0, tries to enable as collateral (nothing should happen)', async () => {
    await evmRevert(snap);
    const {
      pool,
      rusd,
      users: [user1],
      configurator,
      helpersContract,
    } = testEnv;

    const rusdAmount = await convertToCurrencyDecimals(rusd.address, '10');

    await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await rusd.connect(user1.signer)['mint(uint256)'](rusdAmount);

    await pool.connect(user1.signer).supply(rusd.address, rusdAmount, user1.address, 0);

    // Set RUSD LTV = 0
    expect(await configurator.configureReserveAsCollateral(rusd.address, 0, 8000, 10500))
      .to.emit(configurator, 'CollateralConfigurationChanged')
      .withArgs(rusd.address, 0, 8000, 10500);
    const ltv = (await helpersContract.getReserveConfigurationData(rusd.address)).ltv;
    expect(ltv).to.be.equal(0);

    const userDataBefore = await helpersContract.getUserReserveData(rusd.address, user1.address);
    expect(userDataBefore.usageAsCollateralEnabled).to.be.eq(true);

    await pool.connect(user1.signer).setUserUseReserveAsCollateral(rusd.address, true);

    const userDataAfter = await helpersContract.getUserReserveData(rusd.address, user1.address);
    expect(userDataAfter.usageAsCollateralEnabled).to.be.eq(true);
  });

  it('User 1 deposit zero ltv rusd, tries to enable as collateral (revert expected)', async () => {
    await evmRevert(snap);
    const {
      pool,
      rusd,
      users: [user1],
      configurator,
      helpersContract,
    } = testEnv;

    // Clean user's state by withdrawing all aRUSD
    await pool.connect(user1.signer).withdraw(rusd.address, MAX_UINT_AMOUNT, user1.address);

    // Set RUSD LTV = 0
    expect(await configurator.configureReserveAsCollateral(rusd.address, 0, 8000, 10500))
      .to.emit(configurator, 'CollateralConfigurationChanged')
      .withArgs(rusd.address, 0, 8000, 10500);
    const ltv = (await helpersContract.getReserveConfigurationData(rusd.address)).ltv;
    expect(ltv).to.be.equal(0);

    const rusdAmount = await convertToCurrencyDecimals(rusd.address, '10');

    await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await rusd.connect(user1.signer)['mint(uint256)'](rusdAmount);

    await pool.connect(user1.signer).supply(rusd.address, rusdAmount, user1.address, 0);

    await expect(
      pool.connect(user1.signer).setUserUseReserveAsCollateral(rusd.address, true)
    ).to.be.revertedWith(USER_IN_ISOLATION_MODE_OR_LTV_ZERO);
  });

  it('User 1 deposit zero ltv rusd, rusd should not be enabled as collateral', async () => {
    await evmRevert(snap);
    const {
      pool,
      rusd,
      users: [user1],
      configurator,
      helpersContract,
    } = testEnv;

    // Set RUSD LTV = 0
    expect(await configurator.configureReserveAsCollateral(rusd.address, 0, 8000, 10500))
      .to.emit(configurator, 'CollateralConfigurationChanged')
      .withArgs(rusd.address, 0, 8000, 10500);
    const ltv = (await helpersContract.getReserveConfigurationData(rusd.address)).ltv;
    expect(ltv).to.be.equal(0);

    const rusdAmount = await convertToCurrencyDecimals(rusd.address, '10');

    await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await rusd.connect(user1.signer)['mint(uint256)'](rusdAmount);

    await pool.connect(user1.signer).supply(rusd.address, rusdAmount, user1.address, 0);

    const userData = await helpersContract.getUserReserveData(rusd.address, user1.address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 1 deposit rusd, RUSD ltv drops to 0, transfers rusd, rusd should not be enabled as collateral for receiver', async () => {
    await evmRevert(snap);
    const {
      pool,
      rusd,
      RSRUSD,
      users: [user1, user2],
      configurator,
      helpersContract,
    } = testEnv;

    const rusdAmount = await convertToCurrencyDecimals(rusd.address, '10');

    await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await rusd.connect(user1.signer)['mint(uint256)'](rusdAmount);

    await pool.connect(user1.signer).supply(rusd.address, rusdAmount, user1.address, 0);

    // Set RUSD LTV = 0
    expect(await configurator.configureReserveAsCollateral(rusd.address, 0, 8000, 10500))
      .to.emit(configurator, 'CollateralConfigurationChanged')
      .withArgs(rusd.address, 0, 8000, 10500);
    const ltv = (await helpersContract.getReserveConfigurationData(rusd.address)).ltv;
    expect(ltv).to.be.equal(0);

    // Transfer 0 LTV RUSD to user2
    await RSRUSD.connect(user1.signer).transfer(user2.address, 1);
    const userData = await helpersContract.getUserReserveData(rusd.address, user2.address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });
});
