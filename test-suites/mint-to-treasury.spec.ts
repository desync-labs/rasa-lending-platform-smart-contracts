import { expect } from 'chai';
import { RateMode } from '../helpers/types';
import { MAX_UINT_AMOUNT, ONE_YEAR } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { makeSuite, TestEnv } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import { advanceTimeAndBlock } from '../helpers/utilities/tx';

makeSuite('Mint To Treasury', (testEnv: TestEnv) => {
  it('User 0 deposits 1000 RUSD. Borrower borrows 100 RUSD. Clock moved forward one year. Calculates and verifies the amount accrued to the treasury', async () => {
    const { users, pool, rusd, helpersContract } = testEnv;

    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, '1000');
    const amountRUSDtoBorrow = await convertToCurrencyDecimals(rusd.address, '100');

    await expect(await rusd.connect(users[0].signer)['mint(uint256)'](amountRUSDtoDeposit));

    // user 0 deposits 1000 RUSD
    await expect(await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));
    await expect(
      await pool
        .connect(users[0].signer)
        .deposit(rusd.address, amountRUSDtoDeposit, users[0].address, '0')
    );

    await expect(
      await pool
        .connect(users[0].signer)
        .borrow(rusd.address, amountRUSDtoBorrow, RateMode.Variable, '0', users[0].address)
    );

    const { reserveFactor } = await helpersContract.getReserveConfigurationData(rusd.address);

    await advanceTimeAndBlock(parseInt(ONE_YEAR));

    await expect(await rusd.connect(users[0].signer)['mint(uint256)'](amountRUSDtoDeposit));

    await expect(
      await pool
        .connect(users[0].signer)
        .deposit(rusd.address, amountRUSDtoDeposit, users[0].address, '0')
    );

    const { liquidityIndex, variableBorrowIndex } = await pool.getReserveData(rusd.address);

    const expectedAccruedToTreasury = amountRUSDtoBorrow
      .rayMul(variableBorrowIndex)
      .sub(amountRUSDtoBorrow)
      .percentMul(reserveFactor)
      .rayDiv(liquidityIndex);

    const { accruedToTreasury } = await pool.getReserveData(rusd.address);

    expect(accruedToTreasury).to.be.closeTo(expectedAccruedToTreasury, 2);
  });

  it('Mints the accrued to the treasury', async () => {
    const { users, pool, rusd, RSRUSD } = testEnv;

    const treasuryAddress = await RSRUSD.RESERVE_TREASURY_ADDRESS();
    const { accruedToTreasury } = await pool.getReserveData(rusd.address);

    await expect(await pool.connect(users[0].signer).mintToTreasury([rusd.address]));

    const normalizedIncome = await pool.getReserveNormalizedIncome(rusd.address);
    const treasuryBalance = await RSRUSD.balanceOf(treasuryAddress);

    const expectedTreasuryBalance = accruedToTreasury.rayMul(normalizedIncome);

    expect(treasuryBalance).to.be.closeTo(
      expectedTreasuryBalance,
      2,
      'Invalid treasury balance after minting'
    );
  });
});
