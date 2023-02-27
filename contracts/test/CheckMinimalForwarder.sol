// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/metatx/MinimalForwarder.sol";

contract CheckMinimalForwarder is MinimalForwarder {
    function checkExecute(ForwardRequest calldata req, bytes calldata signature) public payable {
        (bool success, bytes memory result) = execute(req, signature);
        if (!success) {
            // If call reverts
            // If there is return data, the call reverted without a reason or a custom error.
            if (result.length == 0) revert("CheckMinimalForwarder: the call failed without an error message");
            assembly {
                // We use Yul's revert() to bubble up errors from the target contract.
                revert(add(32, result), mload(result))
            }
        }
    }
}
