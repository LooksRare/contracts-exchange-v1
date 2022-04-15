import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { MerkleTree } from "merkletreejs";
/* eslint-disable node/no-extraneous-import */
import { keccak256 } from "js-sha3";
import { ethers } from "hardhat";

import { computeDomainSeparator, computeOrderHash } from "./helpers/signature-helper";
import { MakerOrderWithSignature } from "./helpers/order-types";
import { createMakerOrder, createTakerOrder } from "./helpers/order-helper";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { increaseTo } from "./helpers/block-traveller";

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

  // Strategy contracts
  let strategyPrivateSale: Contract;
  let strategyDutchAuction: Contract;
  let strategyStandardSaleForFixedPrice: Contract;
  let strategyAnyItemFromCollectionForFixedPrice: Contract;
  let strategyAnyItemInASetForAFixedPrice: Contract;

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
    royaltyCollector = accounts[15];
    feeRecipient = accounts[19];
    standardProtocolFee = BigNumber.from("200");
    royaltyFeeLimit = BigNumber.from("9500"); // 95%

    // Deploy Mock USDT, WETH, Mock ERC721, Mock ERC1155
    const WETH = await ethers.getContractFactory("WETH");
    weth = await WETH.deploy();
    await weth.deployed();

    const MockERC721 = await ethers.getContractFactory("MockERC721");
    mockERC721 = await MockERC721.deploy("Mock ERC721", "MERC721");
    await mockERC721.deployed();

    const MockERC1155 = await ethers.getContractFactory("MockERC1155");
    mockERC1155 = await MockERC1155.deploy("uri/");
    await mockERC1155.deployed();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDT = await MockERC20.deploy("USD Tether", "USDT");
    await mockUSDT.deployed();

    const MockERC721WithRoyalty = await ethers.getContractFactory("MockERC721WithRoyalty");
    mockERC721WithRoyalty = await MockERC721WithRoyalty.connect(royaltyCollector).deploy(
      "Mock Royalty ERC721",
      "MRC721",
      "200" // 2% royalty fee
    );
    await mockERC721WithRoyalty.deployed();

    // Deploy Currency Manager and add WETH to supported currencies
    const CurrencyManager = await ethers.getContractFactory("CurrencyManager");
    currencyManager = await CurrencyManager.deploy();
    await currencyManager.deployed();
    await currencyManager.connect(admin).addCurrency(weth.address);

    // Deploy Execution Manager
    const ExecutionManager = await ethers.getContractFactory("ExecutionManager");
    executionManager = await ExecutionManager.deploy();
    await executionManager.deployed();

    // Deploy Strategies for trade execution
    const StrategyAnyItemFromCollectionForFixedPrice = await ethers.getContractFactory(
      "StrategyAnyItemFromCollectionForFixedPrice"
    );
    strategyAnyItemFromCollectionForFixedPrice = await StrategyAnyItemFromCollectionForFixedPrice.deploy(200);
    await strategyAnyItemFromCollectionForFixedPrice.deployed();

    const StrategyAnyItemInASetForAFixedPrice = await ethers.getContractFactory("StrategyAnyItemInASetForAFixedPrice");
    strategyAnyItemInASetForAFixedPrice = await StrategyAnyItemInASetForAFixedPrice.deploy(standardProtocolFee);
    await strategyAnyItemInASetForAFixedPrice.deployed();

    const StrategyDutchAuction = await ethers.getContractFactory("StrategyDutchAuction");
    strategyDutchAuction = await StrategyDutchAuction.deploy(
      standardProtocolFee,
      BigNumber.from("900") // 15 minutes
    );

    await strategyDutchAuction.deployed();

    const StrategyPrivateSale = await ethers.getContractFactory("StrategyPrivateSale");
    strategyPrivateSale = await StrategyPrivateSale.deploy(constants.Zero);
    await strategyPrivateSale.deployed();

    const StrategyStandardSaleForFixedPrice = await ethers.getContractFactory("StrategyStandardSaleForFixedPrice");
    strategyStandardSaleForFixedPrice = await StrategyStandardSaleForFixedPrice.deploy(standardProtocolFee);
    await strategyStandardSaleForFixedPrice.deployed();

    // Whitelist these five strategies
    await executionManager.connect(admin).addStrategy(strategyStandardSaleForFixedPrice.address);
    await executionManager.connect(admin).addStrategy(strategyAnyItemFromCollectionForFixedPrice.address);
    await executionManager.connect(admin).addStrategy(strategyAnyItemInASetForAFixedPrice.address);
    await executionManager.connect(admin).addStrategy(strategyDutchAuction.address);
    await executionManager.connect(admin).addStrategy(strategyPrivateSale.address);

    // Deploy RoyaltyFee Registry/Setter/Manager
    const RoyaltyFeeRegistry = await ethers.getContractFactory("RoyaltyFeeRegistry");
    royaltyFeeRegistry = await RoyaltyFeeRegistry.deploy(royaltyFeeLimit);
    await royaltyFeeRegistry.deployed();

    const RoyaltyFeeSetter = await ethers.getContractFactory("RoyaltyFeeSetter");
    royaltyFeeSetter = await RoyaltyFeeSetter.deploy(royaltyFeeRegistry.address);
    await royaltyFeeSetter.deployed();

    const RoyaltyFeeManager = await ethers.getContractFactory("RoyaltyFeeManager");
    royaltyFeeManager = await RoyaltyFeeManager.deploy(royaltyFeeRegistry.address);
    await royaltyFeeSetter.deployed();

    // Transfer ownership of RoyaltyFeeRegistry to RoyaltyFeeSetter
    await royaltyFeeRegistry.connect(admin).transferOwnership(royaltyFeeSetter.address);

    // Deploy LooksRare exchange
    const LooksRareExchange = await ethers.getContractFactory("LooksRareExchange");
    looksRareExchange = await LooksRareExchange.deploy(
      currencyManager.address,
      executionManager.address,
      royaltyFeeManager.address,
      weth.address,
      feeRecipient.address
    );
    await looksRareExchange.deployed();

    // Deploy transfer managers and transfer selector
    const TransferManagerERC721 = await ethers.getContractFactory("TransferManagerERC721");
    transferManagerERC721 = await TransferManagerERC721.deploy(looksRareExchange.address);
    await transferManagerERC721.deployed();
    const TransferManagerERC1155 = await ethers.getContractFactory("TransferManagerERC1155");
    transferManagerERC1155 = await TransferManagerERC1155.deploy(looksRareExchange.address);
    await transferManagerERC1155.deployed();
    const TransferManagerNonCompliantERC721 = await ethers.getContractFactory("TransferManagerNonCompliantERC721");
    transferManagerNonCompliantERC721 = await TransferManagerNonCompliantERC721.deploy(looksRareExchange.address);
    await transferManagerNonCompliantERC721.deployed();
    const TransferSelectorNFT = await ethers.getContractFactory("TransferSelectorNFT");
    transferSelectorNFT = await TransferSelectorNFT.deploy(
      transferManagerERC721.address,
      transferManagerERC1155.address
    );
    await transferSelectorNFT.deployed();

    // Set TransferSelectorNFT in LooksRare exchange
    await looksRareExchange.connect(admin).updateTransferSelectorNFT(transferSelectorNFT.address);

    for (const user of accounts) {
      if (user !== admin && user !== feeRecipient) {
        // Each user gets 30 WETH
        await weth.connect(user).deposit({ value: parseEther("30") });

        // Set approval for WETH
        await weth.connect(user).approve(looksRareExchange.address, constants.MaxUint256);

        // Each users mints 1M USDT
        await mockUSDT.connect(user).mint(user.address, parseEther("1000000"));

        // Set approval for USDT
        await mockUSDT.connect(user).approve(looksRareExchange.address, constants.MaxUint256);

        // Each user mints 1 ERC721 NFT
        await mockERC721.connect(user).mint(user.address);

        // Set approval for all tokens in mock collection to transferManager contract for ERC721
        await mockERC721.connect(user).setApprovalForAll(transferManagerERC721.address, true);

        // Each user mints 1 ERC721WithRoyalty NFT
        await mockERC721WithRoyalty.connect(user).mint(user.address);

        // Set approval for all tokens in mock collection to transferManager contract for ERC721WithRoyalty
        await mockERC721WithRoyalty.connect(user).setApprovalForAll(transferManagerERC721.address, true);

        // Each user batch mints 2 ERC1155 for tokenIds 1, 2, 3
        await mockERC1155
          .connect(user)
          .mintBatch(user.address, ["1", "2", "3"], ["2", "2", "2"], defaultAbiCoder.encode([], []));

        // Set approval for all tokens in mock collection to transferManager contract for ERC1155
        await mockERC1155.connect(user).setApprovalForAll(transferManagerERC1155.address, true);
      }
    }

    // Verify the domain separator is properly computed
    assert.equal(await looksRareExchange.DOMAIN_SEPARATOR(), computeDomainSeparator(looksRareExchange.address));

    // Set up defaults startTime/endTime
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

      // Order is worth 3 ETH; user2 splits it as 2 ETH + 1 WETH
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
    it("Collection Order/ERC721 - MakerBid order is matched by TakerAsk order", async () => {
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

    it("Collection Order/ERC1155 - MakerAsk order is matched by TakerBid order", async () => {
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

    it("Private Sale Order/ERC721 -  No platform fee, only target can buy", async () => {
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

      // User 3 cannot buy since the order target is only user2
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

    it("Dutch Auction Order/ERC721", async () => {
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

    it("Dutch Auction Order/ERC1155 - Buyer overpays", async () => {
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

    it("Trait-based Order/ERC721 - MakerAsk order is matched by TakerBid order", async () => {
      const takerAskUser = accounts[3]; // has tokenId=2
      const makerBidUser = accounts[1];

      // User wishes to buy either tokenId = 0, 2, 3, or 12
      const eligibleTokenIds = ["0", "2", "3", "12"];

      // Compute the leaves using Solidity keccak256 (Equivalent of keccak256 with abi.encodePacked) and converts to hex
      const leaves = eligibleTokenIds.map((x) => "0x" + utils.solidityKeccak256(["uint256"], [x]).substr(2));

      // Compute MerkleTree based on the computed leaves
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      // Compute the proof for index=1 (aka tokenId=2)
      const hexProof = tree.getHexProof(leaves[1], 1);

      // Compute the root of the tree
      const hexRoot = tree.getHexRoot();

      // Verify leaf is matched in the tree with the computed root
      assert.isTrue(tree.verify(hexProof, leaves[1], hexRoot));

      const makerBidOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero,
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyAnyItemInASetForAFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["bytes32"], [hexRoot]),
        signerUser: makerBidUser,
        verifyingContract: looksRareExchange.address,
      });

      const takerAskOrder = createTakerOrder({
        isOrderAsk: true,
        taker: takerAskUser.address,
        tokenId: BigNumber.from("2"),
        price: makerBidOrder.price,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["bytes32[]"], [hexProof]),
      });

      const tx = await looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder);
      await expect(tx)
        .to.emit(looksRareExchange, "TakerAsk")
        .withArgs(
          computeOrderHash(makerBidOrder),
          makerBidOrder.nonce,
          takerAskUser.address,
          makerBidUser.address,
          strategyAnyItemInASetForAFixedPrice.address,
          makerBidOrder.currency,
          makerBidOrder.collection,
          takerAskOrder.tokenId,
          makerBidOrder.amount,
          makerBidOrder.price
        );

      assert.equal(await mockERC721.ownerOf("2"), makerBidUser.address);
      assert.isTrue(
        await looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerBidUser.address, makerBidOrder.nonce)
      );
    });

    it("Trait-based Order/ERC721 - TokenIds not in the set cannot be sold", async () => {
      const takerAskUser = accounts[3]; // has tokenId=2
      const makerBidUser = accounts[1];

      // User wishes to buy either tokenId = 1, 2, 3, 4, or 12
      const eligibleTokenIds = ["1", "2", "3", "4", "12"];

      // Compute the leaves using Solidity keccak256 (Equivalent of keccak256 with abi.encodePacked) and converts to hex
      const leaves = eligibleTokenIds.map((x) => "0x" + utils.solidityKeccak256(["uint256"], [x]).substr(2));

      // Compute MerkleTree based on the computed leaves
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      // Compute the proof for index=1 (aka tokenId=2)
      const hexProof = tree.getHexProof(leaves[1], 1);

      // Compute the root of the tree
      const hexRoot = tree.getHexRoot();

      // Verify leaf is matched in the tree with the computed root
      assert.isTrue(tree.verify(hexProof, leaves[1], hexRoot));

      const makerBidOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: false,
        signer: makerBidUser.address,
        collection: mockERC721.address,
        tokenId: constants.Zero, // not used
        price: parseEther("3"),
        amount: constants.One,
        strategy: strategyAnyItemInASetForAFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: constants.Zero,
        params: defaultAbiCoder.encode(["bytes32"], [hexRoot]),
        signerUser: makerBidUser,
        verifyingContract: looksRareExchange.address,
      });

      for (const tokenId of Array.from(Array(20).keys())) {
        // If the tokenId is not included, it skips
        if (!eligibleTokenIds.includes(tokenId.toString())) {
          const takerAskOrder = createTakerOrder({
            isOrderAsk: true,
            taker: takerAskUser.address,
            tokenId: BigNumber.from(tokenId),
            price: parseEther("3"),
            minPercentageToAsk: constants.Zero,
            params: defaultAbiCoder.encode(["bytes32[]"], [hexProof]),
          });

          await expect(
            looksRareExchange.connect(takerAskUser).matchBidWithTakerAsk(takerAskOrder, makerBidOrder)
          ).to.be.revertedWith("Strategy: Execution invalid");
        }
      }
    });

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
});
