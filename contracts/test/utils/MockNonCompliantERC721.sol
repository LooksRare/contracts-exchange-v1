// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockNonCompliantERC721 is ERC721, Ownable {
    uint256 public currentTokenId;

    constructor(string memory _name, string memory _symbol) ERC721(_name, _symbol) {}

    function mint(address to) external {
        _mint(to, currentTokenId);
        currentTokenId++;
    }

    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        if ((interfaceId == 0x01ffc9a7) || (interfaceId == 0x9a20483d)) {
            return true;
        }

        return false;
    }
}
