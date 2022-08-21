// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {OrderTypes} from "../libraries/OrderTypes.sol";
import {IExecutionStrategy} from "../interfaces/IExecutionStrategy.sol";

/**
 * @title StrategyStandardSaleForFixedPrice
 * @notice Strategy that executes an order at a fixed price that
 * can be taken either by a bid or an ask.
 */
contract StrategyPartialSaleForFixedPrice is IExecutionStrategy {
    uint256 public immutable PROTOCOL_FEE;

    /**
     * @notice Constructor
     * @param _protocolFee protocol fee (200 --> 2%, 400 --> 4%)
     */
    constructor(uint256 _protocolFee) {
        PROTOCOL_FEE = _protocolFee;
    }

    /**
     * @notice Check whether a taker ask order can be executed against a maker bid
     * @param takerAsk taker ask order
     * @param makerBid maker bid order
     * @return (whether strategy can be executed, tokenId to execute, amount of tokens to execute)
     */
    function canExecuteTakerAsk(OrderTypes.TakerOrder calldata takerAsk, OrderTypes.MakerOrder calldata makerBid)
        external
        view
        override
        returns (
            bool,
            uint256,
            uint256
        )
    {
        uint256 takerAskAmount = abi.decode(takerAsk.params, (uint256));
        return (
            (_verifyPrice(takerAsk.price, takerAskAmount, makerBid.price, makerBid.amount) &&
                (makerBid.tokenId == takerAsk.tokenId) &&
                (makerBid.startTime <= block.timestamp) &&
                (makerBid.endTime >= block.timestamp) &&
                (takerAskAmount > 0) &&
                (makerBid.amount >= takerAskAmount)),
            makerBid.tokenId,
            takerAskAmount
        );
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
        uint256 takerBidAmount = abi.decode(takerBid.params, (uint256));
        if (takerBidAmount == 0) {
            return (false, makerAsk.tokenId, takerBidAmount);
        }
        return (
            (_verifyPrice(makerAsk.price, makerAsk.amount, takerBid.price, takerBidAmount) &&
                (makerAsk.tokenId == takerBid.tokenId) &&
                (makerAsk.startTime <= block.timestamp) &&
                (makerAsk.endTime >= block.timestamp) &&
                (takerBidAmount > 0) &&
                (makerAsk.amount >= takerBidAmount)),
            makerAsk.tokenId,
            takerBidAmount
        );
    }

    /**
     * @dev checks that askPrice/askAmount <= bidPrice/bidAmount
     * which is askPrice * bidAmount <= bidPrice * askAmount
     * note that these are uint256 * uint256 = uint512
     * the function supports overflows and extreme values
     * a lot of low level arithmetics
     */
    function _verifyPrice(
        uint256 askPrice,
        uint256 askAmount,
        uint256 bidPrice,
        uint256 bidAmount
    ) private pure returns (bool result) {
        // none operation oferflows
        unchecked {
            // low 128 bits
            uint256 left = (askPrice & (2**128 - 1)) * (bidAmount & (2**128 - 1));
            uint256 leftHigh = left >> 128;
            left &= 2**128 - 1;
            uint256 right = (bidPrice & (2**128 - 1)) * (askAmount & (2**128 - 1));
            uint256 rightHigh = right >> 128;
            right &= 2**128 - 1;
            result = left <= right;

            // middle 128 bits
            left = leftHigh + (askPrice >> 128) * (bidAmount & (2**128 - 1));
            leftHigh = left >> 128;
            left &= 2**128 - 1;
            left += (askPrice & (2**128 - 1)) * (bidAmount >> 128);
            leftHigh += left >> 128;
            left &= 2**128 - 1;
            right = rightHigh + (bidPrice >> 128) * (askAmount & (2**128 - 1));
            rightHigh = right >> 128;
            right &= 2**128 - 1;
            right += (bidPrice & (2**128 - 1)) * (askAmount >> 128);
            rightHigh += right >> 128;
            right &= 2**128 - 1;
            result = left < right || (left == right && result);

            // high 256 bits
            left = leftHigh + (askPrice >> 128) * (bidAmount >> 128);
            right = rightHigh + (bidPrice >> 128) * (askAmount >> 128);
            result = left < right || (left == right && result);
        }
    }

    /**
     * @notice Return protocol fee for this strategy
     * @return protocol fee
     */
    function viewProtocolFee() external view override returns (uint256) {
        return PROTOCOL_FEE;
    }
}
