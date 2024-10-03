import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { RateMode } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';

import './helpers/utils/wadraymath';
import { evmSnapshot, evmRevert, waitForTx } from '../helpers/utilities/tx';
import { RSToken__factory, StableDebtToken__factory, VariableDebtToken__factory } from '../types';
import { parseEther, parseUnits } from 'ethers/lib/utils';

makeSuite('Pool Liquidation: Edge cases', (testEnv: TestEnv) => {
  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snap);
  });

  before(async () => {
    const { addressesProvider, oracle, rusd, eurs, weth } = testEnv;

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));
   
    await oracle.setAssetPrice(rusd.address, parseEther('1'));
    await oracle.setAssetPrice(eurs.address, parseEther('1'));
    await oracle.setAssetPrice(weth.address, parseUnits('4000', 18));

  });

  after(async () => {
    const { rasaOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(rasaOracle.address));
  });

  it('ValidationLogic `executeLiquidationCall` where user has variable and stable debt, but variable debt is insufficient to cover the full liquidation amount', async () => {
    const { pool, users, rusd, weth, oracle } = testEnv;

    const depositor = users[0];
    const borrower = users[1];

    // Deposit rusd
    await rusd
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000000'));
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '10000'),
        depositor.address,
        0
      );

    // Deposit eth, borrow rusd
    await weth.connect(borrower.signer)['mint(uint256)'](utils.parseEther('0.9'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('0.9'), borrower.address, 0);

    const rusdPrice = await oracle.getAssetPrice(rusd.address);

    await oracle.setAssetPrice(rusd.address, rusdPrice.percentDiv('2700'));

    // Borrow
    await pool
      .connect(borrower.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '500'),
        RateMode.Stable,
        0,
        borrower.address
      );

    // Borrow
    await pool
      .connect(borrower.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '220'),
        RateMode.Variable,
        0,
        borrower.address
      );

    await oracle.setAssetPrice(rusd.address, rusdPrice.percentMul(600_00));

    expect(
      await pool
        .connect(depositor.signer)
        .liquidationCall(weth.address, rusd.address, borrower.address, MAX_UINT_AMOUNT, false)
    );
  });

  it('Liquidation repay asset completely, asset should not be set as borrowed anymore', async () => {
    const { pool, users, rusd, eurs, weth, oracle } = testEnv;

    const depositor = users[0];
    const borrower = users[1];

    // Deposit rusd
    await rusd
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000000'));
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '10000'),
        depositor.address,
        0
      );

    // Deposit eurs
    await eurs
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '1000'));
    await eurs.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '1000'),
        depositor.address,
        0
      );

    // Deposit eth, borrow rusd
    await weth.connect(borrower.signer)['mint(uint256)'](utils.parseEther('0.9'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('0.9'), borrower.address, 0);

    // Borrow eurs
    await pool
      .connect(borrower.signer)
      .borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '1000'),
        RateMode.Variable,
        0,
        borrower.address
      );

    // Borrow rusd stable
    await pool
      .connect(borrower.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '100'),
        RateMode.Stable,
        0,
        borrower.address
      );

    // Borrow rusd variable
    await pool
      .connect(borrower.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '100'),
        RateMode.Variable,
        0,
        borrower.address
      );

    // Increase eurs price to allow liquidation
    const eursPrice = await oracle.getAssetPrice(eurs.address);
    await oracle.setAssetPrice(eurs.address, eursPrice.mul(10));

    const rusdData = await pool.getReserveData(rusd.address);
    const variableDebtToken = VariableDebtToken__factory.connect(
      rusdData.variableDebtTokenAddress,
      depositor.signer
    );
    const stableDebtToken = StableDebtToken__factory.connect(
      rusdData.stableDebtTokenAddress,
      depositor.signer
    );

    expect(await variableDebtToken.balanceOf(borrower.address)).to.be.gt(0);
    expect(await stableDebtToken.balanceOf(borrower.address)).to.be.gt(0);

    const userConfigBefore = BigNumber.from(
      (await pool.getUserConfiguration(borrower.address)).data
    );

    expect(
      await pool
        .connect(depositor.signer)
        .liquidationCall(weth.address, rusd.address, borrower.address, MAX_UINT_AMOUNT, false)
    );

    const userConfigAfter = BigNumber.from(
      (await pool.getUserConfiguration(borrower.address)).data
    );

    const isBorrowing = (conf, id) =>
      conf
        .div(BigNumber.from(2).pow(BigNumber.from(id).mul(2)))
        .and(1)
        .gt(0);

    expect(await variableDebtToken.balanceOf(borrower.address)).to.be.eq(0);
    expect(await stableDebtToken.balanceOf(borrower.address)).to.be.eq(0);

    expect(isBorrowing(userConfigBefore, rusdData.id)).to.be.true;
    expect(isBorrowing(userConfigAfter, rusdData.id)).to.be.false;
  });

  it('Liquidate the whole WETH collateral with 10% liquidation fee, asset should not be set as collateralized anymore', async () => {
    const { pool, users, rusd, eurs, weth, RSWETH, oracle, configurator } = testEnv;

    await configurator.setLiquidationProtocolFee(weth.address, '1000'); // 10%

    const depositor = users[0];
    const borrower = users[1];

    // Deposit rusd
    await rusd
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, '1000000'));
    await rusd.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '10000'),
        depositor.address,
        0
      );

    // Deposit eurs
    await eurs
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(eurs.address, '1000000'));
    await eurs.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .deposit(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '1000'),
        depositor.address,
        0
      );

    // Deposit eth, borrow rusd
    await weth.connect(borrower.signer)['mint(uint256)'](utils.parseEther('0.9'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, utils.parseEther('0.9'), borrower.address, 0);

    // Borrow eurs
    await pool
      .connect(borrower.signer)
      .borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, '1000'),
        RateMode.Variable,
        0,
        borrower.address
      );

    // Borrow rusd stable
    await pool
      .connect(borrower.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '100'),
        RateMode.Stable,
        0,
        borrower.address
      );

    // Borrow rusd variable
    await pool
      .connect(borrower.signer)
      .borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, '100'),
        RateMode.Variable,
        0,
        borrower.address
      );

    // HF = (0.9 * 0.85) / (1000 * 0.0005 + 100 * 0.0005 + 100 * 0.0005) = 1.275

    // Increase eurs price to allow liquidation
    const eursPrice = await oracle.getAssetPrice(eurs.address);
    await oracle.setAssetPrice(eurs.address, eursPrice.mul(10));

    // HF = (0.9 * 0.85) / (1000 * 0.005 + 100 * 0.0005 + 100 * 0.0005) = 0.15
    //
    // close factor = 1
    // $WETH_collateral = 0.9
    // $EURS_debt = 1000 * 0.005 = 5

    const wethData = await pool.getReserveData(weth.address);
    const RSWETHToken = RSToken__factory.connect(wethData.RSTokenAddress, depositor.signer);

    expect(await RSWETHToken.balanceOf(borrower.address)).to.be.gt(0);

    const userConfigBefore = BigNumber.from(
      (await pool.getUserConfiguration(borrower.address)).data
    );

    expect(await eurs.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(
      await pool
        .connect(depositor.signer)
        .liquidationCall(weth.address, eurs.address, borrower.address, MAX_UINT_AMOUNT, false)
    );

    const userConfigAfter = BigNumber.from(
      (await pool.getUserConfiguration(borrower.address)).data
    );

    const isUsingAsCollateral = (conf, id) =>
      conf
        .div(BigNumber.from(2).pow(BigNumber.from(id).mul(2).add(1)))
        .and(1)
        .gt(0);

    expect(await RSWETHToken.balanceOf(borrower.address)).to.be.eq(0);

    expect(isUsingAsCollateral(userConfigBefore, wethData.id)).to.be.true;
    expect(isUsingAsCollateral(userConfigAfter, wethData.id)).to.be.false;
  });
});
