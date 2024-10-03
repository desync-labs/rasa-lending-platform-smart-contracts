import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { calcExpectedVariableDebtTokenBalance } from './helpers/utils/calculations';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import { makeSuite, TestEnv } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { waitForTx, increaseTime } from '../helpers/utilities/tx';
import { parseEther, parseUnits } from 'ethers/lib/utils';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Pool Liquidation: Liquidates borrows in eMode through interest', (testEnv: TestEnv) => {
  const { INVALID_HF } = ProtocolErrors;

  const CATEGORY = {
    id: BigNumber.from('1'),
    ltv: BigNumber.from('9800'),
    lt: BigNumber.from('9850'),
    lb: BigNumber.from('10100'),
    oracle: ZERO_ADDRESS,
    label: 'STABLECOINS',
  };

  before(async () => {
    const { addressesProvider, oracle, rusd, eurs } = testEnv;

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));

    await oracle.setAssetPrice(rusd.address, parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, parseUnits('1', 18));
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
          CATEGORY.id,
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
    const { configurator, poolAdmin, rusd, eurs } = testEnv;

    expect(
      await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, CATEGORY.id)
    );
    expect(
      await configurator.connect(poolAdmin.signer).setAssetEModeCategory(eurs.address, CATEGORY.id)
    );
  });

  it('Someone funds the RUSD pool', async () => {
    const {
      pool,
      users: [rusdFunder],
      rusd,
    } = testEnv;
    const supplyAmount = utils.parseUnits('10000', 18);

    await rusd.connect(rusdFunder.signer)['mint(uint256)'](supplyAmount);
    await rusd.connect(rusdFunder.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool.connect(rusdFunder.signer).supply(rusd.address, supplyAmount, rusdFunder.address, 0);
  });

  it('Deposit EURS with eMode', async () => {
    const {
      pool,
      users: [, borrower],
      eurs,
    } = testEnv;

    await eurs.connect(borrower.signer)['mint(uint256)'](utils.parseUnits('10000', 2));
    await eurs.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(borrower.signer)
      .supply(eurs.address, utils.parseUnits('10000', 2), borrower.address, 0);

    await pool.connect(borrower.signer).setUserEMode(CATEGORY.id);
  });

  it('Borrow as much RUSD as possible', async () => {
    const {
      pool,
      users: [, borrower],
      rusd,
      oracle,
    } = testEnv;

    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    const amountRUSDToBorrow = await convertToCurrencyDecimals(
      rusd.address,
      userGlobalData.availableBorrowsBase.div(rusdPrice).toString()
    );

    await pool
      .connect(borrower.signer)
      .borrow(rusd.address, amountRUSDToBorrow, RateMode.Variable, 0, borrower.address);
  });

  it('Drop HF below 1', async () => {
    const {
      users: [, borrower],
      pool,
    } = testEnv;

    const userGlobalDataBefore = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataBefore.healthFactor).to.be.gt(utils.parseUnits('1', 18), INVALID_HF);
    await increaseTime(60 * 60 * 24 * 3);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataAfter.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);
  });

  it('Liquidates the borrow', async () => {
    const {
      rusd,
      eurs,
      users: [, borrower, liquidator],
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

    const tx = await pool
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

    expect(userReserveDataAfter.currentVariableDebt).to.be.closeTo(
      variableDebtBeforeTx.sub(amountToLiquidate),
      2,
      'Invalid user borrow balance after liquidation'
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

    expect(eursReserveDataAfter.availableLiquidity).to.be.closeTo(
      eursReserveDataBefore.availableLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral available liquidity'
    );
  });
});
