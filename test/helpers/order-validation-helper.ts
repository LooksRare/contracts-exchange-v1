import { assert, expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ORDER_EXPECTED_TO_BE_VALID } from "./configErrorCodes";
import { MakerOrderWithSignature } from "./order-types";

export async function assertErrorCode(
  makerOrder: MakerOrderWithSignature,
  ERROR_CODE: number,
  orderValidatorV1: Contract
): Promise<void> {
  const res = await orderValidatorV1.checkOrderValidity(makerOrder);
  let arraySlot: number;
  if (ERROR_CODE % 100 !== 0) {
    arraySlot = Math.floor(ERROR_CODE / 100) - 1;
  } else {
    arraySlot = ERROR_CODE / 100;
  }
  assert.equal(res[arraySlot], ERROR_CODE);
}

export async function assertOrderValid(makerOrder: MakerOrderWithSignature, orderValidatorV1: Contract): Promise<void> {
  expect(await orderValidatorV1.checkOrderValidity(makerOrder)).to.eql(
    new Array(7).fill(BigNumber.from(ORDER_EXPECTED_TO_BE_VALID))
  );
}

export async function assertMultipleOrdersValid(
  makerOrders: MakerOrderWithSignature[],
  orderValidatorV1: Contract
): Promise<void> {
  const res = await orderValidatorV1.checkMultipleOrderValidities(makerOrders);

  for (let i = 0; i < res.length; i++) {
    expect(i).to.eql(new Array(7).fill(BigNumber.from(ORDER_EXPECTED_TO_BE_VALID)));
  }
}
