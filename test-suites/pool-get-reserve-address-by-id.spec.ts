import { expect } from 'chai';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { evmSnapshot, evmRevert } from '../helpers/utilities/tx';
import { ZERO_ADDRESS } from '../helpers/constants';

makeSuite('Pool: getReservesList', (testEnv: TestEnv) => {
  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snap);
  });

  it('User gets address of reserve by id', async () => {
    const { pool, eurs } = testEnv;

    const reserveData = await pool.getReserveData(eurs.address);

    const reserveAddress = await pool.getReserveAddressById(reserveData.id);

    await expect(reserveAddress).to.be.eq(eurs.address);
  });

  it('User calls `getReservesList` with a wrong id (id > reservesCount)', async () => {
    const { pool } = testEnv;

    // MAX_NUMBER_RESERVES is always greater than reservesCount
    const maxNumberOfReserves = await pool.MAX_NUMBER_RESERVES();
    const reserveAddress = await pool.getReserveAddressById(maxNumberOfReserves + 1);

    await expect(reserveAddress).to.be.eq(ZERO_ADDRESS);
  });
});
