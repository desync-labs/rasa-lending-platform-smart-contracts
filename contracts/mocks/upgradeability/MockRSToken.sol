// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import {RSToken} from '../../protocol/tokenization/RSToken.sol';
import {IPool} from '../../interfaces/IPool.sol';

contract MockRSToken is RSToken {
  constructor(IPool pool) RSToken(pool) {}

  function getRevision() internal pure override returns (uint256) {
    return 0x2;
  }
}
