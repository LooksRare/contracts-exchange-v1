import { BigNumber, BytesLike } from "ethers";

export interface MakerOrder {
  isOrderAsk: boolean; // true if ask, false if bid
  signer: string; // signer address of the maker order
  collection: string; // collection address
  price: BigNumber; // price
  tokenId: BigNumber; // id of the token
  amount: BigNumber; // amount of tokens to purchase
  strategy: string; // strategy address for trade execution
  currency: string; // currency address
  nonce: BigNumber; // order nonce
  minPercentageToAsk: BigNumber;
  startTime: BigNumber; // startTime in epoch
  endTime: BigNumber; // endTime in epoch
  params: BytesLike; // additional parameters
}

export interface MakerOrderWithSignature extends MakerOrder {
  signature: BytesLike; // eip712 or eip1271 signature
}

export interface TakerOrder {
  isOrderAsk: boolean; // true if ask, false if bid
  taker: string; // Taker address
  price: BigNumber; // price for the purchase
  tokenId: BigNumber;
  minPercentageToAsk: BigNumber;
  params: BytesLike; // params (e.g., tokenId)
}
