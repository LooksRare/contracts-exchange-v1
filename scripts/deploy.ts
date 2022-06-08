/* eslint-disable no-process-exit */
/* eslint-disable no-console */

import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

async function main() {
  const EarthRareToken = await ethers.getContractFactory("EarthRareToken");

  console.log("Starting deployments...");

  // address _premintReceiver,
  // uint256 _premintAmount,
  // uint256 _cap

  const signers = await ethers.getSigners();

  const earthRareToken = await EarthRareToken.deploy(
    signers[0].address,
    parseEther("1000000"),
    parseEther("7777777777")
  );
  await earthRareToken.deployed();
  console.log("EarthRareToken is deployed to:", earthRareToken.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
