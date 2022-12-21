// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Mock NS Signer Contract, NS stands for no signature,
/// it means that a signature in isValidSignature() is ignored
contract MockNSSignerContract is IERC1271, ERC721Holder, Ownable {
    mapping(bytes32 => bool) public hashes;

    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    function approveHash(bytes32 hash, bool approved) external onlyOwner {
        hashes[hash] = approved;
    }

    /**
     * @notice Approve ERC20
     */
    function approveERC20ToBeSpent(address token, address target) external onlyOwner {
        IERC20(token).approve(target, type(uint256).max);
    }

    /**
     * @notice Approve all ERC721 tokens
     */
    function approveERC721NFT(address collection, address target) external onlyOwner {
        IERC721(collection).setApprovalForAll(target, true);
    }

    /**
     * @notice Withdraw ERC20 balance
     */
    function withdrawERC20(address token) external onlyOwner {
        IERC20(token).transfer(msg.sender, IERC20(token).balanceOf(address(this)));
    }

    /**
     * @notice Withdraw ERC721 tokenId
     */
    function withdrawERC721NFT(address collection, uint256 tokenId) external onlyOwner {
        IERC721(collection).transferFrom(address(this), msg.sender, tokenId);
    }

    /**
     * @notice Verifies that the signer is the owner of the signing contract.
     */
    function isValidSignature(
        bytes32 hash,
        bytes memory /*signature*/
    ) external view override returns (bytes4) {
        return hashes[hash] ? MAGICVALUE : bytes4(0xffffffff);
    }
}
