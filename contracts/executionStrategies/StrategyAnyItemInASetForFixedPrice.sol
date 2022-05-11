// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {OrderTypes} from "../libraries/OrderTypes.sol";
import {IExecutionStrategy} from "../interfaces/IExecutionStrategy.sol";

/**
 * @title StrategyAnyItemInASetForFixedPrice
 * @notice Strategy to send an order at a fixed price that can be
 * matched by any tokenId in a set of tokenIds.
 */
contract StrategyAnyItemInASetForFixedPrice is IExecutionStrategy {
    uint256 public immutable PROTOCOL_FEE;

    /**
     * @notice Constructor
     * @param _protocolFee: protocol fee (200 --> 2%, 400 --> 4%)
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
        // Precomputed merkleRoot (that contains the tokenIds that match a common characteristic)
        bytes32 merkleRoot = abi.decode(makerBid.params, (bytes32));

        // MerkleProof + indexInTree + tokenId
        bytes32[] memory merkleProof = abi.decode(takerAsk.params, (bytes32[]));

        // Compute the node
        bytes32 node = keccak256(abi.encodePacked(takerAsk.tokenId));

        // Return whether the order can be executed, the tokenId, and the amount to sell
        return (
            (MerkleProof.verify(merkleProof, merkleRoot, node) &&
                (makerBid.price == takerAsk.price) &&
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
     * @notice Return protocol fee for this strategy
     * @return protocol fee
     */
    function viewProtocolFee() external view override returns (uint256) {
        return PROTOCOL_FEE;
    }
}
