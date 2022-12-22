import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, constants, Contract } from "ethers";
import { ethers } from "hardhat";

export async function setUp(
  admin: SignerWithAddress,
  feeRecipient: SignerWithAddress,
  royaltyCollector: SignerWithAddress,
  standardProtocolFee: BigNumber,
  royaltyFeeLimit: BigNumber
): Promise<Contract[]> {
  /** 1. Deploy WETH, Mock ERC721, Mock ERC1155, Mock USDT, MockERC721WithRoyalty
   */
  const WETH = await ethers.getContractFactory("WETH");
  const weth = await WETH.deploy();
  await weth.deployed();
  const MockERC721 = await ethers.getContractFactory("MockERC721");
  const mockERC721 = await MockERC721.deploy("Mock ERC721", "MERC721");
  await mockERC721.deployed();
  const MockERC1155 = await ethers.getContractFactory("MockERC1155");
  const mockERC1155 = await MockERC1155.deploy("uri/");
  await mockERC1155.deployed();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockUSDT = await MockERC20.deploy("USD Tether", "USDT");
  await mockUSDT.deployed();
  const MockERC721WithRoyalty = await ethers.getContractFactory("MockERC721WithRoyalty");
  const mockERC721WithRoyalty = await MockERC721WithRoyalty.connect(royaltyCollector).deploy(
    "Mock Royalty ERC721",
    "MRC721",
    "200" // 2% royalty fee
  );
  await mockERC721WithRoyalty.deployed();

  /** 2. Deploy ExecutionManager contract and add WETH to whitelisted currencies
   */
  const CurrencyManager = await ethers.getContractFactory("CurrencyManager");
  const currencyManager = await CurrencyManager.deploy();
  await currencyManager.deployed();
  await currencyManager.connect(admin).addCurrency(weth.address);

  /** 3. Deploy ExecutionManager contract
   */
  const ExecutionManager = await ethers.getContractFactory("ExecutionManager");
  const executionManager = await ExecutionManager.deploy();
  await executionManager.deployed();

  /** 4. Deploy execution strategy contracts for trade execution
   */
  const StrategyAnyItemFromCollectionForFixedPrice = await ethers.getContractFactory(
    "StrategyAnyItemFromCollectionForFixedPrice"
  );
  const strategyAnyItemFromCollectionForFixedPrice = await StrategyAnyItemFromCollectionForFixedPrice.deploy(200);
  await strategyAnyItemFromCollectionForFixedPrice.deployed();
  const StrategyAnyItemInASetForFixedPrice = await ethers.getContractFactory("StrategyAnyItemInASetForFixedPrice");
  const strategyAnyItemInASetForFixedPrice = await StrategyAnyItemInASetForFixedPrice.deploy(standardProtocolFee);
  await strategyAnyItemInASetForFixedPrice.deployed();
  const StrategyDutchAuction = await ethers.getContractFactory("StrategyDutchAuction");
  const strategyDutchAuction = await StrategyDutchAuction.deploy(
    standardProtocolFee,
    BigNumber.from("900") // 15 minutes
  );
  await strategyDutchAuction.deployed();
  const StrategyPrivateSale = await ethers.getContractFactory("StrategyPrivateSale");
  const strategyPrivateSale = await StrategyPrivateSale.deploy(constants.Zero);
  await strategyPrivateSale.deployed();
  const StrategyStandardSaleForFixedPrice = await ethers.getContractFactory("StrategyStandardSaleForFixedPrice");
  const strategyStandardSaleForFixedPrice = await StrategyStandardSaleForFixedPrice.deploy(standardProtocolFee);
  await strategyStandardSaleForFixedPrice.deployed();

  // Whitelist these five strategies
  await executionManager.connect(admin).addStrategy(strategyStandardSaleForFixedPrice.address);
  await executionManager.connect(admin).addStrategy(strategyAnyItemFromCollectionForFixedPrice.address);
  await executionManager.connect(admin).addStrategy(strategyAnyItemInASetForFixedPrice.address);
  await executionManager.connect(admin).addStrategy(strategyDutchAuction.address);
  await executionManager.connect(admin).addStrategy(strategyPrivateSale.address);

  /** 5. Deploy RoyaltyFee Registry/Setter/Manager
   */
  const RoyaltyFeeRegistry = await ethers.getContractFactory("RoyaltyFeeRegistry");
  const royaltyFeeRegistry = await RoyaltyFeeRegistry.deploy(royaltyFeeLimit);
  await royaltyFeeRegistry.deployed();
  const RoyaltyFeeSetter = await ethers.getContractFactory("RoyaltyFeeSetter");
  const royaltyFeeSetter = await RoyaltyFeeSetter.deploy(royaltyFeeRegistry.address);
  await royaltyFeeSetter.deployed();
  const RoyaltyFeeManager = await ethers.getContractFactory("RoyaltyFeeManager");
  const royaltyFeeManager = await RoyaltyFeeManager.deploy(royaltyFeeRegistry.address);
  await royaltyFeeManager.deployed();
  // Transfer ownership of RoyaltyFeeRegistry to RoyaltyFeeSetter
  await royaltyFeeRegistry.connect(admin).transferOwnership(royaltyFeeSetter.address);

  /** 6. Deploy LooksRareExchange contract
   */
  const LooksRareExchange = await ethers.getContractFactory("LooksRareExchange");
  const looksRareExchange = await LooksRareExchange.deploy(
    currencyManager.address,
    executionManager.address,
    royaltyFeeManager.address,
    weth.address,
    feeRecipient.address
  );
  await looksRareExchange.deployed();

  /** 6. Deploy TransferManager contracts and TransferSelector
   */
  const TransferManagerERC721 = await ethers.getContractFactory("TransferManagerERC721");
  const transferManagerERC721 = await TransferManagerERC721.deploy(looksRareExchange.address);
  await transferManagerERC721.deployed();
  const TransferManagerERC1155 = await ethers.getContractFactory("TransferManagerERC1155");
  const transferManagerERC1155 = await TransferManagerERC1155.deploy(looksRareExchange.address);
  await transferManagerERC1155.deployed();
  const TransferManagerNonCompliantERC721 = await ethers.getContractFactory("TransferManagerNonCompliantERC721");
  const transferManagerNonCompliantERC721 = await TransferManagerNonCompliantERC721.deploy(looksRareExchange.address);
  await transferManagerNonCompliantERC721.deployed();
  const TransferSelectorNFT = await ethers.getContractFactory("TransferSelectorNFT");
  const transferSelectorNFT = await TransferSelectorNFT.deploy(
    transferManagerERC721.address,
    transferManagerERC1155.address
  );
  await transferSelectorNFT.deployed();

  // Set TransferSelectorNFT in LooksRare exchange
  await looksRareExchange.connect(admin).updateTransferSelectorNFT(transferSelectorNFT.address);

  /** Return contracts
   */
  return [
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
    strategyAnyItemFromCollectionForFixedPrice,
    strategyDutchAuction,
    strategyPrivateSale,
    strategyAnyItemInASetForFixedPrice,
    royaltyFeeRegistry,
    royaltyFeeManager,
    royaltyFeeSetter,
  ];
}
