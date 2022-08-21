import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MerkleTree } from "merkletreejs";
/* eslint-disable node/no-extraneous-import */
import { keccak256 } from "js-sha3";

import { MakerOrderWithSignature } from "./helpers/order-types";
import { createMakerOrder, createTakerOrder } from "./helpers/order-helper";
import { computeDomainSeparator, computeOrderHash } from "./helpers/signature-helper";
import { setUp } from "./test-setup";
import { tokenSetUp } from "./token-set-up";

const { defaultAbiCoder, parseEther } = utils;

describe("Strategy - AnyItemInASetForFixedPrice ('Trait orders')", () => {
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
  let strategyAnyItemInASetForFixedPrice: Contract;

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
      strategyAnyItemInASetForFixedPrice,
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
      strategy: strategyAnyItemInASetForFixedPrice.address,
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
        strategyAnyItemInASetForFixedPrice.address,
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

  it("ERC721 - TokenIds not in the set cannot be sold", async () => {
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
      strategy: strategyAnyItemInASetForFixedPrice.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode(["bytes32"], [hexRoot]),
      signerUser: makerBidUser,
      verifyingContract: looksRareExchange.address,
    });

    for (const tokenId of Array.from(Array(9).keys())) {
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

  it("Cannot match if wrong side", async () => {
    const makerAskUser = accounts[1];
    const takerBidUser = accounts[2];

    const makerAskOrder = await createMakerOrder({
      isOrderAsk: true,
      signer: makerAskUser.address,
      collection: mockERC721.address,
      tokenId: constants.Zero,
      price: parseEther("3"),
      amount: constants.One,
      strategy: strategyAnyItemInASetForFixedPrice.address,
      currency: weth.address,
      nonce: constants.Zero,
      startTime: startTimeOrder,
      endTime: endTimeOrder,
      minPercentageToAsk: constants.Zero,
      params: defaultAbiCoder.encode([], []), // these parameters are used after it reverts
      signerUser: makerAskUser,
      verifyingContract: looksRareExchange.address,
    });

    const takerBidOrder = {
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
