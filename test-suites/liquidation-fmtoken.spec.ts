import { MockRSTokenRepayment__factory } from '../types/factories/contracts/mocks/tokens/MockRSTokenRepayment__factory';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { MAX_UINT_AMOUNT, oneEther } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { calcExpectedVariableDebtTokenBalance } from './helpers/utils/calculations';
import { getUserData, getReserveData } from './helpers/utils/helpers';
import { makeSuite } from './helpers/make-suite';
import { waitForTx } from '../helpers/utilities/tx';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { parseUnits } from 'ethers/lib/utils';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Pool Liquidation: Liquidator receiving RSToken', (testEnv) => {
  const {
    HEALTH_FACTOR_NOT_BELOW_THRESHOLD,
    INVALID_HF,
    SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER,
    COLLATERAL_CANNOT_BE_LIQUIDATED,
  } = ProtocolErrors;

  let oracleBaseDecimals: number;

  before(async () => {
    const { rasaOracle, addressesProvider, oracle, deployer, pool, configurator, RSRUSD, rusd, weth, eurs } =
      testEnv;
    oracleBaseDecimals = (await (await rasaOracle.BASE_CURRENCY_UNIT()).toString().length) - 1;

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));

    const RSTokenRepayImpl = await new MockRSTokenRepayment__factory(deployer.signer).deploy(
      pool.address
    );

    await configurator.updateRSToken({
      asset: rusd.address,
      treasury: await RSRUSD.RESERVE_TREASURY_ADDRESS(),
      incentivesController: await RSRUSD.getIncentivesController(),
      name: await RSRUSD.name(),
      symbol: await RSRUSD.symbol(),
      implementation: RSTokenRepayImpl.address,
      params: '0x',
    });

    await oracle.setAssetPrice(rusd.address, parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, parseUnits('1', 18));
    await oracle.setAssetPrice(weth.address, parseUnits('4000', 18));

  });

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  it('Deposits WETH, borrows RUSD/Check liquidation fails because health factor is above 1', async () => {
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

    //user 1 deposits RUSD
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, '1000');
    await pool
      .connect(depositor.signer)
      .deposit(rusd.address, amountRUSDtoDeposit, depositor.address, '0');

    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '0.3');

    //mints WETH to borrower
    await weth.connect(borrower.signer)['mint(uint256)'](amountETHtoDeposit);

    //approve protocol to access borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //user 2 deposits WETH
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0');

    //user 2 borrows
    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const rusdPrice = await oracle.getAssetPrice(rusd.address);
    const amountRUSDToBorrow = await convertToCurrencyDecimals(
      rusd.address,
      userGlobalData.availableBorrowsBase.div(rusdPrice.toString()).percentMul(9500).toString()
    );
    await pool
      .connect(borrower.signer)
      .borrow(rusd.address, amountRUSDToBorrow, RateMode.Variable, '0', borrower.address);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    expect(userGlobalDataAfter.currentLiquidationThreshold).to.be.equal(
      8250,
      'Invalid liquidation threshold'
    );

    //someone tries to liquidate user 2
    await expect(
      pool.liquidationCall(weth.address, rusd.address, borrower.address, 1, true)
    ).to.be.revertedWith(HEALTH_FACTOR_NOT_BELOW_THRESHOLD);
  });

  it('Drop the health factor below 1', async () => {
    const {
      rusd,
      users: [, borrower],
      pool,
      oracle,
      rasaOracle,
    } = testEnv;

    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    await oracle.setAssetPrice(rusd.address, rusdPrice.percentMul(11500));

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor).to.be.lt(oneEther, INVALID_HF);
  });

  it('Tries to liquidate a different currency than the loan principal (revert expected)', async () => {
    const {
      pool,
      users: [, borrower],
      weth,
    } = testEnv;
    //user 2 tries to borrow
    await expect(
      pool.liquidationCall(weth.address, weth.address, borrower.address, oneEther, true)
    ).to.be.revertedWith(SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER);
  });

  it('Tries to liquidate a different collateral than the borrower collateral (revert expected)', async () => {
    const {
      pool,
      rusd,
      users: [, borrower],
    } = testEnv;

    await expect(
      pool.liquidationCall(rusd.address, rusd.address, borrower.address, oneEther, true)
    ).to.be.revertedWith(COLLATERAL_CANNOT_BE_LIQUIDATED);
  });

  it('Liquidates the borrow', async () => {
    const {
      pool,
      rusd,
      RSRUSD,
      weth,
      users: [, borrower],
      oracle,
      helpersContract,
      deployer,
    } = testEnv;

    //mints rusd to the caller

    await rusd['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));

    //approve protocol to access depositor wallet
    await rusd.approve(pool.address, MAX_UINT_AMOUNT);

    const rusdReserveDataBefore = await getReserveData(helpersContract, rusd.address);
    const ethReserveDataBefore = await getReserveData(helpersContract, weth.address);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const userWethReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      weth.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentVariableDebt.div(2);

    // The supply is the same, but there should be a change in who has what. The liquidator should have received what the borrower lost.
    const tx = await pool.liquidationCall(
      weth.address,
      rusd.address,
      borrower.address,
      amountToLiquidate,
      true
    );

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      rusd.address,
      borrower.address
    );

    const userWethReserveDataAfter = await helpersContract.getUserReserveData(
      weth.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

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

    expect(expectedCollateralLiquidated).to.be.closeTo(
      userWethReserveDataBefore.currentRSTokenBalance.sub(
        userWethReserveDataAfter.currentRSTokenBalance
      ),
      2,
      'Invalid collateral amount liquidated'
    );

    if (!tx.blockNumber) {
      expect(false, 'Invalid block number');
      return;
    }

    const txTimestamp = BigNumber.from(
      (await hre.ethers.provider.getBlock(tx.blockNumber)).timestamp
    );

    const variableDebtBeforeTx = calcExpectedVariableDebtTokenBalance(
      rusdReserveDataBefore,
      userReserveDataBefore,
      txTimestamp
    );

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentVariableDebt).to.be.closeTo(
      variableDebtBeforeTx.sub(amountToLiquidate),
      2,
      'Invalid user borrow balance after liquidation'
    );

    expect(rusdReserveDataAfter.availableLiquidity).to.be.closeTo(
      rusdReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(rusdReserveDataAfter.totalLiquidity).to.be.closeTo(
      rusdReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
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

    // We need the scaled balances here
    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity,
      2,
      'Invalid collateral total liquidity'
    );

    expect(
      (await helpersContract.getUserReserveData(weth.address, deployer.address))
        .usageAsCollateralEnabled
    ).to.be.true;

    // check handleRepayment function is correctly called
    await expect(tx)
      .to.emit(MockRSTokenRepayment__factory.connect(RSRUSD.address, borrower.signer), 'MockRepayment')
      .withArgs(deployer.address, borrower.address, amountToLiquidate);
  });

  it('User 3 deposits 2000 EURS, user 4 0.12 WETH, user 4 borrows - drops HF, liquidates the borrow', async () => {
    const {
      users: [, , , depositor, borrower],
      pool,
      eurs,
      oracle,
      weth,
      helpersContract,
    } = testEnv;

    //mints EURS to depositor
    await eurs
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '2000'));

    //approve protocol to access depositor wallet
    await eurs.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //user 3 deposits 1000 EURS
    const amountEURStoDeposit = await convertToCurrencyDecimals(eurs.address, '2000');

    await pool
      .connect(depositor.signer)
      .deposit(eurs.address, amountEURStoDeposit, depositor.address, '0');

    //user 4 deposits ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '0.12');

    //mints WETH to borrower
    await weth.connect(borrower.signer)['mint(uint256)'](amountETHtoDeposit);

    //approve protocol to access borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0');

    //user 4 borrows
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

    await eurs['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '1000'));

    //approve protocol to access depositor wallet
    await eurs.approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      eurs.address,
      borrower.address
    );

    const eursReserveDataBefore = await getReserveData(helpersContract, eurs.address);
    const ethReserveDataBefore = await getReserveData(helpersContract, weth.address);
    const userWethReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      weth.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    await pool.liquidationCall(
      weth.address,
      eurs.address,
      borrower.address,
      amountToLiquidate,
      true
    );

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      eurs.address,
      borrower.address
    );

    const userWethReserveDataAfter = await helpersContract.getUserReserveData(
      weth.address,
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
      .mul(amountToLiquidate)
      .percentMul(10500)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    expect(expectedCollateralLiquidated).to.be.eq(
      userWethReserveDataBefore.currentRSTokenBalance.sub(
        userWethReserveDataAfter.currentRSTokenBalance
      ),
      'Invalid collateral amount liquidated'
    );

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(amountToLiquidate),
      2,
      'Invalid user borrow balance after liquidation'
    );

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(eursReserveDataAfter.totalLiquidity).to.be.closeTo(
      eursReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
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

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity,
      2,
      'Invalid collateral total liquidity'
    );
  });
});
