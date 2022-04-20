// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ICheatCodes} from "./ICheatCodes.sol";
import {DSTest} from "../../lib/ds-test/src/test.sol";

abstract contract TestHelpers is DSTest {
    ICheatCodes public cheats = ICheatCodes(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address public user1 = address(1);
    address public user2 = address(2);
    address public user3 = address(3);
    address public user4 = address(4);
    address public user5 = address(5);
    address public user6 = address(6);
    address public user7 = address(7);
    address public user8 = address(8);
    address public user9 = address(9);

    modifier asPrankedUser(address _user) {
        cheats.startPrank(_user);
        _;
        cheats.stopPrank();
    }

    function assertQuasiEq(uint256 a, uint256 b) public {
        require(a >= 1e18 || b >= 1e18, "Error: a & b must be > 1e18");

        // 0.000001 % precision tolerance
        uint256 PRECISION_LOSS = 1e9;

        if (a == b) {
            assertEq(a, b);
        } else if (a > b) {
            assertGt(a, b);
            assertLt(a - PRECISION_LOSS, b);
        } else if (a < b) {
            assertGt(a, b - PRECISION_LOSS);
            assertLt(a, b);
        }
    }

    function _parseEther(uint256 value) internal pure returns (uint256) {
        return value * 1e18;
    }

    function _parseEtherWithFloating(uint256 value, uint8 floatingDigits) internal pure returns (uint256) {
        assert(floatingDigits <= 18);
        return value * (10**(18 - floatingDigits));
    }
}
