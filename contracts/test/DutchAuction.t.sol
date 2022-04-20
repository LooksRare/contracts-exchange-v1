// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import {OrderTypes, StrategyDutchAuction} from "../executionStrategies/StrategyDutchAuction.sol";
import {TestHelpers} from "./TestHelpers.sol";

abstract contract TestParameters {
    // All the parameters are dummy & used for compatibility with Maker/Taker but don't impact Dutch Auction
    address internal _TAKER = address(1);
    address internal _MAKER = address(2);
    address internal _STRATEGY = address(3);
    address internal _COLLECTION = address(4);
    address internal _CURRENCY = address(5);
    uint256 internal _AMOUNT = 1;
    uint256 internal _NONCE = 0;
    uint256 internal _TOKEN_ID = 1;
    uint256 internal _MIN_PERCENTAGE_TO_ASK = 8500;
    bytes internal _TAKER_PARAMS;
    uint8 internal _V = 27;
    bytes32 internal _R;
    bytes32 internal _S;

    uint256 internal _PROTOCOL_FEE = 200;
    uint256 internal _MIN_AUCTION_LENGTH = 15 minutes;
}

contract StrategyDutchAuctionTest is TestHelpers, TestParameters {
    StrategyDutchAuction public strategyDutchAuction;

    function setUp() public {
        strategyDutchAuction = new StrategyDutchAuction(_PROTOCOL_FEE, _MIN_AUCTION_LENGTH);
    }

    function testTimeOverflow(uint32 auctionLength) public {
        uint256 startTime = block.timestamp;
        cheats.assume(_MIN_AUCTION_LENGTH < uint256(auctionLength));
        uint256 endTime = startTime + uint256(auctionLength);
        uint256 startPrice = 2 ether;
        uint256 endPrice = 0.5 ether;

        uint256 takerPrice = startPrice -
            (((startPrice - endPrice) * (block.timestamp - startTime)) / (endTime - startTime));

        bytes memory makerParams = abi.encode(startPrice);

        OrderTypes.TakerOrder memory takerBidOrder = OrderTypes.TakerOrder(
            false,
            _TAKER,
            takerPrice,
            _TOKEN_ID,
            _MIN_PERCENTAGE_TO_ASK,
            _TAKER_PARAMS
        );

        OrderTypes.MakerOrder memory makerAskOrder = OrderTypes.MakerOrder(
            true,
            _MAKER,
            _COLLECTION,
            endPrice,
            _TOKEN_ID,
            _AMOUNT,
            _STRATEGY,
            _CURRENCY,
            _NONCE,
            startTime,
            endTime,
            _MIN_PERCENTAGE_TO_ASK,
            makerParams,
            _V,
            _R,
            _S
        );

        (bool canExecute, , ) = strategyDutchAuction.canExecuteTakerBid(takerBidOrder, makerAskOrder);
        assert(canExecute);
    }
}
