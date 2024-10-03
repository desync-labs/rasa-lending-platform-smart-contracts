// SPDX-License-Identifier: MIT
// RASA oracle Contracts
pragma solidity ^0.8.0;

interface AggregatorInterface {
     function getLatestAnswer() external view returns (uint256 value, uint64 timestamp);

     function getAnswer(uint256 roundId) external view returns (uint256 value, uint64 timestamp);

     function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, uint256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, uint256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
