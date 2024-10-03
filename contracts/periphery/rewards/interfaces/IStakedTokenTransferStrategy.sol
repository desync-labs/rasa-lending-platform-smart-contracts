// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.10;

import {IStakedToken} from '../interfaces/IStakedToken.sol';
import {ITransferStrategyBase} from './ITransferStrategyBase.sol';

/**
 * @title IStakedTokenTransferStrategy
 **/
interface IStakedTokenTransferStrategy is ITransferStrategyBase {
  /**
   * @dev Perform a MAX_UINT approval to the Staked RASA contract.
   */
  function renewApproval() external;

  /**
   * @dev Drop approval to the Staked RASA contract in case of emergency.
   */
  function dropApproval() external;

  /**
   * @return Staked Token contract address
   */
  function getStakeContract() external view returns (address);

  /**
   * @return Underlying token address from the stake contract
   */
  function getUnderlyingToken() external view returns (address);
}
