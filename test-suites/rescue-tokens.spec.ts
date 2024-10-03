import { expect } from 'chai';
import { utils } from 'ethers';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { evmSnapshot, evmRevert } from '../helpers/utilities/tx';

makeSuite('Rescue tokens', (testEnv: TestEnv) => {
  const { CALLER_NOT_POOL_ADMIN, CALLER_MUST_BE_POOL, UNDERLYING_CANNOT_BE_RESCUED } =
    ProtocolErrors;

  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snap);
  });

  it('User tries to rescue tokens from Pool (revert expected)', async () => {
    const {
      pool,
      eurs,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      pool.connect(rescuer.signer).rescueTokens(eurs.address, rescuer.address, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('PoolAdmin rescue tokens from Pool', async () => {
    const {
      poolAdmin,
      pool,
      eurs,
      users: [locker],
    } = testEnv;

    const amountToLock = utils.parseUnits('10', 18);

    // Lock
    await eurs['mint(address,uint256)'](locker.address, amountToLock);
    await eurs.connect(locker.signer).transfer(pool.address, amountToLock);

    const lockerBalanceBefore = await eurs.balanceOf(locker.address);
    const poolBalanceBefore = await eurs.balanceOf(pool.address);

    expect(
      await pool.connect(poolAdmin.signer).rescueTokens(eurs.address, locker.address, amountToLock)
    );

    const poolBalanceAfter = await eurs.balanceOf(pool.address);
    expect(poolBalanceBefore).to.be.eq(poolBalanceAfter.add(amountToLock));
    const lockerBalanceAfter = await eurs.balanceOf(locker.address);
    expect(lockerBalanceBefore).to.be.eq(lockerBalanceAfter.sub(amountToLock));
  });

  it('User tries to rescue tokens from RSToken (revert expected)', async () => {
    const {
      eurs,
      RSRUSD,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      RSRUSD.connect(rescuer.signer).rescueTokens(eurs.address, rescuer.address, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('User tries to rescue tokens of underlying from RSToken (revert expected)', async () => {
    const {
      RSRUSD,
      rusd,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      RSRUSD.connect(rescuer.signer).rescueTokens(rusd.address, rescuer.address, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('PoolAdmin tries to rescue tokens of underlying from RSToken (revert expected)', async () => {
    const {
      poolAdmin,
      RSRUSD,
      rusd,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      RSRUSD.connect(poolAdmin.signer).rescueTokens(rusd.address, rescuer.address, amount)
    ).to.be.revertedWith(UNDERLYING_CANNOT_BE_RESCUED);
  });

  it('PoolAdmin rescue tokens from RSToken', async () => {
    const {
      poolAdmin,
      rusd,
      eurs,
      RSRUSD,
      users: [locker],
    } = testEnv;

    const amountToLock = utils.parseUnits('10', 18);

    // Lock
    await eurs['mint(address,uint256)'](locker.address, amountToLock);
    await eurs.connect(locker.signer).transfer(RSRUSD.address, amountToLock);

    const lockerBalanceBefore = await eurs.balanceOf(locker.address);
    const RSTokenBalanceBefore = await eurs.balanceOf(RSRUSD.address);

    expect(
      await RSRUSD.connect(poolAdmin.signer).rescueTokens(eurs.address, locker.address, amountToLock)
    );

    const RSTokenBalanceAfter = await eurs.balanceOf(RSRUSD.address);
    expect(RSTokenBalanceBefore).to.be.eq(RSTokenBalanceAfter.add(amountToLock));
    const lockerBalanceAfter = await eurs.balanceOf(locker.address);
    expect(lockerBalanceBefore).to.be.eq(lockerBalanceAfter.sub(amountToLock));
  });
});
