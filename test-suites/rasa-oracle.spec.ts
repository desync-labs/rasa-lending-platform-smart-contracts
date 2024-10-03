import { MOCK_CHAINLINK_AGGREGATORS_PRICES } from '../helpers/constants';
import { expect } from 'chai';
import { oneEther, ONE_ADDRESS, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { MintableERC20, MockAggregator } from '../types';
import { deployMintableERC20, deployMockAggregator } from '../helpers/contract-deployments';
import { evmRevert, evmSnapshot } from '../helpers/utilities/tx';
import { makeSuite, TestEnv } from './helpers/make-suite';

makeSuite('RASAOracle', (testEnv: TestEnv) => {
  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snap);
  });

  let mockToken: MintableERC20;
  let mockAggregator: MockAggregator;
  let assetPrice: string;

  before(async () => {
    mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);
    assetPrice = MOCK_CHAINLINK_AGGREGATORS_PRICES.WETH;
    mockAggregator = await deployMockAggregator(assetPrice);
  });

  it('Owner set a new asset source', async () => {
    const { poolAdmin, rasaOracle } = testEnv;

    // Asset has no source
    expect(await rasaOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);
    const priorSourcePrice = await rasaOracle.getAssetPrice(mockToken.address);
    const priorSourcesPrices = (await rasaOracle.getAssetsPrices([mockToken.address])).map((x) =>
      x.toString()
    );

    expect(priorSourcePrice).to.equal('0');
    expect(priorSourcesPrices).to.eql(['0']);
    console.log('poolAdmin.signer' + await poolAdmin.signer.getAddress());
    // Add asset source
    await expect(
      rasaOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [mockAggregator.address])
    )
      .to.emit(rasaOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, mockAggregator.address);

    console.log('test');

    const sourcesPrices = await (
      await rasaOracle.getAssetsPrices([mockToken.address])
    ).map((x) => x.toString());
    console.log('test2');

    expect(await rasaOracle.getSourceOfAsset(mockToken.address)).to.be.eq(mockAggregator.address);
    console.log('test3');

    expect(await rasaOracle.getAssetPrice(mockToken.address)).to.be.eq(assetPrice);
    console.log('test4');

    expect(sourcesPrices).to.eql([assetPrice]);
    console.log('test5');

  });

  it('Owner update an existing asset source', async () => {
    const { poolAdmin, rasaOracle, rusd } = testEnv;

    // RUSD token has already a source
    const rusdSource = await rasaOracle.getSourceOfAsset(rusd.address);
    expect(rusdSource).to.be.not.eq(ZERO_ADDRESS);

    // Update RUSD source
    await expect(
      rasaOracle.connect(poolAdmin.signer).setAssetSources([rusd.address], [mockAggregator.address])
    )
      .to.emit(rasaOracle, 'AssetSourceUpdated')
      .withArgs(rusd.address, mockAggregator.address);

    expect(await rasaOracle.getSourceOfAsset(rusd.address)).to.be.eq(mockAggregator.address);
    expect(await rasaOracle.getAssetPrice(rusd.address)).to.be.eq(assetPrice);
  });

  it('Owner tries to set a new asset source with wrong input params (revert expected)', async () => {
    const { poolAdmin, rasaOracle } = testEnv;

    await expect(
      rasaOracle.connect(poolAdmin.signer).setAssetSources([mockToken.address], [])
    ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_PARAMS_LENGTH);
  });

  it('Get price of BASE_CURRENCY asset', async () => {
    const { rasaOracle } = testEnv;

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await rasaOracle.getAssetPrice(await rasaOracle.BASE_CURRENCY())).to.be.eq(
      await rasaOracle.BASE_CURRENCY_UNIT()
    );
  });

  it('A non-owner user tries to set a new asset source (revert expected)', async () => {
    const { users, rasaOracle } = testEnv;
    const user = users[0];

    const { CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN } = ProtocolErrors;

    await expect(
      rasaOracle.connect(user.signer).setAssetSources([mockToken.address], [mockAggregator.address])
    ).to.be.revertedWith(CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN);
  });

  it('Get price of BASE_CURRENCY asset with registered asset source for its address', async () => {
    const { poolAdmin, rasaOracle, weth } = testEnv;

    // Add asset source for BASE_CURRENCY address
    await expect(
      rasaOracle.connect(poolAdmin.signer).setAssetSources([weth.address], [mockAggregator.address])
    )
      .to.emit(rasaOracle, 'AssetSourceUpdated')
      .withArgs(weth.address, mockAggregator.address);

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await rasaOracle.getAssetPrice(weth.address)).to.be.eq(
      MOCK_CHAINLINK_AGGREGATORS_PRICES.WETH
    );
  });

  it('Get price of asset with no asset source', async () => {
    const { rasaOracle, oracle } = testEnv;
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await rasaOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Returns 0 price
    expect(await rasaOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Get price of asset with 0 price and no fallback price', async () => {
    const { poolAdmin, rasaOracle } = testEnv;
    const zeroPriceMockAgg = await deployMockAggregator('0');

    // Asset has no source
    expect(await rasaOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    await expect(
      rasaOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [zeroPriceMockAgg.address])
    )
      .to.emit(rasaOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, zeroPriceMockAgg.address);

    expect(await rasaOracle.getSourceOfAsset(mockToken.address)).to.be.eq(zeroPriceMockAgg.address);
    expect(await rasaOracle.getAssetPrice(mockToken.address)).to.be.eq(0);
  });

  it('Get price of asset with 0 price but non-zero fallback price', async () => {
    const { poolAdmin, rasaOracle, oracle } = testEnv;
    const zeroPriceMockAgg = await deployMockAggregator('0');
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await rasaOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    await expect(
      rasaOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [zeroPriceMockAgg.address])
    )
      .to.emit(rasaOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, zeroPriceMockAgg.address);

    expect(await rasaOracle.getSourceOfAsset(mockToken.address)).to.be.eq(zeroPriceMockAgg.address);
    expect(await rasaOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Owner update the FallbackOracle', async () => {
    const { poolAdmin, rasaOracle, oracle } = testEnv;

    expect(await rasaOracle.getFallbackOracle()).to.be.eq(oracle.address);

    // Update oracle source
    await expect(rasaOracle.connect(poolAdmin.signer).setFallbackOracle(ONE_ADDRESS))
      .to.emit(rasaOracle, 'FallbackOracleUpdated')
      .withArgs(ONE_ADDRESS);

    expect(await rasaOracle.getFallbackOracle()).to.be.eq(ONE_ADDRESS);
  });
});
