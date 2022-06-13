// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ITransferManagerNFT} from "../interfaces/ITransferManagerNFT.sol";

/**
 * @title TransferManagerNonCompliantERC721
 * @notice It allows the transfer of ERC721 tokens without safeTransferFrom.
 */
contract TransferManagerNonCompliantERC721 is ITransferManagerNFT {
    address public immutable EARTH_RARE_EXCHANGE;

    /**
     * @notice Constructor
     * @param _earthRareExchange address of the EarthRare exchange
     */
    constructor(address _earthRareExchange) {
        EARTH_RARE_EXCHANGE = _earthRareExchange;
    }

    /**
     * @notice Transfer ERC721 token
     * @param collection address of the collection
     * @param from address of the sender
     * @param to address of the recipient
     * @param tokenId tokenId
     */
    function transferNonFungibleToken(
        address collection,
        address from,
        address to,
        uint256 tokenId,
        uint256
    ) external override {
        require(msg.sender == EARTH_RARE_EXCHANGE, "Transfer: Only EarthRare Exchange");
        IERC721(collection).transferFrom(from, to, tokenId);
    }
}
