// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC721WithAdmin is ERC721 {
    address public immutable admin;

    uint256 public currentTokenId;

    constructor(string memory _name, string memory _symbol) ERC721(_name, _symbol) {
        admin = msg.sender;
    }

    function mint(address to) external {
        _mint(to, currentTokenId);
        currentTokenId++;
    }
}
