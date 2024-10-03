const { expect } = require('chai');
import { utils, BigNumber } from 'ethers';
import { ReserveData, UserReserveData } from './helpers/utils/interfaces';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { MAX_UINT_AMOUNT, MAX_UNBACKED_MINT_CAP } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { TestEnv, makeSuite } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import {
  increaseTime,
  waitForTx,
  evmSnapshot,
  evmRevert,
  advanceTimeAndBlock,
} from '../helpers/utilities/tx';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import { getTxCostAndTimestamp } from './helpers/actions';
import RASAConfig from '../markets/test';
import { getACLManager } from '../helpers/contract-getters';
import {
  calcExpectedReserveDataAfterMintUnbacked,
  configuration as calculationsConfiguration,
} from './helpers/utils/calculations';

const expectEqual = (
  actual: UserReserveData | ReserveData,
  expected: UserReserveData | ReserveData
) => {
  expect(actual).to.be.almostEqualOrEqual(expected);
};

makeSuite('Isolation mode', (testEnv: TestEnv) => {
  const ISOLATED_COLLATERAL_SUPPLIER_ROLE = utils.keccak256(
    utils.toUtf8Bytes('ISOLATED_COLLATERAL_SUPPLIER')
  );

  const depositAmount = utils.parseEther('1000');
  const borrowAmount = utils.parseEther('200');
  const ceilingAmount = '10000';

  const withdrawAmount = utils.parseEther('100');
  const feeBps = BigNumber.from(30);
  const denominatorBP = BigNumber.from(10000);
  const mintAmount = withdrawAmount.mul(denominatorBP.sub(feeBps)).div(denominatorBP);
  const bridgeProtocolFeeBps = BigNumber.from(2000);

  const {
    ASSET_NOT_BORROWABLE_IN_ISOLATION,
    DEBT_CEILING_EXCEEDED,
    USER_IN_ISOLATION_MODE_OR_LTV_ZERO,
  } = ProtocolErrors;

  let aclManager;
  let oracleBaseDecimals;
  let snapshot;

  before(async () => {
    const { configurator, rusd, eurs, cgo, users, poolAdmin } = testEnv;
    calculationsConfiguration.reservesParams = RASAConfig.ReservesConfig;

    //set debt ceiling for cgo
    await configurator.setDebtCeiling(cgo.address, ceilingAmount);

    //set category 1 for RUSD and EURS
    await configurator.setBorrowableInIsolation(rusd.address, true);
    await configurator.setBorrowableInIsolation(eurs.address, true);

    // configure bridge
    aclManager = await getACLManager();
    await waitForTx(await aclManager.addBridge(users[2].address));

    await waitForTx(
      await configurator.connect(poolAdmin.signer).updateBridgeProtocolFee(bridgeProtocolFeeBps)
    );

    // configure oracle
    const { rasaOracle, addressesProvider, oracle } = testEnv;
    oracleBaseDecimals = (await rasaOracle.BASE_CURRENCY_UNIT()).toString().length - 1;
    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));

    await oracle.setAssetPrice(rusd.address, utils.parseUnits('1', 18));
    await oracle.setAssetPrice(cgo.address, utils.parseUnits('500', 18));

    snapshot = await evmSnapshot();
  });

  it('User 0 supply 1000 rusd.', async () => {
    const { users, pool, rusd } = testEnv;
    await rusd.connect(users[0].signer)['mint(uint256)'](depositAmount);
    await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[0].signer).supply(rusd.address, depositAmount, users[0].address, 0);
  });

  it('User 1 supply 2 cgo. Checks that cgo is not activated as collateral.', async () => {
    const snap = await evmSnapshot();
    const { users, pool, cgo, helpersContract } = testEnv;
    await cgo.connect(users[1].signer)['mint(uint256)'](utils.parseEther('2'));
    await cgo.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .supply(cgo.address, utils.parseEther('2'), users[1].address, 0);
    const userData = await helpersContract.getUserReserveData(cgo.address, users[1].address);

    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
    await evmRevert(snap);
  });

  it('User 1 as ISOLATED_COLLATERAL_SUPPLIER_ROLE supply 2 cgo to user 2. Checks that cgo is activated as isolated collateral.', async () => {
    const snap = await evmSnapshot();
    const { users, pool, cgo, helpersContract, deployer } = testEnv;

    await cgo.connect(users[1].signer)['mint(uint256)'](utils.parseEther('2'));
    await cgo.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await aclManager
      .connect(deployer.signer)
      .grantRole(ISOLATED_COLLATERAL_SUPPLIER_ROLE, users[1].address);
    const hasRole = await aclManager
      .connect(users[1].address)
      .hasRole(ISOLATED_COLLATERAL_SUPPLIER_ROLE, users[1].address);
    expect(hasRole).to.be.eq(true);

    await pool
      .connect(users[1].signer)
      .supply(cgo.address, utils.parseEther('2'), users[2].address, 0);
    const userData = await helpersContract.getUserReserveData(cgo.address, users[2].address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(true);
    await evmRevert(snap);
  });

  it('User 1 supply 2 cgo. Enables collateral. Checks that cgo is activated as isolated collateral.', async () => {
    const { users, pool, cgo, helpersContract } = testEnv;

    await cgo.connect(users[1].signer)['mint(uint256)'](utils.parseEther('2'));
    await cgo.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .supply(cgo.address, utils.parseEther('2'), users[1].address, 0);
    await pool.connect(users[1].signer).setUserUseReserveAsCollateral(cgo.address, true);
    const userData = await helpersContract.getUserReserveData(cgo.address, users[1].address);

    expect(userData.usageAsCollateralEnabled).to.be.eq(true);
  });

  it('User 1 supply 1 eth. Checks that eth is NOT activated as collateral ', async () => {
    const { users, pool, weth, helpersContract } = testEnv;
    await weth.connect(users[1].signer)['mint(uint256)'](utils.parseEther('1'));
    await weth.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .supply(weth.address, utils.parseEther('1'), users[1].address, 0);

    const userData = await helpersContract.getUserReserveData(weth.address, users[1].address);

    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 1 tries to use eth as collateral (revert expected)', async () => {
    const { users, pool, weth, helpersContract } = testEnv;

    const userDataBefore = await helpersContract.getUserReserveData(weth.address, users[1].address);
    expect(userDataBefore.usageAsCollateralEnabled).to.be.eq(false);

    await expect(
      pool.connect(users[1].signer).setUserUseReserveAsCollateral(weth.address, true)
    ).to.be.revertedWith(USER_IN_ISOLATION_MODE_OR_LTV_ZERO);

    const userDataAfter = await helpersContract.getUserReserveData(weth.address, users[1].address);
    expect(userDataAfter.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 2 deposit rusd and cgo, then tries to use cgo as collateral (revert expected)', async () => {
    const snap = await evmSnapshot();
    const {
      users: [, , user2],
      pool,
      rusd,
      cgo,
      helpersContract,
    } = testEnv;

    await rusd.connect(user2.signer)['mint(uint256)'](utils.parseEther('1'));
    await rusd.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user2.signer).supply(rusd.address, utils.parseEther('1'), user2.address, 0);

    await cgo.connect(user2.signer)['mint(uint256)'](utils.parseEther('1'));
    await cgo.connect(user2.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user2.signer).supply(cgo.address, utils.parseEther('1'), user2.address, 0);

    const userRUSDDataBefore = await helpersContract.getUserReserveData(rusd.address, user2.address);
    expect(userRUSDDataBefore.usageAsCollateralEnabled).to.be.eq(true);

    const userRASADataBefore = await helpersContract.getUserReserveData(
      cgo.address,
      user2.address
    );
    expect(userRASADataBefore.usageAsCollateralEnabled).to.be.eq(false);

    await expect(
      pool.connect(user2.signer).setUserUseReserveAsCollateral(cgo.address, true)
    ).to.be.revertedWith(USER_IN_ISOLATION_MODE_OR_LTV_ZERO);

    const userDataAfter = await helpersContract.getUserReserveData(cgo.address, user2.address);
    expect(userDataAfter.usageAsCollateralEnabled).to.be.eq(false);

    await evmRevert(snap);
  });

  it('User 2 (as bridge) mint 100 unbacked rusd to user 1. Checks that rusd is NOT activated as collateral', async () => {
    const { users, riskAdmin, pool, configurator, rusd, helpersContract } = testEnv;

    // configure unbacked cap for rusd
    expect(await configurator.connect(riskAdmin.signer).setUnbackedMintCap(rusd.address, '10'));
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setUnbackedMintCap(rusd.address, MAX_UNBACKED_MINT_CAP)
    );

    const reserveDataBefore = await getReserveData(helpersContract, rusd.address);
    const tx = await waitForTx(
      await pool.connect(users[2].signer).mintUnbacked(rusd.address, mintAmount, users[1].address, 0)
    );
    const { txTimestamp } = await getTxCostAndTimestamp(tx);
    const expectedDataAfter = calcExpectedReserveDataAfterMintUnbacked(
      mintAmount.toString(),
      reserveDataBefore,
      txTimestamp
    );
    const reserveDataAfter = await getReserveData(helpersContract, rusd.address);
    expectEqual(reserveDataAfter, expectedDataAfter);

    const userData = await helpersContract.getUserReserveData(rusd.address, users[1].address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 2 (as bridge) mint 100 unbacked cgo (isolated) to user 3. Checks that cgo is NOT activated as collateral', async () => {
    const { users, riskAdmin, pool, configurator, cgo, helpersContract } = testEnv;

    // configure unbacked cap for rusd
    expect(await configurator.connect(riskAdmin.signer).setUnbackedMintCap(cgo.address, '10'));
    expect(
      await configurator
        .connect(riskAdmin.signer)
        .setUnbackedMintCap(cgo.address, MAX_UNBACKED_MINT_CAP)
    );

    const reserveDataBefore = await getReserveData(helpersContract, cgo.address);
    const tx = await waitForTx(
      await pool
        .connect(users[2].signer)
        .mintUnbacked(cgo.address, mintAmount, users[3].address, 0)
    );
    const { txTimestamp } = await getTxCostAndTimestamp(tx);
    const expectedDataAfter = calcExpectedReserveDataAfterMintUnbacked(
      mintAmount.toString(),
      reserveDataBefore,
      txTimestamp
    );
    const reserveDataAfter = await getReserveData(helpersContract, cgo.address);
    expectEqual(reserveDataAfter, expectedDataAfter);

    const userData = await helpersContract.getUserReserveData(cgo.address, users[3].address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 2 supply 100 RUSD, transfers to user 1. Checks that RUSD is NOT activated as collateral for user 1', async () => {
    const { rusd, RSRUSD, users, pool, helpersContract } = testEnv;

    const amount = utils.parseEther('100');
    await rusd.connect(users[2].signer)['mint(uint256)'](amount);
    await rusd.connect(users[2].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[2].signer).supply(rusd.address, amount, users[2].address, 0);

    await RSRUSD.connect(users[2].signer).transfer(users[1].address, amount);

    const userData = await helpersContract.getUserReserveData(rusd.address, users[1].address);

    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 1 withdraws everything. User supplies WETH then CGO. Checks CGO is not enabled as collateral', async () => {
    const { rusd, cgo, weth, users, pool, helpersContract } = testEnv;

    await pool
      .connect(users[1].signer)
      .withdraw(weth.address, utils.parseEther('1'), users[1].address);

    await pool
      .connect(users[1].signer)
      .withdraw(cgo.address, utils.parseEther('2'), users[1].address);

    await pool.connect(users[1].signer).withdraw(rusd.address, MAX_UINT_AMOUNT, users[1].address);

    const amount = utils.parseEther('1');

    await pool.connect(users[1].signer).supply(weth.address, amount, users[1].address, 0);

    await pool.connect(users[1].signer).supply(cgo.address, amount, users[1].address, 0);

    const userData = await helpersContract.getUserReserveData(cgo.address, users[1].address);

    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 2 supplies RUSD, transfers to user 1. Checks RUSD is enabled as collateral', async () => {
    const { rusd, RSRUSD, users, pool, helpersContract } = testEnv;

    const amount = utils.parseEther('100');
    await rusd.connect(users[2].signer)['mint(uint256)'](amount);
    await pool.connect(users[2].signer).supply(rusd.address, amount, users[2].address, 0);

    await RSRUSD.connect(users[2].signer).transfer(users[1].address, amount);

    const userData = await helpersContract.getUserReserveData(rusd.address, users[1].address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(true);
  });

  it('User 1 withdraws everything. User 2 supplies ETH, User 1 supplies CGO, tries to borrow ETH (revert expected)', async () => {
    const { rusd, cgo, weth, users, pool } = testEnv;

    await pool
      .connect(users[1].signer)
      .withdraw(weth.address, utils.parseEther('1'), users[1].address);

    await pool
      .connect(users[1].signer)
      .withdraw(cgo.address, utils.parseEther('1'), users[1].address);

    await pool
      .connect(users[1].signer)
      .withdraw(rusd.address, utils.parseEther('100'), users[1].address);

    const wethAmount = utils.parseEther('1');
    await weth.connect(users[2].signer)['mint(uint256)'](wethAmount);
    await weth.connect(users[2].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[2].signer).supply(weth.address, wethAmount, users[2].address, 0);

    const cgoAmount = utils.parseEther('100');
    await cgo.connect(users[1].signer)['mint(uint256)'](cgoAmount);
    await cgo.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[1].signer).supply(cgo.address, cgoAmount, users[1].address, 0);
    await pool.connect(users[1].signer).setUserUseReserveAsCollateral(cgo.address, true);

    await expect(
      pool
        .connect(users[1].signer)
        .borrow(weth.address, utils.parseEther('0.01'), '2', 0, users[1].address)
    ).to.be.revertedWith(ASSET_NOT_BORROWABLE_IN_ISOLATION);
  });

  it('User 2 tries to borrow some ETH on behalf of User 1 (revert expected)', async () => {
    const { users, pool, weth } = testEnv;

    await expect(
      pool
        .connect(users[2].signer)
        .borrow(
          weth.address,
          utils.parseEther('0.0000001'),
          RateMode.Variable,
          '0',
          users[1].address
        )
    ).to.be.revertedWith(ASSET_NOT_BORROWABLE_IN_ISOLATION);
  });

  it('User 1 borrows 10 RUSD. Check debt ceiling', async () => {
    const { rusd, cgo, users, pool } = testEnv;

    const borrowAmount = utils.parseEther('10');
    await expect(
      pool.connect(users[1].signer).borrow(rusd.address, borrowAmount, '2', 0, users[1].address)
    )
      .to.emit(pool, 'IsolationModeTotalDebtUpdated')
      .withArgs(cgo.address, 1000);

    const reserveData = await pool.getReserveData(cgo.address);

    expect(reserveData.isolationModeTotalDebt).to.be.eq('1000');
  });

  it('User 3 deposits 100 CGO, borrows 10 RUSD. Check debt ceiling', async () => {
    const { rusd, cgo, users, pool } = testEnv;

    const cgoAmount = utils.parseEther('100');
    await cgo.connect(users[3].signer)['mint(uint256)'](cgoAmount);
    await cgo.connect(users[3].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[3].signer).supply(cgo.address, cgoAmount, users[3].address, 0);
    await pool.connect(users[3].signer).setUserUseReserveAsCollateral(cgo.address, true);

    const borrowAmount = utils.parseEther('10');
    await expect(
      pool.connect(users[3].signer).borrow(rusd.address, borrowAmount, '2', 0, users[3].address)
    )
      .to.emit(pool, 'IsolationModeTotalDebtUpdated')
      .withArgs(cgo.address, 2000);
    const reserveData = await pool.getReserveData(cgo.address);

    expect(reserveData.isolationModeTotalDebt).to.be.eq('2000');
  });

  it('User 4 deposits 500 CGO, tries to borrow past the debt ceiling (revert expected)', async () => {
    const { rusd, cgo, users, pool } = testEnv;

    const cgoAmount = utils.parseEther('500');
    await cgo.connect(users[3].signer)['mint(uint256)'](cgoAmount);
    await cgo.connect(users[3].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[3].signer).supply(cgo.address, cgoAmount, users[3].address, 0);
    await pool.connect(users[3].signer).setUserUseReserveAsCollateral(cgo.address, true);

    const borrowAmount = utils.parseEther('100');
    await expect(
      pool.connect(users[3].signer).borrow(rusd.address, borrowAmount, '2', 0, users[3].address)
    ).to.be.revertedWith(DEBT_CEILING_EXCEEDED);
  });

  it('Push time forward one year. User 1, User 3 repay debt. Ensure debt ceiling is 0', async () => {
    const { rusd, cgo, users, pool } = testEnv;

    await increaseTime(60 * 60 * 24 * 365);

    const mintAmount = utils.parseEther('100');
    await rusd.connect(users[3].signer)['mint(uint256)'](mintAmount);
    await rusd.connect(users[3].signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool.connect(users[3].signer).repay(rusd.address, MAX_UINT_AMOUNT, '2', users[3].address);

    await rusd.connect(users[1].signer)['mint(uint256)'](mintAmount);
    await rusd.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);

    await expect(
      pool.connect(users[1].signer).repay(rusd.address, MAX_UINT_AMOUNT, '2', users[1].address)
    )
      .to.emit(pool, 'IsolationModeTotalDebtUpdated')
      .withArgs(cgo.address, 0);
    const reserveData = await pool.getReserveData(cgo.address);

    expect(reserveData.isolationModeTotalDebt).to.be.eq('0');
  });

  it('Perform liquidation of isolation mode asset', async () => {
    // We need to look at how the user getting liquidated was positioned. If the asset is isolation mode, then it needs to impact that as well
    const {
      rusd,
      cgo,
      oracle,
      addressesProvider,
      helpersContract,
      users: [, , , , borrower, liquidator],
      pool,
    } = testEnv;

    // Fund depositor and liquidator
    const liquidatorAmount = utils.parseUnits('1000', 18);
    await rusd.connect(liquidator.signer)['mint(uint256)'](liquidatorAmount.mul(2));
    await rusd.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(liquidator.signer)
      .supply(rusd.address, liquidatorAmount, liquidator.address, 0);

    const userGlobalDataBefore = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataBefore.totalCollateralBase).to.be.eq(0);

    const depositAmount = utils.parseUnits('1', 18);
    await cgo.connect(borrower.signer)['mint(uint256)'](depositAmount);
    await cgo.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(borrower.signer).supply(cgo.address, depositAmount, borrower.address, 0);
    await pool.connect(borrower.signer).setUserUseReserveAsCollateral(cgo.address, true);

    const userData = await helpersContract.getUserReserveData(cgo.address, borrower.address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(true);

    const borrowAmount = utils.parseUnits('50', 18);
    await pool
      .connect(borrower.signer)
      .borrow(rusd.address, borrowAmount, RateMode.Variable, '0', borrower.address);

    const rusdPrice = await oracle.getAssetPrice(rusd.address);
    await oracle.setAssetPrice(rusd.address, rusdPrice.mul(10));

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor).to.be.lt(utils.parseEther('1'));

    const isolationModeTotalDebtBefore = (await pool.getReserveData(cgo.address))
      .isolationModeTotalDebt;
    const expectedAmountAfter = isolationModeTotalDebtBefore.sub(
      borrowAmount.div(2).div(BigNumber.from(10).pow(16))
    );

    // await expect(
       await pool
        .connect(liquidator.signer)
        .liquidationCall(cgo.address, rusd.address, borrower.address, borrowAmount.div(2), false)
    // )
    //   .to.emit(pool, 'IsolationModeTotalDebtUpdated')
    //   .withArgs(cgo.address, expectedAmountAfter);

    const isolationModeTotalDebtAfter = (await pool.getReserveData(cgo.address))
      .isolationModeTotalDebt;

    expect(isolationModeTotalDebtAfter).to.be.eq(expectedAmountAfter);
  });

  it('User 5 supplies weth and rusd. User 6 supplies CGO and transfers to User 5', async () => {
    const { weth, rusd, cgo, RSCgo, users, pool, helpersContract } = testEnv;

    const wethAmount = utils.parseEther('1');
    await weth.connect(users[5].signer)['mint(uint256)'](wethAmount);
    await weth.connect(users[5].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[5].signer).supply(weth.address, wethAmount, users[5].address, 0);

    const rusdAmount = utils.parseEther('100');
    await rusd.connect(users[5].signer)['mint(uint256)'](rusdAmount);
    await rusd.connect(users[5].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[5].signer).supply(rusd.address, rusdAmount, users[5].address, 0);

    const cgoAmount = utils.parseEther('100');
    await cgo.connect(users[6].signer)['mint(uint256)'](cgoAmount);
    await cgo.connect(users[6].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[6].signer).supply(cgo.address, cgoAmount, users[6].address, 0);
    await RSCgo.connect(users[6].signer).transfer(users[5].address, cgoAmount);

    const wethUserData = await helpersContract.getUserReserveData(weth.address, users[5].address);
    const rusdUserData = await helpersContract.getUserReserveData(rusd.address, users[5].address);
    const cgoUserData = await helpersContract.getUserReserveData(cgo.address, users[5].address);
    expect(rusdUserData.usageAsCollateralEnabled).to.be.eq(true);
    expect(wethUserData.usageAsCollateralEnabled).to.be.eq(true);
    expect(cgoUserData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 5 supplies isolation mode asset is liquidated by User 6', async () => {
    const { rusd, cgo, users, pool, helpersContract, oracle } = testEnv;

    await evmRevert(snapshot);
    snapshot = await evmSnapshot();
    // supply rusd as user 6, so user 5 can borrow
    const rusdAmount = utils.parseEther('700');
    await rusd.connect(users[6].signer)['mint(uint256)'](rusdAmount);
    await rusd.connect(users[6].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[6].signer).supply(rusd.address, rusdAmount, users[6].address, 0);

    const cgoAmount = utils.parseEther('.3');
    await cgo.connect(users[5].signer)['mint(uint256)'](cgoAmount);
    await cgo.connect(users[5].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[5].signer).supply(cgo.address, cgoAmount, users[5].address, 0);
    await pool.connect(users[5].signer).setUserUseReserveAsCollateral(cgo.address, true);

    // borrow with health factor just above 1
    const userGlobalData = await pool.getUserAccountData(users[5].address);
    const rusdPrice = await oracle.getAssetPrice(rusd.address);
    let amountRUSDToBorrow = await convertToCurrencyDecimals(
      rusd.address,
      userGlobalData.availableBorrowsBase.div(rusdPrice.toString()).percentMul(9999).toString()
    )

    await pool
      .connect(users[5].signer)
      .borrow(rusd.address, amountRUSDToBorrow, RateMode.Variable, 0, users[5].address);

    // advance time so health factor is less than one and liquidate
    await advanceTimeAndBlock(86400 * 365 * 100);
    const userRUSDReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      users[5].address
    );
    const amountToLiquidate = userRUSDReserveDataBefore.currentVariableDebt.div(2);
    await rusd.connect(users[6].signer)['mint(uint256)'](rusdAmount);
    await rusd.connect(users[6].signer).approve(pool.address, MAX_UINT_AMOUNT);
    const tx = await pool
      .connect(users[6].signer)
      .liquidationCall(cgo.address, rusd.address, users[5].address, amountToLiquidate, true);
    await tx.wait();

    // confirm the newly received cgo tokens (in isolation mode) cannot be used as collateral
    const userData = await helpersContract.getUserReserveData(cgo.address, users[6].address);
    expect(userData.usageAsCollateralEnabled).to.be.eq(false);
  });

  it('User 1 supplies CGO and borrows RUSD in isolation, CGO exits isolation. User 1 repay and withdraw. CGO enters isolation again', async () => {
    await evmRevert(snapshot);

    const { pool, configurator, helpersContract, users, poolAdmin, rusd, cgo } = testEnv;

    // Depositor supplies RUSD
    await rusd.connect(users[0].signer)['mint(uint256)'](depositAmount);
    await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[0].signer).supply(rusd.address, depositAmount, users[0].address, 0);

    // User 1 supplies CGO in isolation mode
    const cgoAmountToSupply = utils.parseEther('2');
    await cgo.connect(users[1].signer)['mint(uint256)'](cgoAmountToSupply);
    await cgo.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .supply(cgo.address, cgoAmountToSupply, users[1].address, 0);
    await pool.connect(users[1].signer).setUserUseReserveAsCollateral(cgo.address, true);

    // User 1 borrows RUSD against isolated CGO
    const { isolationModeTotalDebt: isolationModeTotalDebtBeforeBorrow } =
      await pool.getReserveData(cgo.address);
    const isolationModeTotalDebtAfterBorrow = isolationModeTotalDebtBeforeBorrow.add(1000);
    const rusdAmountToBorrow = utils.parseEther('10');
    expect(
      await pool
        .connect(users[1].signer)
        .borrow(rusd.address, rusdAmountToBorrow, '2', 0, users[1].address)
    )
      .to.emit(pool, 'IsolationModeTotalDebtUpdated')
      .withArgs(cgo.address, isolationModeTotalDebtAfterBorrow);

    const reserveDataAfterBorrow = await pool.getReserveData(cgo.address);
    expect(reserveDataAfterBorrow.isolationModeTotalDebt).to.be.eq(
      isolationModeTotalDebtAfterBorrow
    );

    // CGO exits isolation mode (debt ceiling = 0)
    const oldRASADebtCeiling = await helpersContract.getDebtCeiling(cgo.address);
    const newRASADebtCeiling = 0;
    expect(
      await configurator.connect(poolAdmin.signer).setDebtCeiling(cgo.address, newRASADebtCeiling)
    )
      .to.emit(configurator, 'DebtCeilingChanged')
      .withArgs(cgo.address, oldRASADebtCeiling, newRASADebtCeiling);

    expect(await helpersContract.getDebtCeiling(cgo.address)).to.be.eq(newRASADebtCeiling);
    expect((await pool.getReserveData(cgo.address)).isolationModeTotalDebt).to.be.eq(
      0,
      'isolationModeTotalDebt when entering isolation mode'
    );

    // User 1 borrows 1 RUSD
    await pool
      .connect(users[1].signer)
      .borrow(rusd.address, utils.parseEther('1'), '2', 0, users[1].address);

    // User 1 repays debt and withdraw
    await rusd.connect(users[1].signer)['mint(uint256)'](utils.parseEther('20'));
    await rusd.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[1].signer).repay(rusd.address, MAX_UINT_AMOUNT, '2', users[1].address);
    await pool.connect(users[1].signer).withdraw(cgo.address, MAX_UINT_AMOUNT, users[1].address);

    // CGO enters isolation mode again
    expect(await configurator.connect(poolAdmin.signer).setDebtCeiling(cgo.address, 100))
      .to.emit(configurator, 'DebtCeilingChanged')
      .withArgs(cgo.address, 0, 100);

    expect(await helpersContract.getDebtCeiling(cgo.address)).to.be.eq(100);
    expect((await pool.getReserveData(cgo.address)).isolationModeTotalDebt).to.be.eq(
      0,
      'isolationModeTotalDebt when entering isolation mode'
    );
  });
});
