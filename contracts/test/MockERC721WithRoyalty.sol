// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC165, ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

contract MockERC721WithRoyalty is ERC721, IERC2981 {
    address public immutable RECEIVER;
    uint256 public immutable ROYALTY_FEE;
    uint256 public currentTokenId;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _royaltyFee
    ) ERC721(_name, _symbol) {
        ROYALTY_FEE = _royaltyFee;
        RECEIVER = msg.sender;
    }

    function mint(address to) external {
        _mint(to, currentTokenId);
        currentTokenId++;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, IERC165) returns (bool) {
        return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId);
    }

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        return (RECEIVER, (ROYALTY_FEE * salePrice) / 10000);
    }
}
