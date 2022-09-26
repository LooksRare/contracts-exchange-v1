# Error Codes for invalidation

## Overview

- 000: Expected to be valid
- 1\*\*: Nonce-related issues
- 2\*\*: Amount-related issues
- 3\*\*: Signature-related issues
- 4\*\*: Whitelist-related issues
- 5\*\*: Fee-related issues and other slippage
- 6\*\*: Timestamp-related issues
- 7\*\*: Transfer-related issues for ERC20/ERC721/ERC1155/non-compliant (approval and balances)

## Details

| Code | Description                                               |
| ---- | --------------------------------------------------------- |
| 000  | ORDER_EXPECTED_TO_BE_VALID                                |
| 101  | NONCE_EXECUTED_OR_CANCELLED                               |
| 102  | NONCE_BELOW_MIN_ORDER_NONCE                               |
| 201  | ORDER_AMOUNT_CANNOT_BE_ZERO                               |
| 301  | MAKER_SIGNER_IS_NULL_SIGNER                               |
| 302  | INVALID_S_PARAMETER_EOA                                   |
| 303  | INVALID_V_PARAMETER_EOA                                   |
| 304  | NULL_SIGNER_EOA                                           |
| 305  | WRONG_SIGNER_EOA                                          |
| 311  | SIGNATURE_INVALID_EIP1271                                 |
| 312  | MISSING_IS_VALID_SIGNATURE_FUNCTION_EIP1271               |
| 401  | CURRENCY_NOT_WHITELISTED                                  |
| 402  | STRATEGY_NOT_WHITELISTED                                  |
| 501  | MIN_NET_RATIO_ABOVE_PROTOCOL_FEE                          |
| 502  | MIN_NET_RATIO_ABOVE_ROYALTY_FEE_REGISTRY_AND_PROTOCOL_FEE |
| 503  | MIN_NET_RATIO_ABOVE_ROYALTY_FEE_ERC2981_AND_PROTOCOL_FEE  |
| 504  | MISSING_ROYALTY_INFO_FUNCTION_ERC2981                     |
| 601  | TOO_EARLY_TO_EXECUTE_ORDER                                |
| 602  | TOO_LATE_TO_EXECUTE_ORDER                                 |
| 701  | NO_TRANSFER_MANAGER_AVAILABLE_FOR_COLLECTION              |
| 702  | CUSTOM_TRANSFER_MANAGER                                   |
| 711  | ERC20_BALANCE_INFERIOR_TO_PRICE                           |
| 712  | ERC20_APPROVAL_INFERIOR_TO_PRICE                          |
| 721  | ERC721_TOKEN_ID_DOES_NOT_EXIST                            |
| 722  | ERC721_TOKEN_ID_NOT_IN_BALANCE                            |
| 723  | ERC721_NO_APPROVAL_FOR_ALL_OR_TOKEN_ID                    |
| 731  | ERC1155_BALANCE_OF_DOES_NOT_EXIST                         |
| 732  | ERC1155_BALANCE_OF_TOKEN_ID_INFERIOR_TO_AMOUNT            |
| 733  | ERC1155_IS_APPROVED_FOR_ALL_DOES_NOT_EXIST                |
| 734  | ERC1155_NO_APPROVAL_FOR_ALL                               |
