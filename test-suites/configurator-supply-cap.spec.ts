import { expect } from 'chai';
import { utils } from 'ethers';
import { MAX_UINT_AMOUNT, MAX_SUPPLY_CAP } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors } from '../helpers/types';
import { TestEnv, makeSuite } from './helpers/make-suite';
import { advanceTimeAndBlock } from '../helpers/utilities/tx';

makeSuite('PoolConfigurator: Supply Cap', (testEnv: TestEnv) => {
  const { SUPPLY_CAP_EXCEEDED, INVALID_SUPPLY_CAP } = ProtocolErrors;

  before(async () => {
    const { weth, pool, rusd, eurs } = testEnv;

    const mintedAmount = utils.parseEther('1000000000');
    await rusd['mint(uint256)'](mintedAmount);
    await weth['mint(uint256)'](mintedAmount);
    await eurs['mint(uint256)'](mintedAmount);

    await rusd.approve(pool.address, MAX_UINT_AMOUNT);
    await weth.approve(pool.address, MAX_UINT_AMOUNT);
    await eurs.approve(pool.address, MAX_UINT_AMOUNT);
  });

  it('Reserves should initially have supply cap disabled (supplyCap = 0)', async () => {
    const { rusd, eurs, helpersContract } = testEnv;

    let eursSupplyCap = (await helpersContract.getReserveCaps(eurs.address)).supplyCap;
    let rusdSupplyCap = (await helpersContract.getReserveCaps(rusd.address)).supplyCap;

    expect(eursSupplyCap).to.be.equal('0');
    expect(rusdSupplyCap).to.be.equal('0');
  });

  it('Supply 1000 RUSD, 1000 EURS and 1000 WETH', async () => {
    const { weth, pool, rusd, eurs, deployer } = testEnv;

    const suppliedAmount = '1000';

    await pool.deposit(
      eurs.address,
      await convertToCurrencyDecimals(eurs.address, suppliedAmount),
      deployer.address,
      0
    );

    await pool.deposit(
      rusd.address,
      await convertToCurrencyDecimals(rusd.address, suppliedAmount),
      deployer.address,
      0
    );
    await pool.deposit(
      weth.address,
      await convertToCurrencyDecimals(weth.address, suppliedAmount),
      deployer.address,
      0
    );
  });

  it('Sets the supply cap for RUSD and EURS to 1000 Unit, leaving 0 Units to reach the limit', async () => {
    const { configurator, rusd, eurs, helpersContract } = testEnv;

    const { supplyCap: oldEursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: oldRUSDSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = '1000';

    await expect(configurator.setSupplyCap(eurs.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(eurs.address, oldEursSupplyCap, newCap);
    await expect(configurator.setSupplyCap(rusd.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(rusd.address, oldRUSDSupplyCap, newCap);

    const { supplyCap: eursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: rusdSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursSupplyCap).to.be.equal(newCap);
    expect(rusdSupplyCap).to.be.equal(newCap);
  });

  it('Tries to supply any RUSD or EURS (> SUPPLY_CAP) (revert expected)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;
    const suppliedAmount = '10';

    await expect(
      pool.deposit(eurs.address, suppliedAmount, deployer.address, 0)
    ).to.be.revertedWith(SUPPLY_CAP_EXCEEDED);

    await expect(
      pool.deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, suppliedAmount),
        deployer.address,
        0
      )
    ).to.be.revertedWith(SUPPLY_CAP_EXCEEDED);
  });

  it('Tries to set the supply cap for EURS and RUSD to > MAX_SUPPLY_CAP (revert expected)', async () => {
    const { configurator, eurs, rusd } = testEnv;
    const newCap = Number(MAX_SUPPLY_CAP) + 1;

    await expect(configurator.setSupplyCap(eurs.address, newCap)).to.be.revertedWith(
      INVALID_SUPPLY_CAP
    );
    await expect(configurator.setSupplyCap(rusd.address, newCap)).to.be.revertedWith(
      INVALID_SUPPLY_CAP
    );
  });

  it('Sets the supply cap for eurs and RUSD to 1110 Units, leaving 110 Units to reach the limit', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;

    const { supplyCap: oldEursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: oldRUSDSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = '1110';
    await expect(configurator.setSupplyCap(eurs.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(eurs.address, oldEursSupplyCap, newCap);
    await expect(configurator.setSupplyCap(rusd.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(rusd.address, oldRUSDSupplyCap, newCap);

    const { supplyCap: eursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: rusdSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursSupplyCap).to.be.equal(newCap);
    expect(rusdSupplyCap).to.be.equal(newCap);
  });

  it('Supply 10 RUSD and 10 EURS, leaving 100 Units to reach the limit', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const suppliedAmount = '10';
    await pool.deposit(
      eurs.address,
      await convertToCurrencyDecimals(eurs.address, suppliedAmount),
      deployer.address,
      0
    );

    await pool.deposit(
      rusd.address,
      await convertToCurrencyDecimals(rusd.address, suppliedAmount),
      deployer.address,
      0
    );
  });

  it('Tries to supply 101 RUSD and 101 EURS (> SUPPLY_CAP) 1 unit above the limit (revert expected)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const suppliedAmount = '101';

    await expect(
      pool.deposit(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, suppliedAmount),
        deployer.address,
        0
      )
    ).to.be.revertedWith(SUPPLY_CAP_EXCEEDED);

    await expect(
      pool.deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, suppliedAmount),
        deployer.address,
        0
      )
    ).to.be.revertedWith(SUPPLY_CAP_EXCEEDED);
  });

  it('Supply 99 RUSD and 99 EURS (< SUPPLY_CAP), leaving 1 Units to reach the limit', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const suppliedAmount = '99';
    await pool.deposit(
      eurs.address,
      await convertToCurrencyDecimals(eurs.address, suppliedAmount),
      deployer.address,
      0
    );

    await pool.deposit(
      rusd.address,
      await convertToCurrencyDecimals(rusd.address, suppliedAmount),
      deployer.address,
      0
    );
  });

  it('Supply 1 RUSD and 1 EURS (= SUPPLY_CAP), reaching the limit', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const suppliedAmount = '1';
    await pool.deposit(
      eurs.address,
      await convertToCurrencyDecimals(eurs.address, suppliedAmount),
      deployer.address,
      0
    );

    await pool.deposit(
      rusd.address,
      await convertToCurrencyDecimals(rusd.address, suppliedAmount),
      deployer.address,
      0
    );
  });

  it('Time flies and RUSD and EURS supply amount goes above the limit due to accrued interests', async () => {
    const { eurs, pool, rusd, deployer, helpersContract } = testEnv;

    // Advance blocks
    await advanceTimeAndBlock(3600);

    const rusdData = await helpersContract.getReserveData(rusd.address);
    const rusdCaps = await helpersContract.getReserveCaps(rusd.address);
    const eursData = await helpersContract.getReserveData(eurs.address);
    const eursCaps = await helpersContract.getReserveCaps(eurs.address);

    expect(rusdData.totalRSToken).gt(rusdCaps.supplyCap);
    expect(eursData.totalRSToken).gt(eursCaps.supplyCap);
  });

  it('Raises the supply cap for EURS and RUSD to 2000 Units, leaving 800 Units to reach the limit', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;

    const { supplyCap: oldEursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: oldRUSDSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = '2000';
    await expect(configurator.setSupplyCap(eurs.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(eurs.address, oldEursSupplyCap, newCap);
    await expect(configurator.setSupplyCap(rusd.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(rusd.address, oldRUSDSupplyCap, newCap);

    const { supplyCap: eursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: rusdSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursSupplyCap).to.be.equal(newCap);
    expect(rusdSupplyCap).to.be.equal(newCap);
  });

  it('Supply 100 RUSD and 100 EURS, leaving 700 Units to reach the limit', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const suppliedAmount = '100';
    await pool.deposit(
      eurs.address,
      await convertToCurrencyDecimals(eurs.address, suppliedAmount),
      deployer.address,
      0
    );

    await pool.deposit(
      rusd.address,
      await convertToCurrencyDecimals(rusd.address, suppliedAmount),
      deployer.address,
      0
    );
  });

  it('Lowers the supply cap for EURS and RUSD to 1200 Units (suppliedAmount > supplyCap)', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;

    const { supplyCap: oldEursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: oldRUSDSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = '1200';
    await expect(configurator.setSupplyCap(eurs.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(eurs.address, oldEursSupplyCap, newCap);
    await expect(configurator.setSupplyCap(rusd.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(rusd.address, oldRUSDSupplyCap, newCap);

    const { supplyCap: eursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: rusdSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursSupplyCap).to.be.equal(newCap);
    expect(rusdSupplyCap).to.be.equal(newCap);
  });

  it('Tries to supply 100 RUSD and 100 EURS (> SUPPLY_CAP) (revert expected)', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const suppliedAmount = '100';

    await expect(
      pool.deposit(
        eurs.address,
        await convertToCurrencyDecimals(eurs.address, suppliedAmount),
        deployer.address,
        0
      )
    ).to.be.revertedWith(SUPPLY_CAP_EXCEEDED);

    await expect(
      pool.deposit(
        rusd.address,
        await convertToCurrencyDecimals(rusd.address, suppliedAmount),
        deployer.address,
        0
      )
    ).to.be.revertedWith(SUPPLY_CAP_EXCEEDED);
  });

  it('Raises the supply cap for EURS and RUSD to MAX_SUPPLY_CAP', async () => {
    const { configurator, eurs, rusd, helpersContract } = testEnv;

    const { supplyCap: oldEursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: oldRUSDSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    const newCap = MAX_SUPPLY_CAP;
    await expect(configurator.setSupplyCap(eurs.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(eurs.address, oldEursSupplyCap, newCap);
    await expect(configurator.setSupplyCap(rusd.address, newCap))
      .to.emit(configurator, 'SupplyCapChanged')
      .withArgs(rusd.address, oldRUSDSupplyCap, newCap);

    const { supplyCap: eursSupplyCap } = await helpersContract.getReserveCaps(eurs.address);
    const { supplyCap: rusdSupplyCap } = await helpersContract.getReserveCaps(rusd.address);

    expect(eursSupplyCap).to.be.equal(newCap);
    expect(rusdSupplyCap).to.be.equal(newCap);
  });

  it('Supply 100 RUSD and 100 EURS', async () => {
    const { eurs, pool, rusd, deployer } = testEnv;

    const suppliedAmount = '100';
    await pool.deposit(
      eurs.address,
      await convertToCurrencyDecimals(eurs.address, suppliedAmount),
      deployer.address,
      0
    );

    await pool.deposit(
      rusd.address,
      await convertToCurrencyDecimals(rusd.address, suppliedAmount),
      deployer.address,
      0
    );
  });
});
