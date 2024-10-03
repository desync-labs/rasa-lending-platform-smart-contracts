import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import './helpers/utils/wadraymath';
import { evmRevert, evmSnapshot, waitForTx } from '../helpers/utilities/tx';

makeSuite('Pool Liquidation: Liquidates borrows in eMode with price change', (testEnv: TestEnv) => {
  const { INVALID_HF } = ProtocolErrors;

  const CATEGORY = {
    id: BigNumber.from('1'),
    ltv: BigNumber.from('9800'),
    lt: BigNumber.from('9850'),
    lb: BigNumber.from('10100'),
    oracle: ZERO_ADDRESS,
    label: 'STABLECOINS',
  };

  let snap: string;

  before(async () => {
    const { addressesProvider, oracle, rusd, weth, eurs} = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));
    
    await oracle.setAssetPrice(rusd.address, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(weth.address, utils.parseUnits('4000', 18));
    
    snap = await evmSnapshot();
  });

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  it('Adds category id 1 (stablecoins)', async () => {
    const { configurator, pool, poolAdmin } = testEnv;

    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(
          1,
          CATEGORY.ltv,
          CATEGORY.lt,
          CATEGORY.lb,
          CATEGORY.oracle,
          CATEGORY.label
        )
    );

    const categoryData = await pool.getEModeCategoryData(CATEGORY.id);

    expect(categoryData.ltv).to.be.equal(CATEGORY.ltv, 'invalid eMode category ltv');
    expect(categoryData.liquidationThreshold).to.be.equal(
      CATEGORY.lt,
      'invalid eMode category liq threshold'
    );
    expect(categoryData.liquidationBonus).to.be.equal(
      CATEGORY.lb,
      'invalid eMode category liq bonus'
    );
    expect(categoryData.priceSource).to.be.equal(
      CATEGORY.oracle,
      'invalid eMode category price source'
    );
  });

  it('Add RUSD and EURS to category id 1', async () => {
    const { configurator, pool, helpersContract, poolAdmin, rusd, eurs } = testEnv;

    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, CATEGORY.id);
    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(eurs.address, CATEGORY.id);

    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(CATEGORY.id);
    expect(await helpersContract.getReserveEModeCategory(eurs.address)).to.be.eq(CATEGORY.id);
  });

  it('Someone funds the RUSD pool', async () => {
    const {
      pool,
      users: [rusdFunder],
      rusd,
    } = testEnv;
    const supplyAmount = utils.parseUnits('1', 36);

    await rusd.connect(rusdFunder.signer)['mint(uint256)'](supplyAmount);
    await rusd.connect(rusdFunder.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool.connect(rusdFunder.signer).supply(rusd.address, supplyAmount, rusdFunder.address, 0);
  });

  it('Deposit EURS with eMode', async () => {
    const {
      pool,
      users: [, depositor],
      eurs,
    } = testEnv;

    await eurs.connect(depositor.signer)['mint(uint256)'](utils.parseUnits('10000', 2));
    await eurs.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(depositor.signer)
      .supply(eurs.address, utils.parseUnits('10000', 2), depositor.address, 0);

    await pool.connect(depositor.signer).setUserEMode(CATEGORY.id);
    expect(await pool.getUserEMode(depositor.address)).to.be.eq(CATEGORY.id);
  });

  it('Borrow 98% LTV in rusd', async () => {
    const {
      pool,
      users: [, depositor],
      rusd,
      oracle,
    } = testEnv;

    const userGlobalData = await pool.getUserAccountData(depositor.address);
    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    const amountRUSDToBorrow = await convertToCurrencyDecimals(
      rusd.address,
      userGlobalData.availableBorrowsBase.div(rusdPrice).toString()
    );

    await pool
      .connect(depositor.signer)
      .borrow(rusd.address, amountRUSDToBorrow, RateMode.Variable, 0, depositor.address);
  });

  it('Drop HF below 1', async () => {
    const {
      rusd,
      users: [, depositor],
      pool,
      oracle,
    } = testEnv;

    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    const userGlobalDataBefore = await pool.getUserAccountData(depositor.address);
    expect(userGlobalDataBefore.healthFactor).to.be.gt(utils.parseUnits('1', 18));

    await oracle.setAssetPrice(
      rusd.address,
      rusdPrice.mul(userGlobalDataBefore.healthFactor).div(utils.parseUnits('1', 18))
    );

    const userGlobalDataMid = await pool.getUserAccountData(depositor.address);
    expect(userGlobalDataMid.healthFactor).to.be.eq(utils.parseUnits('1', 18));

    await oracle.setAssetPrice(rusd.address, (await oracle.getAssetPrice(rusd.address)).add(1));

    const userGlobalDataAfter = await pool.getUserAccountData(depositor.address);
    expect(userGlobalDataAfter.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);
  });

  it('Liquidates the borrow', async () => {
    const {
      rusd,
      eurs,
      users: [, borrower, , liquidator],
      pool,
      oracle,
      helpersContract,
    } = testEnv;

    await rusd.connect(liquidator.signer)['mint(uint256)'](utils.parseUnits('100000', 18));
    await rusd.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const rusdReserveDataBefore = await getReserveData(helpersContract, rusd.address);
    const eursReserveDataBefore = await getReserveData(helpersContract, eurs.address);
    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentVariableDebt.div(2);

    const userGlobalDataBefore = await pool.getUserAccountData(borrower.address);

    await pool
      .connect(liquidator.signer)
      .liquidationCall(eurs.address, rusd.address, borrower.address, amountToLiquidate, false);

    const rusdReserveDataAfter = await getReserveData(helpersContract, rusd.address);
    const eursReserveDataAfter = await getReserveData(helpersContract, eurs.address);
    const userReserveDataAfter = await helpersContract.getUserReserveData(
      rusd.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataAfter.healthFactor).to.be.gt(userGlobalDataBefore.healthFactor);
    expect(userGlobalDataAfter.totalCollateralBase).to.be.lt(
      userGlobalDataBefore.totalCollateralBase
    );
    expect(userGlobalDataAfter.totalDebtBase).to.be.lt(userGlobalDataBefore.totalDebtBase);

    const collateralPrice = await oracle.getAssetPrice(eurs.address);
    const principalPrice = await oracle.getAssetPrice(rusd.address);
    const collateralDecimals = (await helpersContract.getReserveConfigurationData(eurs.address))
      .decimals;
    const principalDecimals = (await helpersContract.getReserveConfigurationData(rusd.address))
      .decimals;

    const expectedCollateralLiquidated = principalPrice
      .mul(amountToLiquidate)
      .percentMul(CATEGORY.lb)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    expect(userReserveDataAfter.currentVariableDebt).to.be.closeTo(
      userReserveDataBefore.currentVariableDebt.sub(amountToLiquidate),
      3,
      'Invalid user borrow balance after liquidation'
    );

    //the liquidity index of the principal reserve needs to be bigger than the index before
    expect(rusdReserveDataAfter.liquidityIndex).to.be.eq(
      rusdReserveDataBefore.liquidityIndex,
      'Invalid liquidity index'
    );

    //the principal APY after a liquidation needs to be lower than the APY before
    expect(rusdReserveDataAfter.liquidityRate).to.be.eq(0, 'Invalid liquidity APY');

    expect(rusdReserveDataAfter.availableLiquidity).to.be.closeTo(
      rusdReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral available liquidity'
    );
  });

  it('Liquidation of non-eMode collateral with eMode debt for user in EMode', async () => {
    await evmRevert(snap);
    snap = await evmSnapshot();

    const {
      helpersContract,
      oracle,
      configurator,
      pool,
      poolAdmin,
      rusd,
      eurs,
      weth,
      RSWETH,
      users: [user1, user2],
    } = testEnv;

    // Create category
    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(
          1,
          CATEGORY.ltv,
          CATEGORY.lt,
          CATEGORY.lb,
          CATEGORY.oracle,
          CATEGORY.label
        )
    );

    const categoryData = await pool.getEModeCategoryData(CATEGORY.id);

    expect(categoryData.ltv).to.be.equal(CATEGORY.ltv, 'invalid eMode category ltv');
    expect(categoryData.liquidationThreshold).to.be.equal(
      CATEGORY.lt,
      'invalid eMode category liq threshold'
    );
    expect(categoryData.liquidationBonus).to.be.equal(
      CATEGORY.lb,
      'invalid eMode category liq bonus'
    );
    expect(categoryData.priceSource).to.be.equal(
      CATEGORY.oracle,
      'invalid eMode category price source'
    );

    // Add RUSD and EURS to category
    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, CATEGORY.id);
    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(eurs.address, CATEGORY.id);
    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(CATEGORY.id);
    expect(await helpersContract.getReserveEModeCategory(eurs.address)).to.be.eq(CATEGORY.id);

    // User 1 supply 1 rusd + 1 eth, user 2 supply 10000 eurs
    const wethSupplyAmount = utils.parseUnits('1', 18);
    const rusdSupplyAmount = utils.parseUnits('1', 18);
    const eursSupplyAmount = utils.parseUnits('10000', 2);

    expect(await rusd.connect(user1.signer)['mint(uint256)'](rusdSupplyAmount));
    expect(await weth.connect(user1.signer)['mint(uint256)'](wethSupplyAmount));
    expect(await eurs.connect(user2.signer)['mint(uint256)'](eursSupplyAmount.mul(2)));

    expect(await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await eurs.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(await pool.connect(user1.signer).supply(rusd.address, rusdSupplyAmount, user1.address, 0));
    expect(
      await pool.connect(user1.signer).supply(weth.address, wethSupplyAmount, user1.address, 0)
    );
    expect(
      await pool.connect(user2.signer).supply(eurs.address, eursSupplyAmount, user2.address, 0)
    );

    // Activate emode
    expect(await pool.connect(user1.signer).setUserEMode(CATEGORY.id));

    // Borrow a as much eurs as possible
    const userData = await pool.getUserAccountData(user1.address);
    const toBorrow = userData.availableBorrowsBase.div(utils.parseUnits('1', 16));
      console.log(toBorrow);
    expect(
      await pool
        .connect(user1.signer)
        .borrow(eurs.address, toBorrow, RateMode.Variable, 0, user1.address)
    );

    // Drop weth price
    const wethPrice = await oracle.getAssetPrice(weth.address);

    const userGlobalDataBefore = await pool.getUserAccountData(user1.address);
    expect(userGlobalDataBefore.healthFactor).to.be.gt(utils.parseUnits('1', 18));

    await oracle.setAssetPrice(weth.address, wethPrice.percentMul(9000));

    const userGlobalDataAfter = await pool.getUserAccountData(user1.address);
    expect(userGlobalDataAfter.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);

    const balanceBefore = await RSWETH.balanceOf(user1.address);

    // Liquidate
    await pool
      .connect(user2.signer)
      .liquidationCall(weth.address, eurs.address, user1.address, toBorrow.div(2), false);

    const balanceAfter = await RSWETH.balanceOf(user1.address);

    const debtPrice = await oracle.getAssetPrice(eurs.address);
    const collateralPrice = await oracle.getAssetPrice(weth.address);

    const wethConfig = await helpersContract.getReserveConfigurationData(weth.address);

    const expectedCollateralLiquidated = debtPrice
      .mul(toBorrow.div(2))
      .percentMul(wethConfig.liquidationBonus)
      .mul(BigNumber.from(10).pow(18))
      .div(collateralPrice.mul(BigNumber.from(10).pow(2)));

    const collateralLiquidated = balanceBefore.sub(balanceAfter);
    expect(collateralLiquidated).to.be.closeTo(expectedCollateralLiquidated, 2);
  });

  it('Liquidation of eMode collateral with eMode debt in EMode with custom price feed', async () => {
    await evmRevert(snap);
    snap = await evmSnapshot();

    const {
      helpersContract,
      oracle,
      configurator,
      pool,
      poolAdmin,
      rusd,
      eurs,
      weth,
      RSRUSD,
      users: [user1, user2],
    } = testEnv;

    // We need an extra oracle for prices. USe user address as asset in price oracle
    const EMODE_ORACLE_ADDRESS = user1.address;
    await oracle.setAssetPrice(EMODE_ORACLE_ADDRESS, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(rusd.address, utils.parseUnits('0.99', 18));
    await oracle.setAssetPrice(eurs.address, utils.parseUnits('1.01', 18));
    await oracle.setAssetPrice(weth.address, utils.parseUnits('4000', 18));

    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(
          1,
          CATEGORY.ltv,
          CATEGORY.lt,
          CATEGORY.lb,
          EMODE_ORACLE_ADDRESS,
          CATEGORY.label
        )
    );

    const categoryData = await pool.getEModeCategoryData(CATEGORY.id);

    expect(categoryData.ltv).to.be.equal(CATEGORY.ltv, 'invalid eMode category ltv');
    expect(categoryData.liquidationThreshold).to.be.equal(
      CATEGORY.lt,
      'invalid eMode category liq threshold'
    );
    expect(categoryData.liquidationBonus).to.be.equal(
      CATEGORY.lb,
      'invalid eMode category liq bonus'
    );
    expect(categoryData.priceSource).to.be.equal(
      EMODE_ORACLE_ADDRESS,
      'invalid eMode category price source'
    );

    // Add RUSD and EURS to category
    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, CATEGORY.id);
    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(eurs.address, CATEGORY.id);
    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(CATEGORY.id);
    expect(await helpersContract.getReserveEModeCategory(eurs.address)).to.be.eq(CATEGORY.id);

    // User 1 supply 5000 rusd + 1 eth, user 2 supply 10000 eurs
    const wethSupplyAmount = utils.parseUnits('1', 18);
    const rusdSupplyAmount = utils.parseUnits('5000', 18);
    const eursSupplyAmount = utils.parseUnits('10000', 2);

    expect(await rusd.connect(user1.signer)['mint(uint256)'](rusdSupplyAmount));
    expect(await weth.connect(user1.signer)['mint(uint256)'](wethSupplyAmount));
    expect(await eurs.connect(user2.signer)['mint(uint256)'](eursSupplyAmount.mul(2)));

    expect(await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await eurs.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(await pool.connect(user1.signer).supply(rusd.address, rusdSupplyAmount, user1.address, 0));
    expect(
      await pool.connect(user1.signer).supply(weth.address, wethSupplyAmount, user1.address, 0)
    );
    expect(
      await pool.connect(user2.signer).supply(eurs.address, eursSupplyAmount, user2.address, 0)
    );

    // Activate emode
    expect(await pool.connect(user1.signer).setUserEMode(CATEGORY.id));

    // Borrow as much eurs as possible
    const userData = await pool.getUserAccountData(user1.address);
    const toBorrow = userData.availableBorrowsBase.div(utils.parseUnits('1', 16));

    expect(
      await pool
        .connect(user1.signer)
        .borrow(eurs.address, toBorrow, RateMode.Variable, 0, user1.address)
    );

    // Increase EMODE oracle price
    const oraclePrice = await oracle.getAssetPrice(EMODE_ORACLE_ADDRESS);

    const userGlobalDataBefore = await pool.getUserAccountData(user1.address);
    expect(userGlobalDataBefore.healthFactor).to.be.gt(utils.parseUnits('1', 18));

    await oracle.setAssetPrice(EMODE_ORACLE_ADDRESS, oraclePrice.mul(2));

    const userGlobalDataAfter = await pool.getUserAccountData(user1.address);
    expect(userGlobalDataAfter.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);

    const balanceBefore = await RSRUSD.balanceOf(user1.address);

    // Liquidate
    await pool
      .connect(user2.signer)
      .liquidationCall(rusd.address, eurs.address, user1.address, toBorrow.div(2), false);

    const balanceAfter = await RSRUSD.balanceOf(user1.address);

    const debtPrice = await oracle.getAssetPrice(EMODE_ORACLE_ADDRESS);
    const collateralPrice = await oracle.getAssetPrice(EMODE_ORACLE_ADDRESS);

    const expectedCollateralLiquidated = debtPrice
      .mul(toBorrow.div(2))
      .percentMul(CATEGORY.lb)
      .mul(BigNumber.from(10).pow(18))
      .div(collateralPrice.mul(BigNumber.from(10).pow(2)));

    const collateralLiquidated = balanceBefore.sub(balanceAfter);

    expect(collateralLiquidated).to.be.closeTo(expectedCollateralLiquidated, 2);
  });

  it('Liquidation of non-eMode collateral with eMode debt in eMode with custom price feed', async () => {
    await evmRevert(snap);
    snap = await evmSnapshot();

    const {
      helpersContract,
      oracle,
      configurator,
      pool,
      poolAdmin,
      rusd,
      eurs,
      weth,
      RSWETH,
      users: [user1, user2],
    } = testEnv;

    // We need an extra oracle for prices. USe user address as asset in price oracle
    const EMODE_ORACLE_ADDRESS = user1.address;
    await oracle.setAssetPrice(EMODE_ORACLE_ADDRESS, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(rusd.address, utils.parseUnits('0.99', 18));
    await oracle.setAssetPrice(eurs.address, utils.parseUnits('1.01', 18));
    await oracle.setAssetPrice(weth.address, utils.parseUnits('4000', 18));

    // Create category
    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(
          1,
          CATEGORY.ltv,
          CATEGORY.lt,
          CATEGORY.lb,
          EMODE_ORACLE_ADDRESS,
          CATEGORY.label
        )
    );

    const categoryData = await pool.getEModeCategoryData(CATEGORY.id);

    expect(categoryData.ltv).to.be.equal(CATEGORY.ltv, 'invalid eMode category ltv');
    expect(categoryData.liquidationThreshold).to.be.equal(
      CATEGORY.lt,
      'invalid eMode category liq threshold'
    );
    expect(categoryData.liquidationBonus).to.be.equal(
      CATEGORY.lb,
      'invalid eMode category liq bonus'
    );
    expect(categoryData.priceSource).to.be.equal(
      EMODE_ORACLE_ADDRESS,
      'invalid eMode category price source'
    );

    // Add RUSD and EURS to category
    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, CATEGORY.id);
    await configurator.connect(poolAdmin.signer).setAssetEModeCategory(eurs.address, CATEGORY.id);
    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(CATEGORY.id);
    expect(await helpersContract.getReserveEModeCategory(eurs.address)).to.be.eq(CATEGORY.id);

    // User 1 supply 1 rusd + 1 eth, user 2 supply 10000 eurs
    const wethSupplyAmount = utils.parseUnits('1', 18);
    const rusdSupplyAmount = utils.parseUnits('1', 18);
    const eursSupplyAmount = utils.parseUnits('10000', 2);

    expect(await rusd.connect(user1.signer)['mint(uint256)'](rusdSupplyAmount));
    expect(await weth.connect(user1.signer)['mint(uint256)'](wethSupplyAmount));
    expect(await eurs.connect(user2.signer)['mint(uint256)'](eursSupplyAmount.mul(2)));

    expect(await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await eurs.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(await pool.connect(user1.signer).supply(rusd.address, rusdSupplyAmount, user1.address, 0));
    expect(
      await pool.connect(user1.signer).supply(weth.address, wethSupplyAmount, user1.address, 0)
    );
    expect(
      await pool.connect(user2.signer).supply(eurs.address, eursSupplyAmount, user2.address, 0)
    );

    // Activate emode
    expect(await pool.connect(user1.signer).setUserEMode(CATEGORY.id));

    // Borrow a as much eurs as possible
    const userData = await pool.getUserAccountData(user1.address);
    const toBorrow = userData.availableBorrowsBase.div(utils.parseUnits('1', 16));

    expect(
      await pool
        .connect(user1.signer)
        .borrow(eurs.address, toBorrow, RateMode.Variable, 0, user1.address)
    );

    // Drop weth price
    const oraclePrice = await oracle.getAssetPrice(EMODE_ORACLE_ADDRESS);

    const userGlobalDataBefore = await pool.getUserAccountData(user1.address);
    expect(userGlobalDataBefore.healthFactor).to.be.gt(utils.parseUnits('1', 18));

    await oracle.setAssetPrice(EMODE_ORACLE_ADDRESS, oraclePrice.mul(2));

    const userGlobalDataAfter = await pool.getUserAccountData(user1.address);
    expect(userGlobalDataAfter.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);

    const balanceBefore = await RSWETH.balanceOf(user1.address);

    // Liquidate
    await pool
      .connect(user2.signer)
      .liquidationCall(weth.address, eurs.address, user1.address, toBorrow.div(2), false);

    const balanceAfter = await RSWETH.balanceOf(user1.address);

    const debtPrice = await oracle.getAssetPrice(EMODE_ORACLE_ADDRESS);
    const collateralPrice = await oracle.getAssetPrice(weth.address);

    const wethConfig = await helpersContract.getReserveConfigurationData(weth.address);

    const expectedCollateralLiquidated = debtPrice
      .mul(toBorrow.div(2))
      .percentMul(wethConfig.liquidationBonus)
      .mul(BigNumber.from(10).pow(18))
      .div(collateralPrice.mul(BigNumber.from(10).pow(2)));

    const collateralLiquidated = balanceBefore.sub(balanceAfter);
    expect(collateralLiquidated).to.be.closeTo(expectedCollateralLiquidated, 2);
  });
});
