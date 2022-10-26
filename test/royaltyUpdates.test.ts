import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { MakerOrderWithSignature, TakerOrder } from "./helpers/order-types";
import { createMakerOrder, createTakerOrder } from "./helpers/order-helper";
import { computeDomainSeparator, computeOrderHash } from "./helpers/signature-helper";
import { setUp } from "./test-setup";
import { tokenSetUp } from "./token-set-up";
import {
  MIN_NET_RATIO_ABOVE_PROTOCOL_FEE,
  MIN_NET_RATIO_ABOVE_ROYALTY_FEE_ERC2981_AND_PROTOCOL_FEE,
  MIN_NET_RATIO_ABOVE_ROYALTY_FEE_REGISTRY_AND_PROTOCOL_FEE,
  NONCE_EXECUTED_OR_CANCELLED,
} from "./helpers/configErrorCodes";
import { assertErrorCode, assertOrderValid } from "./helpers/order-validation-helper";

const { defaultAbiCoder, parseEther } = utils;

describe("LooksRare Exchange post-royalty change", () => {
  // Mock contracts
  let mockERC721: Contract;
  let mockERC721WithRoyalty: Contract;
  let mockERC1155: Contract;
  let weth: Contract;

  // Exchange contracts
  let transferManagerERC721: Contract;
  let transferManagerERC1155: Contract;
  let executionManager: Contract;
  let royaltyFeeRegistry: Contract;
  let royaltyFeeSetter: Contract;
  let looksRareExchange: Contract;
  let orderValidatorV1B: Contract;
  let royaltyFeeManagerV1B: Contract;
  let strategyStandardSaleForFixedPriceV1B: Contract;

  // Other global variables
  let standardRoyaltyFee: BigNumber;
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
      executionManager,
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
      royaltyFeeRegistry,
      ,
      royaltyFeeSetter,
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

    const RoyaltyFeeManagerV1B = await ethers.getContractFactory("RoyaltyFeeManagerV1B");
    royaltyFeeManagerV1B = await RoyaltyFeeManagerV1B.deploy(royaltyFeeRegistry.address);
    await royaltyFeeManagerV1B.deployed();

    await looksRareExchange.connect(admin).updateRoyaltyFeeManager(royaltyFeeManagerV1B.address);

    const OrderValidatorV1B = await ethers.getContractFactory("OrderValidatorV1B");
    orderValidatorV1B = await OrderValidatorV1B.deploy(looksRareExchange.address);
    await orderValidatorV1B.deployed();

    standardRoyaltyFee = await royaltyFeeManagerV1B.STANDARD_ROYALTY_FEE();

    const StrategyStandardSaleForFixedPriceV1B = await ethers.getContractFactory(
      "StrategyStandardSaleForFixedPriceV1B"
    );
    strategyStandardSaleForFixedPriceV1B = await StrategyStandardSaleForFixedPriceV1B.deploy();
    await strategyStandardSaleForFixedPriceV1B.deployed();

    await executionManager.connect(admin).addStrategy(strategyStandardSaleForFixedPriceV1B.address);
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
        strategy: strategyStandardSaleForFixedPriceV1B.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      await assertOrderValid(makerAskOrder, orderValidatorV1B);

      const takerBidOrder = createTakerOrder({
        isOrderAsk: false,
        taker: takerBidUser.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
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
          strategyStandardSaleForFixedPriceV1B.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          makerAskOrder.tokenId,
          makerAskOrder.amount,
          takerBidOrder.price
        );

      await assertErrorCode(makerAskOrder, NONCE_EXECUTED_OR_CANCELLED, orderValidatorV1B);

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
    it("Fee/Royalty - Payment with ERC2981 works for non-ETH orders", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      assert.equal(await mockERC721WithRoyalty.RECEIVER(), royaltyCollector.address);
      assert.isTrue(await mockERC721WithRoyalty.supportsInterface("0x2a55205a"));

      // Verify balance of royaltyCollector is 0
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), constants.Zero);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721WithRoyalty.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPriceV1B.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      await assertOrderValid(makerAskOrder, orderValidatorV1B);

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: takerBidUser.address,
        price: makerAskOrder.price,
        tokenId: makerAskOrder.tokenId,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      const tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyStandardSaleForFixedPriceV1B.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      const expectedRoyaltyAmount = BigNumber.from(takerBidOrder.price).mul(standardRoyaltyFee).div("10000");

      await expect(tx)
        .to.emit(looksRareExchange, "RoyaltyPayment")
        .withArgs(
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          royaltyCollector.address,
          makerAskOrder.currency,
          expectedRoyaltyAmount
        );

      await assertErrorCode(makerAskOrder, NONCE_EXECUTED_OR_CANCELLED, orderValidatorV1B);
      assert.equal(await mockERC721WithRoyalty.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );
      // Verify WETH balance of royalty collector has increased
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), expectedRoyaltyAmount);
    });

    it("Fee/Royalty - Payment to ERC2981 recipient works with a fixed fee", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      assert.equal(await mockERC721WithRoyalty.RECEIVER(), royaltyCollector.address);
      assert.isTrue(await mockERC721WithRoyalty.supportsInterface("0x2a55205a"));

      // Verify balance of royaltyCollector is 0
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), constants.Zero);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721WithRoyalty.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPriceV1B.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      await assertOrderValid(makerAskOrder, orderValidatorV1B);

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: takerBidUser.address,
        price: makerAskOrder.price,
        tokenId: makerAskOrder.tokenId,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      const tx = await looksRareExchange
        .connect(takerBidUser)
        .matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: parseEther("3"),
        });

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyStandardSaleForFixedPriceV1B.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      const expectedRoyaltyAmount = BigNumber.from(takerBidOrder.price).mul(standardRoyaltyFee).div("10000");

      await expect(tx)
        .to.emit(looksRareExchange, "RoyaltyPayment")
        .withArgs(
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          royaltyCollector.address,
          makerAskOrder.currency,
          expectedRoyaltyAmount
        );

      await assertErrorCode(makerAskOrder, NONCE_EXECUTED_OR_CANCELLED, orderValidatorV1B);
      assert.equal(await mockERC721WithRoyalty.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );
      // Verify WETH balance of royalty collector has increased
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), expectedRoyaltyAmount);
    });

    it("Fee/Royalty - Payment with current registry works with fixed fee", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      // Set 3% for royalties
      const fee = "300";
      let tx = await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollection(mockERC721.address, admin.address, royaltyCollector.address, fee);

      await expect(tx)
        .to.emit(royaltyFeeRegistry, "RoyaltyFeeUpdate")
        .withArgs(mockERC721.address, admin.address, royaltyCollector.address, fee);

      tx = await royaltyFeeRegistry.royaltyFeeInfoCollection(mockERC721.address);
      assert.equal(tx[0], admin.address);
      assert.equal(tx[1], royaltyCollector.address);
      assert.equal(tx[2].toString(), fee);

      // Verify balance of royaltyCollector is 0
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), constants.Zero);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPriceV1B.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      await assertOrderValid(makerAskOrder, orderValidatorV1B);

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyStandardSaleForFixedPriceV1B.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      const expectedRoyaltyAmount = BigNumber.from(takerBidOrder.price).mul(standardRoyaltyFee).div("10000");

      await expect(tx)
        .to.emit(looksRareExchange, "RoyaltyPayment")
        .withArgs(
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          royaltyCollector.address,
          makerAskOrder.currency,
          expectedRoyaltyAmount
        );

      await assertErrorCode(makerAskOrder, NONCE_EXECUTED_OR_CANCELLED, orderValidatorV1B);
      assert.equal(await mockERC721.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // Verify WETH balance of royalty collector has increased
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), expectedRoyaltyAmount);
    });

    it("Can identify stale orders with minPercentageToAsk", async () => {
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

      const makerAskUser = accounts[1];
      const tokenId = constants.Zero;

      // 1. Royalty fee
      let makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: tokenId,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPriceV1B.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: BigNumber.from("9851"), // Protocol fee is 2%
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      await assertErrorCode(makerAskOrder, MIN_NET_RATIO_ABOVE_PROTOCOL_FEE, orderValidatorV1B);

      // 2. Protocol fee + Registry royalties
      const fee = "100"; // 1%
      await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollection(mockERC721.address, admin.address, royaltyCollector.address, fee);

      makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: tokenId,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPriceV1B.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: BigNumber.from("9801"), // Protocol fee is 1.5% and royalty is set at 0.5%
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      await assertErrorCode(
        makerAskOrder,
        MIN_NET_RATIO_ABOVE_ROYALTY_FEE_REGISTRY_AND_PROTOCOL_FEE,
        orderValidatorV1B
      );

      // 3. Protocol fee + ERC2981 royalties
      makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721WithRoyalty.address,
        price: parseEther("3"),
        tokenId: tokenId,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPriceV1B.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: BigNumber.from("9801"), // Protocol fee is 1.5% and royalty fee is 0.5%%
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      await assertErrorCode(makerAskOrder, MIN_NET_RATIO_ABOVE_ROYALTY_FEE_ERC2981_AND_PROTOCOL_FEE, orderValidatorV1B);
    });
  });
});
