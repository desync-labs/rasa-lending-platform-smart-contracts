import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { timeLatest } from '../helpers/misc-utils';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors, RateMode } from '../helpers/types';
import {
  PriceOracleSentinel,
  PriceOracleSentinel__factory,
  SequencerOracle,
  SequencerOracle__factory,
} from '../types';
import { getFirstSigner } from '../helpers/utilities/signer';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { calcExpectedVariableDebtTokenBalance } from './helpers/utils/calculations';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import './helpers/utils/wadraymath';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { waitForTx, increaseTime } from '../helpers/utilities/tx';
import { parseUnits } from 'ethers/lib/utils';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('PriceOracleSentinel', (testEnv: TestEnv) => {
  const {
    PRICE_ORACLE_SENTINEL_CHECK_FAILED,
    INVALID_HF,
    CALLER_NOT_POOL_ADMIN,
    CALLER_NOT_RISK_OR_POOL_ADMIN,
  } = ProtocolErrors;

  let sequencerOracle: SequencerOracle;
  let priceOracleSentinel: PriceOracleSentinel;

  const GRACE_PERIOD = BigNumber.from(60 * 60);

  before(async () => {
    const { addressesProvider, deployer, oracle, rusd, weth } = testEnv;

    // Deploy SequencerOracle
    sequencerOracle = await (
      await new SequencerOracle__factory(deployer.signer).deploy(deployer.address)
    ).deployed();

    priceOracleSentinel = await (
      await new PriceOracleSentinel__factory(await getFirstSigner()).deploy(
        addressesProvider.address,
        sequencerOracle.address,
        GRACE_PERIOD
      )
    ).deployed();

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));

    await oracle.setAssetPrice(rusd.address, parseUnits('1', 18));
    await oracle.setAssetPrice(weth.address, parseUnits('4000', 18));
  });
  

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  it('Admin sets a PriceOracleSentinel and activate it for RUSD and WETH', async () => {
    const { addressesProvider, poolAdmin } = testEnv;

    await expect(
      addressesProvider
        .connect(poolAdmin.signer)
        .setPriceOracleSentinel(priceOracleSentinel.address)
    )
      .to.emit(addressesProvider, 'PriceOracleSentinelUpdated')
      .withArgs(ZERO_ADDRESS, priceOracleSentinel.address);

    expect(await addressesProvider.getPriceOracleSentinel()).to.be.eq(priceOracleSentinel.address);

    const answer = await sequencerOracle.latestRoundData();
    expect(answer[1]).to.be.eq(0);
    expect(answer[3]).to.be.eq(0);
  });

  it('Pooladmin updates grace period for sentinel', async () => {
    const { poolAdmin } = testEnv;

    const newGracePeriod = 0;

    expect(await priceOracleSentinel.getGracePeriod()).to.be.eq(GRACE_PERIOD);
    await expect(priceOracleSentinel.connect(poolAdmin.signer).setGracePeriod(0))
      .to.emit(priceOracleSentinel, 'GracePeriodUpdated')
      .withArgs(0);
    expect(await priceOracleSentinel.getGracePeriod()).to.be.eq(newGracePeriod);
  });

  it('Risk admin updates grace period for sentinel', async () => {
    const { riskAdmin } = testEnv;

    expect(await priceOracleSentinel.getGracePeriod()).to.be.eq(0);
    await expect(priceOracleSentinel.connect(riskAdmin.signer).setGracePeriod(GRACE_PERIOD))
      .to.emit(priceOracleSentinel, 'GracePeriodUpdated')
      .withArgs(GRACE_PERIOD);
    expect(await priceOracleSentinel.getGracePeriod()).to.be.eq(GRACE_PERIOD);
  });

  it('User tries to set grace period for sentinel', async () => {
    const {
      users: [user],
    } = testEnv;

    expect(await priceOracleSentinel.getGracePeriod()).to.be.eq(GRACE_PERIOD);
    await expect(priceOracleSentinel.connect(user.signer).setGracePeriod(0)).to.be.revertedWith(
      CALLER_NOT_RISK_OR_POOL_ADMIN
    );
    expect(await priceOracleSentinel.getGracePeriod()).to.not.be.eq(0);
  });

  it('Pooladmin update the sequencer oracle', async () => {
    const { poolAdmin } = testEnv;

    const newSequencerOracle = ZERO_ADDRESS;

    expect(await priceOracleSentinel.getSequencerOracle()).to.be.eq(sequencerOracle.address);
    await expect(
      priceOracleSentinel.connect(poolAdmin.signer).setSequencerOracle(newSequencerOracle)
    )
      .to.emit(priceOracleSentinel, 'SequencerOracleUpdated')
      .withArgs(newSequencerOracle);
    expect(await priceOracleSentinel.getSequencerOracle()).to.be.eq(newSequencerOracle);

    await expect(
      priceOracleSentinel.connect(poolAdmin.signer).setSequencerOracle(sequencerOracle.address)
    )
      .to.emit(priceOracleSentinel, 'SequencerOracleUpdated')
      .withArgs(sequencerOracle.address);
    expect(await priceOracleSentinel.getSequencerOracle()).to.be.eq(sequencerOracle.address);
  });

  it('User tries to update sequencer oracle', async () => {
    const {
      users: [user],
    } = testEnv;
    const newSequencerOracle = ZERO_ADDRESS;

    expect(await priceOracleSentinel.getSequencerOracle()).to.be.eq(sequencerOracle.address);
    await expect(
      priceOracleSentinel.connect(user.signer).setSequencerOracle(newSequencerOracle)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
    expect(await priceOracleSentinel.getSequencerOracle()).to.be.eq(sequencerOracle.address);
  });

  it('Borrow RUSD', async () => {
    const {
      rusd,
      weth,
      users: [depositor, borrower, borrower2],
      pool,
      oracle,
    } = testEnv;

    //mints RUSD to depositor
    await rusd
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '2000'));

    //approve protocol to access depositor wallet
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //user 1 deposits 1000 RUSD
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, '2000');
    await pool
      .connect(depositor.signer)
      .deposit(rusd.address, amountRUSDtoDeposit, depositor.address, '0');

    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '0.06775');

    for (let i = 0; i < 2; i++) {
      const borrowers = [borrower, borrower2];
      const currBorrower = borrowers[i];
      //mints WETH to borrower
      await weth.connect(currBorrower.signer)['mint(uint256)'](amountETHtoDeposit);

      //approve protocol to access borrower wallet
      await weth.connect(currBorrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

      //user 2 deposits 1 WETH
      await pool
        .connect(currBorrower.signer)
        .deposit(weth.address, amountETHtoDeposit, currBorrower.address, '0');

      //user 2 borrows
      const userGlobalData = await pool.getUserAccountData(currBorrower.address);
      const rusdPrice = await oracle.getAssetPrice(rusd.address);

      const amountRUSDToBorrow = await convertToCurrencyDecimals(
        rusd.address,
        userGlobalData.availableBorrowsBase.div(rusdPrice.toString()).percentMul(9500).toString()
      );

      await pool
        .connect(currBorrower.signer)
        .borrow(rusd.address, amountRUSDToBorrow, RateMode.Variable, '0', currBorrower.address);
    }
  });

  it('Kill sequencer and drop health factor below 1', async () => {
    const {
      rusd,
      users: [, borrower],
      pool,
      oracle,
    } = testEnv;

    const rusdPrice = await oracle.getAssetPrice(rusd.address);
    await oracle.setAssetPrice(rusd.address, rusdPrice.percentMul(11000));
    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);
    const currAnswer = await sequencerOracle.latestRoundData();
    waitForTx(await sequencerOracle.setAnswer(true, currAnswer[3]));
  });

  it('Tries to liquidate borrower when sequencer is down (HF > 0.95) (revert expected)', async () => {
    const {
      pool,
      rusd,
      weth,
      users: [, borrower],
      helpersContract,
    } = testEnv;

    await rusd['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));
    await rusd.approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentVariableDebt.div(2);
    await expect(
      pool.liquidationCall(weth.address, rusd.address, borrower.address, amountToLiquidate, true)
    ).to.be.revertedWith(PRICE_ORACLE_SENTINEL_CHECK_FAILED);
  });

  it('Drop health factor lower', async () => {
    const {
      rusd,
      users: [, borrower],
      pool,
      oracle,
    } = testEnv;

    const rusdPrice = await oracle.getAssetPrice(rusd.address);
    await oracle.setAssetPrice(rusd.address, rusdPrice.percentMul(11000));
    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);
  });

  it('Liquidates borrower when sequencer is down (HF < 0.95)', async () => {
    const {
      pool,
      rusd,
      weth,
      users: [, borrower],
      oracle,
      helpersContract,
      deployer,
    } = testEnv;

    await rusd['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));
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

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(
      (await helpersContract.getUserReserveData(weth.address, deployer.address))
        .usageAsCollateralEnabled
    ).to.be.true;
  });

  it('User tries to borrow (revert expected)', async () => {
    const {
      rusd,
      weth,
      users: [, , , user],
      pool,
      oracle,
    } = testEnv;

    await weth.connect(user.signer)['mint(uint256)'](utils.parseUnits('0.06775', 18));
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .supply(weth.address, utils.parseUnits('0.06775', 18), user.address, 0);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseUnits('100', 18), RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(PRICE_ORACLE_SENTINEL_CHECK_FAILED);
  });

  it('Turn on sequencer', async () => {
    await waitForTx(await sequencerOracle.setAnswer(false, await timeLatest()));
  });

  it('User tries to borrow (revert expected)', async () => {
    const {
      rusd,
      weth,
      users: [, , , user],
      pool,
    } = testEnv;

    await weth.connect(user.signer)['mint(uint256)'](utils.parseUnits('0.06775', 18));
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .supply(weth.address, utils.parseUnits('0.06775', 18), user.address, 0);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseUnits('100', 18), RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(PRICE_ORACLE_SENTINEL_CHECK_FAILED);
  });

  it('Turn off sequencer + increase time more than grace period', async () => {
    const currAnswer = await sequencerOracle.latestRoundData();
    await waitForTx(await sequencerOracle.setAnswer(true, currAnswer[3]));
    await increaseTime(GRACE_PERIOD.mul(2).toNumber());
  });

  it('User tries to borrow (revert expected)', async () => {
    const {
      rusd,
      weth,
      users: [, , , user],
      pool,
    } = testEnv;

    await weth.connect(user.signer)['mint(uint256)'](utils.parseUnits('0.06775', 18));
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .supply(weth.address, utils.parseUnits('0.06775', 18), user.address, 0);

    await expect(
      pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseUnits('100', 18), RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(PRICE_ORACLE_SENTINEL_CHECK_FAILED);
  });

  it('Turn on sequencer + increase time past grace period', async () => {
    await waitForTx(await sequencerOracle.setAnswer(false, await timeLatest()));
    await increaseTime(GRACE_PERIOD.mul(2).toNumber());
  });

  it('User tries to borrow', async () => {
    const {
      rusd,
      weth,
      users: [, , , user],
      pool,
    } = testEnv;

    await weth.connect(user.signer)['mint(uint256)'](utils.parseUnits('0.06775', 18));
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .supply(weth.address, utils.parseUnits('0.06775', 18), user.address, 0);

    await waitForTx(
      await pool
        .connect(user.signer)
        .borrow(rusd.address, utils.parseUnits('100', 18), RateMode.Variable, 0, user.address)
    );
  });

  it('Increase health factor', async () => {
    const {
      rusd,
      users: [, borrower],
      pool,
      oracle,
    } = testEnv;
    const rusdPrice = await oracle.getAssetPrice(rusd.address);
    await oracle.setAssetPrice(rusd.address, rusdPrice.percentMul(9500));
    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor).to.be.lt(utils.parseUnits('1', 18), INVALID_HF);
    expect(userGlobalData.healthFactor).to.be.gt(utils.parseUnits('0.95', 18), INVALID_HF);
  });

  it('Liquidates borrower when sequencer is up again', async () => {
    const {
      pool,
      rusd,
      weth,
      users: [, , borrower],
      oracle,
      helpersContract,
      deployer,
    } = testEnv;

    await rusd['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000'));
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

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(
      (await helpersContract.getUserReserveData(weth.address, deployer.address))
        .usageAsCollateralEnabled
    ).to.be.true;
  });
});
