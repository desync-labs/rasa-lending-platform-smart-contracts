import { expect } from 'chai';
import { BigNumber, Signer, utils } from 'ethers';
import { impersonateAccountsHardhat } from '../helpers/misc-utils';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { getFirstSigner } from '../helpers/utilities/signer';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { increaseTime } from '../helpers/utilities/tx';
import {
  InitializableImmutableAdminUpgradeabilityProxy,
  MockL2Pool__factory,
  MockL2Pool,
  L2Encoder,
  L2Encoder__factory,
  DefaultReserveInterestRateStrategy__factory,
  VariableDebtToken__factory,
} from '../types';
import { ethers, getChainId } from 'hardhat';
import {
  buildPermitParams,
  getProxyImplementation,
  getSignatureFromTypedData,
} from '../helpers/contracts-helpers';
import { getTestWallets } from './helpers/utils/wallets';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { parseUnits } from 'ethers/lib/utils';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import { calcExpectedStableDebtTokenBalance } from './helpers/utils/calculations';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Pool: L2 functions', (testEnv: TestEnv) => {
  const {
    INVALID_HF,
    NO_MORE_RESERVES_ALLOWED,
    CALLER_NOT_RSTOKEN,
    NOT_CONTRACT,
    CALLER_NOT_POOL_CONFIGURATOR,
    RESERVE_ALREADY_INITIALIZED,
    INVALID_ADDRESSES_PROVIDER,
    RESERVE_ALREADY_ADDED,
    DEBT_CEILING_NOT_ZERO,
    ASSET_NOT_LISTED,
    ZERO_ADDRESS_NOT_VALID,
  } = ProtocolErrors;

  let l2Pool: MockL2Pool;

  const POOL_ID = utils.formatBytes32String('POOL');

  let encoder: L2Encoder;

  before('Deploying L2Pool', async () => {
    const { addressesProvider, poolAdmin, pool, deployer, oracle, rusd, eurs } = testEnv;
    const { deployer: deployerName } = await hre.getNamedAccounts();

    await oracle.setAssetPrice(rusd.address, parseUnits('1', 18));
    await oracle.setAssetPrice(eurs.address, parseUnits('1', 18));

    encoder = await (await new L2Encoder__factory(deployer.signer).deploy(pool.address)).deployed();

    // Deploy the mock Pool with a `dropReserve` skipping the checks
    const L2POOL_IMPL_ARTIFACT = await hre.deployments.deploy('MockL2Pool', {
      contract: 'MockL2Pool',
      from: deployerName,
      args: [addressesProvider.address],
      libraries: {
        SupplyLogic: (await hre.deployments.get('SupplyLogic')).address,
        BorrowLogic: (await hre.deployments.get('BorrowLogic')).address,
        LiquidationLogic: (await hre.deployments.get('LiquidationLogic')).address,
        EModeLogic: (await hre.deployments.get('EModeLogic')).address,
        BridgeLogic: (await hre.deployments.get('BridgeLogic')).address,
        FlashLoanLogic: (await hre.deployments.get('FlashLoanLogic')).address,
        PoolLogic: (await hre.deployments.get('PoolLogic')).address,
      },
      log: false,
    });

    const poolProxyAddress = await addressesProvider.getPool();
    const oldPoolImpl = await getProxyImplementation(addressesProvider.address, poolProxyAddress);

    // Upgrade the Pool
    await expect(
      addressesProvider.connect(poolAdmin.signer).setPoolImpl(L2POOL_IMPL_ARTIFACT.address)
    )
      .to.emit(addressesProvider, 'PoolUpdated')
      .withArgs(oldPoolImpl, L2POOL_IMPL_ARTIFACT.address);

    // Get the Pool instance
    const poolAddress = await addressesProvider.getPool();
    l2Pool = await MockL2Pool__factory.connect(poolAddress, await getFirstSigner());
    expect(await addressesProvider.setPriceOracle(oracle.address));
  });

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    expect(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  it('Supply', async () => {
    const {
      rusd,
      RSRUSD,
      users: [user0],
    } = testEnv;

    const amount = utils.parseEther('100000');
    const referralCode = BigNumber.from(2);

    await rusd.connect(user0.signer)['mint(uint256)'](amount);
    await rusd.connect(user0.signer).approve(l2Pool.address, amount);

    const encoded = await encoder.encodeSupplyParams(rusd.address, amount, referralCode);

    await expect(l2Pool.connect(user0.signer)['supply(bytes32)'](encoded))
      .to.emit(l2Pool, 'Supply')
      .withArgs(rusd.address, user0.address, user0.address, amount, referralCode);

    const userBalance = await RSRUSD.balanceOf(user0.address);
    expect(userBalance).to.be.eq(amount, 'invalid amount deposited');
  });

  it('Supply with permit test', async () => {
    const { deployer, rusd, RSRUSD } = testEnv;

    const chainId = Number(await getChainId());
    const nonce = await rusd.nonces(deployer.address);
    const amount = utils.parseEther('10000');
    const highDeadline = '3000000000';
    const userPrivateKey = getTestWallets()[0].secretKey;

    const msgParams = buildPermitParams(
      chainId,
      rusd.address,
      '1',
      await rusd.symbol(),
      deployer.address,
      l2Pool.address,
      nonce.toNumber(),
      highDeadline,
      amount.toString()
    );
    const { v, r, s } = getSignatureFromTypedData(userPrivateKey, msgParams);

    await rusd.connect(deployer.signer)['mint(uint256)'](amount);
    const referralCode = BigNumber.from(2);

    const encoded = await encoder.encodeSupplyWithPermitParams(
      rusd.address,
      amount,
      referralCode,
      highDeadline,
      v,
      r,
      s
    );

    await expect(
      l2Pool.connect(deployer.signer)['supplyWithPermit(bytes32,bytes32,bytes32)'](encoded[0], r, s)
    )
      .to.emit(l2Pool, 'Supply')
      .withArgs(rusd.address, deployer.address, deployer.address, amount, referralCode);

    const userBalance = await RSRUSD.balanceOf(deployer.address);
    expect(userBalance).to.be.eq(amount, 'invalid amount deposited');
  });

  it('setUserUseReserveAsCollateral to false', async () => {
    const {
      rusd,
      RSRUSD,
      users: [user0],
      helpersContract,
    } = testEnv;

    const encoded = await encoder.encodeSetUserUseReserveAsCollateral(rusd.address, false);
    await expect(l2Pool.connect(user0.signer)['setUserUseReserveAsCollateral(bytes32)'](encoded))
      .to.emit(l2Pool, 'ReserveUsedAsCollateralDisabled')
      .withArgs(rusd.address, user0.address);

    const userData = await helpersContract.getUserReserveData(rusd.address, user0.address);
    expect(userData.usageAsCollateralEnabled).to.be.false;
  });

  it('setUserUseReserveAsCollateral to true', async () => {
    const {
      rusd,
      users: [user0],
      helpersContract,
    } = testEnv;

    const encoded = await encoder.encodeSetUserUseReserveAsCollateral(rusd.address, true);
    expect(await l2Pool.connect(user0.signer)['setUserUseReserveAsCollateral(bytes32)'](encoded))
      .to.emit(l2Pool, 'ReserveUsedAsCollateralEnabled')
      .withArgs(rusd.address, user0.address);

    const userData = await helpersContract.getUserReserveData(rusd.address, user0.address);
    expect(userData.usageAsCollateralEnabled).to.be.true;
  });

  it('Borrow', async () => {
    const {
      deployer,
      eurs,
      RSEurs,
      users: [, user1],
      helpersContract,
    } = testEnv;

    const borrowAmount = parseUnits('100', 2);
    const referralCode = BigNumber.from(16);

    expect(await eurs.balanceOf(deployer.address)).to.be.eq(0);

    await eurs.connect(user1.signer)['mint(uint256)'](borrowAmount.mul(10));
    await eurs.connect(user1.signer).approve(l2Pool.address, MAX_UINT_AMOUNT);
    await l2Pool
      .connect(user1.signer)
      ['supply(address,uint256,address,uint16)'](
        eurs.address,
        borrowAmount.mul(10),
        user1.address,
        referralCode
      );

    const encoded = await encoder.encodeBorrowParams(
      eurs.address,
      borrowAmount,
      RateMode.Variable,
      referralCode
    );

    const data = await l2Pool.getReserveData(eurs.address);
    const strat = await DefaultReserveInterestRateStrategy__factory.connect(
      data.interestRateStrategyAddress,
      deployer.signer
    );

    const { reserveFactor } = await helpersContract.getReserveConfigurationData(eurs.address);

    const [liqRate, sRate, varRate] = await strat.calculateInterestRates({
      unbacked: BigNumber.from(0),
      liquidityAdded: BigNumber.from(0),
      liquidityTaken: borrowAmount,
      totalStableDebt: BigNumber.from(0),
      totalVariableDebt: borrowAmount,
      averageStableBorrowRate: BigNumber.from(0),
      reserve: eurs.address,
      RSToken: RSEurs.address,
      reserveFactor: reserveFactor,
    });

    expect(await l2Pool.connect(deployer.signer)['borrow(bytes32)'](encoded))
      .to.emit(l2Pool, 'Borrow')
      .withArgs(
        eurs.address,
        deployer.address,
        deployer.address,
        borrowAmount,
        Number(RateMode.Variable),
        varRate,
        referralCode
      );

    expect(await eurs.balanceOf(deployer.address)).to.be.eq(borrowAmount);
  });

  it('swapBorrowRateMode to stable', async () => {
    const { deployer, rusd, eurs, helpersContract } = testEnv;
    const currentInterestRateMode = RateMode.Variable;
    const encoded = await encoder.encodeSwapBorrowRateMode(eurs.address, currentInterestRateMode);
    const userDataBefore = await helpersContract.getUserReserveData(eurs.address, deployer.address);
    expect(userDataBefore.currentStableDebt).to.be.eq(0);
    expect(userDataBefore.currentVariableDebt).to.be.gt(0);

    expect(await l2Pool.connect(deployer.signer)['swapBorrowRateMode(bytes32)'](encoded))
      .to.emit(l2Pool, 'SwapBorrowRateMode')
      .withArgs(eurs.address, deployer.address, Number(currentInterestRateMode));

    const userDataAfter = await helpersContract.getUserReserveData(eurs.address, deployer.address);

    expect(userDataAfter.currentStableDebt).to.be.gt(0);
    expect(userDataAfter.currentVariableDebt).to.be.eq(0);
  });

  it('rebalanceStableBorrowRate (revert expected)', async () => {
    // The test only checks that the value is translated properly, not that the underlying function is run correctly.
    // see other rebalance tests for that
    const { deployer, eurs } = testEnv;
    const encoded = await encoder.encodeRebalanceStableBorrowRate(eurs.address, deployer.address);
    await expect(
      l2Pool.connect(deployer.signer)['rebalanceStableBorrowRate(bytes32)'](encoded)
    ).to.be.revertedWith(ProtocolErrors.INTEREST_RATE_REBALANCE_CONDITIONS_NOT_MET);
  });

  it('swapBorrowRateMode to variable', async () => {
    const { deployer, rusd, eurs, helpersContract } = testEnv;
    const currentInterestRateMode = RateMode.Stable;
    const encoded = await encoder.encodeSwapBorrowRateMode(eurs.address, currentInterestRateMode);
    const userDataBefore = await helpersContract.getUserReserveData(eurs.address, deployer.address);
    expect(userDataBefore.currentStableDebt).to.be.gt(0);
    expect(userDataBefore.currentVariableDebt).to.be.eq(0);

    expect(await l2Pool.connect(deployer.signer)['swapBorrowRateMode(bytes32)'](encoded))
      .to.emit(l2Pool, 'SwapBorrowRateMode')
      .withArgs(eurs.address, deployer.address, Number(currentInterestRateMode));

    const userDataAfter = await helpersContract.getUserReserveData(eurs.address, deployer.address);
    expect(userDataAfter.currentStableDebt).to.be.eq(0);
    expect(userDataAfter.currentVariableDebt).to.be.gt(0);
  });

  it('Repay some', async () => {
    const { deployer, eurs } = testEnv;

    await eurs.connect(deployer.signer).approve(l2Pool.address, MAX_UINT_AMOUNT);

    const data = await l2Pool.getReserveData(eurs.address);
    const vDebtToken = VariableDebtToken__factory.connect(
      data.variableDebtTokenAddress,
      deployer.signer
    );

    const debtBefore = await vDebtToken.balanceOf(deployer.address);
    const balanceBefore = await eurs.balanceOf(deployer.address);
    const repayAmount = parseUnits('50', 2);

    const encoded = await encoder.encodeRepayParams(eurs.address, repayAmount, RateMode.Variable);

    expect(await l2Pool.connect(deployer.signer)['repay(bytes32)'](encoded))
      .to.emit(l2Pool, 'Repay')
      .withArgs(eurs.address, deployer.address, deployer.address, repayAmount, false);

    const userDebt = await vDebtToken.balanceOf(deployer.address);
    expect(userDebt).to.be.eq(debtBefore.sub(repayAmount), 'invalid amount repaid');
    const userBalance = await eurs.balanceOf(deployer.address);
    expect(userBalance).to.be.eq(balanceBefore.sub(repayAmount), 'invalid amount repaid');
  });

  it('Repay some with RSTokens', async () => {
    const {
      deployer,
      eurs,
      RSEurs,
      users: [, user1],
    } = testEnv;

    await eurs.connect(deployer.signer).approve(l2Pool.address, MAX_UINT_AMOUNT);

    const data = await l2Pool.getReserveData(eurs.address);
    const vDebtToken = VariableDebtToken__factory.connect(
      data.variableDebtTokenAddress,
      deployer.signer
    );

    const repayAmount = parseUnits('10', 2);
    expect(await RSEurs.connect(user1.signer).transfer(deployer.address, repayAmount));

    const balanceBefore = await eurs.balanceOf(deployer.address);
    const debtBefore = await vDebtToken.balanceOf(deployer.address);

    const encoded = await encoder.encodeRepayWithRSTokensParams(
      eurs.address,
      repayAmount,
      RateMode.Variable
    );

    expect(await l2Pool.connect(deployer.signer)['repayWithRSTokens(bytes32)'](encoded))
      .to.emit(l2Pool, 'Repay')
      .withArgs(eurs.address, deployer.address, deployer.address, repayAmount, true);

    const userDebt = await vDebtToken.balanceOf(deployer.address);
    const userBalance = await eurs.balanceOf(deployer.address);
    const userABalance = await RSEurs.balanceOf(deployer.address);
    expect(userDebt).to.be.eq(debtBefore.sub(repayAmount), 'invalid amount repaid');
    expect(userBalance).to.be.eq(balanceBefore, 'user balance changed');
    expect(userABalance).to.be.eq(0, 'invalid amount repaid');
  });

  it('Repay remainder with permit', async () => {
    const { deployer, eurs } = testEnv;

    const data = await l2Pool.getReserveData(eurs.address);
    const vDebtToken = VariableDebtToken__factory.connect(
      data.variableDebtTokenAddress,
      deployer.signer
    );

    const debtBefore = await vDebtToken.balanceOf(deployer.address);

    const chainId = Number(await getChainId());
    const nonce = await eurs.nonces(deployer.address);
    const amount = MAX_UINT_AMOUNT;
    const highDeadline = '3000000000';
    const userPrivateKey = getTestWallets()[0].secretKey;

    const msgParams = buildPermitParams(
      chainId,
      eurs.address,
      '1',
      await eurs.symbol(),
      deployer.address,
      l2Pool.address,
      nonce.toNumber(),
      highDeadline,
      amount.toString()
    );
    const { v, r, s } = getSignatureFromTypedData(userPrivateKey, msgParams);

    await eurs.connect(deployer.signer)['mint(uint256)'](debtBefore.mul(10));
    await eurs.connect(deployer.signer).approve(l2Pool.address, MAX_UINT_AMOUNT);

    const encoded = await encoder.encodeRepayWithPermitParams(
      eurs.address,
      amount,
      RateMode.Variable,
      highDeadline,
      v,
      r,
      s
    );

    expect(
      await l2Pool
        .connect(deployer.signer)
        ['repayWithPermit(bytes32,bytes32,bytes32)'](encoded[0], r, s)
    )
      .to.emit(l2Pool, 'Repay')
      .withArgs(eurs.address, deployer.address, deployer.address, debtBefore, false);

    const userBalance = await vDebtToken.balanceOf(deployer.address);
    expect(userBalance).to.be.eq(0, 'invalid amount repaid');
  });

  it('Withdraw some', async () => {
    const {
      rusd,
      RSRUSD,
      users: [user0],
    } = testEnv;

    const amount = utils.parseEther('0.5');
    const encoded = await encoder.encodeWithdrawParams(rusd.address, amount);
    const balanceBefore = await RSRUSD.balanceOf(user0.address);

    expect(await l2Pool.connect(user0.signer)['withdraw(bytes32)'](encoded))
      .to.emit(l2Pool, 'Withdraw')
      .withArgs(rusd.address, user0.address, user0.address, amount);

    const userBalance = await RSRUSD.balanceOf(user0.address);
    expect(userBalance).to.be.eq(balanceBefore.sub(amount), 'invalid amount withdrawn');
  });

  it('Withdraw remainder', async () => {
    const {
      rusd,
      RSRUSD,
      users: [user0],
    } = testEnv;

    const amount = MAX_UINT_AMOUNT;
    const encoded = await encoder.encodeWithdrawParams(rusd.address, amount);
    const balanceBefore = await RSRUSD.balanceOf(user0.address);

    expect(await l2Pool.connect(user0.signer)['withdraw(bytes32)'](encoded))
      .to.emit(l2Pool, 'Withdraw')
      .withArgs(rusd.address, user0.address, user0.address, balanceBefore);

    const userBalance = await RSRUSD.balanceOf(user0.address);
    expect(userBalance).to.be.eq(0, 'invalid amount withdrawn');
  });

  it('liquidationCall', async () => {
    const {
      rusd,
      eurs,
      users: [depositor, borrower, liquidator],
      oracle,
      pool,
      helpersContract,
    } = testEnv;

    //mints RUSD to depositor
    const amountRUSDtoDeposit = parseUnits('5000', 18);
    await rusd.connect(depositor.signer)['mint(uint256)'](amountRUSDtoDeposit);
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(rusd.address, amountRUSDtoDeposit, depositor.address, '0');

    //user 2 deposits  eurs
    const amountEURStoDeposit = parseUnits('1000', 2);
    await eurs.connect(borrower.signer)['mint(uint256)'](parseUnits('1000', 2));
    await eurs.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(eurs.address, amountEURStoDeposit, borrower.address, '0');

    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    const amountRUSDToBorrow = userGlobalData.availableBorrowsBase
      .mul(9500)
      .div(10000)
      .div(rusdPrice)
      .mul(BigNumber.from(10).pow(18));

    await pool
      .connect(borrower.signer)
      .borrow(rusd.address, amountRUSDToBorrow, RateMode.Stable, '0', borrower.address);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataAfter.currentLiquidationThreshold).to.be.equal(8500, INVALID_HF);

    // Increases price
    await oracle.setAssetPrice(rusd.address, rusdPrice.mul(2));
    const userGlobalDataPriceChange = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataPriceChange.healthFactor).to.be.lt(parseUnits('1', 18), INVALID_HF);

    //mints rusd to the liquidator
    await rusd.connect(liquidator.signer)['mint(uint256)'](parseUnits('1000', 18));

    //approve protocol to access the liquidator wallet
    await rusd.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const rusdReserveDataBefore = await getReserveData(helpersContract, rusd.address);
    const eursReserveDataBefore = await getReserveData(helpersContract, eurs.address);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    await increaseTime(100);

    const encoded = await encoder.encodeLiquidationCall(
      eurs.address,
      rusd.address,
      borrower.address,
      amountToLiquidate,
      false
    );

    const tx = await l2Pool
      .connect(liquidator.signer)
      ['liquidationCall(bytes32,bytes32)'](encoded[0], encoded[1]);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const rusdReserveDataAfter = await getReserveData(helpersContract, rusd.address);
    const eursReserveDataAfter = await getReserveData(helpersContract, eurs.address);

    const collateralPrice = await oracle.getAssetPrice(eurs.address);
    const principalPrice = await oracle.getAssetPrice(rusd.address);

    const collateralDecimals = (await helpersContract.getReserveConfigurationData(eurs.address))
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

    expect(eursReserveDataAfter.totalLiquidity).to.be.closeTo(
      eursReserveDataBefore.totalLiquidity.sub(expectedCollateralLiquidated),
      2,
      'Invalid collateral total liquidity'
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
    await oracle.setAssetPrice(rusd.address, rusdPrice);
  });

  it('liquidationCall max value', async () => {
    const {
      rusd,
      RSEurs,
      eurs,
      users: [depositor, borrower, liquidator],
      oracle,
      pool,
      helpersContract,
    } = testEnv;

    //mints RUSD to depositor
    const amountRUSDtoDeposit = parseUnits('5000', 18);
    await rusd.connect(depositor.signer)['mint(uint256)'](amountRUSDtoDeposit);
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(rusd.address, amountRUSDtoDeposit, depositor.address, '0');

    //user 2 deposits  eurs
    const amountEURStoDeposit = parseUnits('1000', 2);
    await eurs.connect(borrower.signer)['mint(uint256)'](parseUnits('1000', 2));
    await eurs.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(eurs.address, amountEURStoDeposit, borrower.address, '0');

    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    const amountRUSDToBorrow = userGlobalData.availableBorrowsBase
      .mul(9500)
      .div(10000)
      .div(rusdPrice)
      .mul(BigNumber.from(10).pow(18));

    await pool
      .connect(borrower.signer)
      .borrow(rusd.address, amountRUSDToBorrow, RateMode.Stable, '0', borrower.address);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataAfter.currentLiquidationThreshold).to.be.equal(8500, INVALID_HF);

    // Increase price
    await oracle.setAssetPrice(rusd.address, rusdPrice.mul(2));
    const userGlobalDataPriceChange = await pool.getUserAccountData(borrower.address);
    expect(userGlobalDataPriceChange.healthFactor).to.be.lt(parseUnits('1', 18), INVALID_HF);

    //mints rusd to the liquidator
    await rusd.connect(liquidator.signer)['mint(uint256)'](parseUnits('1000', 18));

    //approve protocol to access the liquidator wallet
    await rusd.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    const encoded = await encoder.encodeLiquidationCall(
      eurs.address,
      rusd.address,
      borrower.address,
      MAX_UINT_AMOUNT,
      true
    );

    const liquidatorRSEURSBefore = await RSEurs.balanceOf(liquidator.address);

    const tx = await l2Pool
      .connect(liquidator.signer)
      ['liquidationCall(bytes32,bytes32)'](encoded[0], encoded[1]);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      rusd.address,
      borrower.address
    );

    expect(await RSEurs.balanceOf(liquidator.address)).to.be.gt(liquidatorRSEURSBefore);
    expect(
      userReserveDataAfter.currentStableDebt.add(userReserveDataAfter.currentVariableDebt)
    ).to.be.lt(
      userReserveDataBefore.currentStableDebt.add(userReserveDataBefore.currentVariableDebt)
    );
  });
});
