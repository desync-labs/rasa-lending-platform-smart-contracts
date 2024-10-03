import { expect } from 'chai';
import { utils } from 'ethers';
import { advanceTimeAndBlock } from '../helpers/utilities/tx';
import { MAX_UINT_AMOUNT, MAX_BORROW_CAP } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { TestEnv, makeSuite } from './helpers/make-suite';

makeSuite('PoolConfigurator: Borrow Cap', (testEnv: TestEnv) => {
  const { BORROW_CAP_EXCEEDED, INVALID_BORROW_CAP } = ProtocolErrors;

  before(async () => {
    const {
      weth,
      pool,
      rusd,
      eurs,
      users: [user1],
    } = testEnv;

    const mintedAmount = utils.parseEther('1000000000');
    // minting for main user
    expect(await rusd['mint(uint256)'](mintedAmount));
    expect(await weth['mint(uint256)'](mintedAmount));
    expect(await eurs['mint(uint256)'](mintedAmount));

    // minting for lp user
    expect(await rusd.connect(user1.signer)['mint(uint256)'](mintedAmount));
    expect(await weth.connect(user1.signer)['mint(uint256)'](mintedAmount));
    expect(await eurs.connect(user1.signer)['mint(uint256)'](mintedAmount));

    expect(await rusd.approve(pool.address, MAX_UINT_AMOUNT));
    expect(await weth.approve(pool.address, MAX_UINT_AMOUNT));
    expect(await eurs.approve(pool.address, MAX_UINT_AMOUNT));
    expect(await rusd.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
    expect(await eurs.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));
  });

  it('Reserves should initially have borrow cap disabled (borrowCap = 0)', async () => {
    const { rusd, eurs, helpersContract } = testEnv;

    const { borrowCap: eursBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursBorrowCap).to.be.equal('0');
    expect(rusdBorrowCap).to.be.equal('0');
  });

  it('Borrows 10 stable RUSD, 10 variable EURS', async () => {
    const {
      weth,
      pool,
      rusd,
      eurs,
      deployer,
      users: [user1],
    } = testEnv;

    const suppliedAmount = '1000';
    const borrowedAmount = '10';

    // Deposit collateral
    expect(
      await pool.deposit(
        weth.address,
        await convertToCurrencyDecimals(weth.address, suppliedAmount),
        deployer.address,
        0
      )
    );
    // User 1 deposit more RUSD and EURS to be able to borrow
    expect(
      await pool
        .connect(user1.signer)
        .deposit(
          rusd.address,
          await convertToCurrencyDecimals(rusd.address, suppliedAmount),
          user1.address,
          0
        )
    );

    expect(
      await pool
        .connect(user1.signer)
        .deposit(
          eurs.address,
          await convertToCurrencyDecimals(rusd.address, suppliedAmount),
          user1.address,
          0
        )
    );

    // Borrow
    expect(
      await pool.borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    );

    expect(
      await pool.borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, borrowedAmount),
        1,
        0,
        deployer.address
      )
    );
  });

  it('Sets the borrow cap for RUSD and EURS to 10 Units', async () => {
    const { configurator, rusd, eurs, helpersContract } = testEnv;

    const { borrowCap: eursOldBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdOldBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = 10;
    await expect(configurator.setBorrowCap(eurs.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(eurs.address, rusdOldBorrowCap, newCap);
    await expect(configurator.setBorrowCap(rusd.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(rusd.address, eursOldBorrowCap, newCap);

    const { borrowCap: eursBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursBorrowCap).to.be.equal(newCap);
    expect(rusdBorrowCap).to.be.equal(newCap);
  });

  it('Tries to borrow any RUSD or EURS, stable or variable, (> BORROW_CAP) (revert expected)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;
    const borrowedAmount = '10';

    await expect(
      pool.borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    ).to.be.revertedWith(BORROW_CAP_EXCEEDED);

    await expect(
      pool.borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    ).to.be.revertedWith(BORROW_CAP_EXCEEDED);
  });

  it('Tries to set the borrow cap for EURS and RUSD to > MAX_BORROW_CAP (revert expected)', async () => {
    const { configurator, eurs, rusd } = testEnv;
    const newCap = Number(MAX_BORROW_CAP) + 1;

    await expect(configurator.setBorrowCap(eurs.address, newCap)).to.be.revertedWith(
      INVALID_BORROW_CAP
    );
    await expect(configurator.setBorrowCap(rusd.address, newCap)).to.be.revertedWith(
      INVALID_BORROW_CAP
    );
  });

  it('Sets the borrow cap for RUSD and EURS to 120 Units', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;
    const newCap = '120';

    const { borrowCap: eursOldBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdOldBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    await expect(configurator.setBorrowCap(eurs.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(eurs.address, eursOldBorrowCap, newCap);
    await expect(configurator.setBorrowCap(rusd.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(rusd.address, rusdOldBorrowCap, newCap);

    const { borrowCap: eursBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursBorrowCap).to.be.equal(newCap);
    expect(rusdBorrowCap).to.be.equal(newCap);
  });

  it('Borrows 10 stable RUSD and 10 variable EURS', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const borrowedAmount = '10';
    expect(
      await pool.borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    );

    expect(
      await pool.borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, borrowedAmount),
        1,
        0,
        deployer.address
      )
    );
  });

  it('Sets the borrow cap for WETH to 2 Units', async () => {
    const { configurator, weth, helpersContract } = testEnv;

    const { borrowCap: wethOldBorrowCap } = await helpersContract.getReserveCaps(weth.address);

    const newCap = 2;
    await expect(configurator.setBorrowCap(weth.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(weth.address, wethOldBorrowCap, newCap);

    const wethBorrowCap = (await helpersContract.getReserveCaps(weth.address)).borrowCap;

    expect(wethBorrowCap).to.be.equal(newCap);
  });

  it('Borrows 2 variable WETH (= BORROW_CAP)', async () => {
    const { weth, pool, deployer, helpersContract } = testEnv;

    const borrowedAmount = '2';

    await pool.borrow(
      weth.address,
      await convertToCurrencyDecimals(weth.address, borrowedAmount),
      RateMode.Variable,
      0,
      deployer.address
    );
  });

  it('Time flies and ETH debt amount goes above the limit due to accrued interests', async () => {
    const { weth, helpersContract } = testEnv;

    // Advance blocks
    await advanceTimeAndBlock(3600);

    const wethData = await helpersContract.getReserveData(weth.address);
    const totalDebt = wethData.totalVariableDebt.add(wethData.totalStableDebt);
    const wethCaps = await helpersContract.getReserveCaps(weth.address);

    expect(totalDebt).gt(wethCaps.borrowCap);
  });

  it('Tries to borrow any variable ETH (> BORROW_CAP) (revert expected)', async () => {
    const { weth, pool, deployer } = testEnv;

    const borrowedAmount = '1';
    await expect(
      pool.borrow(
        weth.address,
        await convertToCurrencyDecimals(weth.address, borrowedAmount),
        RateMode.Variable,
        0,
        deployer.address
      )
    ).to.be.revertedWith(BORROW_CAP_EXCEEDED);
  });

  it('Borrows 99 variable RUSD and 99 stable EURS (< BORROW_CAP)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const borrowedAmount = '99';
    expect(
      await pool.borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    );

    expect(
      await pool.borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, borrowedAmount),
        1,
        0,
        deployer.address
      )
    );
  });

  it('Raises the borrow cap for EURS and RUSD to 1000 Units', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;

    const { borrowCap: eursOldBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdOldBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = '1000';
    await expect(configurator.setBorrowCap(eurs.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(eurs.address, eursOldBorrowCap, newCap);
    await expect(configurator.setBorrowCap(rusd.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(rusd.address, rusdOldBorrowCap, newCap);

    const { borrowCap: eursBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursBorrowCap).to.be.equal(newCap);
    expect(rusdBorrowCap).to.be.equal(newCap);
  });

  it('Borrows 100 variable RUSD and 100 stable EURS (< BORROW_CAP)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const borrowedAmount = '100';
    expect(
      await pool.borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, borrowedAmount),
        1,
        0,
        deployer.address
      )
    );

    expect(
      await pool.borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    );
  });

  it('Lowers the borrow cap for EURS and RUSD to 200 Units', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;

    const { borrowCap: eursOldBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdOldBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = '200';
    await expect(configurator.setBorrowCap(eurs.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(eurs.address, eursOldBorrowCap, newCap);
    await expect(configurator.setBorrowCap(rusd.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(rusd.address, rusdOldBorrowCap, newCap);

    const { borrowCap: eursBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursBorrowCap).to.be.equal(newCap);
    expect(rusdBorrowCap).to.be.equal(newCap);
  });

  it('Tries to borrows 100 variable RUSD and 100 stable EURS (> BORROW_CAP) (revert expected)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const borrowedAmount = '100';
    await expect(
      pool.borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, borrowedAmount),
        1,
        0,
        deployer.address
      )
    ).to.be.revertedWith(BORROW_CAP_EXCEEDED);

    await expect(
      pool.borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    ).to.be.revertedWith(BORROW_CAP_EXCEEDED);
  });

  it('Raises the borrow cap for EURS and RUSD to MAX_BORROW_CAP', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;

    const { borrowCap: eursOldBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdOldBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = MAX_BORROW_CAP;
    await expect(configurator.setBorrowCap(eurs.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(eurs.address, eursOldBorrowCap, newCap);
    await expect(configurator.setBorrowCap(rusd.address, newCap))
      .to.emit(configurator, 'BorrowCapChanged')
      .withArgs(rusd.address, rusdOldBorrowCap, newCap);

    const { borrowCap: eursBorrowCap } = await helpersContract.getReserveCaps(eurs.address);
    const { borrowCap: rusdBorrowCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursBorrowCap).to.be.equal(newCap);
    expect(rusdBorrowCap).to.be.equal(newCap);
  });

  it('Borrows 100 variable RUSD and 100 stable EURS (< BORROW_CAP)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const borrowedAmount = '100';
    expect(
      await pool.borrow(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, borrowedAmount),
        1,
        0,
        deployer.address
      )
    );
    expect(
      await pool.borrow(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, borrowedAmount),
        2,
        0,
        deployer.address
      )
    );
  });
});
