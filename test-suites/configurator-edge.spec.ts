import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { ProtocolErrors } from '../helpers/types';
import {
  MAX_BORROW_CAP,
  MAX_UNBACKED_MINT_CAP,
  MAX_UINT_AMOUNT,
  MAX_SUPPLY_CAP,
  ZERO_ADDRESS,
} from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { impersonateAddress } from '../helpers/utilities/fork';
import { topUpNonPayableWithEther } from './helpers/utils/funds';
import { parseUnits } from 'ethers/lib/utils';

makeSuite('PoolConfigurator: Edge cases', (testEnv: TestEnv) => {
  const {
    INVALID_RESERVE_FACTOR,
    INVALID_RESERVE_PARAMS,
    INVALID_LIQ_BONUS,
    FLASHLOAN_PREMIUM_INVALID,
    RESERVE_LIQUIDITY_NOT_ZERO,
    INVALID_BORROW_CAP,
    INVALID_SUPPLY_CAP,
    INVALID_UNBACKED_MINT_CAP,
    EMODE_CATEGORY_RESERVED,
    INVALID_EMODE_CATEGORY_PARAMS,
    INVALID_EMODE_CATEGORY_ASSIGNMENT,
    BRIDGE_PROTOCOL_FEE_INVALID,
    ASSET_NOT_LISTED,
  } = ProtocolErrors;

  it('ReserveConfiguration setLiquidationBonus() threshold > MAX_VALID_LIQUIDATION_THRESHOLD', async () => {
    const { poolAdmin, rusd, configurator } = testEnv;
    await expect(
      configurator
        .connect(poolAdmin.signer)
        .configureReserveAsCollateral(rusd.address, 5, 10, 65535 + 1)
    ).to.be.revertedWith(INVALID_LIQ_BONUS);
  });

  it('PoolConfigurator setReserveFactor() reserveFactor > PERCENTAGE_FACTOR (revert expected)', async () => {
    const { rusd, configurator } = testEnv;
    const invalidReserveFactor = 20000;
    await expect(
      configurator.setReserveFactor(rusd.address, invalidReserveFactor)
    ).to.be.revertedWith(INVALID_RESERVE_FACTOR);
  });

  it('ReserveConfiguration setReserveFactor() reserveFactor > MAX_VALID_RESERVE_FACTOR', async () => {
    const { rusd, configurator } = testEnv;
    const invalidReserveFactor = 65536;
    await expect(
      configurator.setReserveFactor(rusd.address, invalidReserveFactor)
    ).to.be.revertedWith(INVALID_RESERVE_FACTOR);
  });

  it('PoolConfigurator configureReserveAsCollateral() ltv > liquidationThreshold', async () => {
    const { poolAdmin, rusd, configurator, helpersContract } = testEnv;

    const config = await helpersContract.getReserveConfigurationData(rusd.address);

    await expect(
      configurator
        .connect(poolAdmin.signer)
        .configureReserveAsCollateral(
          rusd.address,
          65535 + 1,
          config.liquidationThreshold,
          config.liquidationBonus
        )
    ).to.be.revertedWith(INVALID_RESERVE_PARAMS);
  });

  it('PoolConfigurator configureReserveAsCollateral() liquidationBonus < 10000', async () => {
    const { poolAdmin, rusd, configurator, helpersContract } = testEnv;

    const config = await helpersContract.getReserveConfigurationData(rusd.address);

    await expect(
      configurator
        .connect(poolAdmin.signer)
        .configureReserveAsCollateral(rusd.address, config.ltv, config.liquidationThreshold, 10000)
    ).to.be.revertedWith(INVALID_RESERVE_PARAMS);
  });

  it('PoolConfigurator configureReserveAsCollateral() liquidationThreshold.percentMul(liquidationBonus) > PercentageMath.PERCENTAGE_FACTOR', async () => {
    const { poolAdmin, rusd, configurator } = testEnv;

    await expect(
      configurator
        .connect(poolAdmin.signer)
        .configureReserveAsCollateral(rusd.address, 10001, 10001, 10001)
    ).to.be.revertedWith(INVALID_RESERVE_PARAMS);
  });

  it('PoolConfigurator configureReserveAsCollateral() liquidationThreshold == 0 && liquidationBonus > 0', async () => {
    const { poolAdmin, rusd, configurator } = testEnv;

    await expect(
      configurator.connect(poolAdmin.signer).configureReserveAsCollateral(rusd.address, 0, 0, 10500)
    ).to.be.revertedWith(INVALID_RESERVE_PARAMS);
  });

  it('Tries to bridge protocol fee > PERCENTAGE_FACTOR (revert expected)', async () => {
    const { configurator } = testEnv;
    const newProtocolFee = 10001;
    await expect(configurator.updateBridgeProtocolFee(newProtocolFee)).to.be.revertedWith(
      BRIDGE_PROTOCOL_FEE_INVALID
    );
  });

  it('Tries to update flashloan premium total > PERCENTAGE_FACTOR (revert expected)', async () => {
    const { configurator } = testEnv;

    const newPremiumTotal = 10001;
    await expect(configurator.updateFlashloanPremiumTotal(newPremiumTotal)).to.be.revertedWith(
      FLASHLOAN_PREMIUM_INVALID
    );
  });

  it('Tries to update flashloan premium to protocol > PERCENTAGE_FACTOR (revert expected)', async () => {
    const { configurator } = testEnv;

    const newPremiumToProtocol = 10001;
    await expect(
      configurator.updateFlashloanPremiumToProtocol(newPremiumToProtocol)
    ).to.be.revertedWith(FLASHLOAN_PREMIUM_INVALID);
  });

  it('Tries to update borrowCap > MAX_BORROW_CAP (revert expected)', async () => {
    const { configurator, weth } = testEnv;
    await expect(
      configurator.setBorrowCap(weth.address, BigNumber.from(MAX_BORROW_CAP).add(1))
    ).to.be.revertedWith(INVALID_BORROW_CAP);
  });

  it('Tries to update supplyCap > MAX_SUPPLY_CAP (revert expected)', async () => {
    const { configurator, weth } = testEnv;
    await expect(
      configurator.setSupplyCap(weth.address, BigNumber.from(MAX_SUPPLY_CAP).add(1))
    ).to.be.revertedWith(INVALID_SUPPLY_CAP);
  });

  it('Tries to update unbackedMintCap > MAX_UNBACKED_MINT_CAP (revert expected)', async () => {
    const { configurator, weth } = testEnv;
    await expect(
      configurator.setUnbackedMintCap(weth.address, BigNumber.from(MAX_UNBACKED_MINT_CAP).add(1))
    ).to.be.revertedWith(INVALID_UNBACKED_MINT_CAP);
  });

  it('Tries to set borrowCap of MAX_BORROW_CAP an unlisted asset', async () => {
    const { configurator, users } = testEnv;
    const newCap = 10;
    await expect(configurator.setBorrowCap(users[5].address, newCap)).to.be.revertedWith(
      ASSET_NOT_LISTED
    );
  });

  it('Tries to add a category with id 0 (revert expected)', async () => {
    const { configurator, poolAdmin } = testEnv;

    await expect(
      configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(0, '9800', '9800', '10100', ZERO_ADDRESS, 'INVALID_ID_CATEGORY')
    ).to.be.revertedWith(EMODE_CATEGORY_RESERVED);
  });

  it('Tries to add an eMode category with ltv > liquidation threshold (revert expected)', async () => {
    const { configurator, poolAdmin } = testEnv;

    const id = BigNumber.from('16');
    const ltv = BigNumber.from('9900');
    const lt = BigNumber.from('9800');
    const lb = BigNumber.from('10100');
    const oracle = ZERO_ADDRESS;
    const label = 'STABLECOINS';

    await expect(
      configurator.connect(poolAdmin.signer).setEModeCategory(id, ltv, lt, lb, oracle, label)
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Tries to add an eMode category with no liquidation bonus (revert expected)', async () => {
    const { configurator, poolAdmin } = testEnv;

    const id = BigNumber.from('16');
    const ltv = BigNumber.from('9800');
    const lt = BigNumber.from('9800');
    const lb = BigNumber.from('10000');
    const oracle = ZERO_ADDRESS;
    const label = 'STABLECOINS';

    await expect(
      configurator.connect(poolAdmin.signer).setEModeCategory(id, ltv, lt, lb, oracle, label)
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Tries to add an eMode category with too large liquidation bonus (revert expected)', async () => {
    const { configurator, poolAdmin } = testEnv;

    const id = BigNumber.from('16');
    const ltv = BigNumber.from('9800');
    const lt = BigNumber.from('9800');
    const lb = BigNumber.from('11000');
    const oracle = ZERO_ADDRESS;
    const label = 'STABLECOINS';

    await expect(
      configurator.connect(poolAdmin.signer).setEModeCategory(id, ltv, lt, lb, oracle, label)
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Tries to add an eMode category with liquidation threshold > 1 (revert expected)', async () => {
    const { configurator, poolAdmin } = testEnv;

    const id = BigNumber.from('16');
    const ltv = BigNumber.from('9800');
    const lt = BigNumber.from('10100');
    const lb = BigNumber.from('10100');
    const oracle = ZERO_ADDRESS;
    const label = 'STABLECOINS';

    await expect(
      configurator.connect(poolAdmin.signer).setEModeCategory(id, ltv, lt, lb, oracle, label)
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_PARAMS);
  });

  it('Tries to set RUSD eMode category to undefined category (revert expected)', async () => {
    const { configurator, poolAdmin, rusd } = testEnv;

    await expect(
      configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, '100')
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_ASSIGNMENT);
  });

  it('Tries to set RUSD eMode category to category with too low LT (revert expected)', async () => {
    const { configurator, helpersContract, poolAdmin, rusd } = testEnv;

    const { liquidationThreshold, ltv } = await helpersContract.getReserveConfigurationData(
      rusd.address
    );

    expect(
      await configurator
        .connect(poolAdmin.signer)
        .setEModeCategory(
          '100',
          ltv,
          liquidationThreshold.sub(1),
          '10100',
          ZERO_ADDRESS,
          'LT_TOO_LOW_FOR_RUSD'
        )
    );

    await expect(
      configurator.connect(poolAdmin.signer).setAssetEModeCategory(rusd.address, '100')
    ).to.be.revertedWith(INVALID_EMODE_CATEGORY_ASSIGNMENT);
  });

  it('Tries to disable the RUSD reserve with liquidity on it (revert expected)', async () => {
    const { rusd, pool, configurator } = testEnv;
    const userAddress = await pool.signer.getAddress();
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, '1000');

    // Top up user
    expect(await rusd['mint(uint256)'](amountRUSDtoDeposit));

    // Approve protocol to access depositor wallet
    expect(await rusd.approve(pool.address, MAX_UINT_AMOUNT));

    // User 1 deposits 1000 RUSD
    expect(await pool.deposit(rusd.address, amountRUSDtoDeposit, userAddress, '0'));

    await expect(
      configurator.setReserveActive(rusd.address, false),
      RESERVE_LIQUIDITY_NOT_ZERO
    ).to.be.revertedWith(RESERVE_LIQUIDITY_NOT_ZERO);
  });

  it('Tries to withdraw from an inactive reserve (revert expected)', async () => {
    const { rusd, pool, configurator, helpersContract } = testEnv;
    const amountRUSDtoDeposit = await convertToCurrencyDecimals(rusd.address, '1000');
    const userAddress = await pool.signer.getAddress();

    // Impersonate configurator
    const impConfig = await impersonateAddress(configurator.address);
    await topUpNonPayableWithEther(pool.signer, [configurator.address], parseUnits('10', 18));

    // Top up user
    expect(await rusd['mint(uint256)'](amountRUSDtoDeposit));

    // Approve protocol to access depositor wallet
    expect(await rusd.approve(pool.address, MAX_UINT_AMOUNT));

    // User 1 deposits 1000 RUSD
    expect(await pool.deposit(rusd.address, amountRUSDtoDeposit, userAddress, '0'));

    // get configuration
    const rusdConfiguration: BigNumber = (await pool.getConfiguration(rusd.address)).data;
    const activeMask = BigNumber.from(
      '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFF'
    );

    // Set new configuration with active turned off
    expect(
      await pool
        .connect(impConfig.signer)
        .setConfiguration(rusd.address, { data: rusdConfiguration.and(activeMask) })
    );

    const updatedConfiguration = await helpersContract.getReserveConfigurationData(rusd.address);
    expect(updatedConfiguration.isActive).to.false;

    await expect(pool.withdraw(rusd.address, amountRUSDtoDeposit, userAddress)).to.be.revertedWith(
      ProtocolErrors.RESERVE_INACTIVE
    );
  });
});
