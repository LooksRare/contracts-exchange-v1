// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OrderTypes} from "../libraries/OrderTypes.sol";
import {IExecutionStrategy} from "../interfaces/IExecutionStrategy.sol";

/**
 * @title StrategyAnyItemFromCollectionForFixedPriceV1B
 * @notice Strategy to send an order at a fixed price that can be
 * matched by any tokenId for the collection.
 */
contract StrategyAnyItemFromCollectionForFixedPriceV1B is Ownable, IExecutionStrategy {
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
                (makerBid.endTime >= block.timestamp) &&
                (makerBid.startTime <= block.timestamp)),
            takerAsk.tokenId,
            makerBid.amount
        );
    }

    /**
     * @notice Check whether a taker bid order can be executed against a maker ask
     * @return (whether strategy can be executed, tokenId to execute, amount of tokens to execute)
     * @dev It cannot execute but it is left for compatibility purposes with the interface.
     */
    function canExecuteTakerBid(OrderTypes.TakerOrder calldata, OrderTypes.MakerOrder calldata)
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
