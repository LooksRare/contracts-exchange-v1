/* eslint-disable no-process-exit */
/* eslint-disable no-console */

import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

async function main() {
  const CurrencyManager = await ethers.getContractFactory("CurrencyManager");
  const ExecutionManager = await ethers.getContractFactory("ExecutionManager");
  const RoyaltyFeeRegistry = await ethers.getContractFactory("RoyaltyFeeRegistry");
  const RoyaltyFeeManager = await ethers.getContractFactory("RoyaltyFeeManager");
  const RoyaltyFeeSetter = await ethers.getContractFactory("RoyaltyFeeSetter");
  const EarthRareExchange = await ethers.getContractFactory("EarthRareExchange");

  console.log("Starting deployments...");

  const signers = await ethers.getSigners();

  const currencyManager = await CurrencyManager.deploy();
  await currencyManager.deployed();
  console.log("CurrencyManager is deployed to:", currencyManager.address);

  const executionManager = await ExecutionManager.deploy();
  await executionManager.deployed();
  console.log("ExecutionManager is deployed to:", executionManager.address);

  // address _royaltyFeeRegistry
  const royaltyFeeRegistry = await RoyaltyFeeRegistry.deploy(1000); // 10%
  await royaltyFeeRegistry.deployed();
  console.log("RoyaltyFeeRegistry is deployed to:", royaltyFeeRegistry.address);

  // address _royaltyFeeRegistry
  const royaltyFeeManager = await RoyaltyFeeManager.deploy(royaltyFeeRegistry.address);
  await royaltyFeeManager.deployed();
  console.log("RoyaltyFeeManager is deployed to:", royaltyFeeManager.address);

  const WETH_ADDRESS = "0x0a180A76e4466bF68A7F86fB029BEd3cCcFaAac5";

  // address _currencyManager,
  // address _executionManager,
  // address _royaltyFeeManager,
  // address _WETH,
  // address _protocolFeeRecipient
  const exchange = await EarthRareExchange.deploy(
    currencyManager.address,
    executionManager.address,
    royaltyFeeManager.address,
    WETH_ADDRESS,
    signers[0].address
  );
  await exchange.deployed();
  console.log("EarthRareExchange is deployed to:", exchange.address);

  // ==========================================================
  // ==========================================================

  const StrategyStandardSaleForFixedPrice = await ethers.getContractFactory("StrategyStandardSaleForFixedPrice");
  const StrategyAnyItemFromCollectionForFixedPrice = await ethers.getContractFactory(
    "StrategyAnyItemFromCollectionForFixedPrice"
  );
  const StrategyPrivateSale = await ethers.getContractFactory("StrategyPrivateSale");

  const strategyStandardSaleForFixedPrice = await StrategyStandardSaleForFixedPrice.deploy(200); // 2%
  await strategyStandardSaleForFixedPrice.deployed();
  console.log("StrategyStandardSaleForFixedPrice is deployed to:", strategyStandardSaleForFixedPrice.address);

  const strategyAnyItemFromCollectionForFixedPrice = await StrategyAnyItemFromCollectionForFixedPrice.deploy(200); // 2%
  await strategyAnyItemFromCollectionForFixedPrice.deployed();
  console.log(
    "StrategyAnyItemFromCollectionForFixedPrice is deployed to:",
    strategyAnyItemFromCollectionForFixedPrice.address
  );

  const strategyPrivateSale = await StrategyPrivateSale.deploy(200); // 2%
  await strategyPrivateSale.deployed();
  console.log("StrategyPrivateSale is deployed to:", strategyPrivateSale.address);

  // address _royaltyFeeRegistry
  const royaltyFeeSetter = await RoyaltyFeeSetter.deploy(royaltyFeeRegistry.address);
  await royaltyFeeSetter.deployed();
  console.log("RoyaltyFeeSetter is deployed to:", royaltyFeeSetter.address);

  // ==========================================================
  // ==========================================================

  const TransferManagerERC721 = await ethers.getContractFactory("TransferManagerERC721");
  const TransferManagerERC1155 = await ethers.getContractFactory("TransferManagerERC1155");
  const TransferManagerNonCompliantERC721 = await ethers.getContractFactory("TransferManagerNonCompliantERC721");
  const TransferSelectorNFT = await ethers.getContractFactory("TransferSelectorNFT");

  const transferManagerERC721 = await TransferManagerERC721.deploy(exchange.address);
  await transferManagerERC721.deployed();
  console.log("TransferManagerERC721 is deployed to:", transferManagerERC721.address);

  const transferManagerERC1155 = await TransferManagerERC1155.deploy(exchange.address);
  await transferManagerERC1155.deployed();
  console.log("TransferManagerERC1155 is deployed to:", transferManagerERC1155.address);

  const transferManagerNonCompliantERC721 = await TransferManagerNonCompliantERC721.deploy(exchange.address);
  await transferManagerNonCompliantERC721.deployed();
  console.log("TransferManagerNonCompliantERC721 is deployed to:", transferManagerNonCompliantERC721.address);

  const transferSelectorNFT = await TransferSelectorNFT.deploy(
    transferManagerERC721.address,
    transferManagerERC1155.address
  );
  await transferSelectorNFT.deployed();
  console.log("TransferSelectorNFT is deployed to:", transferSelectorNFT.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
