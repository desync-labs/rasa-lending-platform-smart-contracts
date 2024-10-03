import { expect } from 'chai';
import { utils } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { TestEnv, makeSuite } from './helpers/make-suite';

makeSuite('PoolConfigurator: Liquidation Protocol Fee', (testEnv: TestEnv) => {
  const { INVALID_LIQUIDATION_PROTOCOL_FEE } = ProtocolErrors;

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

  it('Reserves should initially have protocol liquidation fee set to 0', async () => {
    const { rusd, eurs, helpersContract } = testEnv;

    const eursLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      eurs.address
    );
    const rusdLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(rusd.address);

    expect(eursLiquidationProtocolFee).to.be.equal('0');
    expect(rusdLiquidationProtocolFee).to.be.equal('0');
  });

  it('Sets the protocol liquidation fee to 1000 (10.00%)', async () => {
    const { configurator, rusd, eurs, helpersContract } = testEnv;

    const oldEursLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      eurs.address
    );
    const oldRUSDLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      rusd.address
    );

    const liquidationProtocolFee = 1000;

    await expect(configurator.setLiquidationProtocolFee(eurs.address, liquidationProtocolFee))
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(eurs.address, oldEursLiquidationProtocolFee, liquidationProtocolFee);
    await expect(configurator.setLiquidationProtocolFee(rusd.address, liquidationProtocolFee))
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(rusd.address, oldRUSDLiquidationProtocolFee, liquidationProtocolFee);

    const eursLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      eurs.address
    );
    const rusdLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(rusd.address);

    expect(eursLiquidationProtocolFee).to.be.equal(liquidationProtocolFee);
    expect(rusdLiquidationProtocolFee).to.be.equal(liquidationProtocolFee);
  });

  it('Sets the protocol liquidation fee to 10000 (100.00%) equal to PERCENTAGE_FACTOR', async () => {
    const { configurator, rusd, eurs, helpersContract } = testEnv;

    const oldEursLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      eurs.address
    );
    const oldRUSDLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      rusd.address
    );

    const liquidationProtocolFee = 10000;

    await expect(configurator.setLiquidationProtocolFee(eurs.address, liquidationProtocolFee))
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(eurs.address, oldEursLiquidationProtocolFee, liquidationProtocolFee);
    await expect(configurator.setLiquidationProtocolFee(rusd.address, liquidationProtocolFee))
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(rusd.address, oldRUSDLiquidationProtocolFee, liquidationProtocolFee);

    const eursLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      eurs.address
    );
    const rusdLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(rusd.address);

    expect(eursLiquidationProtocolFee).to.be.equal(liquidationProtocolFee);
    expect(rusdLiquidationProtocolFee).to.be.equal(liquidationProtocolFee);
  });

  it('Tries to set the protocol liquidation fee to 10001 (100.01%) > PERCENTAGE_FACTOR (revert expected)', async () => {
    const { configurator, rusd, eurs } = testEnv;

    const liquidationProtocolFee = 10001;

    expect(
      configurator.setLiquidationProtocolFee(eurs.address, liquidationProtocolFee)
    ).to.be.revertedWith(INVALID_LIQUIDATION_PROTOCOL_FEE);
    expect(
      configurator.setLiquidationProtocolFee(rusd.address, liquidationProtocolFee)
    ).to.be.revertedWith(INVALID_LIQUIDATION_PROTOCOL_FEE);
  });
});
