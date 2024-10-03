import { expect } from 'chai';
import { utils } from 'ethers';
import { ProtocolErrors } from '../helpers/types';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { MockFlashLoanReceiver } from '../types/MockFlashLoanReceiver';
import { getMockFlashLoanReceiver } from '../helpers/contract-getters';
import { makeSuite, TestEnv } from './helpers/make-suite';

makeSuite('Pool: Drop Reserve', (testEnv: TestEnv) => {
  let _mockFlashLoanReceiver = {} as MockFlashLoanReceiver;

  const {
    UNDERLYING_CLAIMABLE_RIGHTS_NOT_ZERO,
    STABLE_DEBT_NOT_ZERO,
    VARIABLE_DEBT_SUPPLY_NOT_ZERO,
    ASSET_NOT_LISTED,
    ZERO_ADDRESS_NOT_VALID,
  } = ProtocolErrors;

  before(async () => {
    _mockFlashLoanReceiver = await getMockFlashLoanReceiver();
  });

  it('User 1 deposits RUSD, User 2 borrow RUSD stable and variable, should fail to drop RUSD reserve', async () => {
    const {
      deployer,
      users: [user1],
      pool,
      rusd,
      weth,
      configurator,
    } = testEnv;

    const depositedAmount = utils.parseEther('1000');
    const borrowedAmount = utils.parseEther('100');
    // setting reserve factor to 0 to ease tests, no RSToken accrued in reserve
    await configurator.setReserveFactor(rusd.address, 0);

    await rusd['mint(uint256)'](depositedAmount);
    await rusd.approve(pool.address, depositedAmount);
    await rusd.connect(user1.signer)['mint(uint256)'](depositedAmount);
    await rusd.connect(user1.signer).approve(pool.address, depositedAmount);

    await weth.connect(user1.signer)['mint(uint256)'](depositedAmount);
    await weth.connect(user1.signer).approve(pool.address, depositedAmount);

    await pool.deposit(rusd.address, depositedAmount, deployer.address, 0);

    await expect(configurator.dropReserve(rusd.address)).to.be.revertedWith(
      UNDERLYING_CLAIMABLE_RIGHTS_NOT_ZERO
    );

    await pool.connect(user1.signer).deposit(weth.address, depositedAmount, user1.address, 0);

    await pool.connect(user1.signer).borrow(rusd.address, borrowedAmount, 2, 0, user1.address);
    await expect(configurator.dropReserve(rusd.address)).to.be.revertedWith(
      VARIABLE_DEBT_SUPPLY_NOT_ZERO
    );
    await pool.connect(user1.signer).borrow(rusd.address, borrowedAmount, 1, 0, user1.address);
    await expect(configurator.dropReserve(rusd.address)).to.be.revertedWith(STABLE_DEBT_NOT_ZERO);
  });

  it('User 2 repays debts, drop RUSD reserve should fail', async () => {
    const {
      users: [user1],
      pool,
      rusd,
      configurator,
    } = testEnv;
    expect(await pool.connect(user1.signer).repay(rusd.address, MAX_UINT_AMOUNT, 1, user1.address));
    await expect(configurator.dropReserve(rusd.address)).to.be.revertedWith(
      VARIABLE_DEBT_SUPPLY_NOT_ZERO
    );

    expect(await pool.connect(user1.signer).repay(rusd.address, MAX_UINT_AMOUNT, 2, user1.address));
    await expect(configurator.dropReserve(rusd.address)).to.be.revertedWith(
      UNDERLYING_CLAIMABLE_RIGHTS_NOT_ZERO
    );
  });

  it('User 1 withdraw RUSD, drop RUSD reserve should succeed', async () => {
    const { deployer, pool, rusd, configurator, helpersContract } = testEnv;

    await pool.withdraw(rusd.address, MAX_UINT_AMOUNT, deployer.address);
    const reserveCount = (await pool.getReservesList()).length;
    expect(await configurator.dropReserve(rusd.address));

    const tokens = await pool.getReservesList();

    expect(tokens.length).to.be.eq(reserveCount - 1);
    expect(tokens.includes(rusd.address)).to.be.false;

    const { isActive } = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(isActive).to.be.false;
  });

  it('Drop an asset that is not a listed reserve should fail', async () => {
    const { users, configurator } = testEnv;
    await expect(configurator.dropReserve(users[5].address)).to.be.revertedWith(ASSET_NOT_LISTED);
  });

  it('Drop an asset that is not a listed reserve should fail', async () => {
    const { users, configurator } = testEnv;
    await expect(configurator.dropReserve(ZERO_ADDRESS)).to.be.revertedWith(ZERO_ADDRESS_NOT_VALID);
  });
});
