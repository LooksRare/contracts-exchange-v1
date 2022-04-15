import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MakerOrder, MakerOrderWithSignature, TakerOrder } from "./order-types";
import { signMakerOrder } from "./signature-helper";

export interface SignedMakerOrder extends MakerOrder {
  signerUser: SignerWithAddress;
  verifyingContract: string;
}

export async function createMakerOrder({
  isOrderAsk,
  signer,
  collection,
  price,
  tokenId,
  amount,
  strategy,
  currency,
  nonce,
  startTime,
  endTime,
  minPercentageToAsk,
  params,
  signerUser,
  verifyingContract,
}: SignedMakerOrder): Promise<MakerOrderWithSignature> {
  const makerOrder: MakerOrder = {
    isOrderAsk: isOrderAsk,
    signer: signer,
    collection: collection,
    price: price,
    tokenId: tokenId,
    amount: amount,
    strategy: strategy,
    currency: currency,
    nonce: nonce,
    startTime: startTime,
    endTime: endTime,
    minPercentageToAsk: minPercentageToAsk,
    params: params,
  };

  const signedOrder = await signMakerOrder(signerUser, verifyingContract, makerOrder);

  // Extend makerOrder with proper signature
  const makerOrderExtended: MakerOrderWithSignature = {
    ...makerOrder,
    r: signedOrder.r,
    s: signedOrder.s,
    v: signedOrder.v,
  };

  return makerOrderExtended;
}

export function createTakerOrder({
  isOrderAsk,
  taker,
  price,
  tokenId,
  minPercentageToAsk,
  params,
}: TakerOrder): TakerOrder {
  const takerOrder: TakerOrder = {
    isOrderAsk: isOrderAsk,
    taker: taker,
    price: price,
    tokenId: tokenId,
    minPercentageToAsk: minPercentageToAsk,
    params: params,
  };

  return takerOrder;
}
