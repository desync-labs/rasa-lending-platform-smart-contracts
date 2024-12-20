import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { makeSuite, TestEnv } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import { parseUnits, parseEther } from '@ethersproject/units';
import { evmSnapshot, evmRevert } from '../helpers/utilities/tx';
import { VariableDebtToken__factory } from '../types';

makeSuite('EfficiencyMode', (testEnv: TestEnv) => {
  const {
    INCONSISTENT_EMODE_CATEGORY,
    HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD,
    COLLATERAL_CANNOT_COVER_NEW_BORROW,
    INVALID_EMODE_CATEGORY_PARAMS,
  } = ProtocolErrors;

  let snapSetup: string;

  const CATEGORIES = {
    STABLECOINS: {
      id: BigNumber.from('1'),
      ltv: BigNumber.from('9800'),
      lt: BigNumber.from('9800'),
      lb: BigNumber.from('10100'),
      oracle: ZERO_ADDRESS,
      label: 'STABLECOINS',
    },
    ETHEREUM: {
      id: BigNumber.from('2'),
      ltv: BigNumber.from('9800'),
      lt: BigNumber.from('9800'),
      lb: BigNumber.from('10100'),
      oracle: ZERO_ADDRESS,
      label: 'ETHEREUM',
    },
  };

  before(async () => {
    const {
      pool,
      rusd,
      eurs,
      weth,
      users: [user0, user1, user2],
      oracle,
    } = testEnv;
    const mintAmount = utils.parseEther('10000');

    await rusd.connect(user0.signer)['mint(uint256)'](mintAmount);
    await eurs.connect(user0.signer)['mint(uint256)'](mintAmount);
    await weth.connect(user0.signer)['mint(uint256)'](mintAmount);
    await eurs.connect(user1.signer)['mint(uint256)'](mintAmount);
    await weth.connect(user1.signer)['mint(uint256)'](mintAmount);
    await rusd.connect(user2.signer)['mint(uint256)'](mintAmount);

    await rusd.connect(user0.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await eurs.connect(user0.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await weth.connect(user0.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await eurs.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await rusd.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await oracle.setAssetPrice(rusd.address, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(weth.address, utils.parseUnits('4000', 18));

    snapSetup = await evmSnapshot();
  });

  it('Admin adds a category for stablecoins with RUSD and EURS', async () => {
    const { configurator, helpersContract, rusd, eurs, poolAdmin } = testEnv;

    const { id, ltv, lt, lb, oracle, label } = CATEGORIES.STABLECOINS;

    expect(
      await configurator.connect(poolAdmin.signer).setEModeCategory(id, ltv, lt, lb, oracle, label)
    );
    expect(await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, id));
    expect(await configurator.connect(poolAdmin.signer).setAssetEModeCategory(eurs.address, id));

    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(id);
    expect(await helpersContract.getReserveEModeCategory(eurs.address)).to.be.eq(id);
  });

  it('Admin adds a category for ethereum with WETH', async () => {
    const { configurator, helpersContract, weth, poolAdmin } = testEnv;

    const { id, ltv, lt, lb, oracle, label } = CATEGORIES.ETHEREUM;

    expect(
      await configurator.connect(poolAdmin.signer).setEModeCategory(id, ltv, lt, lb, oracle, label)
    );
    expect(await configurator.connect(poolAdmin.signer).setAssetEModeCategory(weth.address, id));

    expect(await helpersContract.getReserveEModeCategory(weth.address)).to.be.eq(id);
  });

  it('User 0 activates eMode for stablecoins category', async () => {
    const {
      pool,
      users: [user0],
    } = testEnv;

    expect(await pool.connect(user0.signer).setUserEMode(CATEGORIES.STABLECOINS.id))
      .to.emit(pool, 'UserEModeSet')
      .withArgs(user0.address, CATEGORIES.STABLECOINS.id);

    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.STABLECOINS.id);
  });

  it('User 0 supplies 100 RUSD, user 1 supplies 100 EURS', async () => {
    const {
      pool,
      rusd,
      eurs,
      helpersContract,
      users: [user0, user1],
    } = testEnv;

    expect(
      await pool
        .connect(user0.signer)
        .supply(rusd.address, await convertToCurrencyDecimals(rusd.address, '100'), user0.address, 0)
    );
    const { usageAsCollateralEnabled: user0UseAsCollateral } =
      await helpersContract.getUserReserveData(rusd.address, user0.address);
    expect(user0UseAsCollateral).to.be.true;

    expect(
      await pool
        .connect(user1.signer)
        .supply(
          eurs.address,
          await convertToCurrencyDecimals(eurs.address, '100'),
          user1.address,
          0
        )
    );
    const { usageAsCollateralEnabled: user1UseAsCollateral } =
      await helpersContract.getUserReserveData(eurs.address, user1.address);
    expect(user1UseAsCollateral).to.be.true;
  });

  it('User 0 borrows 98 EURS and tries to deactivate eMode (revert expected)', async () => {
    const {
      pool,
      eurs,
      users: [user0],
    } = testEnv;
    expect(
      await pool
        .connect(user0.signer)
        .borrow(
          eurs.address,
          await convertToCurrencyDecimals(eurs.address, '98'),
          RateMode.Variable,
          0,
          user0.address
        )
    );

    const userCategory = await pool.getUserEMode(user0.address);
    await expect(pool.connect(user0.signer).setUserEMode(0)).to.be.revertedWith(
      HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
    );
    expect(await pool.getUserEMode(user0.address)).to.be.eq(userCategory);
  });

  it('User 0 tries to sends RSTokens to user 3 (revert expected)', async () => {
    const {
      pool,
      rusd,
      RSRUSD,
      users: [user0, , , user3],
    } = testEnv;

    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.STABLECOINS.id);
    expect(await pool.getUserEMode(user3.address)).to.be.eq(0);

    await expect(
      RSRUSD
        .connect(user0.signer)
        .transfer(user3.address, await convertToCurrencyDecimals(rusd.address, '10'))
    ).to.be.revertedWith(HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD);

    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.STABLECOINS.id);
    expect(await pool.getUserEMode(user3.address)).to.be.eq(0);
  });

  it('User 0 repays 50 EURS and withdraws 10 RUSD', async () => {
    const {
      pool,
      rusd,
      eurs,
      users: [user0],
    } = testEnv;
    expect(
      await pool
        .connect(user0.signer)
        .repay(
          eurs.address,
          await convertToCurrencyDecimals(eurs.address, '50'),
          RateMode.Variable,
          user0.address
        )
    )
      .to.emit(pool, 'Repay')
      .withArgs(
        eurs.address,
        user0.address,
        user0.address,
        await convertToCurrencyDecimals(eurs.address, '50'),
        false
      );
    expect(
      await pool
        .connect(user0.signer)
        .withdraw(rusd.address, await convertToCurrencyDecimals(rusd.address, '10'), user0.address)
    );
  });

  it('User 0 supplies WETH (non-category asset), increasing borrowing power', async () => {
    const {
      pool,
      helpersContract,
      weth,
      users: [user0],
    } = testEnv;
    const userDataBefore = await pool.getUserAccountData(user0.address);

    expect(
      await pool
        .connect(user0.signer)
        .supply(weth.address, await convertToCurrencyDecimals(weth.address, '1'), user0.address, 0)
    );
    const { usageAsCollateralEnabled } = await helpersContract.getUserReserveData(
      weth.address,
      user0.address
    );
    expect(usageAsCollateralEnabled).to.be.true;

    const userDataAfter = await pool.getUserAccountData(user0.address);
    expect(userDataBefore.availableBorrowsBase).to.be.lt(userDataAfter.availableBorrowsBase);
    expect(userDataBefore.totalCollateralBase).to.be.lt(userDataAfter.totalCollateralBase);
    expect(userDataBefore.totalDebtBase).to.be.eq(userDataAfter.totalDebtBase);
    expect(userDataBefore.healthFactor).to.be.lt(userDataAfter.healthFactor);
  });

  it('User 1 supplies 1 WETH and activates eMode for ethereum category', async () => {
    const {
      pool,
      helpersContract,
      weth,
      users: [, user1],
      oracle,
    } = testEnv;
    const wethPrice = await oracle.getAssetPrice(weth.address);

    const userDataBeforeSupply = await pool.getUserAccountData(user1.address);

    // Supply 1 WETH, increasing totalCollateralBase
    const wethToSupply = await convertToCurrencyDecimals(weth.address, '1');
    expect(await pool.connect(user1.signer).supply(weth.address, wethToSupply, user1.address, 0));
    const { usageAsCollateralEnabled } = await helpersContract.getUserReserveData(
      weth.address,
      user1.address
    );
    expect(usageAsCollateralEnabled).to.be.true;
    const userDataBeforeEMode = await pool.getUserAccountData(user1.address);
    // expect(userDataBeforeSupply.totalCollateralBase).to.be.eq(
    //   userDataBeforeEMode.totalCollateralBase.sub(wethToSupply.wadMul(wethPrice))
    // );

    // Activate EMode, increasing availableBorrowsBase
    expect(await pool.connect(user1.signer).setUserEMode(CATEGORIES.ETHEREUM.id))
      .to.emit(pool, 'UserEModeSet')
      .withArgs(user1.address, CATEGORIES.ETHEREUM.id);
    expect(await pool.getUserEMode(user1.address)).to.be.eq(CATEGORIES.ETHEREUM.id);

    const userDataAfterEMode = await pool.getUserAccountData(user1.address);
    expect(userDataBeforeEMode.totalCollateralBase).to.be.eq(
      userDataAfterEMode.totalCollateralBase
    );
    expect(userDataBeforeEMode.availableBorrowsBase).to.be.lt(
      userDataAfterEMode.availableBorrowsBase
    );
  });

  it('User 0 tries to activate eMode for ethereum category (revert expected)', async () => {
    const {
      pool,
      users: [user0],
    } = testEnv;

    const userCategory = await pool.getUserEMode(user0.address);
    await expect(
      pool.connect(user0.signer).setUserEMode(CATEGORIES.ETHEREUM.id)
    ).to.be.revertedWith(INCONSISTENT_EMODE_CATEGORY);
    expect(await pool.getUserEMode(user0.address)).to.be.eq(userCategory);
  });

  it('User 0 tries to borrow (non-category asset) WETH (revert expected)', async () => {
    const {
      pool,
      weth,
      users: [user0],
    } = testEnv;

    await expect(
      pool
        .connect(user0.signer)
        .borrow(
          weth.address,
          await convertToCurrencyDecimals(weth.address, '0.0001'),
          RateMode.Variable,
          0,
          user0.address
        )
    ).to.be.revertedWith(INCONSISTENT_EMODE_CATEGORY);
  });

  it('User 1 tries to borrow (non-category asset) RUSD (revert expected)', async () => {
    const {
      pool,
      rusd,
      users: [, user1],
    } = testEnv;

    await expect(
      pool
        .connect(user1.signer)
        .borrow(
          rusd.address,
          await convertToCurrencyDecimals(rusd.address, '10'),
          RateMode.Variable,
          0,
          user1.address
        )
    ).to.be.revertedWith(INCONSISTENT_EMODE_CATEGORY);
  });

  it('User 0 repays EURS debt and activates eMode for ethereum category', async () => {
    const {
      pool,
      eurs,
      users: [user0],
    } = testEnv;

    expect(
      await pool
        .connect(user0.signer)
        .repay(eurs.address, MAX_UINT_AMOUNT, RateMode.Variable, user0.address)
    );

    expect(await pool.connect(user0.signer).setUserEMode(CATEGORIES.ETHEREUM.id));
    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.ETHEREUM.id);
  });

  it('User 1 activates eMode for stablecoins category', async () => {
    const {
      pool,
      users: [, user1],
    } = testEnv;

    expect(await pool.connect(user1.signer).setUserEMode(CATEGORIES.STABLECOINS.id));
    expect(await pool.getUserEMode(user1.address)).to.be.eq(CATEGORIES.STABLECOINS.id);
  });

  it('User 0 tries to borrow (non-category asset) EURS (revert expected)', async () => {
    const {
      pool,
      eurs,
      users: [user0],
    } = testEnv;

    await expect(
      pool
        .connect(user0.signer)
        .borrow(
          eurs.address,
          await convertToCurrencyDecimals(eurs.address, '5'),
          RateMode.Stable,
          0,
          user0.address
        )
    ).to.be.revertedWith(INCONSISTENT_EMODE_CATEGORY);
  });

  it('User 0 sends RSTokens to user 3', async () => {
    const {
      pool,
      rusd,
      RSRUSD,
      users: [user0, , , user3],
    } = testEnv;

    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.ETHEREUM.id);
    expect(await pool.getUserEMode(user3.address)).to.be.eq(0);

    const transferAmount = await convertToCurrencyDecimals(rusd.address, '10');

    const balanceBeforeUser0 = await RSRUSD.balanceOf(user0.address);
    const balanceBeforeUser3 = await RSRUSD.balanceOf(user3.address);

    expect(await RSRUSD.connect(user0.signer).transfer(user3.address, transferAmount));

    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.ETHEREUM.id);
    expect(await pool.getUserEMode(user3.address)).to.be.eq(0);

    expect(await RSRUSD.balanceOf(user0.address)).to.be.eq(balanceBeforeUser0.sub(transferAmount));
    expect(await RSRUSD.balanceOf(user3.address)).to.be.eq(balanceBeforeUser3.add(transferAmount));
  });

  it('User 0 sends RSTokens to user 3', async () => {
    const {
      pool,
      rusd,
      RSRUSD,
      users: [user0, , , user3],
    } = testEnv;

    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.ETHEREUM.id);
    expect(await pool.getUserEMode(user3.address)).to.be.eq(0);

    const balanceBeforeUser0 = await RSRUSD.balanceOf(user0.address);
    const balanceBeforeUser3 = await RSRUSD.balanceOf(user3.address);

    const transferAmount = await convertToCurrencyDecimals(rusd.address, '10');
    expect(await RSRUSD.connect(user0.signer).transfer(user3.address, transferAmount));

    expect(await pool.getUserEMode(user0.address)).to.be.eq(CATEGORIES.ETHEREUM.id);
    expect(await pool.getUserEMode(user3.address)).to.be.eq(0);

    expect(await RSRUSD.balanceOf(user0.address)).to.be.eq(balanceBeforeUser0.sub(transferAmount));
    expect(await RSRUSD.balanceOf(user3.address)).to.be.eq(balanceBeforeUser3.add(transferAmount));
  });

  it('Credit delegation from EMode user, delegatee borrows non EMode asset (revert expected)', async () => {
    const snap = await evmSnapshot();
    const {
      pool,
      helpersContract,
      rusd,
      weth,
      eurs,
      users: [, , , user3, user4, user5],
    } = testEnv;
    const { id } = CATEGORIES.STABLECOINS;

    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(id);
    expect(await helpersContract.getReserveEModeCategory(eurs.address)).to.be.eq(id);
    expect(await helpersContract.getReserveEModeCategory(weth.address)).to.not.be.eq(id);

    const wethData = await pool.getReserveData(weth.address);
    const variableDebtWETH = VariableDebtToken__factory.connect(
      wethData.variableDebtTokenAddress,
      user4.signer
    );

    expect(await weth.connect(user3.signer)['mint(uint256)'](parseUnits('100', 18)));
    expect(await weth.connect(user3.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(
      await pool.connect(user3.signer).supply(weth.address, parseUnits('100', 18), user3.address, 0)
    );

    expect(await rusd.connect(user4.signer)['mint(uint256)'](parseUnits('100', 18)));
    expect(await rusd.connect(user4.signer).approve(pool.address, MAX_UINT_AMOUNT));

    // Alice deposit 100 rusd
    expect(
      await pool.connect(user4.signer).supply(rusd.address, parseUnits('100', 18), user4.address, 0)
    );

    // Alice set eMode to stablecoins
    expect(await pool.connect(user4.signer).setUserEMode(CATEGORIES.STABLECOINS.id));
    expect(await pool.getUserEMode(user4.address)).to.be.eq(CATEGORIES.STABLECOINS.id);

    // Alice delegates 1 weth with variable rate to Bob.
    expect(
      await variableDebtWETH
        .connect(user4.signer)
        .approveDelegation(user5.address, parseUnits('1', 18))
    );

    const bobWethBalanceBefore = await weth.balanceOf(user5.address);

    // Bob borrows 0.01 weth on behalf of Alice (should revert)
    await expect(
      pool.connect(user5.signer).borrow(weth.address, parseUnits('0.01', 18), 2, 0, user4.address)
    ).to.be.revertedWith(INCONSISTENT_EMODE_CATEGORY);

    expect(await weth.balanceOf(user5.address)).to.be.eq(
      bobWethBalanceBefore,
      'Bob forced Alice to borrow WETH while in stablecoin emode'
    );
    await evmRevert(snap);
  });

  it('Credit delegation to EMode user, user tries do abuse EMode to liquidate delegator (revert expected)', async () => {
    const {
      pool,
      helpersContract,
      rusd,
      eurs,
      users: [, , , user3, user4, user5],
    } = testEnv;
    const { id } = CATEGORIES.STABLECOINS;

    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(id);
    expect(await helpersContract.getReserveEModeCategory(eurs.address)).to.be.eq(id);

    const eursData = await pool.getReserveData(eurs.address);
    const variableDebtEURS = VariableDebtToken__factory.connect(
      eursData.variableDebtTokenAddress,
      user4.signer
    );

    expect(await eurs.connect(user3.signer)['mint(uint256)'](parseUnits('100', 6)));
    expect(await eurs.connect(user3.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(
      await pool.connect(user3.signer).supply(eurs.address, parseUnits('100', 6), user3.address, 0)
    );

    expect(await rusd.connect(user4.signer)['mint(uint256)'](parseUnits('100', 18)));
    expect(await rusd.connect(user4.signer).approve(pool.address, MAX_UINT_AMOUNT));

    // Alice deposit 100 rusd
    expect(
      await pool.connect(user4.signer).supply(rusd.address, parseUnits('100', 18), user4.address, 0)
    );

    // Alice delegates 100 eurs with variable rate to Bob.
    expect(
      await variableDebtEURS
        .connect(user4.signer)
        .approveDelegation(user5.address, parseUnits('100', 6))
    );

    // Bob set eMode to stablecoins
    expect(await pool.connect(user5.signer).setUserEMode(CATEGORIES.STABLECOINS.id));
    expect(await pool.getUserEMode(user5.address)).to.be.eq(CATEGORIES.STABLECOINS.id);

    // Bob borrows 90 eurs on behalf of Alice
    await expect(
      pool.connect(user5.signer).borrow(eurs.address, parseUnits('90', 6), 2, 0, user4.address)
    ).to.be.revertedWith(COLLATERAL_CANNOT_COVER_NEW_BORROW);

    // Alice is still in a position where she CANNOT be liquidated
    const user4Data = await pool.getUserAccountData(user4.address);
    expect(user4Data.healthFactor).to.be.gt(parseEther('1'));
  });

  it('Admin sets LTV of stablecoins eMode category to zero (revert expected)', async () => {
    const {
      configurator,
      pool,
      users: [, user1],
    } = testEnv;

    const { id } = CATEGORIES.STABLECOINS;

    const eModeData = await pool.getEModeCategoryData(id);
    const newLtv = BigNumber.from(0);

    await expect(
      configurator.setEModeCategory(
        id,
        newLtv,
        eModeData.liquidationThreshold,
        eModeData.liquidationBonus,
        eModeData.priceSource,
        eModeData.label
      )
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Admin sets Liquidation Threshold of stablecoins eMode category to zero (revert expected)', async () => {
    const { configurator, pool } = testEnv;

    const { id } = CATEGORIES.STABLECOINS;

    const eModeData = await pool.getEModeCategoryData(id);
    const newLiquidationThreshold = BigNumber.from(0);

    await expect(
      configurator.setEModeCategory(
        id,
        eModeData.ltv,
        newLiquidationThreshold,
        eModeData.liquidationBonus,
        eModeData.priceSource,
        eModeData.label
      )
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Admin lowers LTV of stablecoins eMode category below an asset within the eModes individual LTV (revert expected)', async () => {
    const { configurator, pool, rusd, eurs, helpersContract } = testEnv;

    const { id } = CATEGORIES.STABLECOINS;

    const eModeData = await pool.getEModeCategoryData(id);

    // find the min LTV of assets in eMode and submit a new LTV lower
    const rusdLtv = (await helpersContract.getReserveConfigurationData(rusd.address)).ltv;
    const eursLtv = (await helpersContract.getReserveConfigurationData(eurs.address)).ltv;
    const maxExistingLtv = rusdLtv.sub(eursLtv).gte(0) ? rusdLtv : eursLtv;
    const newLtv = maxExistingLtv.sub(1);

    await expect(
      configurator.setEModeCategory(
        id,
        newLtv,
        eModeData.liquidationThreshold,
        eModeData.liquidationBonus,
        eModeData.priceSource,
        eModeData.label
      )
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Admin lowers LTV of stablecoins eMode category, decreasing user borrowing power', async () => {
    const {
      configurator,
      pool,
      users: [, user1],
    } = testEnv;

    const { id } = CATEGORIES.STABLECOINS;

    const userDataBefore = await pool.getUserAccountData(user1.address);

    const eModeData = await pool.getEModeCategoryData(id);
    const newLtv = BigNumber.from('9500');

    expect(
      await configurator.setEModeCategory(
        id,
        newLtv,
        eModeData.liquidationThreshold,
        eModeData.liquidationBonus,
        eModeData.priceSource,
        eModeData.label
      )
    );

    const userDataAfter = await pool.getUserAccountData(user1.address);

    expect(userDataAfter.availableBorrowsBase).to.be.lt(userDataBefore.availableBorrowsBase);
  });

  it('User 1 withdraws 0.7 WETH and borrows 100 EURS', async () => {
    const {
      pool,
      weth,
      eurs,
      users: [, user1],
    } = testEnv;

    expect(
      await pool
        .connect(user1.signer)
        .withdraw(weth.address, await convertToCurrencyDecimals(weth.address, '0.7'), user1.address)
    );

    expect(
      await pool
        .connect(user1.signer)
        .borrow(
          eurs.address,
          await convertToCurrencyDecimals(eurs.address, '100'),
          RateMode.Variable,
          0,
          user1.address
        )
    );
  });

  it('Admin lowers LT of stablecoins eMode category below an asset within the eModes individual LT (revert expected)', async () => {
    const { configurator, pool } = testEnv;

    const { id } = CATEGORIES.STABLECOINS;

    const eModeData = await pool.getEModeCategoryData(id);

    const newLtv = BigNumber.from(8300);
    const newLt = BigNumber.from(8500);

    await expect(
      configurator.setEModeCategory(
        id,
        newLtv,
        newLt,
        eModeData.liquidationBonus,
        eModeData.priceSource,
        eModeData.label
      )
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Admin lowers LT of stablecoins eMode category, decreasing user health factor', async () => {
    const {
      configurator,
      pool,
      users: [, user1],
    } = testEnv;

    const { id } = CATEGORIES.STABLECOINS;

    const userDataBefore = await pool.getUserAccountData(user1.address);

    const eModeData = await pool.getEModeCategoryData(id);
    const newLt = eModeData.ltv;

    expect(
      await configurator.setEModeCategory(
        id,
        eModeData.ltv,
        newLt,
        eModeData.liquidationBonus,
        eModeData.priceSource,
        eModeData.label
      )
    );

    const userDataAfter = await pool.getUserAccountData(user1.address);
    expect(userDataAfter.healthFactor).to.be.lt(userDataBefore.healthFactor);
  });

  it('Admin adds a category for stablecoins with RUSD (own price feed)', async () => {
    const { configurator, pool, poolAdmin, rusd, eurs } = testEnv;
    const { ltv, lt, lb, label } = CATEGORIES.STABLECOINS;

    const id = 3;
    const categoryOracle = eurs.address;

    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(id, ltv, lt, lb, categoryOracle, label)
    )
      .to.emit(configurator, 'EModeCategoryAdded')
      .withArgs(id, ltv, lt, lb, categoryOracle, label);

    const categoryData = await pool.getEModeCategoryData(id);
    expect(categoryData.ltv).to.be.equal(ltv, 'invalid eMode category ltv');
    expect(categoryData.liquidationThreshold).to.be.equal(
      lt,
      'invalid eMode category liq threshold'
    );
    expect(categoryData.liquidationBonus).to.be.equal(lb, 'invalid eMode category liq bonus');
    expect(categoryData.priceSource).to.be.equal(
      categoryOracle,
      'invalid eMode category price source'
    );
    expect(await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, id));
  });

  it('User 2 supplies RUSD and activates eMode for stablecoins (own price feed)', async () => {
    const {
      pool,
      rusd,
      eurs,
      oracle,
      users: [, , user2],
    } = testEnv;

    const id = 3;
    const rusdAmount = utils.parseUnits('1000', 18);

    expect(await pool.connect(user2.signer).supply(rusd.address, rusdAmount, user2.address, 0));

    const rusdPrice = await oracle.getAssetPrice(rusd.address);
    const eursPrice = await oracle.getAssetPrice(eurs.address);

    const dataBefore = await pool.getUserAccountData(user2.address);
    const expectedCollateralRUSDPrice = rusdAmount.wadMul(rusdPrice);
    expect(dataBefore.totalCollateralBase).to.be.eq(expectedCollateralRUSDPrice);

    expect(await pool.connect(user2.signer).setUserEMode(id));
    expect(await pool.getUserEMode(user2.address)).to.be.eq(id);

    const dataAfter = await pool.getUserAccountData(user2.address);
    const expectedCollateralEursPrice = rusdAmount.wadMul(eursPrice);
    expect(dataAfter.totalCollateralBase).to.be.eq(expectedCollateralEursPrice);
  });

  it('User 0 deactivate eMode', async () => {
    const {
      pool,
      users: [user0],
    } = testEnv;

    const userDataBefore = await pool.getUserAccountData(user0.address);

    expect(await pool.connect(user0.signer).setUserEMode(0));
    expect(await pool.getUserEMode(user0.address)).to.be.eq(0);

    const userDataAfter = await pool.getUserAccountData(user0.address);
    expect(userDataAfter.totalCollateralBase).to.be.eq(userDataBefore.totalCollateralBase);
    expect(userDataAfter.availableBorrowsBase).to.be.lt(userDataBefore.availableBorrowsBase);
    expect(userDataAfter.healthFactor).to.be.eq(userDataBefore.healthFactor);
  });

  it('Remove RUSD from stablecoin eMode category', async () => {
    const { configurator, poolAdmin, rusd, helpersContract } = testEnv;
    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.not.be.eq(0);
    expect(await configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, 0));
    expect(await helpersContract.getReserveEModeCategory(rusd.address)).to.be.eq(0);
  });

  it('User supplies EURS, activates eMode for ethereum category and borrowing power keeps the same', async () => {
    await evmRevert(snapSetup);

    const {
      configurator,
      helpersContract,
      weth,
      eurs,
      poolAdmin,
      pool,
      users: [user],
    } = testEnv;

    // Setup eMode category for eth, use weth oracle as price source.
    const { id, ltv, lt, lb, label } = CATEGORIES.ETHEREUM;
    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(id, ltv, lt, lb, weth.address, label)
    );
    expect(await configurator.connect(poolAdmin.signer).setAssetEModeCategory(weth.address, id));
    expect(await helpersContract.getReserveEModeCategory(weth.address)).to.be.eq(id);
    const data = await pool.getEModeCategoryData(id);
    expect(data.priceSource).to.be.eq(weth.address);

    // Deposit EURS
    expect(
      await pool
        .connect(user.signer)
        .supply(eurs.address, utils.parseUnits('100', 2), user.address, 0)
    );

    // Look at power
    const baseUnit = utils.parseUnits('1', 18);
    const userDataBefore = await pool.getUserAccountData(user.address);
    expect(userDataBefore.totalCollateralBase).to.be.eq(baseUnit.mul(100));

    // Activate eMode for ETH
    expect(await pool.connect(user.signer).setUserEMode(id));

    // Look at power
    const userDataAfter = await pool.getUserAccountData(user.address);

    // Expect collateral to have equal value
    expect(userDataAfter.totalCollateralBase).to.be.eq(userDataBefore.totalCollateralBase);
    expect(userDataAfter.availableBorrowsBase).to.be.eq(userDataBefore.availableBorrowsBase);
    expect(userDataAfter.currentLiquidationThreshold).to.be.eq(
      userDataBefore.currentLiquidationThreshold
    );
    expect(userDataAfter.ltv).to.be.eq(userDataBefore.ltv);
    expect(userDataAfter.healthFactor).to.be.eq(userDataBefore.healthFactor);
  });
});
