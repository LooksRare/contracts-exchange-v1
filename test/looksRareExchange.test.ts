import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { increaseTo } from "./helpers/block-traveller";
import { MakerOrderWithSignature, TakerOrder } from "./helpers/order-types";
import { createMakerOrder, createTakerOrder } from "./helpers/order-helper";
import { computeDomainSeparator, computeOrderHash } from "./helpers/signature-helper";
import { setUp } from "./test-setup";
import { tokenSetUp } from "./token-set-up";

const { defaultAbiCoder, parseEther } = utils;

describe("LooksRare Exchange", () => {
  // Mock contracts
  let mockUSDT: Contract;
  let mockERC721: Contract;
  let mockERC721WithRoyalty: Contract;
  let mockERC1155: Contract;
  let weth: Contract;

  // Exchange contracts
  let transferSelectorNFT: Contract;
  let transferManagerERC721: Contract;
  let transferManagerERC1155: Contract;
  let transferManagerNonCompliantERC721: Contract;
  let currencyManager: Contract;
  let executionManager: Contract;
  let royaltyFeeManager: Contract;
  let royaltyFeeRegistry: Contract;
  let royaltyFeeSetter: Contract;
  let looksRareExchange: Contract;

  // Strategy contracts (used for this test file)
  let strategyPrivateSale: Contract;
  let strategyStandardSaleForFixedPrice: Contract;

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
      mockUSDT,
      mockERC721WithRoyalty,
      currencyManager,
      executionManager,
      transferSelectorNFT,
      transferManagerERC721,
      transferManagerERC1155,
      transferManagerNonCompliantERC721,
      looksRareExchange,
      strategyStandardSaleForFixedPrice,
      ,
      ,
      strategyPrivateSale,
      ,
      royaltyFeeRegistry,
      royaltyFeeManager,
      royaltyFeeSetter,
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
          strategyStandardSaleForFixedPrice.address,
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
        params: defaultAbiCoder.encode([], []),
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
          strategyStandardSaleForFixedPrice.address,
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
          strategyStandardSaleForFixedPrice.address,
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
          strategyStandardSaleForFixedPrice.address,
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
          strategyStandardSaleForFixedPrice.address,
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

  describe("#2 - Non-standard orders", async () => {
    it("ERC1271/Contract Signature - MakerBid order is matched by TakerAsk order", async () => {
      const userSigningThroughContract = accounts[1];
      const takerAskUser = accounts[2];

      const MockSignerContract = await ethers.getContractFactory("MockSignerContract");
      const mockSignerContract = await MockSignerContract.connect(userSigningThroughContract).deploy();
      await mockSignerContract.deployed();

      await weth.connect(userSigningThroughContract).transfer(mockSignerContract.address, parseEther("1"));
      await mockSignerContract
        .connect(userSigningThroughContract)
        .approveERC20ToBeSpent(weth.address, looksRareExchange.address);

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: mockSignerContract.address,
        collection: mockERC721.address,
        tokenId: constants.One,
        price: parseEther("1"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: userSigningThroughContract,
        verifyingContract: looksRareExchange.address,
      });

      const takerAskOrder = createTakerOrder({
        isOrderAsk: true,
        taker: takerAskUser.address,
        tokenId: makerBidOrder.tokenId,
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
          mockSignerContract.address,
          strategyStandardSaleForFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          makerBidOrder.amount,
          makerBidOrder.price
        );

      // Verify funds/tokens were transferred
      assert.equal(await mockERC721.ownerOf("1"), mockSignerContract.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(mockSignerContract.address, makerBidOrder.nonce)
      );

      // Withdraw it back
      await mockSignerContract.connect(userSigningThroughContract).withdrawERC721NFT(mockERC721.address, "1");
      assert.equal(await mockERC721.ownerOf("1"), userSigningThroughContract.address);
    });

    it("ERC1271/Contract Signature - MakerAsk order is matched by TakerBid order", async () => {
      const userSigningThroughContract = accounts[1];
      const takerBidUser = accounts[2];
      const MockSignerContract = await ethers.getContractFactory("MockSignerContract");
      const mockSignerContract = await MockSignerContract.connect(userSigningThroughContract).deploy();
      await mockSignerContract.deployed();

      await mockERC721
        .connect(userSigningThroughContract)
        .transferFrom(userSigningThroughContract.address, mockSignerContract.address, "0");

      await mockSignerContract
        .connect(userSigningThroughContract)
        .approveERC721NFT(mockERC721.address, transferManagerERC721.address);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: mockSignerContract.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("1"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: userSigningThroughContract,
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder = createTakerOrder({
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: makerAskOrder.tokenId,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      });

      const tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          mockSignerContract.address,
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      // Verify funds/tokens were transferred
      assert.equal(await mockERC721.ownerOf("1"), takerBidUser.address);
      assert.deepEqual(await weth.balanceOf(mockSignerContract.address), takerBidOrder.price.mul("9800").div("10000"));

      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(mockSignerContract.address, makerAskOrder.nonce)
      );

      // Withdraw WETH back
      await mockSignerContract.connect(userSigningThroughContract).withdrawERC20(weth.address);
      assert.deepEqual(await weth.balanceOf(mockSignerContract.address), constants.Zero);
    });
  });

  describe("#3 - Royalty fee system", async () => {
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      const expectedRoyaltyAmount = BigNumber.from(takerBidOrder.price).mul("200").div("10000");

      await expect(tx)
        .to.emit(looksRareExchange, "RoyaltyPayment")
        .withArgs(
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          royaltyCollector.address,
          makerAskOrder.currency,
          expectedRoyaltyAmount
        );

      assert.equal(await mockERC721WithRoyalty.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // Verify WETH balance of royalty collector has increased
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), expectedRoyaltyAmount);
    });

    it("Fee/Royalty - Payment with ERC2981 works for ETH orders", async () => {
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      const expectedRoyaltyAmount = BigNumber.from(takerBidOrder.price).mul("200").div("10000");

      await expect(tx)
        .to.emit(looksRareExchange, "RoyaltyPayment")
        .withArgs(
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          royaltyCollector.address,
          makerAskOrder.currency,
          expectedRoyaltyAmount
        );
      assert.equal(await mockERC721WithRoyalty.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // Verify WETH balance of royalty collector has increased
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), expectedRoyaltyAmount);
    });

    it("Fee/Royalty - Payment for custom integration works", async () => {
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
        strategy: strategyStandardSaleForFixedPrice.address,
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
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      const expectedRoyaltyAmount = BigNumber.from(takerBidOrder.price).mul(fee).div("10000");

      await expect(tx)
        .to.emit(looksRareExchange, "RoyaltyPayment")
        .withArgs(
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          royaltyCollector.address,
          makerAskOrder.currency,
          expectedRoyaltyAmount
        );

      assert.equal(await mockERC721.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // Verify WETH balance of royalty collector has increased
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), expectedRoyaltyAmount);
    });

    it("Fee/Royalty - Slippage protection works for MakerAsk", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      // Set 3% for royalties
      const fee = "300";
      await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollection(mockERC721.address, admin.address, royaltyCollector.address, fee);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: BigNumber.from("9500"), // ProtocolFee: 2%, RoyaltyFee: 3%
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      // Update to 3.01% for royalties
      await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollection(mockERC721.address, admin.address, royaltyCollector.address, "301");

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: parseEther("3"),
        })
      ).to.be.revertedWith("Fees: Higher than expected");

      // Update back to 3.00% for royalties
      await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollection(mockERC721.address, admin.address, royaltyCollector.address, fee);

      // Trade is executed
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
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );
    });

    it("Fee/Royalty - Slippage protection works for TakerAsk", async () => {
      const makerBidUser = accounts[2];
      const takerAskUser = accounts[1];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        price: parseEther("3"),
        minPercentageToAsk: BigNumber.from("9500"), // ProtocolFee: 2%, RoyaltyFee: 3%
        params: defaultAbiCoder.encode([], []),
      });

      // Update to 3.01% for royalties
      await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollection(mockERC721.address, admin.address, royaltyCollector.address, "301");

      await expect(
        looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
      ).to.be.revertedWith("Fees: Higher than expected");

      // Update back to 3.00% for royalties
      await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollection(mockERC721.address, admin.address, royaltyCollector.address, "300");

      const tx = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyStandardSaleForFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          makerBidOrder.amount,
          makerBidOrder.price
        );
    });

    it("Fee/Royalty/Private Sale - Royalty fee is collected but no platform fee", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      // Verify balance of royaltyCollector is 0
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), constants.Zero);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721WithRoyalty.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyPrivateSale.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["address"], [takerBidUser.address]), // target user
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: takerBidUser.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
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
          strategyPrivateSale.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      assert.equal(await mockERC721WithRoyalty.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, makerAskOrder.nonce)
      );

      // Verify WETH balance of royalty collector has increased
      assert.deepEqual(await weth.balanceOf(royaltyCollector.address), takerBidOrder.price.mul("200").div("10000"));

      // Verify balance of admin (aka treasury) is 0
      assert.deepEqual(await weth.balanceOf(admin.address), constants.Zero);
    });

    it("RoyaltyFeeSetter - Owner can set the royalty fee", async () => {
      const fee = "200";
      const MockERC721WithOwner = await ethers.getContractFactory("MockERC721WithOwner");
      const mockERC721WithOwner = await MockERC721WithOwner.deploy("Mock Ownable ERC721", "MOERC721");
      await mockERC721WithOwner.deployed();

      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollectionIfAdmin(
            mockERC721WithOwner.address,
            royaltyCollector.address,
            royaltyCollector.address,
            fee
          )
      ).to.be.revertedWith("function selector was not recognized and there's no fallback function");

      const tx = await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollectionIfOwner(
          mockERC721WithOwner.address,
          royaltyCollector.address,
          royaltyCollector.address,
          fee
        );

      await expect(tx)
        .to.emit(royaltyFeeRegistry, "RoyaltyFeeUpdate")
        .withArgs(mockERC721WithOwner.address, royaltyCollector.address, royaltyCollector.address, fee);
    });

    it("RoyaltyFeeSetter - Admin can set the royalty fee", async () => {
      const fee = "200";
      const MockERC721WithAdmin = await ethers.getContractFactory("MockERC721WithAdmin");
      const mockERC721WithAdmin = await MockERC721WithAdmin.deploy("Mock Ownable ERC721", "MOERC721");
      await mockERC721WithAdmin.deployed();

      let res = await royaltyFeeSetter.checkForCollectionSetter(mockERC721WithAdmin.address);
      assert.equal(res[0], admin.address);
      assert.equal(res[1].toString(), "3");

      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollectionIfOwner(
            mockERC721WithAdmin.address,
            royaltyCollector.address,
            royaltyCollector.address,
            fee
          )
      ).to.be.revertedWith("function selector was not recognized and there's no fallback function");

      const tx = await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollectionIfAdmin(
          mockERC721WithAdmin.address,
          royaltyCollector.address,
          royaltyCollector.address,
          "200"
        );

      await expect(tx)
        .to.emit(royaltyFeeRegistry, "RoyaltyFeeUpdate")
        .withArgs(mockERC721WithAdmin.address, royaltyCollector.address, royaltyCollector.address, fee);

      res = await royaltyFeeSetter.checkForCollectionSetter(mockERC721WithAdmin.address);
      assert.equal(res[0], royaltyCollector.address);
      assert.equal(res[1].toString(), "0");
    });

    it("RoyaltyFeeSetter - Owner cannot set the royalty fee if already set", async () => {
      const MockERC721WithOwner = await ethers.getContractFactory("MockERC721WithOwner");
      const mockERC721WithOwner = await MockERC721WithOwner.deploy("Mock Ownable ERC721", "MOERC721");
      await mockERC721WithOwner.deployed();

      let res = await royaltyFeeSetter.checkForCollectionSetter(mockERC721WithOwner.address);
      assert.equal(res[0], admin.address);
      assert.equal(res[1].toString(), "2");

      await royaltyFeeSetter
        .connect(admin)
        .updateRoyaltyInfoForCollectionIfOwner(
          mockERC721WithOwner.address,
          royaltyCollector.address,
          royaltyCollector.address,
          "200"
        );

      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollectionIfOwner(
            mockERC721WithOwner.address,
            royaltyCollector.address,
            royaltyCollector.address,
            "200"
          )
      ).to.been.revertedWith("Setter: Already set");

      const tx = await royaltyFeeSetter
        .connect(royaltyCollector)
        .updateRoyaltyInfoForCollectionIfSetter(
          mockERC721WithOwner.address,
          royaltyCollector.address,
          royaltyCollector.address,
          "200"
        );

      await expect(tx)
        .to.emit(royaltyFeeRegistry, "RoyaltyFeeUpdate")
        .withArgs(mockERC721WithOwner.address, royaltyCollector.address, royaltyCollector.address, "200");

      res = await royaltyFeeSetter.checkForCollectionSetter(mockERC721WithOwner.address);
      assert.equal(res[0], royaltyCollector.address);
      assert.equal(res[1].toString(), "0");
    });

    it("RoyaltyFeeSetter - No function selector if no admin()/owner() function", async () => {
      const res = await royaltyFeeSetter.checkForCollectionSetter(mockERC721.address);
      assert.equal(res[0], constants.AddressZero);
      assert.equal(res[1].toString(), "4");

      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollectionIfOwner(mockERC721.address, admin.address, royaltyCollector.address, "200")
      ).to.be.revertedWith("function selector was not recognized and there's no fallback function");

      await expect(
        royaltyFeeSetter.updateRoyaltyInfoForCollectionIfAdmin(
          mockERC721.address,
          admin.address,
          royaltyCollector.address,
          "200"
        )
      ).to.be.revertedWith("function selector was not recognized and there's no fallback function");
    });

    it("RoyaltyFeeSetter - Cannot adjust if not the setter", async () => {
      await expect(
        royaltyFeeSetter.updateRoyaltyInfoForCollectionIfSetter(
          mockERC721.address,
          admin.address,
          royaltyCollector.address,
          "200"
        )
      ).to.be.revertedWith("Setter: Not the setter");
    });

    it("RoyaltyFeeSetter - Cannot set a royalty fee too high", async () => {
      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollection(
            mockERC721.address,
            royaltyCollector.address,
            royaltyCollector.address,
            "9501"
          )
      ).to.be.revertedWith("Registry: Royalty fee too high");
    });

    it("RoyaltyFeeSetter - Cannot set a royalty fee if not compliant", async () => {
      const MockNonCompliantERC721 = await ethers.getContractFactory("MockNonCompliantERC721");
      const mockNonCompliantERC721 = await MockNonCompliantERC721.deploy("Mock Bad ERC721", "MBERC721");
      await mockNonCompliantERC721.deployed();

      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollectionIfOwner(
            mockNonCompliantERC721.address,
            royaltyCollector.address,
            royaltyCollector.address,
            "500"
          )
      ).to.be.revertedWith("Setter: Not ERC721/ERC1155");
    });

    it("RoyaltyFeeSetter - Cannot set custom royalty fee if ERC2981", async () => {
      const res = await royaltyFeeSetter.checkForCollectionSetter(mockERC721WithRoyalty.address);

      assert.equal(res[0], constants.AddressZero);
      assert.equal(res[1].toString(), "1");

      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollectionIfOwner(
            mockERC721WithRoyalty.address,
            royaltyCollector.address,
            royaltyCollector.address,
            "500"
          )
      ).to.be.revertedWith("Owner: Must not be ERC2981");

      await expect(
        royaltyFeeSetter
          .connect(admin)
          .updateRoyaltyInfoForCollectionIfAdmin(
            mockERC721WithRoyalty.address,
            royaltyCollector.address,
            royaltyCollector.address,
            "500"
          )
      ).to.be.revertedWith("Admin: Must not be ERC2981");
    });
  });

  describe("#4 - Standard logic revertions", async () => {
    it("One Cancel Other - Initial order is not executable anymore", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const initialMakerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      const adjustedMakerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("2.5"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        price: parseEther("2.5"),
        tokenId: constants.Zero,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      });

      const tx = await looksRareExchange
        .connect(takerBidUser)
        .matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, adjustedMakerAskOrder, {
          value: takerBidOrder.price,
        });

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(adjustedMakerAskOrder),
          adjustedMakerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyStandardSaleForFixedPrice.address,
          adjustedMakerAskOrder.currency,
          adjustedMakerAskOrder.collection,
          takerBidOrder.tokenId,
          adjustedMakerAskOrder.amount,
          adjustedMakerAskOrder.price
        );

      assert.equal(await mockERC721.ownerOf("0"), takerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, adjustedMakerAskOrder.nonce)
      );

      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerAskUser.address, initialMakerAskOrder.nonce)
      );

      // Initial order is not executable anymore
      await expect(
        looksRareExchange
          .connect(takerBidUser)
          .matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, initialMakerAskOrder, {
            value: takerBidOrder.price,
          })
      ).to.be.revertedWith("Order: Matching order expired");
    });

    it("Cancel - Cannot match if order was cancelled", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        tokenId: makerAskOrder.tokenId,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      });

      const tx = await looksRareExchange.connect(makerAskUser).cancelMultipleMakerOrders([makerAskOrder.nonce]);
      // Event params are not tested because of array issue with BN
      await expect(tx).to.emit(looksRareExchange, "CancelMultipleOrders");

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        })
      ).to.be.revertedWith("Order: Matching order expired");
    });

    it("Cancel - Cannot match if on a different checkpoint than current on-chain signer's checkpoint", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[3];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        tokenId: makerAskOrder.tokenId,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      });

      const tx = await looksRareExchange.connect(makerAskUser).cancelAllOrdersForSender("1");
      await expect(tx).to.emit(looksRareExchange, "CancelAllOrders").withArgs(makerAskUser.address, "1");

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        })
      ).to.be.revertedWith("Order: Matching order expired");
    });

    it("Order - Cannot match if msg.value is too high", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[3];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        price: makerAskOrder.price,
        tokenId: makerAskOrder.tokenId,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price.add(constants.One),
        })
      ).to.be.revertedWith("Order: Msg.value too high");
    });

    it("Order - Cannot match is amount is 0", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[3];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.Zero,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder, {})
      ).to.be.revertedWith("Order: Amount cannot be 0");
    });

    it("Order - Cannot match 2 ask orders, 2 bid orders, or taker not the sender", async () => {
      const makerAskUser = accounts[2];
      const fakeTakerUser = accounts[3];
      const takerBidUser = accounts[4];

      // 1. MATCH ASK WITH TAKER BID
      // 1.1 Signer is not the actual signer
      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        looksRareExchange.connect(fakeTakerUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder, {})
      ).to.be.revertedWith("Order: Taker must be the sender");

      await expect(
        looksRareExchange.connect(fakeTakerUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        })
      ).to.be.revertedWith("Order: Taker must be the sender");

      // 1.2 Wrong sides
      takerBidOrder.isOrderAsk = true;

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder, {})
      ).to.be.revertedWith("Order: Wrong sides");

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        })
      ).to.be.revertedWith("Order: Wrong sides");

      makerAskOrder.isOrderAsk = false;

      // No need to duplicate tests again
      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder, {})
      ).to.be.revertedWith("Order: Wrong sides");

      takerBidOrder.isOrderAsk = false;

      // No need to duplicate tests again
      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
      ).to.be.revertedWith("Order: Wrong sides");

      // 2. MATCH ASK WITH TAKER BID
      // 2.1 Signer is not the actual signer
      const takerAskUser = accounts[1];
      const makerBidUser = accounts[2];

      const makerBidOrder = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        tokenId: makerAskOrder.tokenId,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      });

      await expect(
        looksRareExchange.connect(fakeTakerUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
      ).to.be.revertedWith("Order: Taker must be the sender");

      // 2.2 Wrong sides
      takerAskOrder.isOrderAsk = false;

      await expect(
        looksRareExchange.connect(makerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
      ).to.be.revertedWith("Order: Wrong sides");

      makerBidOrder.isOrderAsk = true;

      await expect(
        looksRareExchange.connect(takerBidUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
      ).to.be.revertedWith("Order: Wrong sides");

      takerAskOrder.isOrderAsk = true;

      await expect(
        looksRareExchange.connect(takerBidUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder, {})
      ).to.be.revertedWith("Order: Wrong sides");
    });

    it("Cancel - Cannot cancel all at an nonce equal or lower than existing one", async () => {
      await expect(looksRareExchange.connect(accounts[1]).cancelAllOrdersForSender("0")).to.be.revertedWith(
        "Cancel: Order nonce lower than current"
      );

      await expect(looksRareExchange.connect(accounts[1]).cancelAllOrdersForSender("500000")).to.be.revertedWith(
        "Cancel: Cannot cancel more orders"
      );

      // Change the minimum nonce for user to 2
      await looksRareExchange.connect(accounts[1]).cancelAllOrdersForSender("2");

      await expect(looksRareExchange.connect(accounts[1]).cancelAllOrdersForSender("1")).to.be.revertedWith(
        "Cancel: Order nonce lower than current"
      );

      await expect(looksRareExchange.connect(accounts[1]).cancelAllOrdersForSender("2")).to.be.revertedWith(
        "Cancel: Order nonce lower than current"
      );
    });

    it("Cancel - Cannot cancel all at an nonce equal than existing one", async () => {
      // Change the minimum nonce for user to 2
      await looksRareExchange.connect(accounts[1]).cancelAllOrdersForSender("2");

      await expect(looksRareExchange.connect(accounts[1]).cancelMultipleMakerOrders(["0"])).to.be.revertedWith(
        "Cancel: Order nonce lower than current"
      );

      await expect(looksRareExchange.connect(accounts[1]).cancelMultipleMakerOrders(["3", "1"])).to.be.revertedWith(
        "Cancel: Order nonce lower than current"
      );

      // Can cancel at the same nonce that minimum one
      await looksRareExchange.connect(accounts[1]).cancelMultipleMakerOrders(["2"]);
    });

    it("Order - Cannot trade before startTime", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      startTimeOrder = BigNumber.from(
        (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
      ).add("5000");
      endTimeOrder = startTimeOrder.add(BigNumber.from("10000"));

      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        tokenId: makerAskOrder.tokenId,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      });
      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder)
      ).to.be.revertedWith("Strategy: Execution invalid");

      await increaseTo(startTimeOrder);
      await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
    });

    it("Order - Cannot trade after endTime", async () => {
      const makerBidUser = accounts[2];
      const takerAskUser = accounts[1];

      endTimeOrder = startTimeOrder.add(BigNumber.from("5000"));

      const makerBidOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        tokenId: makerBidOrder.tokenId,
        price: makerBidOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      });

      await increaseTo(endTimeOrder.add(1));

      await expect(
        looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
      ).to.be.revertedWith("Strategy: Execution invalid");
    });

    it("Currency - Cannot match if currency is removed", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];
      const tx = await currencyManager.connect(admin).removeCurrency(weth.address);
      await expect(tx).to.emit(currencyManager, "CurrencyRemoved").withArgs(weth.address);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        })
      ).to.be.revertedWith("Currency: Not whitelisted");

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder, {})
      ).to.be.revertedWith("Currency: Not whitelisted");
    });

    it("Currency - Cannot use function to match MakerAsk with native asset if maker currency not WETH", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: mockUSDT.address,
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
        tokenId: makerAskOrder.price,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBidUsingETHAndWETH(takerBidOrder, makerAskOrder, {
          value: takerBidOrder.price,
        })
      ).to.be.revertedWith("Order: Currency must be WETH");
    });

    it("Currency - Cannot match until currency is whitelisted", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      // Each users mints 1M USDT
      await mockUSDT.connect(takerBidUser).mint(takerBidUser.address, parseEther("1000000"));

      // Set approval for USDT
      await mockUSDT.connect(takerBidUser).approve(looksRareExchange.address, constants.MaxUint256);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: mockUSDT.address,
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
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder, {})
      ).to.be.revertedWith("Currency: Not whitelisted");

      let tx = await currencyManager.connect(admin).addCurrency(mockUSDT.address);
      await expect(tx).to.emit(currencyManager, "CurrencyWhitelisted").withArgs(mockUSDT.address);

      tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);
      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );
    });

    it("Strategy - Cannot match if strategy not whitelisted", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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

      let tx = await executionManager.connect(admin).removeStrategy(strategyStandardSaleForFixedPrice.address);
      await expect(tx).to.emit(executionManager, "StrategyRemoved").withArgs(strategyStandardSaleForFixedPrice.address);

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
      ).to.be.revertedWith("Strategy: Not whitelisted");

      tx = await executionManager.connect(admin).addStrategy(strategyStandardSaleForFixedPrice.address);
      await expect(tx)
        .to.emit(executionManager, "StrategyWhitelisted")
        .withArgs(strategyStandardSaleForFixedPrice.address);

      tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );
    });

    it("Transfer - Cannot match if no transfer manager", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const MockNonCompliantERC721 = await ethers.getContractFactory("MockNonCompliantERC721");
      const mockNonCompliantERC721 = await MockNonCompliantERC721.deploy("Mock Bad ERC721", "MBERC721");
      await mockNonCompliantERC721.deployed();

      // User1 mints tokenId=0
      await mockNonCompliantERC721.connect(makerAskUser).mint(makerAskUser.address);

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockNonCompliantERC721.address,
        price: parseEther("3"),
        tokenId: constants.Zero,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
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
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder, {})
      ).to.be.revertedWith("Transfer: No NFT transfer manager available");

      let tx = await transferSelectorNFT
        .connect(admin)
        .addCollectionTransferManager(mockNonCompliantERC721.address, transferManagerNonCompliantERC721.address);

      await expect(tx)
        .to.emit(transferSelectorNFT, "CollectionTransferManagerAdded")
        .withArgs(mockNonCompliantERC721.address, transferManagerNonCompliantERC721.address);

      assert.equal(
        await transferSelectorNFT.transferManagerSelectorForCollection(mockNonCompliantERC721.address),
        transferManagerNonCompliantERC721.address
      );

      // User approves custom transfer manager contract
      await mockNonCompliantERC721
        .connect(makerAskUser)
        .setApprovalForAll(transferManagerNonCompliantERC721.address, true);

      tx = await looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder);

      await expect(tx)
        .to.emit(looksRareExchange, "TakerBid")
        .withArgs(
          computeOrderHash(makerAskOrder),
          makerAskOrder.nonce,
          takerBidUser.address,
          makerAskUser.address,
          strategyStandardSaleForFixedPrice.address,
          makerAskOrder.currency,
          makerAskOrder.collection,
          takerBidOrder.tokenId,
          makerAskOrder.amount,
          makerAskOrder.price
        );

      tx = await transferSelectorNFT.removeCollectionTransferManager(mockNonCompliantERC721.address);

      await expect(tx)
        .to.emit(transferSelectorNFT, "CollectionTransferManagerRemoved")
        .withArgs(mockNonCompliantERC721.address);

      assert.equal(
        await transferSelectorNFT.transferManagerSelectorForCollection(mockNonCompliantERC721.address),
        constants.AddressZero
      );
    });
  });

  describe("#5 - Unusual logic revertions", async () => {
    it("CurrencyManager/ExecutionManager - Revertions work as expected", async () => {
      await expect(currencyManager.connect(admin).addCurrency(weth.address)).to.be.revertedWith(
        "Currency: Already whitelisted"
      );

      await expect(currencyManager.connect(admin).removeCurrency(mockUSDT.address)).to.be.revertedWith(
        "Currency: Not whitelisted"
      );

      await expect(executionManager.connect(admin).addStrategy(strategyPrivateSale.address)).to.be.revertedWith(
        "Strategy: Already whitelisted"
      );

      // MockUSDT is obviously not a strategy but this checks only if the address is in enumerable set
      await expect(executionManager.connect(admin).removeStrategy(mockUSDT.address)).to.be.revertedWith(
        "Strategy: Not whitelisted"
      );
    });

    it("SignatureChecker - Cannot match if v parameters is not 27 or 28", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      makerAskOrder.v = 29;

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
      ).to.be.revertedWith("Signature: Invalid v parameter");
    });

    it("SignatureChecker - Cannot match if invalid s parameter", async () => {
      const makerAskUser = accounts[1];
      const takerBidUser = accounts[2];

      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      // The s value is picked randomly to make the condition be rejected
      makerAskOrder.s = "0x9ca0e65dda4b504989e1db8fc30095f24489ee7226465e9545c32fc7853fe985";

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: takerBidUser.address,
        price: makerAskOrder.price,
        tokenId: makerAskOrder.tokenId,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      await expect(
        looksRareExchange.connect(takerBidUser).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
      ).to.be.revertedWith("Signature: Invalid s parameter");
    });

    it("Order - Cannot cancel if no order", async () => {
      await expect(looksRareExchange.connect(accounts[1]).cancelMultipleMakerOrders([])).to.be.revertedWith(
        "Cancel: Cannot be empty"
      );

      await expect(looksRareExchange.connect(accounts[2]).cancelMultipleMakerOrders([])).to.be.revertedWith(
        "Cancel: Cannot be empty"
      );
    });

    it("Order - Cannot execute if signer is null address", async () => {
      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: constants.AddressZero,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: accounts[3],
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: accounts[2].address,
        tokenId: makerAskOrder.tokenId,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      await expect(
        looksRareExchange.connect(accounts[2]).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
      ).to.be.revertedWith("Order: Invalid signer");
    });

    it("Order - Cannot execute if wrong signer", async () => {
      const makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: accounts[1].address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
        signerUser: accounts[3],
        verifyingContract: looksRareExchange.address,
      });

      const takerBidOrder: TakerOrder = {
        isOrderAsk: false,
        taker: accounts[2].address,
        tokenId: makerAskOrder.tokenId,
        price: makerAskOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode([], []),
      };

      await expect(
        looksRareExchange.connect(accounts[2]).matchAskWithTakerBid(takerBidOrder, makerAskOrder)
      ).to.be.revertedWith("Signature: Invalid");
    });

    it("Transfer Managers - Transfer functions only callable by LooksRareExchange", async () => {
      await expect(
        transferManagerERC721
          .connect(accounts[5])
          .transferNonFungibleToken(mockERC721.address, accounts[1].address, accounts[5].address, "0", "1")
      ).to.be.revertedWith("Transfer: Only LooksRare Exchange");

      await expect(
        transferManagerERC1155
          .connect(accounts[5])
          .transferNonFungibleToken(mockERC1155.address, accounts[1].address, accounts[5].address, "0", "2")
      ).to.be.revertedWith("Transfer: Only LooksRare Exchange");

      await expect(
        transferManagerNonCompliantERC721
          .connect(accounts[5])
          .transferNonFungibleToken(mockERC721.address, accounts[1].address, accounts[5].address, "0", "1")
      ).to.be.revertedWith("Transfer: Only LooksRare Exchange");
    });
  });

  describe("#6 - Owner functions and access rights", async () => {
    it("LooksRareExchange - Null address in owner functions", async () => {
      await expect(looksRareExchange.connect(admin).updateCurrencyManager(constants.AddressZero)).to.be.revertedWith(
        "Owner: Cannot be null address"
      );

      await expect(looksRareExchange.connect(admin).updateExecutionManager(constants.AddressZero)).to.be.revertedWith(
        "Owner: Cannot be null address"
      );

      await expect(looksRareExchange.connect(admin).updateRoyaltyFeeManager(constants.AddressZero)).to.be.revertedWith(
        "Owner: Cannot be null address"
      );

      await expect(
        looksRareExchange.connect(admin).updateTransferSelectorNFT(constants.AddressZero)
      ).to.be.revertedWith("Owner: Cannot be null address");
    });

    it("LooksRareExchange - Owner functions work as expected", async () => {
      let tx = await looksRareExchange.connect(admin).updateCurrencyManager(currencyManager.address);
      await expect(tx).to.emit(looksRareExchange, "NewCurrencyManager").withArgs(currencyManager.address);

      tx = await looksRareExchange.connect(admin).updateExecutionManager(executionManager.address);
      await expect(tx).to.emit(looksRareExchange, "NewExecutionManager").withArgs(executionManager.address);

      tx = await looksRareExchange.connect(admin).updateRoyaltyFeeManager(royaltyFeeManager.address);
      await expect(tx).to.emit(looksRareExchange, "NewRoyaltyFeeManager").withArgs(royaltyFeeManager.address);

      tx = await looksRareExchange.connect(admin).updateProtocolFeeRecipient(admin.address);
      await expect(tx).to.emit(looksRareExchange, "NewProtocolFeeRecipient").withArgs(admin.address);
    });

    it("TransferSelector - Owner revertions work as expected", async () => {
      await expect(
        transferSelectorNFT.connect(admin).addCollectionTransferManager(mockERC721.address, constants.AddressZero)
      ).to.be.revertedWith("Owner: TransferManager cannot be null address");

      await expect(
        transferSelectorNFT
          .connect(admin)
          .addCollectionTransferManager(constants.AddressZero, transferManagerERC721.address)
      ).to.be.revertedWith("Owner: Collection cannot be null address");

      await expect(
        transferSelectorNFT.connect(admin).removeCollectionTransferManager(mockERC721.address)
      ).to.be.revertedWith("Owner: Collection has no transfer manager");
    });

    it("FeeSetter/FeeRegistry - Owner functions work as expected", async () => {
      let tx = await royaltyFeeSetter.connect(admin).updateRoyaltyFeeLimit("30");
      await expect(tx).to.emit(royaltyFeeRegistry, "NewRoyaltyFeeLimit").withArgs("30");

      await expect(royaltyFeeSetter.connect(admin).updateRoyaltyFeeLimit("9501")).to.be.revertedWith(
        "Owner: Royalty fee limit too high"
      );

      tx = await royaltyFeeSetter.connect(admin).updateOwnerOfRoyaltyFeeRegistry(admin.address);
      await expect(tx)
        .to.emit(royaltyFeeRegistry, "OwnershipTransferred")
        .withArgs(royaltyFeeSetter.address, admin.address);
    });

    it("LooksRareExchange - Owner functions are only callable by owner", async () => {
      const notAdminUser = accounts[3];

      await expect(
        looksRareExchange.connect(notAdminUser).updateCurrencyManager(currencyManager.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        looksRareExchange.connect(notAdminUser).updateExecutionManager(executionManager.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        looksRareExchange.connect(notAdminUser).updateProtocolFeeRecipient(notAdminUser.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        looksRareExchange.connect(notAdminUser).updateRoyaltyFeeManager(royaltyFeeManager.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        looksRareExchange.connect(notAdminUser).updateTransferSelectorNFT(transferSelectorNFT.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("CurrencyManager/ExecutionManager/RoyaltyFeeRegistry/RoyaltyFeeSetter/TransferSelectorNFT - Owner functions are only callable by owner", async () => {
      const notAdminUser = accounts[3];

      await expect(currencyManager.connect(notAdminUser).addCurrency(mockUSDT.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(currencyManager.connect(notAdminUser).removeCurrency(weth.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(executionManager.connect(notAdminUser).addStrategy(strategyPrivateSale.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(
        executionManager.connect(notAdminUser).removeStrategy(strategyPrivateSale.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(royaltyFeeRegistry.connect(notAdminUser).updateRoyaltyFeeLimit("30")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(
        royaltyFeeSetter
          .connect(notAdminUser)
          .updateRoyaltyInfoForCollection(mockERC721.address, notAdminUser.address, notAdminUser.address, "5000")
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        royaltyFeeSetter.connect(notAdminUser).updateOwnerOfRoyaltyFeeRegistry(notAdminUser.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(royaltyFeeSetter.connect(notAdminUser).updateRoyaltyFeeLimit("10")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(
        transferSelectorNFT
          .connect(notAdminUser)
          .addCollectionTransferManager(mockERC721WithRoyalty.address, transferManagerERC721.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        transferSelectorNFT.connect(notAdminUser).removeCollectionTransferManager(mockERC721WithRoyalty.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#7 - View functions", async () => {
    it("CurrencyManager - View functions work as expected", async () => {
      // Add a 2nd currency
      await currencyManager.connect(admin).addCurrency(mockUSDT.address);

      const numberCurrencies = await currencyManager.viewCountWhitelistedCurrencies();
      assert.equal(numberCurrencies.toString(), "2");

      let tx = await currencyManager.viewWhitelistedCurrencies("0", "1");
      assert.equal(tx[0].length, 1);
      assert.deepEqual(BigNumber.from(tx[1].toString()), constants.One);

      tx = await currencyManager.viewWhitelistedCurrencies("1", "100");
      assert.equal(tx[0].length, 1);
      assert.deepEqual(BigNumber.from(tx[1].toString()), BigNumber.from(numberCurrencies.toString()));
    });

    it("ExecutionManager - View functions work as expected", async () => {
      const numberStrategies = await executionManager.viewCountWhitelistedStrategies();
      assert.equal(numberStrategies.toString(), "6");

      let tx = await executionManager.viewWhitelistedStrategies("0", "2");
      assert.equal(tx[0].length, 2);
      assert.deepEqual(BigNumber.from(tx[1].toString()), constants.Two);

      tx = await executionManager.viewWhitelistedStrategies("2", "100");
      assert.equal(tx[0].length, 4);
      assert.deepEqual(BigNumber.from(tx[1].toString()), BigNumber.from(numberStrategies.toString()));
    });
  });
});
