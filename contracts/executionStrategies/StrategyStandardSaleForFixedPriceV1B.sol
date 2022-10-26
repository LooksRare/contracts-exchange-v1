// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OrderTypes} from "../libraries/OrderTypes.sol";
import {IExecutionStrategy} from "../interfaces/IExecutionStrategy.sol";

/**
 * @title StrategyStandardSaleForFixedPriceV1B
 * @notice Strategy that executes an order at a fixed price that
 * can be taken either by a bid or an ask.
 */
contract StrategyStandardSaleForFixedPriceV1B is Ownable, IExecutionStrategy {
    // Event if the protocol fee changes
    event NewProtocolFee(uint256 protocolFee);

    // Protocol fee
    uint256 internal _protocolFee = 150;

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
        return (
            ((makerBid.price == takerAsk.price) &&
                (makerBid.tokenId == takerAsk.tokenId) &&
                (makerBid.startTime <= block.timestamp) &&
                (makerBid.endTime >= block.timestamp)),
            makerBid.tokenId,
            makerBid.amount
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
        return (
            ((makerAsk.price == takerBid.price) &&
                (makerAsk.tokenId == takerBid.tokenId) &&
                (makerAsk.startTime <= block.timestamp) &&
                (makerAsk.endTime >= block.timestamp)),
            makerAsk.tokenId,
            makerAsk.amount
        );
    }

    /**
     * @notice Set new protocol fee for this strategy
     * @param newProtocolFee protocol fee
     */
    function setProtocolFee(uint256 newProtocolFee) external onlyOwner {
        require(newProtocolFee < _protocolFee, "Owner: Protocol fee too high");
        _protocolFee = newProtocolFee;

        emit NewProtocolFee(newProtocolFee);
    }

    /**
     * @notice Return protocol fee for this strategy
     * @return protocol fee
     */
    function viewProtocolFee() external view override returns (uint256) {
        return _protocolFee;
    }
}
