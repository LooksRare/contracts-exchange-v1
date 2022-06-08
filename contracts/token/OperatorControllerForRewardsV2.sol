// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {FeeSharingSystem} from "./FeeSharingSystem.sol";
import {FeeSharingSetter} from "./FeeSharingSetter.sol";
import {TokenSplitter} from "./TokenSplitter.sol";

/**
 * @title OperatorControllerForRewardsV2
 * @notice It splits pending EARTH and updates trading rewards.
 */
contract OperatorControllerForRewardsV2 is Ownable {
    FeeSharingSystem public immutable feeSharingSystem;

    FeeSharingSetter public immutable feeSharingSetter;
    TokenSplitter public immutable tokenSplitter;

    address public immutable teamVesting;
    address public immutable treasuryVesting;
    address public immutable tradingRewardsDistributor;

    /**
     * @notice Constructor
     * @param _feeSharingSystem address of the fee sharing system contract
     * @param _feeSharingSetter address of the fee sharing setter contract
     * @param _tokenSplitter address of the token splitter contract
     * @param _teamVesting address of the team vesting contract
     * @param _treasuryVesting address of the treasury vesting contract
     * @param _tradingRewardsDistributor address of the trading rewards distributor contract
     */
    constructor(
        address _feeSharingSystem,
        address _feeSharingSetter,
        address _tokenSplitter,
        address _teamVesting,
        address _treasuryVesting,
        address _tradingRewardsDistributor
    ) {
        feeSharingSystem = FeeSharingSystem(_feeSharingSystem);
        feeSharingSetter = FeeSharingSetter(_feeSharingSetter);
        tokenSplitter = TokenSplitter(_tokenSplitter);
        teamVesting = _teamVesting;
        treasuryVesting = _treasuryVesting;
        tradingRewardsDistributor = _tradingRewardsDistributor;
    }

    /**
     * @notice Release EARTH tokens from the TokenSplitter and update fee-sharing rewards
     */
    function releaseTokensAndUpdateRewards() external onlyOwner {
        require(canRelease(), "Owner: Too early");

        try tokenSplitter.releaseTokens(teamVesting) {} catch {}
        try tokenSplitter.releaseTokens(treasuryVesting) {} catch {}
        try tokenSplitter.releaseTokens(tradingRewardsDistributor) {} catch {}

        feeSharingSetter.updateRewards();
    }

    /**
     * @notice It verifies that the lastUpdateBlock is greater than endBlock
     */
    function canRelease() public view returns (bool) {
        uint256 endBlock = feeSharingSystem.periodEndBlock();
        uint256 lastUpdateBlock = feeSharingSystem.lastUpdateBlock();
        return lastUpdateBlock == endBlock;
    }
}
