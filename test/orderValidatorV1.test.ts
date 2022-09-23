import { assert } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MakerOrderWithSignature } from "./helpers/order-types";
import { createMakerOrder } from "./helpers/order-helper";
import { setUp } from "./test-setup";
import { tokenSetUp } from "./token-set-up";
import {
  CUSTOM_TRANSFER_MANAGER,
  ERC1155_BALANCE_TOKEN_ID_INFERIOR_TO_AMOUNT,
  ERC1155_NO_APPROVAL_FOR_ALL,
  ERC20_APPROVAL_INFERIOR_TO_PRICE,
  ERC20_BALANCE_INFERIOR_TO_PRICE,
  ERC721_NO_APPROVAL_FOR_ALL_OR_TOKEN_ID,
  ERC721_TOKEN_ID_DOES_NOT_EXIST,
  ERC721_TOKEN_ID_NOT_IN_BALANCE,
  MIN_NET_RATIO_ABOVE_PROTOCOL_FEE,
  MIN_NET_RATIO_ABOVE_ROYALTY_FEE_ERC2981_AND_PROTOCOL_FEE,
  MIN_NET_RATIO_ABOVE_ROYALTY_FEE_REGISTRY_AND_PROTOCOL_FEE,
  ORDER_EXPECTED_TO_BE_VALID,
} from "./helpers/configErrorCodes";

const { defaultAbiCoder, parseEther } = utils;

describe("OrderValidatorV1 (additional tests)", () => {
  let mockERC721: Contract;
  let mockERC721WithRoyalty: Contract;
  let mockERC1155: Contract;
  let weth: Contract;

  // Exchange contracts
  let transferManagerERC721: Contract;
  let transferManagerERC1155: Contract;
  let transferManagerNonCompliantERC721: Contract;
  let transferSelectorNFT: Contract;
  let royaltyFeeSetter: Contract;
  let looksRareExchange: Contract;
  let orderValidatorV1: Contract;

  // Strategy contracts (used for this test file)
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
      ,
      mockERC721WithRoyalty,
      ,
      ,
      transferSelectorNFT,
      transferManagerERC721,
      transferManagerERC1155,
      transferManagerNonCompliantERC721,
      looksRareExchange,
      strategyStandardSaleForFixedPrice,
      ,
      ,
      ,
      ,
      ,
      ,
      royaltyFeeSetter,
    ] = await setUp(admin, feeRecipient, royaltyCollector, standardProtocolFee, royaltyFeeLimit);

    // Set up defaults startTime/endTime (for orders)
    startTimeOrder = BigNumber.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    endTimeOrder = startTimeOrder.add(BigNumber.from("1000"));

    const OrderValidatorV1 = await ethers.getContractFactory("OrderValidatorV1");
    orderValidatorV1 = await OrderValidatorV1.deploy(looksRareExchange.address);
    await orderValidatorV1.deployed();
  });

  describe("", async () => {
    it("ERC20 // Approvals and balances", async () => {
      const makerBidUser = accounts[2];

      // 1. Balance inferior to bid price
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

      assert.equal(await orderValidatorV1.checkOrderValidity(makerBidOrder), ERC20_BALANCE_INFERIOR_TO_PRICE);
      await weth.connect(makerBidUser).deposit({ value: makerBidOrder.price });

      // 2. Approval allowance inferior to bid price
      assert.equal(await orderValidatorV1.checkOrderValidity(makerBidOrder), ERC20_APPROVAL_INFERIOR_TO_PRICE);
      // Approval allowance lower than price
      await weth.connect(makerBidUser).approve(looksRareExchange.address, makerBidOrder.price.sub("1"));
      assert.equal(await orderValidatorV1.checkOrderValidity(makerBidOrder), ERC20_APPROVAL_INFERIOR_TO_PRICE);
      // Approval allowance equal to price
      await weth.connect(makerBidUser).approve(looksRareExchange.address, makerBidOrder.price);
      assert.equal(await orderValidatorV1.checkOrderValidity(makerBidOrder), ORDER_EXPECTED_TO_BE_VALID);
    });

    it("ERC721 // Approvals and balances", async () => {
      const makerAskUser = accounts[1];
      const tokenId = constants.Zero;

      // 1. TokenId doesn't exist
      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721.address,
        price: parseEther("3"),
        tokenId: tokenId,
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

      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ERC721_TOKEN_ID_DOES_NOT_EXIST);

      // 2. TokenId is not owned by the signer
      // Minting is incremental so first tokenId minted is 0
      await mockERC721.mint(accounts[5].address);
      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ERC721_TOKEN_ID_NOT_IN_BALANCE);

      // 3. TokenId is not approved individually
      await mockERC721.connect(accounts[5]).transferFrom(accounts[5].address, makerAskUser.address, tokenId);
      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ERC721_NO_APPROVAL_FOR_ALL_OR_TOKEN_ID);
      await mockERC721.connect(makerAskUser).approve(transferManagerERC721.address, tokenId);
      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ORDER_EXPECTED_TO_BE_VALID);

      // 4. TokenId is approved along with all items in the collection by the signer
      // Removes tokenId approval
      await mockERC721.connect(makerAskUser).approve(constants.AddressZero, tokenId);
      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ERC721_NO_APPROVAL_FOR_ALL_OR_TOKEN_ID);
      // Approves all
      await mockERC721.connect(makerAskUser).setApprovalForAll(transferManagerERC721.address, true);
      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ORDER_EXPECTED_TO_BE_VALID);
    });

    it("ERC1155 // Approvals and balances", async () => {
      const makerAskUser = accounts[1];
      const tokenId = constants.Zero;

      // 1. Signer has a balanceOf(tokenId) equal to 0
      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC1155.address,
        price: parseEther("3"),
        tokenId: tokenId,
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

      assert.equal(
        await orderValidatorV1.checkOrderValidity(makerAskOrder),
        ERC1155_BALANCE_TOKEN_ID_INFERIOR_TO_AMOUNT
      );

      // 2. Signer has a balanceOf(tokenId) inferior to order amount
      // Mints 1 tokenId=0 (balance = 1)
      await mockERC1155.mint(makerAskUser.address, tokenId, constants.One, defaultAbiCoder.encode([], []));
      assert.equal(
        await orderValidatorV1.checkOrderValidity(makerAskOrder),
        ERC1155_BALANCE_TOKEN_ID_INFERIOR_TO_AMOUNT
      );

      // Mints 1 tokenId=0 (balance = 2)
      await mockERC1155.mint(makerAskUser.address, tokenId, constants.One, defaultAbiCoder.encode([], []));
      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ERC1155_NO_APPROVAL_FOR_ALL);

      // 3. Signer approves all
      await mockERC1155.connect(makerAskUser).setApprovalForAll(transferManagerERC1155.address, true);
      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), ORDER_EXPECTED_TO_BE_VALID);
    });

    it("Transfer manager is not for standard ERC721/ERC1155", async () => {
      const makerAskUser = accounts[1];

      const MockNonCompliantERC721 = await ethers.getContractFactory("MockNonCompliantERC721");
      const mockNonCompliantERC721 = await MockNonCompliantERC721.deploy("Mock Bad ERC721", "MBERC721");
      await mockNonCompliantERC721.deployed();

      await transferSelectorNFT
        .connect(admin)
        .addCollectionTransferManager(mockNonCompliantERC721.address, transferManagerNonCompliantERC721.address);

      const makerAskOrder: MakerOrderWithSignature = await createMakerOrder({
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
        minPercentageToAsk: BigNumber.from("9800"),
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), CUSTOM_TRANSFER_MANAGER);
    });

    it("MinPercentageToAsk", async () => {
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
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: BigNumber.from("9801"), // Protocol fee is 2%
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      assert.equal(await orderValidatorV1.checkOrderValidity(makerAskOrder), MIN_NET_RATIO_ABOVE_PROTOCOL_FEE);

      // 2. Protocol fee + Registry royalties (1%)
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
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: BigNumber.from("9701"), // Protocol fee is 2% and royalty is set at 1%
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      assert.equal(
        await orderValidatorV1.checkOrderValidity(makerAskOrder),
        MIN_NET_RATIO_ABOVE_ROYALTY_FEE_REGISTRY_AND_PROTOCOL_FEE
      );

      // 3. Protocol fee + ERC2981 royalties (1%)
      makerAskOrder = await createMakerOrder({
        isOrderAsk: true,
        signer: makerAskUser.address,
        collection: mockERC721WithRoyalty.address,
        price: parseEther("3"),
        tokenId: tokenId,
        amount: constants.One,
        strategy: strategyStandardSaleForFixedPrice.address,
        currency: weth.address,
        nonce: constants.Zero,
        startTime: startTimeOrder,
        endTime: endTimeOrder,
        minPercentageToAsk: BigNumber.from("9701"), // Protocol fee is 2% and royalty fee is 1%
        params: defaultAbiCoder.encode([], []),
        signerUser: makerAskUser,
        verifyingContract: looksRareExchange.address,
      });

      assert.equal(
        await orderValidatorV1.checkOrderValidity(makerAskOrder),
        MIN_NET_RATIO_ABOVE_ROYALTY_FEE_ERC2981_AND_PROTOCOL_FEE
      );
    });
  });
});
