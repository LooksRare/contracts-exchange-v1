import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { MakerOrderWithSignature, TakerOrder } from "./helpers/order-types";
import { createMakerOrder, createTakerOrder } from "./helpers/order-helper";
import { computeDomainSeparator, computeOrderHash } from "./helpers/signature-helper";
import { setUp } from "./test-setup";
import { tokenSetUp } from "./token-set-up";

const { defaultAbiCoder, parseEther } = utils;

describe("Strategy - PrivateSale", () => {
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
  let strategyPrivateSale: Contract;

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
      ,
      strategyPrivateSale,
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

  it("ERC721 -  No platform fee, only target can buy", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];
    const wrongUser = accounts[3];

    const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      price: parseEther("5"),
      amount: constants.One,
      strategy: strategyPrivateSale.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["address"], [takerBidUser.address]),
      signerUser: makerAskUser,
      verifyingContract: looksRareExchange.address,
    });

    let takerBidOrder = createTakerOrder({
      isOrderAsk: false,
      taker: wrongUser.address,
      tokenId: constants.Zero,
      price: makerAskOrder.price,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    // User 3 cannot buy since the order target is only taker user
    await expect(
      looksRareExchange.connect(wrongUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
        value: takerBidOrder.price,
      })
    ).to.be.revertedWith("Strategy: Execution invalid");

    await expect(
      looksRareExchange.connect(wrongUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
    ).to.be.revertedWith("Strategy: Execution invalid");

    takerBidOrder = createTakerOrder({
      isOrderAsk: false,
      taker: takerBidUser.address,
      price: makerAskOrder.price,
      tokenId: constants.Zero,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    assert.deepEqual(await weth.balanceOf(feeRecipient.address), constants.Zero);

    const tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
    await expect(tx)
      .to.emit(looksRareExchange, "TakerBid")
      .withArgs(
        computeOrderHash(makerAskOrder),
        makerAskOrder.nonce,
        takerBidUser.address,
        makerAskUser.address,
        strategyPrivateSale.address,
        makerAskOrder.currency,
        makerAskOrder.collection,
        takerBidOrder.tokenId,
        makerAskOrder.amount,
        makerAskOrder.price
      );

    assert.equal(await mockERC721.ownerOf(constants.Zero), takerBidUser.address);
    assert.isTrue(
      await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
    );
    // Verify balance of treasury (aka feeRecipient) is 0
    assert.deepEqual(await weth.balanceOf(feeRecipient.address), constants.Zero);
  });

  it("ERC721 -  No platform fee, only target can buy", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];
    const wrongUser = accounts[3];

    const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      price: parseEther("5"),
      amount: constants.One,
      strategy: strategyPrivateSale.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["address"], [takerBidUser.address]),
      signerUser: makerAskUser,
      verifyingContract: looksRareExchange.address,
    });

    let takerBidOrder = createTakerOrder({
      isOrderAsk: false,
      taker: wrongUser.address,
      tokenId: constants.Zero,
      price: makerAskOrder.price,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    // User 3 cannot buy since the order target is only taker user
    await expect(
      looksRareExchange.connect(wrongUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
        value: takerBidOrder.price,
      })
    ).to.be.revertedWith("Strategy: Execution invalid");

    await expect(
      looksRareExchange.connect(wrongUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
    ).to.be.revertedWith("Strategy: Execution invalid");

    takerBidOrder = createTakerOrder({
      isOrderAsk: false,
      taker: takerBidUser.address,
      price: makerAskOrder.price,
      tokenId: constants.Zero,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    assert.deepEqual(await weth.balanceOf(feeRecipient.address), constants.Zero);

    const tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
    await expect(tx)
      .to.emit(looksRareExchange, "TakerBid")
      .withArgs(
        computeOrderHash(makerAskOrder),
        makerAskOrder.nonce,
        takerBidUser.address,
        makerAskUser.address,
        strategyPrivateSale.address,
        makerAskOrder.currency,
        makerAskOrder.collection,
        takerBidOrder.tokenId,
        makerAskOrder.amount,
        makerAskOrder.price
      );

    assert.equal(await mockERC721.ownerOf(constants.Zero), takerBidUser.address);
    assert.isTrue(
      await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
    );
    // Verify balance of treasury (aka feeRecipient) is 0
    assert.deepEqual(await weth.balanceOf(feeRecipient.address), constants.Zero);
  });

  it("Cannot match if wrong side", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];

    const makerBidOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: false,
      signer: takerBidUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      amount: constants.One,
      price: parseEther("3"),
      strategy: strategyPrivateSale.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
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
});
