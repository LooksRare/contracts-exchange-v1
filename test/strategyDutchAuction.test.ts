import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { MakerOrderWithSignature, TakerOrder } from "./helpers/order-types";
import { createMakerOrder, createTakerOrder } from "./helpers/order-helper";
import { computeDomainSeparator, computeOrderHash } from "./helpers/signature-helper";
import { setUp } from "./test-setup";
import { tokenSetUp } from "./token-set-up";
import { increaseTo } from "./helpers/block-traveller";

const { defaultAbiCoder, parseEther } = utils;

describe("Strategy - Dutch Auction", () => {
  // Mock contracts
  let mockERC721: Contract;
  let mockERC721WithRoyalty: Contract;
  let mockERC1155: Contract;
  let weth: Contract;

  // Exchange contracts
  let transferManagerERC721: Contract;
  let transferManagerERC1155: Contract;
  let looksRareExchange: Contract;

  // Strategy contract
  let strategyDutchAuction: Contract;

  // Other global variables
  let standardProtocolFee: BigNumber;
  let royaltyFeeLimit: BigNumber;
  let accounts: SignerWithAddress[];
  let admin: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let royaltyCollector: SignerWithAddress;
  let startTimeOrder: BigNumber;
  let endTimeOrder: BigNumber;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];
    feeRecipient = accounts[19];
    royaltyCollector = accounts[15];
    standardProtocolFee = BigNumber.from("200");
    royaltyFeeLimit = BigNumber.from("9500"); // 95%
    [
      weth,
      mockERC721,
      mockERC1155,
      ,
      mockERC721WithRoyalty,
      ,
      ,
      ,
      transferManagerERC721,
      transferManagerERC1155,
      ,
      looksRareExchange,
      ,
      ,
      strategyDutchAuction,
      ,
      ,
      ,
      ,
      ,
      ,
    ] = await setUp(admin, feeRecipient, royaltyCollector, standardProtocolFee, royaltyFeeLimit);

    await tokenSetUp(
      accounts.slice(1, 10),
      weth,
      mockERC721,
      mockERC721WithRoyalty,
      mockERC1155,
      looksRareExchange,
      transferManagerERC721,
      transferManagerERC1155
    );

    // Verify the domain separator is properly computed
    assert.equal(await looksRareExchange.DOMAIN_SEPARATOR(), computeDomainSeparator(looksRareExchange.address));

    // Set up defaults startTime/endTime (for orders)
    startTimeOrder = BigNumber.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    endTimeOrder = startTimeOrder.add(BigNumber.from("1000"));
  });

  it("ERC721 - Buyer pays the exact auction price", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];

    endTimeOrder = startTimeOrder.add(BigNumber.from("1000"));

    const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC721.address,
      price: parseEther("1"),
      tokenId: constants.Zero,
      amount: constants.One,
      strategy: strategyDutchAuction.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["uint256"], [parseEther("5")]),
      signerUser: makerAskUser,
      verifyingContract: looksRareExchange.address,
    });

    const takerBidOrder = createTakerOrder({
      isOrderAsk: false,
      taker: takerBidUser.address,
      tokenId: constants.Zero,
      price: BigNumber.from(parseEther("3").toString()),
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    // User 2 cannot buy since the current auction price is not 3
    await expect(
      looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
        value: takerBidOrder.price,
      })
    ).to.be.revertedWith("Strategy: Execution invalid");

    await expect(
      looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
    ).to.be.revertedWith("Strategy: Execution invalid");

    // Advance time to half time of the auction (3 is between 5 and 1)
    const midTimeOrder = startTimeOrder.add("500");
    await increaseTo(midTimeOrder);

    const tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
    await expect(tx)
      .to.emit(looksRareExchange, "TakerBid")
      .withArgs(
        computeOrderHash(makerAskOrder),
        makerAskOrder.nonce,
        takerBidUser.address,
        makerAskUser.address,
        strategyDutchAuction.address,
        makerAskOrder.currency,
        makerAskOrder.collection,
        takerBidOrder.tokenId,
        makerAskOrder.amount,
        takerBidOrder.price
      );

    assert.equal(await mockERC721.ownerOf("0"), takerBidUser.address);
    assert.isTrue(
      await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
    );
  });

  it("ERC1155 - Buyer overpays", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];
    endTimeOrder = startTimeOrder.add("1000");

    const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC1155.address,
      price: parseEther("1"),
      tokenId: constants.One,
      amount: constants.Two,
      strategy: strategyDutchAuction.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["uint256"], [parseEther("5")]),
      signerUser: makerAskUser,
      verifyingContract: looksRareExchange.address,
    });

    const takerBidOrder = createTakerOrder({
      isOrderAsk: false,
      taker: takerBidUser.address,
      tokenId: constants.One,
      price: BigNumber.from(parseEther("4.5").toString()),
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    // Advance time to half time of the auction (3 is between 5 and 1)
    const midTimeOrder = startTimeOrder.add("500");
    await increaseTo(midTimeOrder);

    // User 2 buys with 4.5 WETH (when auction price was at 3 WETH)
    const tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
    await expect(tx)
      .to.emit(looksRareExchange, "TakerBid")
      .withArgs(
        computeOrderHash(makerAskOrder),
        makerAskOrder.nonce,
        takerBidUser.address,
        makerAskUser.address,
        strategyDutchAuction.address,
        makerAskOrder.currency,
        makerAskOrder.collection,
        takerBidOrder.tokenId,
        makerAskOrder.amount,
        takerBidOrder.price
      );

    // Verify amount transfered to the protocol fee (user1) is (protocolFee) * 4.5 WETH
    const protocolFee = await strategyDutchAuction.PROTOCOL_FEE();
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(takerBidUser.address, feeRecipient.address, takerBidOrder.price.mul(protocolFee).div("10000"));

    // User 2 had minted 2 tokenId=1 so he has 4
    assert.deepEqual(await mockERC1155.balanceOf(takerBidUser.address, "1"), BigNumber.from("4"));
  });

  it("Revert if start price is lower than end price", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];

    let makerAskOrder = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      price: parseEther("3"),
      amount: constants.One,
      strategy: strategyDutchAuction.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["uint256", "uint256"], [parseEther("3"), parseEther("5")]), // startPrice/endPrice
      signerUser: makerAskUser,
      verifyingContract: looksRareExchange.address,
    });

    const takerBidOrder: TakerOrder = {
      isOrderAsk: false,
      taker: takerBidUser.address,
      tokenId: makerAskOrder.tokenId,
      price: makerAskOrder.price,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    };

    await expect(
      looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
    ).to.be.revertedWith("Dutch Auction: Start price must be greater than end price");

    // EndTimeOrder is 50 seconds after startTimeOrder
    endTimeOrder = startTimeOrder.add(BigNumber.from("50"));

    makerAskOrder = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      price: parseEther("3"),
      amount: constants.One,
      strategy: strategyDutchAuction.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["uint256", "uint256"], [parseEther("5"), parseEther("3")]), // startPrice/endPrice
      signerUser: makerAskUser,
      verifyingContract: looksRareExchange.address,
    });

    await expect(
      looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
    ).to.be.revertedWith("Dutch Auction: Length must be longer");
  });

  it("Cannot match if wrong side", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];

    const makerBidOrder = await createMakerOrder({
      isOrderAsk: false,
      signer: takerBidUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      price: parseEther("3"),
      amount: constants.One,
      strategy: strategyDutchAuction.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["uint256"], [parseEther("5")]), // startPrice
      signerUser: takerBidUser,
      verifyingContract: looksRareExchange.address,
    });

    const takerAskOrder: TakerOrder = {
      isOrderAsk: true,
      taker: makerAskUser.address,
      tokenId: makerBidOrder.tokenId,
      price: makerBidOrder.price,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    };

    await expect(
      looksRareExchange.connect(makerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
    ).to.be.revertedWith("Strategy: Execution invalid");
  });

  it("Min Auction length creates revertion as expected", async () => {
    await expect(strategyDutchAuction.connect(admin).updateMinimumAuctionLength("899")).to.be.revertedWith(
      "Owner: Auction length must be > 15 min"
    );

    const StrategyDutchAuction = await ethers.getContractFactory("StrategyDutchAuction");
    await expect(StrategyDutchAuction.connect(admin).deploy("900", "899")).to.be.revertedWith(
      "Owner: Auction length must be > 15 min"
    );
  });

  it("Owner functions work as expected", async () => {
    const tx = await strategyDutchAuction.connect(admin).updateMinimumAuctionLength("1000");
    await expect(tx).to.emit(strategyDutchAuction, "NewMinimumAuctionLengthInSeconds").withArgs("1000");
  });

  it("Owner functions are only callable by owner", async () => {
    const notAdminUser = accounts[3];

    await expect(strategyDutchAuction.connect(notAdminUser).updateMinimumAuctionLength("500")).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });
});
