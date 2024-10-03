import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { HARDHAT_CHAINID, MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import {
  buildDelegationWithSigParams,
  convertToCurrencyDecimals,
  getSignatureFromTypedData,
} from '../helpers/contracts-helpers';
import { timeLatest } from '../helpers/misc-utils';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { getTestWallets } from './helpers/utils/wallets';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ProtocolErrors } from '../helpers/types';
import { evmSnapshot, evmRevert } from '../helpers/utilities/tx';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('DebtToken: Permit Delegation', (testEnv: TestEnv) => {
  let snapId;

  beforeEach(async () => {
    snapId = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snapId);
  });

  let rusdMintedAmount: BigNumber;
  let wethMintedAmount: BigNumber;
  let testWallets;

  const MINT_AMOUNT = '1000';
  const EIP712_REVISION = '1';

  before(async () => {
    const {
      pool,
      weth,
      rusd,
      deployer: user1,
      users: [user2],
    } = testEnv;
    testWallets = getTestWallets();

    // Setup the pool
    rusdMintedAmount = await convertToCurrencyDecimals(rusd.address, MINT_AMOUNT);
    wethMintedAmount = await convertToCurrencyDecimals(weth.address, MINT_AMOUNT);

    expect(await rusd['mint(uint256)'](rusdMintedAmount));
    expect(await rusd.approve(pool.address, rusdMintedAmount));
    expect(await pool.deposit(rusd.address, rusdMintedAmount, user1.address, 0));
    expect(await weth.connect(user2.signer)['mint(uint256)'](wethMintedAmount));
    expect(await weth.connect(user2.signer).approve(pool.address, wethMintedAmount));
    expect(
      await pool.connect(user2.signer).deposit(weth.address, wethMintedAmount, user2.address, 0)
    );
  });

  it('Checks the domain separator', async () => {
    const { variableDebtRUSD, stableDebtRUSD } = testEnv;
    const variableSeparator = await variableDebtRUSD.DOMAIN_SEPARATOR();
    const stableSeparator = await stableDebtRUSD.DOMAIN_SEPARATOR();

    const variableDomain = {
      name: await variableDebtRUSD.name(),
      version: EIP712_REVISION,
      chainId: hre.network.config.chainId,
      verifyingContract: variableDebtRUSD.address,
    };
    const stableDomain = {
      name: await stableDebtRUSD.name(),
      version: EIP712_REVISION,
      chainId: hre.network.config.chainId,
      verifyingContract: stableDebtRUSD.address,
    };
    const variableDomainSeparator = utils._TypedDataEncoder.hashDomain(variableDomain);
    const stableDomainSeparator = utils._TypedDataEncoder.hashDomain(stableDomain);

    expect(variableSeparator).to.be.equal(
      variableDomainSeparator,
      'Invalid variable domain separator'
    );
    expect(stableSeparator).to.be.equal(stableDomainSeparator, 'Invalid stable domain separator');
  });

  it('User 3 borrows variable interest rusd on behalf of user 2 via permit', async () => {
    const {
      pool,
      variableDebtRUSD,
      rusd,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = MAX_UINT_AMOUNT;
    const nonce = (await variableDebtRUSD.nonces(user2.address)).toNumber();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      variableDebtRUSD.address,
      EIP712_REVISION,
      await variableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    expect(
      await variableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(user2.address, user3.address, permitAmount, expiration, v, r, s)
    );

    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal(permitAmount);

    await pool.connect(user3.signer).borrow(rusd.address, permitAmount, 2, 0, user2.address);
    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');
  });

  it('User 3 borrows stable interest rusd on behalf of user 2 via permit', async () => {
    const {
      pool,
      stableDebtRUSD,
      rusd,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = MAX_UINT_AMOUNT;
    const nonce = (await stableDebtRUSD.nonces(user2.address)).toNumber();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      stableDebtRUSD.address,
      EIP712_REVISION,
      await stableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    expect(
      await stableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(user2.address, user3.address, permitAmount, expiration, v, r, s)
    );

    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal(permitAmount);

    await pool
      .connect(user3.signer)
      .borrow(rusd.address, rusdMintedAmount.div(10), 1, 0, user2.address);

    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal(permitAmount.sub(rusdMintedAmount.div(10)));
  });

  it('Stable debt delegation with delegator == address(0)', async () => {
    const {
      stableDebtRUSD,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = MAX_UINT_AMOUNT;
    const nonce = (await stableDebtRUSD.nonces(user2.address)).toNumber();
    const EIP712_REVISION = await stableDebtRUSD.EIP712_REVISION();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      stableDebtRUSD.address,
      EIP712_REVISION,
      await stableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    await expect(
      stableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(ZERO_ADDRESS, user3.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(ProtocolErrors.ZERO_ADDRESS_NOT_VALID);

    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');
  });

  it('Stable debt delegation with block.timestamp > deadline', async () => {
    const {
      stableDebtRUSD,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = (await timeLatest()).sub(500).toString();
    const nonce = (await stableDebtRUSD.nonces(user2.address)).toNumber();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      stableDebtRUSD.address,
      EIP712_REVISION,
      await stableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    await expect(
      stableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(user2.address, user3.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(ProtocolErrors.INVALID_EXPIRATION);

    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');
  });

  it('Stable debt delegation with wrong delegator', async () => {
    const {
      stableDebtRUSD,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = MAX_UINT_AMOUNT;
    const nonce = (await stableDebtRUSD.nonces(user2.address)).toNumber();
    const EIP712_REVISION = await stableDebtRUSD.EIP712_REVISION();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      stableDebtRUSD.address,
      EIP712_REVISION,
      await stableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    await expect(
      stableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(user1.address, user3.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(ProtocolErrors.INVALID_SIGNATURE);

    expect(
      (await stableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');
  });

  it('Variable debt delegation with delegator == address(0)', async () => {
    const {
      variableDebtRUSD,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = MAX_UINT_AMOUNT;
    const nonce = (await variableDebtRUSD.nonces(user2.address)).toNumber();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      variableDebtRUSD.address,
      EIP712_REVISION,
      await variableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    await expect(
      variableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(ZERO_ADDRESS, user3.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(ProtocolErrors.ZERO_ADDRESS_NOT_VALID);

    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');
  });

  it('Variable debt delegation with block.timestamp > deadline', async () => {
    const {
      variableDebtRUSD,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = (await timeLatest()).sub(500).toString();
    const nonce = (await variableDebtRUSD.nonces(user2.address)).toNumber();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      variableDebtRUSD.address,
      EIP712_REVISION,
      await variableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    await expect(
      variableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(user2.address, user3.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(ProtocolErrors.INVALID_EXPIRATION);

    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');
  });

  it('Variable debt delegation with wrong delegator', async () => {
    const {
      variableDebtRUSD,
      deployer: user1,
      users: [user2, user3],
    } = testEnv;

    const chainId = hre.network.config.chainId || HARDHAT_CHAINID;
    const expiration = MAX_UINT_AMOUNT;
    const nonce = (await variableDebtRUSD.nonces(user2.address)).toNumber();
    const permitAmount = rusdMintedAmount.div(3);
    const msgParams = buildDelegationWithSigParams(
      chainId,
      variableDebtRUSD.address,
      EIP712_REVISION,
      await variableDebtRUSD.name(),
      user3.address,
      nonce,
      expiration,
      permitAmount.toString()
    );

    const user2PrivateKey = testWallets[1].secretKey;
    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');

    const { v, r, s } = getSignatureFromTypedData(user2PrivateKey, msgParams);

    await expect(
      variableDebtRUSD
        .connect(user1.signer)
        .delegationWithSig(user1.address, user3.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith(ProtocolErrors.INVALID_SIGNATURE);

    expect(
      (await variableDebtRUSD.borrowAllowance(user2.address, user3.address)).toString()
    ).to.be.equal('0');
  });
});
