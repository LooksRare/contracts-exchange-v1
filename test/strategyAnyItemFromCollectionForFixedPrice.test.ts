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

describe("Strategy - AnyItemFromCollectionForFixedPrice ('Collection orders')", () => {
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
  let strategyAnyItemFromCollectionForFixedPrice: Contract;

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
      strategyAnyItemFromCollectionForFixedPrice,
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

  it("ERC721 - MakerBid order is matched by TakerAsk order", async () => {
    const makerBidUser = accounts[1];
    const takerAskUser = accounts[5];

    const makerBidOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: false,
      signer: makerBidUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero, // Not used
      price: parseEther("3"),
      amount: constants.One,
      strategy: strategyAnyItemFromCollectionForFixedPrice.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
      signerUser: makerBidUser,
      verifyingContract: looksRareExchange.address,
    });

    const takerAskOrder = createTakerOrder({
      isOrderAsk: true,
      taker: takerAskUser.address,
      tokenId: BigNumber.from("4"),
      price: makerBidOrder.price,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    const tx = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
    await expect(tx)
      .to.emit(looksRareExchange, "TakerAsk")
      .withArgs(
        computeOrderHash(makerBidOrder),
        makerBidOrder.nonce,
        takerAskUser.address,
        makerBidUser.address,
        strategyAnyItemFromCollectionForFixedPrice.address,
        makerBidOrder.currency,
        makerBidOrder.collection,
        takerAskOrder.tokenId,
        makerBidOrder.amount,
        makerBidOrder.price
      );

    assert.isTrue(
      await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
    );
  });

  it("ERC1155 - MakerBid order is matched by TakerAsk order", async () => {
    const makerBidUser = accounts[1];
    const takerAskUser = accounts[2];

    const makerBidOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: false,
      signer: makerBidUser.address,
      collection: mockERC1155.address,
      tokenId: constants.Zero, // not used
      price: parseEther("3"),
      amount: constants.Two,
      strategy: strategyAnyItemFromCollectionForFixedPrice.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
      signerUser: makerBidUser,
      verifyingContract: looksRareExchange.address,
    });

    const takerAskOrder = createTakerOrder({
      isOrderAsk: true,
      taker: takerAskUser.address,
      price: makerBidOrder.price,
      tokenId: BigNumber.from("2"),
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
    });

    const tx = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
    await expect(tx)
      .to.emit(looksRareExchange, "TakerAsk")
      .withArgs(
        computeOrderHash(makerBidOrder),
        makerBidOrder.nonce,
        takerAskUser.address,
        makerBidUser.address,
        strategyAnyItemFromCollectionForFixedPrice.address,
        makerBidOrder.currency,
        makerBidOrder.collection,
        takerAskOrder.tokenId,
        makerBidOrder.amount,
        makerBidOrder.price
      );

    assert.isTrue(
      await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
    );
  });

  it("Cannot match if wrong side", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];

    const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      price: parseEther("3"),
      amount: constants.One,
      strategy: strategyAnyItemFromCollectionForFixedPrice.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []),
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
    ).to.be.revertedWith("Strategy: Execution invalid");
  });
});
