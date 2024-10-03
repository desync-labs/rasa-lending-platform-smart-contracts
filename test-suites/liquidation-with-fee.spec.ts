import { expect } from 'chai';
import { BigNumber } from '@ethersproject/bignumber';
import { MAX_UINT_AMOUNT, oneEther } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { RSToken__factory } from '../types';
import { calcExpectedStableDebtTokenBalance } from './helpers/utils/calculations';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import { makeSuite } from './helpers/make-suite';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { waitForTx, increaseTime, evmSnapshot, evmRevert } from '../helpers/utilities/tx';
import { parseUnits } from 'ethers/lib/utils';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Pool Liquidation: Add fee to liquidations', (testEnv) => {
  const { INVALID_HF } = ProtocolErrors;

  before(async () => {
    const { addressesProvider, oracle, rusd, eurs, weth, cgo } = testEnv;

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));

    await oracle.setAssetPrice(rusd.address, parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, parseUnits('1', 18));
    await oracle.setAssetPrice(weth.address, parseUnits('4000', 18));
    await oracle.setAssetPrice(cgo.address, parseUnits('300', 18));
  });

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  it('position should be liquidated when turn on liquidation protocol fee.', async () => {
    const {
      pool,
      users: [depositor, borrower, liquidator],
      eurs,
      weth,
      oracle,
      configurator,
      helpersContract,
    } = testEnv;

    const snapId = await evmSnapshot();

    const rusdPrice = await oracle.getAssetPrice(eurs.address);

    //1. Depositor supplies 10000 EURS and 10 ETH
    await eurs
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '10000'));
    await eurs.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .supply(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '10000'),
        depositor.address,
        0
      );

    await weth
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '10'));
    await weth.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .supply(
        weth.address,
        await convertToCurrencyDecimals(weth.address, '10'),
        depositor.address,
        0
      );

    //2. Borrower supplies 10 ETH, and borrows as much EURS as it can
    await weth
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '10'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .supply(
        weth.address,
        await convertToCurrencyDecimals(weth.address, '10'),
        borrower.address,
        0
      );

    const { availableBorrowsBase } = await pool.getUserAccountData(borrower.address);
    let toBorrow = availableBorrowsBase.div(rusdPrice);
    console.log('toBorrow: ', toBorrow.toString());
    await pool
      .connect(borrower.signer)
      .borrow(eurs.address, toBorrow, RateMode.Variable, 0, borrower.address);

    //3. Liquidator supplies 10000 EURS and borrow 5 ETH
    await eurs
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '20000'));
    await eurs.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(liquidator.signer)
      .supply(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '10000'),
        liquidator.address,
        0
      );

    await pool
      .connect(liquidator.signer)
      .borrow(
        weth.address,
        await convertToCurrencyDecimals(weth.address, '1'),
        RateMode.Variable,
        0,
        liquidator.address
      );

    //4. Advance block to make ETH income index > 1
    await increaseTime(86400);

    //5. Decrease weth price to allow liquidation
    await oracle.setAssetPrice(eurs.address, parseUnits('8000', 18)); //weth = 500 eurs

    //7. Turn on liquidation protocol fee
    expect(await configurator.setLiquidationProtocolFee(weth.address, 500));
    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );
    expect(wethLiquidationProtocolFee).to.be.eq(500);

    const tryMaxTimes = 20;
    for (let i = 1; i <= tryMaxTimes; i++) {
      const tmpSnap = await evmSnapshot();
      await increaseTime(i);
      expect(
        await pool
          .connect(liquidator.signer)
          .liquidationCall(weth.address, eurs.address, borrower.address, MAX_UINT_AMOUNT, false)
      );

      if (i !== tryMaxTimes) {
        await evmRevert(tmpSnap);
      }
    }
    expect(await weth.balanceOf(liquidator.address)).to.be.gt(
      await convertToCurrencyDecimals(weth.address, '5')
    );

    await evmRevert(snapId);
  });

  it('Sets the WETH protocol liquidation fee to 1000 (10.00%)', async () => {
    const { configurator, weth, cgo, helpersContract } = testEnv;

    const oldWethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );
    const oldCgoLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      cgo.address
    );

    const wethLiquidationProtocolFeeInput = 1000;
    const cgoLiquidationProtocolFeeInput = 500;

    expect(
      await configurator.setLiquidationProtocolFee(weth.address, wethLiquidationProtocolFeeInput)
    )
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(weth.address, oldWethLiquidationProtocolFee, wethLiquidationProtocolFeeInput);
    expect(
      await configurator.setLiquidationProtocolFee(cgo.address, cgoLiquidationProtocolFeeInput)
    )
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(cgo.address, oldCgoLiquidationProtocolFee, cgoLiquidationProtocolFeeInput);

    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );
    const cgoLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      cgo.address
    );

    expect(wethLiquidationProtocolFee).to.be.equal(wethLiquidationProtocolFeeInput);
    expect(cgoLiquidationProtocolFee).to.be.equal(cgoLiquidationProtocolFeeInput);
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
    //user 2 deposits 1 ETH
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
      RSWETH,
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

    const liquidatorBalanceBefore = await weth.balanceOf(liquidator.address);

    const treasuryAddress = await RSWETH.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentRSTokenBalance;

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );

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

    const liquidatorBalanceAfter = await weth.balanceOf(liquidator.address);

    const treasuryDataAfter = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentRSTokenBalance;

    const collateralPrice = await oracle.getAssetPrice(weth.address);
    const principalPrice = await oracle.getAssetPrice(rusd.address);

    const collateralDecimals = (await helpersContract.getReserveConfigurationData(weth.address))
      .decimals;
    const principalDecimals = (await helpersContract.getReserveConfigurationData(rusd.address))
      .decimals;

    const baseCollateral = principalPrice
      .mul(amountToLiquidate)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    const bonusCollateral = baseCollateral.percentMul(10500).sub(baseCollateral);
    const totalCollateralLiquidated = baseCollateral.add(bonusCollateral);
    const liquidationProtocolFees = bonusCollateral.percentMul(wethLiquidationProtocolFee);
    const expectedLiquidationReward = totalCollateralLiquidated.sub(liquidationProtocolFees);

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

    expect(rusdReserveDataAfter.availableLiquidity).to.be.closeTo(
      rusdReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity.sub(expectedLiquidationReward),
      2,
      'Invalid collateral available liquidity'
    );

    expect(treasuryBalanceAfter).to.be.closeTo(
      treasuryBalanceBefore.add(liquidationProtocolFees),
      2,
      'Invalid treasury increase'
    );

    expect(liquidatorBalanceAfter).to.be.closeTo(
      liquidatorBalanceBefore.add(expectedLiquidationReward),
      2,
      'Invalid liquidator balance'
    );

    expect(rusdReserveDataAfter.totalLiquidity).to.be.closeTo(
      rusdReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
    );

    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity.sub(
        totalCollateralLiquidated.sub(liquidationProtocolFees)
      ),
      2,
      'Invalid collateral total liquidity'
    );
  });

  it('User 3 deposits 1000 EURS, user 4 0.06775 WETH, user 4 borrows - drops HF, liquidates the borrow', async () => {
    const {
      eurs,
      users: [, , , depositor, borrower, liquidator],
      pool,
      oracle,
      weth,
      RSWETH,
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

    //borrower deposits 1 ETH
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
    const ethReserveDataBefore = await getReserveData(helpersContract, weth.address);

    const liquidatorBalanceBefore = await weth.balanceOf(liquidator.address);

    const treasuryAddress = await RSWETH.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentRSTokenBalance;

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );

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

    const liquidatorBalanceAfter = await weth.balanceOf(liquidator.address);
    const treasuryDataAfter = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentRSTokenBalance;

    const collateralPrice = await oracle.getAssetPrice(weth.address);
    const principalPrice = await oracle.getAssetPrice(eurs.address);

    const collateralDecimals = (await helpersContract.getReserveConfigurationData(weth.address))
      .decimals;
    const principalDecimals = (await helpersContract.getReserveConfigurationData(eurs.address))
      .decimals;

    const baseCollateral = principalPrice
      .mul(amountToLiquidate)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    const bonusCollateral = baseCollateral.percentMul(10500).sub(baseCollateral);
    const totalCollateralLiquidated = baseCollateral.add(bonusCollateral);
    const liquidationProtocolFees = bonusCollateral.percentMul(wethLiquidationProtocolFee);
    const expectedLiquidationReward = totalCollateralLiquidated.sub(liquidationProtocolFees);

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

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity.sub(expectedLiquidationReward),
      2,
      'Invalid collateral available liquidity'
    );

    expect(treasuryBalanceAfter).to.be.closeTo(
      treasuryBalanceBefore.add(liquidationProtocolFees),
      2,
      'Invalid treasury increase'
    );

    expect(liquidatorBalanceAfter).to.be.closeTo(
      liquidatorBalanceBefore.add(expectedLiquidationReward),
      2,
      'Invalid liquidator balance'
    );

    expect(eursReserveDataAfter.totalLiquidity).to.be.closeTo(
      eursReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
    );

    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity.sub(
        totalCollateralLiquidated.sub(liquidationProtocolFees)
      ),
      2,
      'Invalid collateral total liquidity'
    );
  });

  it('User 4 deposits 0.03 CGO - drops HF, liquidates the CGO, which results on a lower amount being liquidated', async () => {
    const snap = await evmSnapshot();
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
      ['mint(uint256)'](await convertToCurrencyDecimals(cgo.address, '0.03'));

    //approve protocol to access the borrower wallet
    await cgo.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //borrower deposits CGO
    const amountToDeposit = await convertToCurrencyDecimals(cgo.address, '0.03');

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

    const cgoTokenAddresses = await helpersContract.getReserveTokensAddresses(cgo.address);
    const RSCgoTokenAddress = await cgoTokenAddresses.RSTokenAddress;
    const RSCgoTokenContract = await RSToken__factory.connect(
      RSCgoTokenAddress,
      hre.ethers.provider
    );
    const RSCgoTokenBalanceBefore = await RSCgoTokenContract.balanceOf(liquidator.address);
    const borrowerRSTokenBalance = await RSCgoTokenContract.balanceOf(borrower.address);

    const treasuryAddress = await RSCgoTokenContract.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      cgo.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentRSTokenBalance;

    await pool
      .connect(liquidator.signer)
      .liquidationCall(cgo.address, eurs.address, borrower.address, amountToLiquidate, true);

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

    const expectedCollateralLiquidated = oneEther.mul(30).div(1000);

    const cgoLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      cgo.address
    );

    const expectedPrincipal = collateralPrice
      .mul(expectedCollateralLiquidated)
      .mul(BigNumber.from(10).pow(principalDecimals))
      .div(principalPrice.mul(BigNumber.from(10).pow(collateralDecimals)))
      .percentDiv(liquidationBonus);

    const bonusCollateral = borrowerRSTokenBalance.sub(
      borrowerRSTokenBalance.percentDiv(liquidationBonus)
    );
    const liquidationProtocolFee = bonusCollateral.percentMul(cgoLiquidationProtocolFee);
    const expectedLiquidationReward = borrowerRSTokenBalance.sub(liquidationProtocolFee);

    const RSCgoTokenBalanceAfter = await RSCgoTokenContract.balanceOf(liquidator.address);

    const treasuryDataAfter = await helpersContract.getUserReserveData(
      cgo.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentRSTokenBalance;

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(expectedPrincipal),
      2,
      'Invalid user borrow balance after liquidation'
    );

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal available liquidity'
    );

    expect(cgoReserveDataAfter.availableLiquidity).to.be.closeTo(
      cgoReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(eursReserveDataAfter.totalLiquidity).to.be.closeTo(
      eursReserveDataBefore.totalLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal total liquidity'
    );

    expect(cgoReserveDataAfter.totalLiquidity).to.be.closeTo(
      cgoReserveDataBefore.totalLiquidity,
      2,
      'Invalid collateral total liquidity'
    );

    expect(RSCgoTokenBalanceBefore).to.be.equal(
      RSCgoTokenBalanceAfter.sub(expectedLiquidationReward),
      'Liquidator RSToken balance incorrect'
    );

    expect(treasuryBalanceBefore).to.be.equal(
      treasuryBalanceAfter.sub(liquidationProtocolFee),
      'Treasury RSToken balance incorrect'
    );

    await evmRevert(snap);
  });

  it('Set liquidationProtocolFee to 0. User 4 deposits 0.03 CGO - drops HF, liquidates the CGO, which results on a lower amount being liquidated', async () => {
    const {
      cgo,
      eurs,
      users: [, , , , borrower, liquidator],
      pool,
      oracle,
      helpersContract,
      configurator,
    } = testEnv;

    const oldCgoLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      cgo.address
    );

    expect(await configurator.setLiquidationProtocolFee(cgo.address, 0))
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(cgo.address, oldCgoLiquidationProtocolFee, 0);

    //mints CGO to borrower
    await cgo
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(cgo.address, '0.03'));

    //approve protocol to access the borrower wallet
    await cgo.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //borrower deposits CGO
    const amountToDeposit = await convertToCurrencyDecimals(cgo.address, '0.03');

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

    const cgoTokenAddresses = await helpersContract.getReserveTokensAddresses(cgo.address);
    const RSCgoTokenAddress = await cgoTokenAddresses.RSTokenAddress;
    const RSCgoTokenContract = await RSToken__factory.connect(
      RSCgoTokenAddress,
      hre.ethers.provider
    );
    const RSCgoTokenBalanceBefore = await RSCgoTokenContract.balanceOf(liquidator.address);
    const borrowerRSTokenBalance = await RSCgoTokenContract.balanceOf(borrower.address);

    const treasuryAddress = await RSCgoTokenContract.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      cgo.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentRSTokenBalance;

    await pool
      .connect(liquidator.signer)
      .liquidationCall(cgo.address, eurs.address, borrower.address, amountToLiquidate, true);

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

    const expectedCollateralLiquidated = oneEther.mul(30).div(1000);

    const cgoLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      cgo.address
    );

    const expectedPrincipal = collateralPrice
      .mul(expectedCollateralLiquidated)
      .mul(BigNumber.from(10).pow(principalDecimals))
      .div(principalPrice.mul(BigNumber.from(10).pow(collateralDecimals)))
      .percentDiv(liquidationBonus);

    const bonusCollateral = borrowerRSTokenBalance.sub(
      borrowerRSTokenBalance.percentDiv(liquidationBonus)
    );
    const liquidationProtocolFee = bonusCollateral.percentMul(cgoLiquidationProtocolFee);
    const expectedLiquidationReward = borrowerRSTokenBalance.sub(liquidationProtocolFee);

    const RSCgoTokenBalanceAfter = await RSCgoTokenContract.balanceOf(liquidator.address);

    const treasuryDataAfter = await helpersContract.getUserReserveData(
      cgo.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentRSTokenBalance;

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(expectedPrincipal),
      2,
      'Invalid user borrow balance after liquidation'
    );

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal available liquidity'
    );

    expect(cgoReserveDataAfter.availableLiquidity).to.be.closeTo(
      cgoReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(eursReserveDataAfter.totalLiquidity).to.be.closeTo(
      eursReserveDataBefore.totalLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal total liquidity'
    );

    expect(cgoReserveDataAfter.totalLiquidity).to.be.closeTo(
      cgoReserveDataBefore.totalLiquidity,
      2,
      'Invalid collateral total liquidity'
    );

    expect(RSCgoTokenBalanceBefore).to.be.equal(
      RSCgoTokenBalanceAfter.sub(expectedLiquidationReward),
      'Liquidator RSToken balance incorrect'
    );

    expect(treasuryBalanceBefore).to.be.equal(
      treasuryBalanceAfter.sub(liquidationProtocolFee),
      'Treasury RSToken balance incorrect'
    );
  });
});
