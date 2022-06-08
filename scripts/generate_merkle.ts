/* eslint-disable no-process-exit */
/* eslint-disable prefer-const */
/* eslint-disable no-console */

import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { parseEther, solidityKeccak256 } from "ethers/lib/utils";
import { BigNumber } from "ethers";

// list of wallets
const whitelists = [{ address: "", amount: "" }];

// const allocation = 3

async function main() {
  // validation
  let i;
  let flags: { [key: string]: boolean } = {};

  for (i = 0; i < whitelists.length; i++) {
    if (flags[whitelists[i].address] === undefined) {
      flags[whitelists[i].address] = true;
    } else {
      console.log("--> already exists", whitelists[i]);
    }
  }

  let leafnodes: Buffer[], merkleTree: MerkleTree, merkleRoot: string;
  leafnodes = whitelists.map((whitelist) =>
    Buffer.from(
      // Hash in appropriate Merkle format
      solidityKeccak256(["address", "uint256"], [whitelist.address, parseEther(whitelist.amount)]).slice(2),
      "hex"
    )
  );
  merkleTree = new MerkleTree(leafnodes, keccak256, { sortPairs: true });
  merkleRoot = merkleTree.getHexRoot();

  console.log("merkleRoot", String(merkleRoot));
  const merkleData: {
    [key: string]: { amount: string | number | BigNumber; proof: string[]; leaf: string };
  } = {};
  for (let i = 0; i < whitelists.length; i++) {
    const minter1Leaf = leafnodes[i].toString("hex");
    const minter1Proof = merkleTree.getHexProof(minter1Leaf);
    merkleData[whitelists[i].address] = {
      amount: whitelists[i].amount,
      leaf: "0x" + minter1Leaf,
      proof: minter1Proof,
    };
  }
  console.log(merkleData);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
