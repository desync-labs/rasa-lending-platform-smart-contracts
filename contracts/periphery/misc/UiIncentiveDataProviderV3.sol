// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.10;

import {IERC20Detailed} from '../../dependencies/openzeppelin/contracts/IERC20Detailed.sol';
import {IPoolAddressesProvider} from '../../interfaces/IPoolAddressesProvider.sol';
import {IPool} from '../../interfaces/IPool.sol';
import {IncentivizedERC20} from '../../protocol/tokenization/base/IncentivizedERC20.sol';
import {UserConfiguration} from '../../protocol/libraries/configuration/UserConfiguration.sol';
import {DataTypes} from '../../protocol/libraries/types/DataTypes.sol';
import {IRewardsController} from '../rewards/interfaces/IRewardsController.sol';
import {IEACAggregatorProxy} from './interfaces/IEACAggregatorProxy.sol';
import {IUiIncentiveDataProviderV3} from './interfaces/IUiIncentiveDataProviderV3.sol';

contract UiIncentiveDataProviderV3 is IUiIncentiveDataProviderV3 {
  using UserConfiguration for DataTypes.UserConfigurationMap;

  function getFullReservesIncentiveData(
    IPoolAddressesProvider provider,
    address user
  )
    external
    view
    override
    returns (AggregatedReserveIncentiveData[] memory, UserReserveIncentiveData[] memory)
  {
    return (_getReservesIncentivesData(provider), _getUserReservesIncentivesData(provider, user));
  }

  function getReservesIncentivesData(
    IPoolAddressesProvider provider
  ) external view override returns (AggregatedReserveIncentiveData[] memory) {
    return _getReservesIncentivesData(provider);
  }

  function _getReservesIncentivesData(
    IPoolAddressesProvider provider
  ) private view returns (AggregatedReserveIncentiveData[] memory) {
    IPool pool = IPool(provider.getPool());
    address[] memory reserves = pool.getReservesList();
    AggregatedReserveIncentiveData[]
      memory reservesIncentiveData = new AggregatedReserveIncentiveData[](reserves.length);
    // Iterate through the reserves to get all the information from the (a/s/v) Tokens
    for (uint256 i = 0; i < reserves.length; i++) {
      AggregatedReserveIncentiveData memory reserveIncentiveData = reservesIncentiveData[i];
      reserveIncentiveData.underlyingAsset = reserves[i];

      DataTypes.ReserveData memory baseData = pool.getReserveData(reserves[i]);

      // Get RSTokens rewards information
      // TODO: check that this is deployed correctly on contract and remove casting
      IRewardsController RSTokenIncentiveController = IRewardsController(
        address(IncentivizedERC20(baseData.RSTokenAddress).getIncentivesController())
      );
      RewardInfo[] memory aRewardsInformation;
      if (address(RSTokenIncentiveController) != address(0)) {
        address[] memory RSTokenRewardAddresses = RSTokenIncentiveController.getRewardsByAsset(
          baseData.RSTokenAddress
        );

        aRewardsInformation = new RewardInfo[](RSTokenRewardAddresses.length);
        for (uint256 j = 0; j < RSTokenRewardAddresses.length; ++j) {
          RewardInfo memory rewardInformation;
          rewardInformation.rewardTokenAddress = RSTokenRewardAddresses[j];

          (
            rewardInformation.tokenIncentivesIndex,
            rewardInformation.emissionPerSecond,
            rewardInformation.incentivesLastUpdateTimestamp,
            rewardInformation.emissionEndTimestamp
          ) = RSTokenIncentiveController.getRewardsData(
            baseData.RSTokenAddress,
            rewardInformation.rewardTokenAddress
          );

          rewardInformation.precision = RSTokenIncentiveController.getAssetDecimals(
            baseData.RSTokenAddress
          );
          rewardInformation.rewardTokenDecimals = IERC20Detailed(
            rewardInformation.rewardTokenAddress
          ).decimals();
          rewardInformation.rewardTokenSymbol = IERC20Detailed(rewardInformation.rewardTokenAddress)
            .symbol();

          // Get price of reward token from Chainlink Proxy Oracle
          rewardInformation.rewardOracleAddress = RSTokenIncentiveController.getRewardOracle(
            rewardInformation.rewardTokenAddress
          );
          rewardInformation.priceFeedDecimals = IEACAggregatorProxy(
            rewardInformation.rewardOracleAddress
          ).decimals();
          rewardInformation.rewardPriceFeed = IEACAggregatorProxy(
            rewardInformation.rewardOracleAddress
          ).latestAnswer();

          aRewardsInformation[j] = rewardInformation;
        }
      }

      reserveIncentiveData.aIncentiveData = IncentiveData(
        baseData.RSTokenAddress,
        address(RSTokenIncentiveController),
        aRewardsInformation
      );

      // Get vTokens rewards information
      IRewardsController vTokenIncentiveController = IRewardsController(
        address(IncentivizedERC20(baseData.variableDebtTokenAddress).getIncentivesController())
      );
      RewardInfo[] memory vRewardsInformation;
      if (address(vTokenIncentiveController) != address(0)) {
        address[] memory vTokenRewardAddresses = vTokenIncentiveController.getRewardsByAsset(
          baseData.variableDebtTokenAddress
        );
        vRewardsInformation = new RewardInfo[](vTokenRewardAddresses.length);
        for (uint256 j = 0; j < vTokenRewardAddresses.length; ++j) {
          RewardInfo memory rewardInformation;
          rewardInformation.rewardTokenAddress = vTokenRewardAddresses[j];

          (
            rewardInformation.tokenIncentivesIndex,
            rewardInformation.emissionPerSecond,
            rewardInformation.incentivesLastUpdateTimestamp,
            rewardInformation.emissionEndTimestamp
          ) = vTokenIncentiveController.getRewardsData(
            baseData.variableDebtTokenAddress,
            rewardInformation.rewardTokenAddress
          );

          rewardInformation.precision = vTokenIncentiveController.getAssetDecimals(
            baseData.variableDebtTokenAddress
          );
          rewardInformation.rewardTokenDecimals = IERC20Detailed(
            rewardInformation.rewardTokenAddress
          ).decimals();
          rewardInformation.rewardTokenSymbol = IERC20Detailed(rewardInformation.rewardTokenAddress)
            .symbol();

          // Get price of reward token from Chainlink Proxy Oracle
          rewardInformation.rewardOracleAddress = vTokenIncentiveController.getRewardOracle(
            rewardInformation.rewardTokenAddress
          );
          rewardInformation.priceFeedDecimals = IEACAggregatorProxy(
            rewardInformation.rewardOracleAddress
          ).decimals();
          rewardInformation.rewardPriceFeed = IEACAggregatorProxy(
            rewardInformation.rewardOracleAddress
          ).latestAnswer();

          vRewardsInformation[j] = rewardInformation;
        }
      }

      reserveIncentiveData.vIncentiveData = IncentiveData(
        baseData.variableDebtTokenAddress,
        address(vTokenIncentiveController),
        vRewardsInformation
      );

      // Get sTokens rewards information
      IRewardsController sTokenIncentiveController = IRewardsController(
        address(IncentivizedERC20(baseData.stableDebtTokenAddress).getIncentivesController())
      );
      RewardInfo[] memory sRewardsInformation;
      if (address(sTokenIncentiveController) != address(0)) {
        address[] memory sTokenRewardAddresses = sTokenIncentiveController.getRewardsByAsset(
          baseData.stableDebtTokenAddress
        );
        sRewardsInformation = new RewardInfo[](sTokenRewardAddresses.length);
        for (uint256 j = 0; j < sTokenRewardAddresses.length; ++j) {
          RewardInfo memory rewardInformation;
          rewardInformation.rewardTokenAddress = sTokenRewardAddresses[j];

          (
            rewardInformation.tokenIncentivesIndex,
            rewardInformation.emissionPerSecond,
            rewardInformation.incentivesLastUpdateTimestamp,
            rewardInformation.emissionEndTimestamp
          ) = sTokenIncentiveController.getRewardsData(
            baseData.stableDebtTokenAddress,
            rewardInformation.rewardTokenAddress
          );

          rewardInformation.precision = sTokenIncentiveController.getAssetDecimals(
            baseData.stableDebtTokenAddress
          );
          rewardInformation.rewardTokenDecimals = IERC20Detailed(
            rewardInformation.rewardTokenAddress
          ).decimals();
          rewardInformation.rewardTokenSymbol = IERC20Detailed(rewardInformation.rewardTokenAddress)
            .symbol();

          // Get price of reward token from Chainlink Proxy Oracle
          rewardInformation.rewardOracleAddress = sTokenIncentiveController.getRewardOracle(
            rewardInformation.rewardTokenAddress
          );
          rewardInformation.priceFeedDecimals = IEACAggregatorProxy(
            rewardInformation.rewardOracleAddress
          ).decimals();
          rewardInformation.rewardPriceFeed = IEACAggregatorProxy(
            rewardInformation.rewardOracleAddress
          ).latestAnswer();

          sRewardsInformation[j] = rewardInformation;
        }
      }

      reserveIncentiveData.sIncentiveData = IncentiveData(
        baseData.stableDebtTokenAddress,
        address(sTokenIncentiveController),
        sRewardsInformation
      );
    }

    return (reservesIncentiveData);
  }

  function getUserReservesIncentivesData(
    IPoolAddressesProvider provider,
    address user
  ) external view override returns (UserReserveIncentiveData[] memory) {
    return _getUserReservesIncentivesData(provider, user);
  }

  function _getUserReservesIncentivesData(
    IPoolAddressesProvider provider,
    address user
  ) private view returns (UserReserveIncentiveData[] memory) {
    IPool pool = IPool(provider.getPool());
    address[] memory reserves = pool.getReservesList();

    UserReserveIncentiveData[] memory userReservesIncentivesData = new UserReserveIncentiveData[](
      user != address(0) ? reserves.length : 0
    );

    for (uint256 i = 0; i < reserves.length; i++) {
      DataTypes.ReserveData memory baseData = pool.getReserveData(reserves[i]);

      // user reserve data
      userReservesIncentivesData[i].underlyingAsset = reserves[i];

      IRewardsController RSTokenIncentiveController = IRewardsController(
        address(IncentivizedERC20(baseData.RSTokenAddress).getIncentivesController())
      );
      if (address(RSTokenIncentiveController) != address(0)) {
        // get all rewards information from the asset
        address[] memory RSTokenRewardAddresses = RSTokenIncentiveController.getRewardsByAsset(
          baseData.RSTokenAddress
        );
        UserRewardInfo[] memory aUserRewardsInformation = new UserRewardInfo[](
          RSTokenRewardAddresses.length
        );
        for (uint256 j = 0; j < RSTokenRewardAddresses.length; ++j) {
          UserRewardInfo memory userRewardInformation;
          userRewardInformation.rewardTokenAddress = RSTokenRewardAddresses[j];

          userRewardInformation.tokenIncentivesUserIndex = RSTokenIncentiveController
            .getUserAssetIndex(
              user,
              baseData.RSTokenAddress,
              userRewardInformation.rewardTokenAddress
            );

          userRewardInformation.userUnclaimedRewards = RSTokenIncentiveController
            .getUserAccruedRewards(user, userRewardInformation.rewardTokenAddress);
          userRewardInformation.rewardTokenDecimals = IERC20Detailed(
            userRewardInformation.rewardTokenAddress
          ).decimals();
          userRewardInformation.rewardTokenSymbol = IERC20Detailed(
            userRewardInformation.rewardTokenAddress
          ).symbol();

          // Get price of reward token from Chainlink Proxy Oracle
          userRewardInformation.rewardOracleAddress = RSTokenIncentiveController.getRewardOracle(
            userRewardInformation.rewardTokenAddress
          );
          userRewardInformation.priceFeedDecimals = IEACAggregatorProxy(
            userRewardInformation.rewardOracleAddress
          ).decimals();
          userRewardInformation.rewardPriceFeed = IEACAggregatorProxy(
            userRewardInformation.rewardOracleAddress
          ).latestAnswer();

          aUserRewardsInformation[j] = userRewardInformation;
        }

        userReservesIncentivesData[i].RSTokenIncentivesUserData = UserIncentiveData(
          baseData.RSTokenAddress,
          address(RSTokenIncentiveController),
          aUserRewardsInformation
        );
      }

      // variable debt token
      IRewardsController vTokenIncentiveController = IRewardsController(
        address(IncentivizedERC20(baseData.variableDebtTokenAddress).getIncentivesController())
      );
      if (address(vTokenIncentiveController) != address(0)) {
        // get all rewards information from the asset
        address[] memory vTokenRewardAddresses = vTokenIncentiveController.getRewardsByAsset(
          baseData.variableDebtTokenAddress
        );
        UserRewardInfo[] memory vUserRewardsInformation = new UserRewardInfo[](
          vTokenRewardAddresses.length
        );
        for (uint256 j = 0; j < vTokenRewardAddresses.length; ++j) {
          UserRewardInfo memory userRewardInformation;
          userRewardInformation.rewardTokenAddress = vTokenRewardAddresses[j];

          userRewardInformation.tokenIncentivesUserIndex = vTokenIncentiveController
            .getUserAssetIndex(
              user,
              baseData.variableDebtTokenAddress,
              userRewardInformation.rewardTokenAddress
            );

          userRewardInformation.userUnclaimedRewards = vTokenIncentiveController
            .getUserAccruedRewards(user, userRewardInformation.rewardTokenAddress);
          userRewardInformation.rewardTokenDecimals = IERC20Detailed(
            userRewardInformation.rewardTokenAddress
          ).decimals();
          userRewardInformation.rewardTokenSymbol = IERC20Detailed(
            userRewardInformation.rewardTokenAddress
          ).symbol();

          // Get price of reward token from Chainlink Proxy Oracle
          userRewardInformation.rewardOracleAddress = vTokenIncentiveController.getRewardOracle(
            userRewardInformation.rewardTokenAddress
          );
          userRewardInformation.priceFeedDecimals = IEACAggregatorProxy(
            userRewardInformation.rewardOracleAddress
          ).decimals();
          userRewardInformation.rewardPriceFeed = IEACAggregatorProxy(
            userRewardInformation.rewardOracleAddress
          ).latestAnswer();

          vUserRewardsInformation[j] = userRewardInformation;
        }

        userReservesIncentivesData[i].vTokenIncentivesUserData = UserIncentiveData(
          baseData.variableDebtTokenAddress,
          address(RSTokenIncentiveController),
          vUserRewardsInformation
        );
      }

      // stable debt token
      IRewardsController sTokenIncentiveController = IRewardsController(
        address(IncentivizedERC20(baseData.stableDebtTokenAddress).getIncentivesController())
      );
      if (address(sTokenIncentiveController) != address(0)) {
        // get all rewards information from the asset
        address[] memory sTokenRewardAddresses = sTokenIncentiveController.getRewardsByAsset(
          baseData.stableDebtTokenAddress
        );
        UserRewardInfo[] memory sUserRewardsInformation = new UserRewardInfo[](
          sTokenRewardAddresses.length
        );
        for (uint256 j = 0; j < sTokenRewardAddresses.length; ++j) {
          UserRewardInfo memory userRewardInformation;
          userRewardInformation.rewardTokenAddress = sTokenRewardAddresses[j];

          userRewardInformation.tokenIncentivesUserIndex = sTokenIncentiveController
            .getUserAssetIndex(
              user,
              baseData.stableDebtTokenAddress,
              userRewardInformation.rewardTokenAddress
            );

          userRewardInformation.userUnclaimedRewards = sTokenIncentiveController
            .getUserAccruedRewards(user, userRewardInformation.rewardTokenAddress);
          userRewardInformation.rewardTokenDecimals = IERC20Detailed(
            userRewardInformation.rewardTokenAddress
          ).decimals();
          userRewardInformation.rewardTokenSymbol = IERC20Detailed(
            userRewardInformation.rewardTokenAddress
          ).symbol();

          // Get price of reward token from Chainlink Proxy Oracle
          userRewardInformation.rewardOracleAddress = sTokenIncentiveController.getRewardOracle(
            userRewardInformation.rewardTokenAddress
          );
          userRewardInformation.priceFeedDecimals = IEACAggregatorProxy(
            userRewardInformation.rewardOracleAddress
          ).decimals();
          userRewardInformation.rewardPriceFeed = IEACAggregatorProxy(
            userRewardInformation.rewardOracleAddress
          ).latestAnswer();

          sUserRewardsInformation[j] = userRewardInformation;
        }

        userReservesIncentivesData[i].sTokenIncentivesUserData = UserIncentiveData(
          baseData.stableDebtTokenAddress,
          address(RSTokenIncentiveController),
          sUserRewardsInformation
        );
      }
    }

    return (userReservesIncentivesData);
  }
}
