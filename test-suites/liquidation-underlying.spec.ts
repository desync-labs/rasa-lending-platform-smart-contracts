import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { MAX_UINT_AMOUNT, oneEther } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { calcExpectedStableDebtTokenBalance } from './helpers/utils/calculations';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import { makeSuite } from './helpers/make-suite';
import { increaseTime, waitForTx } from '../helpers/utilities/tx';

import { HardhatRuntimeEnvironment } from 'hardhat/types';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Pool Liquidation: Liquidator receiving the underlying asset', (testEnv) => {
  const { INVALID_HF } = ProtocolErrors;

  before(async () => {
    const { addressesProvider, oracle, rusd, eurs, weth, cgo } = testEnv;

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));

    await oracle.setAssetPrice(rusd.address, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(cgo.address, utils.parseUnits('300', 18));
    await oracle.setAssetPrice(weth.address, utils.parseUnits('4000', 18));
  });

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  it("It's not possible to liquidate on a non-active collateral or a non active principal", async () => {
    const {
      configurator,
      weth,
      pool,
      users: [, user],
      rusd,
    } = testEnv;
    await configurator.setReserveActive(weth.address, false);

    await expect(
      pool.liquidationCall(weth.address, rusd.address, user.address, utils.parseEther('1000'), false)
    ).to.be.revertedWith('27');

    await configurator.setReserveActive(weth.address, true);

    await configurator.setReserveActive(rusd.address, false);

    await expect(
      pool.liquidationCall(weth.address, rusd.address, user.address, utils.parseEther('1000'), false)
    ).to.be.revertedWith('27');

    await configurator.setReserveActive(rusd.address, true);
  });

  it('Deposits WETH, borrows RUSD', async () => {
    const {
      rusd,
      weth,
      users: [depositor, borrower],
      pool,
      oracle,
    } = testEnv;

    //mints RUSD to depositor
    await rusd
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));

    //approve protocol to access depositor wallet
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //user 1 deposits 1000 RUSD
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    await pool
      .connect(depositor.signer)
      .deposit(rusd.address, amountRUSDtoDeposit, depositor.address, '0');
    //user 2 deposits  ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '0.06775');

    //mints WETH to borrower
    await weth
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '1000'));

    //approve protocol to access the borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0');

    //user 2 borrows

    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    const amountRUSDToBorrow = await convertToCurrencyDecimals(
      rusd.address,
      userGlobalData.availableBorrowsBase.div(rusdPrice).percentMul(9500).toString()
    );

    await pool
      .connect(borrower.signer)
      .borrow(rusd.address, amountRUSDToBorrow, RateMode.Stable, '0', borrower.address);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    expect(userGlobalDataAfter.currentLiquidationThreshold).to.be.equal(8250, INVALID_HF);
  });

  it('Drop the health factor below 1', async () => {
    const {
      rusd,
      users: [, borrower],
      pool,
      oracle,
    } = testEnv;

    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    await oracle.setAssetPrice(rusd.address, rusdPrice.percentMul(11800));

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor).to.be.lt(oneEther, INVALID_HF);
  });

  it('Liquidates the borrow', async () => {
    const {
      rusd,
      weth,
      users: [, borrower, , liquidator],
      pool,
      oracle,
      helpersContract,
    } = testEnv;

    //mints rusd to the liquidator
    await rusd
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));

    //approve protocol to access the liquidator wallet
    await rusd.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const rusdReserveDataBefore = await getReserveData(helpersContract, rusd.address);
    const ethReserveDataBefore = await getReserveData(helpersContract, weth.address);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    await increaseTime(100);

    const tx = await pool
      .connect(liquidator.signer)
      .liquidationCall(weth.address, rusd.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const rusdReserveDataAfter = await getReserveData(helpersContract, rusd.address);
    const ethReserveDataAfter = await getReserveData(helpersContract, weth.address);

    const collateralPrice = await oracle.getAssetPrice(weth.address);
    const principalPrice = await oracle.getAssetPrice(rusd.address);

    const collateralDecimals = (await helpersContract.getReserveConfigurationData(weth.address))
      .decimals;
    const principalDecimals = (await helpersContract.getReserveConfigurationData(rusd.address))
      .decimals;

    const expectedCollateralLiquidated = principalPrice
      .mul(amountToLiquidate)
      .percentMul(10500)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    if (!tx.blockNumber) {
      expect(false, 'Invalid block number');
      return;
    }
    const txTimestamp = BigNumber.from(
      (await hre.ethers.provider.getBlock(tx.blockNumber)).timestamp
    );

    const stableDebtBeforeTx = calcExpectedStableDebtTokenBalance(
      userReserveDataBefore.principalStableDebt,
      userReserveDataBefore.stableBorrowRate,
      userReserveDataBefore.stableRateLastUpdated,
      txTimestamp
    );

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      stableDebtBeforeTx.sub(amountToLiquidate),
      2,
      'Invalid user debt after liquidation'
    );

    //the liquidity index of the principal reserve needs to be bigger than the index before
    expect(rusdReserveDataAfter.liquidityIndex).to.be.gte(
      rusdReserveDataBefore.liquidityIndex,
      'Invalid liquidity index'
    );

    //the principal APY after a liquidation needs to be lower than the APY before
    expect(rusdReserveDataAfter.liquidityRate).to.be.lt(
      rusdReserveDataBefore.liquidityRate,
      'Invalid liquidity APY'
    );

    expect(rusdReserveDataAfter.totalLiquidity).to.be.closeTo(
      rusdReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
    );

    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral total liquidity'
    );

    expect(rusdReserveDataAfter.availableLiquidity).to.be.closeTo(
      rusdReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral available liquidity'
    );
  });

  it('User 3 deposits 1000 EURS, user 4 0.06775 WETH, user 4 borrows - drops HF, liquidates the borrow', async () => {
    const {
      eurs,
      users: [, , , depositor, borrower, liquidator],
      pool,
      oracle,
      weth,
      helpersContract,
    } = testEnv;

    //mints EURS to depositor
    await eurs
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '1000'));

    //approve protocol to access depositor wallet
    await eurs.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //depositor deposits 1000 EURS
    const amountEURStoDeposit = await convertToCurrencyDecimals(eurs.address, '1000');

    await pool
      .connect(depositor.signer)
      .deposit(eurs.address, amountEURStoDeposit, depositor.address, '0');

    //borrower deposits ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '0.06775');

    //mints WETH to borrower
    await weth
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '1000'));

    //approve protocol to access the borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0');

    //borrower borrows
    const userGlobalData = await pool.getUserAccountData(borrower.address);

    const eursPrice = await oracle.getAssetPrice(eurs.address);

    const amountEURSToBorrow = await convertToCurrencyDecimals(
      eurs.address,
      userGlobalData.availableBorrowsBase.div(eursPrice).percentMul(9502).toString()
    );

    await pool
      .connect(borrower.signer)
      .borrow(eurs.address, amountEURSToBorrow, RateMode.Stable, '0', borrower.address);

    //drops HF below 1
    await oracle.setAssetPrice(eurs.address, eursPrice.percentMul(11200));

    //mints rusd to the liquidator

    await eurs
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '1000'));

    //approve protocol to access depositor wallet
    await eurs.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      eurs.address,
      borrower.address
    );

    const eursReserveDataBefore = await getReserveData(helpersContract, eurs.address);
    const ethReserveDataBefore = await getReserveData(helpersContract, weth.address);

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    await pool
      .connect(liquidator.signer)
      .liquidationCall(weth.address, eurs.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      eurs.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    const eursReserveDataAfter = await getReserveData(helpersContract, eurs.address);
    const ethReserveDataAfter = await getReserveData(helpersContract, weth.address);

    const collateralPrice = await oracle.getAssetPrice(weth.address);
    const principalPrice = await oracle.getAssetPrice(eurs.address);

    const collateralDecimals = (await helpersContract.getReserveConfigurationData(weth.address))
      .decimals;
    const principalDecimals = (await helpersContract.getReserveConfigurationData(eurs.address))
      .decimals;

    const expectedCollateralLiquidated = principalPrice
      .mul(BigNumber.from(amountToLiquidate))
      .percentMul(10500)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(amountToLiquidate),
      2,
      'Invalid user borrow balance after liquidation'
    );

    //the liquidity index of the principal reserve needs to be bigger than the index before
    expect(eursReserveDataAfter.liquidityIndex).to.be.gte(
      eursReserveDataBefore.liquidityIndex,
      'Invalid liquidity index'
    );

    //the principal APY after a liquidation needs to be lower than the APY before
    expect(eursReserveDataAfter.liquidityRate).to.be.lt(
      eursReserveDataBefore.liquidityRate,
      'Invalid liquidity APY'
    );

    expect(eursReserveDataAfter.totalLiquidity).to.be.closeTo(
      eursReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
    );

    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral total liquidity'
    );

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral available liquidity'
    );
  });

  it('User 4 deposits 0.033 CGO - drops HF, liquidates the CGO, which results on a lower amount being liquidated', async () => {
    const {
      cgo,
      eurs,
      users: [, , , , borrower, liquidator],
      pool,
      oracle,
      helpersContract,
    } = testEnv;

    //mints CGO to borrower
    await cgo
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(cgo.address, '0.033'));

    //approve protocol to access the borrower wallet
    await cgo.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //borrower deposits 1 CGO
    const amountToDeposit = await convertToCurrencyDecimals(cgo.address, '0.033');

    await pool
      .connect(borrower.signer)
      .deposit(cgo.address, amountToDeposit, borrower.address, '0');
    const eursPrice = await oracle.getAssetPrice(eurs.address);

    //drops HF below 1
    await oracle.setAssetPrice(eurs.address, eursPrice.percentMul(11400));

    //mints eurs to the liquidator
    await eurs
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '1000'));

    //approve protocol to access liquidator wallet
    await eurs.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      eurs.address,
      borrower.address
    );

    const eursReserveDataBefore = await getReserveData(helpersContract, eurs.address);
    const cgoReserveDataBefore = await getReserveData(helpersContract, cgo.address);

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    const collateralPrice = await oracle.getAssetPrice(cgo.address);
    const principalPrice = await oracle.getAssetPrice(eurs.address);

    await pool
      .connect(liquidator.signer)
      .liquidationCall(cgo.address, eurs.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      eurs.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    const eursReserveDataAfter = await getReserveData(helpersContract, eurs.address);
    const cgoReserveDataAfter = await getReserveData(helpersContract, cgo.address);

    const cgoConfiguration = await helpersContract.getReserveConfigurationData(cgo.address);
    const collateralDecimals = cgoConfiguration.decimals;
    const liquidationBonus = cgoConfiguration.liquidationBonus;

    const principalDecimals = (await helpersContract.getReserveConfigurationData(eurs.address))
      .decimals;

    const expectedCollateralLiquidated = oneEther.mul('33').div('1000');

    const expectedPrincipal = collateralPrice
      .mul(expectedCollateralLiquidated)
      .mul(BigNumber.from(10).pow(principalDecimals))
      .div(principalPrice.mul(BigNumber.from(10).pow(collateralDecimals)))
      .percentDiv(liquidationBonus);

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(expectedPrincipal),
      2,
      'Invalid user borrow balance after liquidation'
    );

    expect(eursReserveDataAfter.totalLiquidity).to.be.closeTo(
      eursReserveDataBefore.totalLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal total liquidity'
    );

    expect(cgoReserveDataAfter.totalLiquidity).to.be.closeTo(
      cgoReserveDataBefore.totalLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral total liquidity'
    );

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal available liquidity'
    );

    expect(cgoReserveDataAfter.availableLiquidity).to.be.closeTo(
      cgoReserveDataBefore.availableLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral available liquidity'
    );
  });
});
