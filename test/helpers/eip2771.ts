import { BigNumber, utils, Wallet, BytesLike } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
/* eslint-disable node/no-extraneous-import */
import { TypedDataDomain } from "@ethersproject/abstract-signer";
/* eslint-disable node/no-extraneous-import */
import { Signature } from "@ethersproject/bytes";
/* eslint-disable node/no-extraneous-import */
import { _TypedDataEncoder } from "@ethersproject/hash";
import { findPrivateKey } from "./hardhat-keys";

const { defaultAbiCoder, keccak256, solidityPack } = utils;

export interface ForwardRequest {
  from: string; // signer address
  to: string; // LooksRareExchange address by default
  value: BigNumber; // eth transfer
  gas: BigNumber; // max gas for an internal call
  nonce: BigNumber; // forwarder's signer nonce
  data: BytesLike; // internal call data
}

/**
 * Generate a signature used to generate v, r, s parameters
 * @param signer signer
 * @param types solidity types of the value param
 * @param values params to be sent to the Solidity function
 * @param verifyingContract verifying contract address ("LooksRareExchange")
 * @returns splitted signature
 * @see https://docs.ethers.io/v5/api/signer/#Signer-signTypedData
 */
const signTypedData = async (
  signer: SignerWithAddress,
  types: string[],
  values: (string | boolean | BigNumber)[],
  verifyingContract: string
): Promise<Signature> => {
  const domain: TypedDataDomain = {
    name: "MinimalForwarder",
    version: "0.0.1",
    chainId: "31337", // HRE
    verifyingContract: verifyingContract,
  };

  const domainSeparator = _TypedDataEncoder.hashDomain(domain);

  // https://docs.ethers.io/v5/api/utils/abi/coder/#AbiCoder--methods
  const hash = keccak256(defaultAbiCoder.encode(types, values));

  // Compute the digest
  const digest = keccak256(
    solidityPack(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", domainSeparator, hash])
  );

  const adjustedSigner = new Wallet(findPrivateKey(signer.address));
  return { ...adjustedSigner._signingKey().signDigest(digest) };
};

/**
 * Create a signature for a maker order
 * @param signer signer for the order
 * @param verifyingContract verifying contract address
 * @param order see MakerOrder definition
 * @returns splitted signature
 */
export const signForwardRequest = async (
  signer: SignerWithAddress,
  verifyingContract: string,
  req: ForwardRequest
): Promise<BytesLike> => {
  const types = ["bytes32", "address", "address", "uint256", "uint256", "uint256", "bytes32"];

  const values = [
    "0xdd8f4b70b0f4393e889bd39128a30628a78b61816a9eb8199759e7a349657e48", // keccak256(ForwarderRequest)
    req.from,
    req.to,
    req.value,
    req.gas,
    req.nonce,
    keccak256(req.data),
  ];

  const sig = await signTypedData(signer, types, values, verifyingContract);
  return utils.joinSignature(sig);
};
