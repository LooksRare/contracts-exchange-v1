import { BigNumber, constants } from "ethers";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const standardProtocolFee = BigNumber.from("200"); // 2%
  const royaltyFeeLimit = BigNumber.from("9500"); // 95%

  /**
   * 1. Deploy ExecutionManager contract and add WETH to whitelisted currencies
   */
  const WETH = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6";
  const CurrencyManager = await ethers.getContractFactory("CurrencyManager");
  const currencyManager = await CurrencyManager.deploy();
  await currencyManager.deployed();
  await currencyManager.addCurrency(WETH);
  console.log("Currency Manager:", currencyManager.address);

  /**
   * 2. Deploy ExecutionManager contract
   */
  const ExecutionManager = await ethers.getContractFactory("ExecutionManager");
  const executionManager = await ExecutionManager.deploy();
  await executionManager.deployed();
  console.log("Execution Manager:", executionManager.address);

  /** 3. Deploy execution strategy contracts for trade execution
   */
  const StrategyAnyItemFromCollectionForFixedPrice = await ethers.getContractFactory(
    "StrategyAnyItemFromCollectionForFixedPrice"
  );
  const strategyAnyItemFromCollectionForFixedPrice = await StrategyAnyItemFromCollectionForFixedPrice.deploy(200);
  await strategyAnyItemFromCollectionForFixedPrice.deployed();
  console.log("StrategyAnyItemFromCollectionForFixedPrice:", strategyAnyItemFromCollectionForFixedPrice.address);

  const StrategyAnyItemInASetForFixedPrice = await ethers.getContractFactory("StrategyAnyItemInASetForFixedPrice");
  const strategyAnyItemInASetForFixedPrice = await StrategyAnyItemInASetForFixedPrice.deploy(standardProtocolFee);
  await strategyAnyItemInASetForFixedPrice.deployed();
  console.log("StrategyAnyItemInASetForFixedPrice:", strategyAnyItemInASetForFixedPrice.address);

  const StrategyDutchAuction = await ethers.getContractFactory("StrategyDutchAuction");
  const strategyDutchAuction = await StrategyDutchAuction.deploy(
    standardProtocolFee,
    BigNumber.from("900") // 15 minutes
  );
  await strategyDutchAuction.deployed();
  console.log("StrategyDutchAuction:", strategyDutchAuction.address);

  const StrategyPrivateSale = await ethers.getContractFactory("StrategyPrivateSale");
  const strategyPrivateSale = await StrategyPrivateSale.deploy(constants.Zero);
  await strategyPrivateSale.deployed();
  console.log("StrategyPrivateSale:", strategyPrivateSale.address);

  const StrategyStandardSaleForFixedPrice = await ethers.getContractFactory("StrategyStandardSaleForFixedPrice");
  const strategyStandardSaleForFixedPrice = await StrategyStandardSaleForFixedPrice.deploy(standardProtocolFee);
  await strategyStandardSaleForFixedPrice.deployed();
  console.log("strategyStandardSaleForFixedPrice:", strategyStandardSaleForFixedPrice.address);

  // Whitelist these five strategies
  await executionManager.addStrategy(strategyStandardSaleForFixedPrice.address);
  await executionManager.addStrategy(strategyAnyItemFromCollectionForFixedPrice.address);
  await executionManager.addStrategy(strategyAnyItemInASetForFixedPrice.address);
  await executionManager.addStrategy(strategyDutchAuction.address);
  await executionManager.addStrategy(strategyPrivateSale.address);

  /** 5. Deploy RoyaltyFee Registry/Setter/Manager
   */
  const RoyaltyFeeRegistry = await ethers.getContractFactory("RoyaltyFeeRegistry");
  const royaltyFeeRegistry = await RoyaltyFeeRegistry.deploy(royaltyFeeLimit);
  await royaltyFeeRegistry.deployed();
  console.log("RoyaltyFeeRegistry:", royaltyFeeRegistry.address);
  const RoyaltyFeeSetter = await ethers.getContractFactory("RoyaltyFeeSetter");
  const royaltyFeeSetter = await RoyaltyFeeSetter.deploy(royaltyFeeRegistry.address);
  await royaltyFeeSetter.deployed();
  console.log("RoyaltyFeeSetter:", royaltyFeeSetter.address);
  const RoyaltyFeeManager = await ethers.getContractFactory("RoyaltyFeeManager");
  const royaltyFeeManager = await RoyaltyFeeManager.deploy(royaltyFeeRegistry.address);
  await royaltyFeeManager.deployed();
  console.log("RoyaltyFeeManager:", royaltyFeeManager.address);
  // Transfer ownership of RoyaltyFeeRegistry to RoyaltyFeeSetter
  await royaltyFeeRegistry.transferOwnership(royaltyFeeSetter.address);

  /** 6. Deploy LooksRareExchange contract
   */
  const LooksRareExchange = await ethers.getContractFactory("LooksRareExchange");
  const looksRareExchange = await LooksRareExchange.deploy(
    currencyManager.address,
    executionManager.address,
    royaltyFeeManager.address,
    WETH,
    deployer.address
  );
  await looksRareExchange.deployed();
  console.log("LooksRareExchange:", looksRareExchange.address);

  /** 6. Deploy TransferManager contracts and TransferSelector
   */
  const TransferManagerERC721 = await ethers.getContractFactory("TransferManagerERC721");
  const transferManagerERC721 = await TransferManagerERC721.deploy(looksRareExchange.address);
  await transferManagerERC721.deployed();
  console.log("TransferManagerERC721:", transferManagerERC721.address);

  const TransferManagerERC1155 = await ethers.getContractFactory("TransferManagerERC1155");
  const transferManagerERC1155 = await TransferManagerERC1155.deploy(looksRareExchange.address);
  await transferManagerERC1155.deployed();
  console.log("TransferManagerERC1155:", transferManagerERC1155.address);

  const TransferManagerNonCompliantERC721 = await ethers.getContractFactory("TransferManagerNonCompliantERC721");
  const transferManagerNonCompliantERC721 = await TransferManagerNonCompliantERC721.deploy(looksRareExchange.address);
  await transferManagerNonCompliantERC721.deployed();
  console.log("TransferManagerNonCompliantERC721:", transferManagerNonCompliantERC721.address);

  const TransferSelectorNFT = await ethers.getContractFactory("TransferSelectorNFT");
  const transferSelectorNFT = await TransferSelectorNFT.deploy(
    transferManagerERC721.address,
    transferManagerERC1155.address
  );
  await transferSelectorNFT.deployed();
  console.log("TransferSelectorNFT:", transferSelectorNFT.address);

  // Set TransferSelectorNFT in LooksRare exchange
  await looksRareExchange.updateTransferSelectorNFT(transferSelectorNFT.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
