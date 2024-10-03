// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IRASAIncentivesController} from './IRASAIncentivesController.sol';
import {IPool} from './IPool.sol';

/**
 * @title IInitializableRSToken
 * @notice Interface for the initialize function on RSToken
 */
interface IInitializableRSToken {
  /**
   * @dev Emitted when an RSToken is initialized
   * @param underlyingAsset The address of the underlying asset
   * @param pool The address of the associated pool
   * @param treasury The address of the treasury
   * @param incentivesController The address of the incentives controller for this RSToken
   * @param RSTokenDecimals The decimals of the underlying
   * @param RSTokenName The name of the RSToken
   * @param RSTokenSymbol The symbol of the RSToken
   * @param params A set of encoded parameters for additional initialization
   */
  event Initialized(
    address indexed underlyingAsset,
    address indexed pool,
    address treasury,
    address incentivesController,
    uint8 RSTokenDecimals,
    string RSTokenName,
    string RSTokenSymbol,
    bytes params
  );

  /**
   * @notice Initializes the RSToken
   * @param pool The pool contract that is initializing this contract
   * @param treasury The address of the RASA treasury, receiving the fees on this RSToken
   * @param underlyingAsset The address of the underlying asset of this RSToken (E.g. WETH for RSWETH)
   * @param incentivesController The smart contract managing potential incentives distribution
   * @param RSTokenDecimals The decimals of the RSToken, same as the underlying asset's
   * @param RSTokenName The name of the RSToken
   * @param RSTokenSymbol The symbol of the RSToken
   * @param params A set of encoded parameters for additional initialization
   */
  function initialize(
    IPool pool,
    address treasury,
    address underlyingAsset,
    IRASAIncentivesController incentivesController,
    uint8 RSTokenDecimals,
    string calldata RSTokenName,
    string calldata RSTokenSymbol,
    bytes calldata params
  ) external;
}
