// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

import {IRoyaltyFeeManager} from "./interfaces/IRoyaltyFeeManager.sol";
import {IRoyaltyFeeRegistry} from "./interfaces/IRoyaltyFeeRegistry.sol";

/**
 * @title RoyaltyFeeManagerV1B
 * @notice It handles the logic to check and transfer rebate fees (if any).
 */
contract RoyaltyFeeManagerV1B is IRoyaltyFeeManager, Ownable {
    // Royalty fee registry
    IRoyaltyFeeRegistry public immutable royaltyFeeRegistry;

    // Standard royalty fee
    uint256 public standardRoyaltyFee = 50;

    /**
     * @notice Constructor
     * @param _royaltyFeeRegistry Royalty fee registry address
     */
    constructor(address _royaltyFeeRegistry) {
        royaltyFeeRegistry = IRoyaltyFeeRegistry(_royaltyFeeRegistry);
    }

    /**
     * @notice Calculate royalty fee and get recipient
     * @param collection address of the NFT contract
     * @param tokenId tokenId
     * @param amount amount to transfer
     */
    function calculateRoyaltyFeeAndGetRecipient(
        address collection,
        uint256 tokenId,
        uint256 amount
    ) external view override returns (address receiver, uint256 royaltyAmount) {
        // 1. Check if there is a royalty info in the system
        (receiver, ) = royaltyFeeRegistry.royaltyInfo(collection, amount);

        // 2. If the receiver is address(0), check if it supports the ERC2981 interface
        if (receiver == address(0)) {
            (bool status, bytes memory data) = collection.staticcall(
                abi.encodeWithSelector(IERC2981.royaltyInfo.selector, tokenId, amount)
            );
            if (status) {
                (receiver, ) = abi.decode(data, (address, uint256));
            }
        }

        // A fixed royalty fee is applied
        if (receiver != address(0)) {
            royaltyAmount = (standardRoyaltyFee * amount) / 10000;
        }
    }
}
