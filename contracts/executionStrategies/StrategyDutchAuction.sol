// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OrderTypes} from "../libraries/OrderTypes.sol";
import {IExecutionStrategy} from "../interfaces/IExecutionStrategy.sol";

/**
 * @title StrategyDutchAuction
 * @notice Strategy to launch a Dutch Auction for a token where the price decreases linearly
 * until a specified timestamp and end price defined by the seller.
 */
contract StrategyDutchAuction is IExecutionStrategy, Ownable {
    uint256 public immutable PROTOCOL_FEE;

    // Minimum auction length in seconds
    uint256 public minimumAuctionLengthInSeconds;

    event NewMinimumAuctionLengthInSeconds(uint256 minimumAuctionLengthInSeconds);

    /**
     * @notice Constructor
     * @param _protocolFee protocol fee (200 --> 2%, 400 --> 4%)
     * @param _minimumAuctionLengthInSeconds minimum auction length in seconds
     */
    constructor(uint256 _protocolFee, uint256 _minimumAuctionLengthInSeconds) {
        require(_minimumAuctionLengthInSeconds >= 15 minutes, "Owner: Auction length must be > 15 min");

        PROTOCOL_FEE = _protocolFee;
        minimumAuctionLengthInSeconds = _minimumAuctionLengthInSeconds;
    }

    /**
     * @notice Check whether a taker bid order can be executed against a maker ask
     * @param takerBid taker bid order
     * @param makerAsk maker ask order
     * @return (whether strategy can be executed, tokenId to execute, amount of tokens to execute)
     */
    function canExecuteTakerBid(OrderTypes.TakerOrder calldata takerBid, OrderTypes.MakerOrder calldata makerAsk)
        external
        view
        override
        returns (
            bool,
            uint256,
            uint256
        )
    {
        uint256 startPrice = abi.decode(makerAsk.params, (uint256));
        uint256 endPrice = makerAsk.price;

        uint256 startTime = makerAsk.startTime;
        uint256 endTime = makerAsk.endTime;

        // Underflow checks and auction length check
        require(endTime >= (startTime + minimumAuctionLengthInSeconds), "Dutch Auction: Length must be longer");
        require(startPrice > endPrice, "Dutch Auction: Start price must be greater than end price");

        uint256 currentAuctionPrice = startPrice -
            (((startPrice - endPrice) * (block.timestamp - startTime)) / (endTime - startTime));

        return (
            (startTime <= block.timestamp) &&
                (endTime >= block.timestamp) &&
                (takerBid.price >= currentAuctionPrice) &&
                (takerBid.tokenId == makerAsk.tokenId),
            makerAsk.tokenId,
            makerAsk.amount
        );
    }

    /**
     * @notice Check whether a taker ask order can be executed against a maker bid
     * @return (whether strategy can be executed, tokenId to execute, amount of tokens to execute)
     * @dev It cannot execute but it is left for compatibility purposes with the interface.
     */
    function canExecuteTakerAsk(OrderTypes.TakerOrder calldata, OrderTypes.MakerOrder calldata)
        external
        pure
        override
        returns (
            bool,
            uint256,
            uint256
        )
    {
        return (false, 0, 0);
    }

    /**
     * @notice Return protocol fee for this strategy
     * @return protocol fee
     */
    function viewProtocolFee() external view override returns (uint256) {
        return PROTOCOL_FEE;
    }

    /**
     * @notice Update minimum auction length (in seconds)
     * @param _minimumAuctionLengthInSeconds minimum auction length in seconds
     * @dev It protects against auctions that would be too short to be executed (e.g., 15 seconds)
     */
    function updateMinimumAuctionLength(uint256 _minimumAuctionLengthInSeconds) external onlyOwner {
        require(_minimumAuctionLengthInSeconds >= 15 minutes, "Owner: Auction length must be > 15 min");
        minimumAuctionLengthInSeconds = _minimumAuctionLengthInSeconds;

        emit NewMinimumAuctionLengthInSeconds(_minimumAuctionLengthInSeconds);
    }
}
