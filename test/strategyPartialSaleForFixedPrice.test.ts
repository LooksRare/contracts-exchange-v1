import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { MakerOrderWithSignature } from "./helpers/order-types";
import { createMakerOrder, createTakerOrder } from "./helpers/order-helper";
import { computeDomainSeparator, computeOrderHash } from "./helpers/signature-helper";
import { setUp } from "./test-setup";
import { tokenSetUp } from "./token-set-up";

const { defaultAbiCoder, parseEther } = utils;

describe("Strategy - PartialSaleForFixedPrice", () => {
  // Mock contracts
  let mockERC721: Contract;
  let mockERC721WithRoyalty: Contract;
  let mockERC1155: Contract;
  let weth: Contract;

  // Exchange contracts
  let transferManagerERC721: Contract;
  let transferManagerERC1155: Contract;
  let looksRareExchange: Contract;

  // Strategy contracts (used for this test file)
  let strategyPartialSaleForFixedPrice: Contract;

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
      ,
      ,
      ,
      ,
      ,
      strategyPartialSaleForFixedPrice,
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

  describe("#1 - Regular sales", async () => {
    it("Standard Order/ERC721/ETH only - MakerAsk order is matched by TakerBid order", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyPartialSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder = createTakerOrder({
        isOrderAsk: false,
        taker: takerBidUser.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      const tx = await looksRareExchange
        .connect(takerBidUser)
        .matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        });

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          makerAskOrder.tokenId,
          makerAskOrder.amount,
          takerBidOrder.price
        );

      assert.equal(await mockERC721.ownerOf("0"), takerBidUser.address);

      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // Orders that have been executed cannot be matched again
      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        })
      ).to.be.revertedWith("Order: Matching order expired");
    });

    it("Standard Order/ERC721/(ETH + WETH) - MakerAsk order is matched by TakerBid order", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyPartialSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder = createTakerOrder({
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      // Order is worth 3 ETH; taker user splits it as 2 ETH + 1 WETH
      const expectedBalanceInWETH = BigNumber.from((await weth.balanceOf(takerBidUser.address)).toString()).sub(
        BigNumber.from(parseEther("1"))
      );

      const tx = await looksRareExchange
        .connect(takerBidUser)
        .matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: parseEther("2"),
        });

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          makerAskOrder.tokenId,
          makerAskOrder.amount,
          takerBidOrder.price
        );

      assert.equal(await mockERC721.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // Check balance of WETH is same as expected
      assert.deepEqual(expectedBalanceInWETH, await weth.balanceOf(takerBidUser.address));
    });

    it("Standard Order/ERC1155/ETH only - MakerAsk order is matched by TakerBid order", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC1155.address,
        tokenId: constants.One,
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder = createTakerOrder({
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: constants.One,
        price: parseEther("3"),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.Two]),
      });

      const tx = await looksRareExchange
        .connect(takerBidUser)
        .matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        });

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          makerAskOrder.tokenId,
          makerAskOrder.amount,
          takerBidOrder.price
        );

      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // User 2 had minted 2 tokenId=1 so he has 4
      assert.equal((await mockERC1155.balanceOf(takerBidUser.address, "1")).toString(), "4");
    });

    it("Standard Order/ERC721/WETH only - MakerBid order is matched by TakerAsk order", async () => {
      const makerBidUser = accounts[2];
      const takerAskUser = accounts[1];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyPartialSaleForFixedPrice.address,
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
        tokenId: constants.Zero,
        price: makerBidOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      const tx = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          makerBidOrder.amount,
          makerBidOrder.price
        );

      assert.equal(await mockERC721.ownerOf("0"), makerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
      );
    });

    it("Standard Order/ERC1155/WETH only - MakerBid order is matched by TakerAsk order", async () => {
      const makerBidUser = accounts[1];
      const takerAskUser = accounts[2];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC1155.address,
        tokenId: BigNumber.from("3"),
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
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
        tokenId: BigNumber.from("3"),
        price: makerBidOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.Two]),
      });

      const tx = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyPartialSaleForFixedPrice.address,
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
  });

  describe("#2 - Partial sales", async () => {
    it("Split Order/ERC1155/WETH only - MakerBid order is matched by two TakerAsk orders", async () => {
      const makerBidUser = accounts[1];
      const takerAskUser = accounts[2];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC1155.address,
        tokenId: BigNumber.from("3"),
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
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
        tokenId: BigNumber.from("3"),
        price: makerBidOrder.price.div(2),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      const tx1 = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx1)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          constants.One,
          takerAskOrder.price
        );

      assert.isFalse(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
      );

      const tx2 = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx2)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          constants.One,
          takerAskOrder.price
        );

      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
      );
    });

    it("Split Order/ERC1155/WETH only - MakerBid order is not matched by excessive TakerAsk order", async () => {
      const makerBidUser = accounts[1];
      const takerAskUser = accounts[2];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC1155.address,
        tokenId: BigNumber.from("3"),
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
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
        tokenId: BigNumber.from("3"),
        price: makerBidOrder.price.div(2),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      const tx1 = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx1)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          constants.One,
          takerAskOrder.price
        );

      assert.isFalse(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
      );

      takerAskOrder.params = defaultAbiCoder.encode(["uint256"], [constants.Two]);
      await expect(
        looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
      ).to.be.revertedWith("Strategy: Excessive amount");
    });

    it("Split Order/ERC1155/WETH only - MakerBid order can be cancelled", async () => {
      const makerBidUser = accounts[1];
      const takerAskUser = accounts[2];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC1155.address,
        tokenId: BigNumber.from("3"),
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
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
        tokenId: BigNumber.from("3"),
        price: makerBidOrder.price.div(2),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      const tx1 = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx1)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          constants.One,
          takerAskOrder.price
        );

      assert.isFalse(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
      );

      await looksRareExchange.connect(makerBidUser).cancelMultipleMakerOrders([makerBidOrder.nonce]);

      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
      );
    });

    it("Split Order/ERC1155/WETH only - MakerBid order is not matched by overpriced TakerAsk order", async () => {
      const makerBidUser = accounts[1];
      const takerAskUser = accounts[2];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC1155.address,
        tokenId: BigNumber.from("3"),
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
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
        tokenId: BigNumber.from("3"),
        price: makerBidOrder.price.div(2).add(1),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      await expect(
        looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
      ).to.be.revertedWith("Strategy: Execution invalid");
    });

    it("Split Order/ERC1155/WETH only - MakerAsk order is matched by two TakerBid orders", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC1155.address,
        tokenId: constants.One,
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder = createTakerOrder({
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: constants.One,
        price: parseEther("3").div(2),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      const tx1 = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);

      await expect(tx1)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          makerAskOrder.tokenId,
          constants.One,
          takerBidOrder.price
        );

      assert.isFalse(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // User 2 had minted 2 tokenId=1 so he has 3
      assert.equal((await mockERC1155.balanceOf(takerBidUser.address, "1")).toString(), "3");

      const tx2 = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);

      await expect(tx2)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyPartialSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          makerAskOrder.tokenId,
          constants.One,
          takerBidOrder.price
        );

      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // User 2 had minted 2 tokenId=1 so he has 4 now
      assert.equal((await mockERC1155.balanceOf(takerBidUser.address, "1")).toString(), "4");
    });

    it("Split Order/ERC1155/WETH only - MakerAsk order is not matched by underpriced TakerBid order", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC1155.address,
        tokenId: constants.One,
        price: parseEther("3"),
        amount: constants.Two,
        strategy: strategyPartialSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder = createTakerOrder({
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: constants.One,
        price: parseEther("3").div(2).sub(1),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["uint256"], [constants.One]),
      });

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
      ).to.revertedWith("Strategy: Execution invalid");
    });
  });
});
