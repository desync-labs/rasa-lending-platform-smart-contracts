import { expect } from 'chai';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { RateMode, ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { evmSnapshot, evmRevert } from '../helpers/utilities/tx';

makeSuite('RSToken: Transfer', (testEnv: TestEnv) => {
  const {
    INVALID_FROM_BALANCE_AFTER_TRANSFER,
    INVALID_TO_BALANCE_AFTER_TRANSFER,
    HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD,
  } = ProtocolErrors;

  const RUSD_AMOUNT_TO_DEPOSIT = '1000';

  it('User 0 deposits 1000 RUSD, transfers 1000 to user 0', async () => {
    const { users, pool, rusd, RSRUSD } = testEnv;
    const snap = await evmSnapshot();

    // User 1 deposits 1000 RUSD
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, RUSD_AMOUNT_TO_DEPOSIT);

    // Top up user
    expect(await rusd.connect(users[0].signer)['mint(uint256)'](amountRUSDtoDeposit));

    expect(await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(await RSRUSD.getPreviousIndex(users[0].address)).to.be.eq(0);

    expect(
      await pool
        .connect(users[0].signer)
        .deposit(rusd.address, amountRUSDtoDeposit, users[0].address, '0')
    );

    expect(await RSRUSD.getPreviousIndex(users[0].address)).to.be.gt(0);

    await expect(RSRUSD.connect(users[0].signer).transfer(users[0].address, amountRUSDtoDeposit))
      .to.emit(RSRUSD, 'Transfer')
      .withArgs(users[0].address, users[0].address, amountRUSDtoDeposit);

    const name = await RSRUSD.name();

    expect(name).to.be.equal('RASA RUSD');

    const fromBalance = await RSRUSD.balanceOf(users[0].address);
    const toBalance = await RSRUSD.balanceOf(users[0].address);
    expect(fromBalance.toString()).to.be.eq(toBalance.toString());

    await evmRevert(snap);
  });

  it('User 0 deposits 1000 RUSD, disable as collateral, transfers 1000 to user 1', async () => {
    const { users, pool, rusd, RSRUSD } = testEnv;
    const snap = await evmSnapshot();

    // User 1 deposits 1000 RUSD
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, RUSD_AMOUNT_TO_DEPOSIT);

    // Top up user
    expect(await rusd.connect(users[0].signer)['mint(uint256)'](amountRUSDtoDeposit));

    expect(await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(
      await pool
        .connect(users[0].signer)
        .deposit(rusd.address, amountRUSDtoDeposit, users[0].address, '0')
    );

    expect(await pool.connect(users[0].signer).setUserUseReserveAsCollateral(rusd.address, false));

    await expect(RSRUSD.connect(users[0].signer).transfer(users[1].address, amountRUSDtoDeposit))
      .to.emit(RSRUSD, 'Transfer')
      .withArgs(users[0].address, users[1].address, amountRUSDtoDeposit);

    const name = await RSRUSD.name();

    expect(name).to.be.equal('RASA RUSD');

    const fromBalance = await RSRUSD.balanceOf(users[0].address);
    const toBalance = await RSRUSD.balanceOf(users[1].address);
    expect(fromBalance.toString()).to.be.equal('0', INVALID_FROM_BALANCE_AFTER_TRANSFER);
    expect(toBalance.toString()).to.be.equal(
      amountRUSDtoDeposit.toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );

    await evmRevert(snap);
  });

  it('User 0 deposits 1000 RUSD, transfers 5 to user 1 twice, then transfer 0 to user 1', async () => {
    const { users, pool, rusd, RSRUSD } = testEnv;
    const snap = await evmSnapshot();

    expect(
      await rusd
        .connect(users[0].signer)
        ['mint(uint256)'](await convertToCurrencyDecimals(rusd.address, RUSD_AMOUNT_TO_DEPOSIT))
    );

    expect(await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));

    // User 1 deposits 1000 RUSD
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, RUSD_AMOUNT_TO_DEPOSIT);
    const amountRUSDtoTransfer = await convertToCurrencyDecimals(rusd.address, '5');

    expect(
      await pool
        .connect(users[0].signer)
        .deposit(rusd.address, amountRUSDtoDeposit, users[0].address, '0')
    );

    await expect(RSRUSD.connect(users[0].signer).transfer(users[1].address, amountRUSDtoTransfer))
      .to.emit(RSRUSD, 'Transfer')
      .withArgs(users[0].address, users[1].address, amountRUSDtoTransfer);
    expect(await RSRUSD.balanceOf(users[0].address)).to.be.eq(
      (await convertToCurrencyDecimals(rusd.address, '995')).toString(),
      INVALID_FROM_BALANCE_AFTER_TRANSFER
    );
    expect(await RSRUSD.balanceOf(users[1].address)).to.be.eq(
      (await convertToCurrencyDecimals(rusd.address, '5')).toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );

    await expect(RSRUSD.connect(users[0].signer).transfer(users[1].address, amountRUSDtoTransfer))
      .to.emit(RSRUSD, 'Transfer')
      .withArgs(users[0].address, users[1].address, amountRUSDtoTransfer);
    expect(await RSRUSD.balanceOf(users[0].address)).to.be.eq(
      (await convertToCurrencyDecimals(rusd.address, '990')).toString(),
      INVALID_FROM_BALANCE_AFTER_TRANSFER
    );
    expect(await RSRUSD.balanceOf(users[1].address)).to.be.eq(
      (await convertToCurrencyDecimals(rusd.address, '10')).toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );

    await expect(RSRUSD.connect(users[0].signer).transfer(users[1].address, 0))
      .to.emit(RSRUSD, 'Transfer')
      .withArgs(users[0].address, users[1].address, 0);
    expect(await RSRUSD.balanceOf(users[0].address)).to.be.eq(
      (await convertToCurrencyDecimals(rusd.address, '990')).toString(),
      INVALID_FROM_BALANCE_AFTER_TRANSFER
    );
    expect(await RSRUSD.balanceOf(users[1].address)).to.be.eq(
      (await convertToCurrencyDecimals(rusd.address, '10')).toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );

    await evmRevert(snap);
  });

  it('User 0 deposits 1000 RUSD, transfers to user 1', async () => {
    const { users, pool, rusd, RSRUSD } = testEnv;

    // User 1 deposits 1000 RUSD
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, RUSD_AMOUNT_TO_DEPOSIT);

    // Top up user
    expect(await rusd.connect(users[0].signer)['mint(uint256)'](amountRUSDtoDeposit));

    expect(await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(
      await pool
        .connect(users[0].signer)
        .deposit(rusd.address, amountRUSDtoDeposit, users[0].address, '0')
    );

    await expect(RSRUSD.connect(users[0].signer).transfer(users[1].address, amountRUSDtoDeposit))
      .to.emit(RSRUSD, 'Transfer')
      .withArgs(users[0].address, users[1].address, amountRUSDtoDeposit);

    const name = await RSRUSD.name();

    expect(name).to.be.equal('RASA RUSD');

    const fromBalance = await RSRUSD.balanceOf(users[0].address);
    const toBalance = await RSRUSD.balanceOf(users[1].address);

    expect(fromBalance.toString()).to.be.equal('0', INVALID_FROM_BALANCE_AFTER_TRANSFER);
    expect(toBalance.toString()).to.be.equal(
      amountRUSDtoDeposit.toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );
  });

  it('User 0 deposits 1 WETH and user 1 tries to borrow the WETH with the received RUSD as collateral', async () => {
    const { users, pool, weth, helpersContract } = testEnv;
    const userAddress = await pool.signer.getAddress();

    const amountWETHtoDeposit = await convertToCurrencyDecimals(weth.address, '1');
    const amountWETHtoBorrow = await convertToCurrencyDecimals(weth.address, '0.1');

    expect(await weth.connect(users[0].signer)['mint(uint256)'](amountWETHtoDeposit));

    expect(await weth.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));

    expect(
      await pool
        .connect(users[0].signer)
        .deposit(weth.address, amountWETHtoDeposit, userAddress, '0')
    );
    expect(
      await pool
        .connect(users[1].signer)
        .borrow(weth.address, amountWETHtoBorrow, RateMode.Stable, '0', users[1].address)
    );

    const userReserveData = await helpersContract.getUserReserveData(
      weth.address,
      users[1].address
    );

    expect(userReserveData.currentStableDebt.toString()).to.be.eq(amountWETHtoBorrow);
  });

  it('User 1 tries to transfer all the RUSD used as collateral back to user 0 (revert expected)', async () => {
    const { users, RSRUSD, rusd } = testEnv;

    const amountRUSDtoTransfer = await convertToCurrencyDecimals(rusd.address, RUSD_AMOUNT_TO_DEPOSIT);

    await expect(
      RSRUSD.connect(users[1].signer).transfer(users[0].address, amountRUSDtoTransfer),
      HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
    ).to.be.revertedWith(HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD);
  });

  it('User 1 transfers a small amount of RUSD used as collateral back to user 0', async () => {
    const { users, RSRUSD, rusd } = testEnv;

    const aRUSDtoTransfer = await convertToCurrencyDecimals(rusd.address, '100');

    await expect(RSRUSD.connect(users[1].signer).transfer(users[0].address, aRUSDtoTransfer))
      .to.emit(RSRUSD, 'Transfer')
      .withArgs(users[1].address, users[0].address, aRUSDtoTransfer);

    const user0Balance = await RSRUSD.balanceOf(users[0].address);

    expect(user0Balance.toString()).to.be.eq(aRUSDtoTransfer.toString());
  });
});
