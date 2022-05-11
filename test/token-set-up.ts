import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { constants, Contract } from "ethers";
import { defaultAbiCoder, parseEther } from "ethers/lib/utils";

export async function tokenSetUp(
  users: SignerWithAddress[],
  weth: Contract,
  mockERC721: Contract,
  mockERC721WithRoyalty: Contract,
  mockERC1155: Contract,
  looksRareExchange: Contract,
  transferManagerERC721: Contract,
  transferManagerERC1155: Contract
): Promise<void> {
  for (const user of users) {
    // Each user gets 30 WETH
    await weth.connect(user).deposit({ value: parseEther("30") });

    // Set approval for WETH
    await weth.connect(user).approve(looksRareExchange.address, constants.MaxUint256);

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
