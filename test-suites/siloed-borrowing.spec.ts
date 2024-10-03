const { expect } = require('chai');
import { utils } from 'ethers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { TestEnv, makeSuite } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import { evmSnapshot } from '../helpers/utilities/tx';

makeSuite('Siloed borrowing', (testEnv: TestEnv) => {
  const { SILOED_BORROWING_VIOLATION } = ProtocolErrors;

  let snapshot;

  before(async () => {
    snapshot = await evmSnapshot();
  });

  it('Configure RUSD as siloed borrowing asset', async () => {
    const { configurator, helpersContract, rusd } = testEnv;

    await configurator.setSiloedBorrowing(rusd.address, true);
    const siloed = await helpersContract.getSiloedBorrowing(rusd.address);

    expect(siloed).to.be.equal(true, 'Invalid siloed state for RUSD');
  });

  it('User 0 supplies RUSD, User 1 supplies ETH and EURS, borrows RUSD', async () => {
    const { users, pool, rusd, weth, eurs, variableDebtRUSD } = testEnv;

    const wethSupplyAmount = utils.parseEther('1');
    const rusdBorrowAmount = utils.parseEther('10');
    const rusdSupplyAmount = utils.parseEther('1000');
    const eursSupplyAmount = utils.parseUnits('1000', 6);

    await rusd.connect(users[0].signer)['mint(address,uint256)'](users[0].address, rusdSupplyAmount);
    await rusd.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(users[0].signer).supply(rusd.address, rusdSupplyAmount, users[0].address, '0');

    await eurs
      .connect(users[1].signer)
      ['mint(address,uint256)'](users[1].address, eursSupplyAmount);
    await eurs.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .supply(eurs.address, eursSupplyAmount, users[1].address, '0');

    await weth
      .connect(users[1].signer)
      ['mint(address,uint256)'](users[1].address, wethSupplyAmount);
    await weth.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .supply(weth.address, wethSupplyAmount, users[1].address, '0');
    await pool
      .connect(users[1].signer)
      .borrow(rusd.address, rusdBorrowAmount, RateMode.Variable, '0', users[1].address);

    const debtBalance = await variableDebtRUSD.balanceOf(users[1].address);

    expect(debtBalance).to.be.closeTo(rusdBorrowAmount, 2);
  });

  it('User 0 supplies EURS, User 1 tries to borrow EURS (revert expected)', async () => {
    const { users, pool, eurs } = testEnv;

    const eursBorrowAmount = utils.parseUnits('1', '6');
    const eursSupplyAmount = utils.parseUnits('1000', '6');

    await eurs
      .connect(users[0].signer)
      ['mint(address,uint256)'](users[0].address, eursSupplyAmount);
    await eurs.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[0].signer)
      .supply(eurs.address, eursSupplyAmount, users[0].address, '0');

    await expect(
      pool
        .connect(users[1].signer)
        .borrow(eurs.address, eursBorrowAmount, RateMode.Variable, '0', users[1].address)
    ).to.be.revertedWith(SILOED_BORROWING_VIOLATION);
  });

  it('User 1 repays RUSD, borrows EURS', async () => {
    const { users, pool, eurs, rusd } = testEnv;

    const eursBorrowAmount = utils.parseUnits('100', '6');
    const rusdMintAmount = utils.parseEther('1000');

    await rusd.connect(users[1].signer)['mint(address,uint256)'](users[1].address, rusdMintAmount);
    await rusd.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .repay(rusd.address, MAX_UINT_AMOUNT, RateMode.Variable, users[1].address);

    await pool
      .connect(users[1].signer)
      .borrow(eurs.address, eursBorrowAmount, RateMode.Variable, '0', users[1].address);
  });

  it('User 1 tries to borrow RUSD (revert expected)', async () => {
    const { users, pool, rusd } = testEnv;

    const rusdBorrowAmount = utils.parseEther('1');

    await expect(
      pool
        .connect(users[1].signer)
        .borrow(rusd.address, rusdBorrowAmount, RateMode.Variable, '0', users[1].address)
    ).to.be.revertedWith(SILOED_BORROWING_VIOLATION);
  });

  it('User 1 borrows ETH, tries to borrow RUSD (revert expected)', async () => {
    const { users, pool, rusd, weth } = testEnv;

    const wethBorrowAmount = utils.parseEther('0.01');
    const rusdBorrowAmount = utils.parseEther('1');

    await pool
      .connect(users[1].signer)
      .borrow(weth.address, wethBorrowAmount, RateMode.Variable, '0', users[1].address);

    await expect(
      pool
        .connect(users[1].signer)
        .borrow(rusd.address, rusdBorrowAmount, RateMode.Variable, '0', users[1].address)
    ).to.be.revertedWith(SILOED_BORROWING_VIOLATION);
  });

  it('User 1 Repays EURS and WETH debt, set EURS as siloed', async () => {
    const { users, pool, eurs, weth, configurator, helpersContract } = testEnv;

    const wethMintAmount = utils.parseEther('1');

    const eursMintAmount = utils.parseEther('1000');

    await eurs.connect(users[1].signer)['mint(address,uint256)'](users[1].address, eursMintAmount);
    await eurs.connect(users[1].signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(users[1].signer)
      .repay(eurs.address, MAX_UINT_AMOUNT, RateMode.Variable, users[1].address);

    await weth.connect(users[1].signer)['mint(address,uint256)'](users[1].address, wethMintAmount);
    await pool
      .connect(users[1].signer)
      .repay(weth.address, MAX_UINT_AMOUNT, RateMode.Variable, users[1].address);

    await configurator.setSiloedBorrowing(eurs.address, true);
    const siloed = await helpersContract.getSiloedBorrowing(eurs.address);

    expect(siloed).to.be.equal(true, 'Invalid siloed state for EURS');
  });

  it('User 1 borrows RUSD, tries to borrow EURS (revert expected)', async () => {
    const { users, pool, eurs, rusd } = testEnv;

    const rusdBorrowAmount = utils.parseEther('1');
    const eursBorrowAmount = utils.parseUnits('1', '6');

    await pool
      .connect(users[1].signer)
      .borrow(rusd.address, rusdBorrowAmount, RateMode.Variable, '0', users[1].address);

    await expect(
      pool
        .connect(users[1].signer)
        .borrow(eurs.address, eursBorrowAmount, RateMode.Variable, '0', users[1].address)
    ).to.be.revertedWith(SILOED_BORROWING_VIOLATION);
  });

  it('User 1 borrows more RUSD', async () => {
    const { users, pool, rusd, variableDebtRUSD } = testEnv;

    const rusdBorrowAmount = utils.parseEther('1');

    const debtBefore = await variableDebtRUSD.balanceOf(users[1].address);

    await pool
      .connect(users[1].signer)
      .borrow(rusd.address, rusdBorrowAmount, RateMode.Variable, '0', users[1].address);

    const debtAfter = await variableDebtRUSD.balanceOf(users[1].address);

    //large interval to account for interest generated
    expect(debtAfter).to.be.closeTo(debtBefore.add(rusdBorrowAmount), 10000000);
  });
});
