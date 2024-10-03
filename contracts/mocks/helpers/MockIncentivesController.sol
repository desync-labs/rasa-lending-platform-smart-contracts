// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import {IRASAIncentivesController} from '../../interfaces/IRASAIncentivesController.sol';

contract MockIncentivesController is IRASAIncentivesController {
  function handleAction(address, uint256, uint256) external override {}
}
