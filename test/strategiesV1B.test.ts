import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("LooksRare V1B strategies test", () => {
  // Strategy V1B contracts
  let strategyStandardSaleForFixedPriceV1B: Contract;
  let strategyAnyItemFromCollectionForFixedPriceV1B: Contract;

  // Other global variables
  let accounts: SignerWithAddress[];
  let admin: SignerWithAddress;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];

    const StrategyStandardSaleForFixedPriceV1B = await ethers.getContractFactory(
      "StrategyStandardSaleForFixedPriceV1B"
    );
    strategyStandardSaleForFixedPriceV1B = await StrategyStandardSaleForFixedPriceV1B.deploy();
    await strategyStandardSaleForFixedPriceV1B.deployed();

    const StrategyAnyItemFromCollectionForFixedPriceV1B = await ethers.getContractFactory(
      "StrategyAnyItemFromCollectionForFixedPriceV1B"
    );
    strategyAnyItemFromCollectionForFixedPriceV1B = await StrategyAnyItemFromCollectionForFixedPriceV1B.deploy();
    await strategyAnyItemFromCollectionForFixedPriceV1B.deployed();
  });

  describe("#1 - Ownership", async () => {
    it("Owner functions work as expected", async () => {
      let tx = await strategyStandardSaleForFixedPriceV1B.connect(admin).setProtocolFee("100");
      await expect(tx).to.emit(strategyStandardSaleForFixedPriceV1B, "NewProtocolFee").withArgs("100");

      tx = await strategyAnyItemFromCollectionForFixedPriceV1B.connect(admin).setProtocolFee("100");
      await expect(tx).to.emit(strategyAnyItemFromCollectionForFixedPriceV1B, "NewProtocolFee").withArgs("100");
    });

    it("Cannot set protocol fee higher or equal to current one", async () => {
      await expect(strategyStandardSaleForFixedPriceV1B.connect(admin).setProtocolFee("150")).to.be.revertedWith(
        "Owner: Protocol fee too high"
      );

      await expect(
        strategyAnyItemFromCollectionForFixedPriceV1B.connect(admin).setProtocolFee("150")
      ).to.be.revertedWith("Owner: Protocol fee too high");

      await expect(strategyStandardSaleForFixedPriceV1B.connect(admin).setProtocolFee("151")).to.be.revertedWith(
        "Owner: Protocol fee too high"
      );

      await expect(
        strategyAnyItemFromCollectionForFixedPriceV1B.connect(admin).setProtocolFee("151")
      ).to.be.revertedWith("Owner: Protocol fee too high");
    });

    it("Owner functions are only callable by owner", async () => {
      const notAdminUser = accounts[3];

      await expect(strategyStandardSaleForFixedPriceV1B.connect(notAdminUser).setProtocolFee("100")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(
        strategyAnyItemFromCollectionForFixedPriceV1B.connect(notAdminUser).setProtocolFee("100")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
