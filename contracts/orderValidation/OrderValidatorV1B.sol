// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// OZ dependencies
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165, IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

// LooksRare libraries and validation code constants
import {OrderTypes} from "../libraries/OrderTypes.sol";
import "./ValidationCodeConstants.sol";

// LooksRare interfaces
import {ICurrencyManager} from "../interfaces/ICurrencyManager.sol";
import {IExecutionManager} from "../interfaces/IExecutionManager.sol";
import {IExecutionStrategy} from "../interfaces/IExecutionStrategy.sol";
import {IRoyaltyFeeRegistry} from "../interfaces/IRoyaltyFeeRegistry.sol";
import {ITransferManagerNFT} from "../interfaces/ITransferManagerNFT.sol";
import {ITransferSelectorNFTExtended, IRoyaltyFeeManagerV1BExtended} from "./ExtendedInterfaces.sol";

// LooksRareExchange
import {LooksRareExchange} from "../LooksRareExchange.sol";

/**
 * @title OrderValidatorV1B
 * @notice This contract is used to check the validity of a maker order in the LooksRareProtocol (v1).
 *         It performs checks for:
 *         1. Nonce-related issues (e.g., nonce executed or cancelled)
 *         2. Amount-related issues (e.g. order amount being 0)
 *         3. Signature-related issues
 *         4. Whitelist-related issues (i.e., currency or strategy not whitelisted)
 *         5. Fee-related issues (e.g., minPercentageToAsk too high due to changes in royalties)
 *         6. Timestamp-related issues (e.g., order expired)
 *         7. Transfer-related issues for ERC20/ERC721/ERC1155 (approvals and balances)
 */
contract OrderValidatorV1B {
    using OrderTypes for OrderTypes.MakerOrder;

    // Number of distinct criteria groups checked to evaluate the validity
    uint256 public constant CRITERIA_GROUPS = 7;

    // ERC721 interfaceID
    bytes4 public constant INTERFACE_ID_ERC721 = 0x80ac58cd;

    // ERC1155 interfaceID
    bytes4 public constant INTERFACE_ID_ERC1155 = 0xd9b67a26;

    // ERC2981 interfaceId
    bytes4 public constant INTERFACE_ID_ERC2981 = 0x2a55205a;

    // EIP1271 magic value
    bytes4 public constant MAGIC_VALUE_EIP1271 = 0x1626ba7e;

    // TransferManager ERC721
    address public immutable TRANSFER_MANAGER_ERC721;

    // TransferManager ERC1155
    address public immutable TRANSFER_MANAGER_ERC1155;

    // Domain separator from LooksRare Exchange
    bytes32 public immutable DOMAIN_SEPARATOR;

    // Currency Manager
    ICurrencyManager public immutable currencyManager;

    // Execution Manager
    IExecutionManager public immutable executionManager;

    // Royalty Fee Registry
    IRoyaltyFeeRegistry public immutable royaltyFeeRegistry;

    // Royalty Fee Manager 1B
    IRoyaltyFeeManagerV1BExtended public immutable royaltyFeeManager;

    // Transfer Selector
    ITransferSelectorNFTExtended public immutable transferSelectorNFT;

    // LooksRare Exchange
    LooksRareExchange public immutable looksRareExchange;

    /**
     * @notice Constructor
     * @param _looksRareExchange address of the LooksRare exchange (v1)
     */
    constructor(address _looksRareExchange) {
        looksRareExchange = LooksRareExchange(_looksRareExchange);
        DOMAIN_SEPARATOR = LooksRareExchange(_looksRareExchange).DOMAIN_SEPARATOR();

        TRANSFER_MANAGER_ERC721 = ITransferSelectorNFTExtended(
            address(LooksRareExchange(_looksRareExchange).transferSelectorNFT())
        ).TRANSFER_MANAGER_ERC721();

        TRANSFER_MANAGER_ERC1155 = ITransferSelectorNFTExtended(
            address(LooksRareExchange(_looksRareExchange).transferSelectorNFT())
        ).TRANSFER_MANAGER_ERC1155();

        currencyManager = LooksRareExchange(_looksRareExchange).currencyManager();
        executionManager = LooksRareExchange(_looksRareExchange).executionManager();
        transferSelectorNFT = ITransferSelectorNFTExtended(
            address(LooksRareExchange(_looksRareExchange).transferSelectorNFT())
        );

        royaltyFeeManager = IRoyaltyFeeManagerV1BExtended(
            address(LooksRareExchange(_looksRareExchange).royaltyFeeManager())
        );

        royaltyFeeRegistry = IRoyaltyFeeManagerV1BExtended(
            address(LooksRareExchange(_looksRareExchange).royaltyFeeManager())
        ).royaltyFeeRegistry();
    }

    /**
     * @notice Check the validities for an array of maker orders
     * @param makerOrders Array of maker order structs
     * @return validationCodes Array of validation code arrays for the maker orders
     */
    function checkMultipleOrderValidities(OrderTypes.MakerOrder[] calldata makerOrders)
        public
        view
        returns (uint256[][] memory validationCodes)
    {
        validationCodes = new uint256[][](makerOrders.length);

        for (uint256 i; i < makerOrders.length; ) {
            validationCodes[i] = checkOrderValidity(makerOrders[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Check the validity of a maker order
     * @param makerOrder Maker order struct
     * @return validationCodes Array of validations code for each group
     */
    function checkOrderValidity(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256[] memory validationCodes)
    {
        validationCodes = new uint256[](CRITERIA_GROUPS);
        validationCodes[0] = checkValidityNonces(makerOrder);
        validationCodes[1] = checkValidityAmounts(makerOrder);
        validationCodes[2] = checkValiditySignature(makerOrder);
        validationCodes[3] = checkValidityWhitelists(makerOrder);
        validationCodes[4] = checkValidityMinPercentageToAsk(makerOrder);
        validationCodes[5] = checkValidityTimestamps(makerOrder);
        validationCodes[6] = checkValidityApprovalsAndBalances(makerOrder);
    }

    /**
     * @notice Check the validity for user nonces
     * @param makerOrder Maker order struct
     * @return validationCode Validation code
     */
    function checkValidityNonces(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        if (looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerOrder.signer, makerOrder.nonce))
            return NONCE_EXECUTED_OR_CANCELLED;
        if (makerOrder.nonce < looksRareExchange.userMinOrderNonce(makerOrder.signer))
            return NONCE_BELOW_MIN_ORDER_NONCE;
    }

    /**
     * @notice Check the validity of amounts
     * @param makerOrder Maker order struct
     * @return validationCode Validation code
     */
    function checkValidityAmounts(OrderTypes.MakerOrder calldata makerOrder)
        public
        pure
        returns (uint256 validationCode)
    {
        if (makerOrder.amount == 0) return ORDER_AMOUNT_CANNOT_BE_ZERO;
    }

    /**
     * @notice Check the validity of a signature
     * @param makerOrder Maker order struct
     * @return validationCode Validation code
     */
    function checkValiditySignature(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        if (makerOrder.signer == address(0)) return MAKER_SIGNER_IS_NULL_SIGNER;

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, makerOrder.hash()));

        if (!Address.isContract(makerOrder.signer)) {
            return _validateEOA(digest, makerOrder.signer, makerOrder.v, makerOrder.r, makerOrder.s);
        } else {
            return _validateERC1271(digest, makerOrder.signer, makerOrder.v, makerOrder.r, makerOrder.s);
        }
    }

    /**
     * @notice Check the validity for currency/strategy whitelists
     * @param makerOrder Maker order struct
     * @return validationCode Validation code
     */
    function checkValidityWhitelists(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        // Verify whether the currency is whitelisted
        if (!currencyManager.isCurrencyWhitelisted(makerOrder.currency)) return CURRENCY_NOT_WHITELISTED;

        // Verify whether the strategy is whitelisted
        if (!executionManager.isStrategyWhitelisted(makerOrder.strategy)) return STRATEGY_NOT_WHITELISTED;
    }

    /**
     * @notice Check the validity of min percentage to ask
     * @param makerOrder Maker order struct
     * @return validationCode Validation code
     */
    function checkValidityMinPercentageToAsk(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        // Return if order is bid since there is no protection for minPercentageToAsk
        if (!makerOrder.isOrderAsk) return ORDER_EXPECTED_TO_BE_VALID;

        uint256 minNetPriceToAsk = (makerOrder.minPercentageToAsk * makerOrder.price);

        uint256 finalSellerAmount = makerOrder.price;
        uint256 protocolFee = (makerOrder.price * IExecutionStrategy(makerOrder.strategy).viewProtocolFee()) / 10000;
        finalSellerAmount -= protocolFee;

        if ((finalSellerAmount * 10000) < minNetPriceToAsk) return MIN_NET_RATIO_ABOVE_PROTOCOL_FEE;

        uint256 royaltyFeeAmount = (makerOrder.price * royaltyFeeManager.standardRoyaltyFee()) / 10000;

        (address receiver, ) = royaltyFeeRegistry.royaltyInfo(makerOrder.collection, makerOrder.price);

        if (receiver != address(0)) {
            // Royalty registry logic
            finalSellerAmount -= royaltyFeeAmount;
            if ((finalSellerAmount * 10000) < minNetPriceToAsk)
                return MIN_NET_RATIO_ABOVE_ROYALTY_FEE_REGISTRY_AND_PROTOCOL_FEE;
        } else {
            // ERC2981 logic
            if (IERC165(makerOrder.collection).supportsInterface(INTERFACE_ID_ERC2981)) {
                (bool success, bytes memory data) = makerOrder.collection.staticcall(
                    abi.encodeWithSelector(IERC2981.royaltyInfo.selector, makerOrder.tokenId, makerOrder.price)
                );

                if (!success) {
                    return MISSING_ROYALTY_INFO_FUNCTION_ERC2981;
                } else {
                    (receiver, ) = abi.decode(data, (address, uint256));
                }

                if (receiver != address(0)) {
                    finalSellerAmount -= royaltyFeeAmount;
                    if ((finalSellerAmount * 10000) < minNetPriceToAsk)
                        return MIN_NET_RATIO_ABOVE_ROYALTY_FEE_ERC2981_AND_PROTOCOL_FEE;
                }
            }
        }
    }

    /**
     * @notice Check the validity of order timestamps
     * @param makerOrder Maker order struct
     * @return validationCode Validation code
     */
    function checkValidityTimestamps(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        if (makerOrder.startTime > block.timestamp) return TOO_EARLY_TO_EXECUTE_ORDER;
        if (makerOrder.endTime < block.timestamp) return TOO_LATE_TO_EXECUTE_ORDER;
    }

    /**
     * @notice Check the validity of approvals and balances
     * @param makerOrder Maker order struct
     * @return validationCode Validation code
     */
    function checkValidityApprovalsAndBalances(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        if (makerOrder.isOrderAsk) {
            return
                _validateNFTApprovals(makerOrder.collection, makerOrder.signer, makerOrder.tokenId, makerOrder.amount);
        } else {
            return _validateERC20(makerOrder.currency, makerOrder.signer, makerOrder.price);
        }
    }

    /**
     * @notice Check the validity of NFT approvals and balances
     * @param collection Collection address
     * @param user User address
     * @param tokenId TokenId
     * @param amount Amount
     */
    function _validateNFTApprovals(
        address collection,
        address user,
        uint256 tokenId,
        uint256 amount
    ) internal view returns (uint256 validationCode) {
        address transferManager;

        if (IERC165(collection).supportsInterface(INTERFACE_ID_ERC721)) {
            transferManager = TRANSFER_MANAGER_ERC721;
        } else if (IERC165(collection).supportsInterface(INTERFACE_ID_ERC1155)) {
            transferManager = TRANSFER_MANAGER_ERC1155;
        } else {
            transferManager = transferSelectorNFT.transferManagerSelectorForCollection(collection);
        }

        if (transferManager == address(0)) return NO_TRANSFER_MANAGER_AVAILABLE_FOR_COLLECTION;

        if (transferManager == TRANSFER_MANAGER_ERC721) {
            return _validateERC721AndEquivalents(collection, user, transferManager, tokenId);
        } else if (transferManager == TRANSFER_MANAGER_ERC1155) {
            return _validateERC1155(collection, user, transferManager, tokenId, amount);
        } else {
            return CUSTOM_TRANSFER_MANAGER;
        }
    }

    /**
     * @notice Check the validity of ERC20 approvals and balances that are required to process the maker bid order
     * @param currency Currency address
     * @param user User address
     * @param price Price (defined by the maker order)
     */
    function _validateERC20(
        address currency,
        address user,
        uint256 price
    ) internal view returns (uint256 validationCode) {
        if (IERC20(currency).balanceOf(user) < price) return ERC20_BALANCE_INFERIOR_TO_PRICE;
        if (IERC20(currency).allowance(user, address(looksRareExchange)) < price)
            return ERC20_APPROVAL_INFERIOR_TO_PRICE;
    }

    /**
     * @notice Check the validity of ERC721 approvals and balances required to process the maker ask order
     * @param collection Collection address
     * @param user User address
     * @param transferManager Transfer manager address
     * @param tokenId TokenId
     */
    function _validateERC721AndEquivalents(
        address collection,
        address user,
        address transferManager,
        uint256 tokenId
    ) internal view returns (uint256 validationCode) {
        // 1. Verify tokenId is owned by user and catch revertion if ERC721 ownerOf fails
        (bool success, bytes memory data) = collection.staticcall(
            abi.encodeWithSelector(IERC721.ownerOf.selector, tokenId)
        );

        if (!success) return ERC721_TOKEN_ID_DOES_NOT_EXIST;
        if (abi.decode(data, (address)) != user) return ERC721_TOKEN_ID_NOT_IN_BALANCE;

        // 2. Verify if collection is approved by transfer manager
        (success, data) = collection.staticcall(
            abi.encodeWithSelector(IERC721.isApprovedForAll.selector, user, transferManager)
        );

        bool isApprovedAll;
        if (success) {
            isApprovedAll = abi.decode(data, (bool));
        }

        if (!isApprovedAll) {
            // 3. If collection is not approved by transfer manager, try to see if it is approved individually
            (success, data) = collection.staticcall(abi.encodeWithSelector(IERC721.getApproved.selector, tokenId));

            address approvedAddress;
            if (success) {
                approvedAddress = abi.decode(data, (address));
            }

            if (approvedAddress != transferManager) return ERC721_NO_APPROVAL_FOR_ALL_OR_TOKEN_ID;
        }
    }

    /**
     * @notice Check the validity of ERC1155 approvals and balances required to process the maker ask order
     * @param collection Collection address
     * @param user User address
     * @param transferManager Transfer manager address
     * @param tokenId TokenId
     * @param amount Amount
     */
    function _validateERC1155(
        address collection,
        address user,
        address transferManager,
        uint256 tokenId,
        uint256 amount
    ) internal view returns (uint256 validationCode) {
        (bool success, bytes memory data) = collection.staticcall(
            abi.encodeWithSelector(IERC1155.balanceOf.selector, user, tokenId)
        );

        if (!success) return ERC1155_BALANCE_OF_DOES_NOT_EXIST;
        if (abi.decode(data, (uint256)) < amount) return ERC1155_BALANCE_OF_TOKEN_ID_INFERIOR_TO_AMOUNT;

        (success, data) = collection.staticcall(
            abi.encodeWithSelector(IERC1155.isApprovedForAll.selector, user, transferManager)
        );

        if (!success) return ERC1155_IS_APPROVED_FOR_ALL_DOES_NOT_EXIST;
        if (!abi.decode(data, (bool))) return ERC1155_NO_APPROVAL_FOR_ALL;
    }

    /**
     * @notice Check the validity of EOA maker order
     * @param digest Digest
     * @param targetSigner Expected signer address to confirm message validity
     * @param v V parameter (27 or 28)
     * @param r R parameter
     * @param s S parameter
     */
    function _validateEOA(
        bytes32 digest,
        address targetSigner,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (uint256 validationCode) {
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0)
            return INVALID_S_PARAMETER_EOA;

        if (v != 27 && v != 28) return INVALID_V_PARAMETER_EOA;

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) return NULL_SIGNER_EOA;
        if (signer != targetSigner) return WRONG_SIGNER_EOA;
    }

    /**
     * @notice Check the validity for EIP1271 maker order
     * @param digest Digest
     * @param targetSigner Expected signer address to confirm message validity
     * @param v V parameter (27 or 28)
     * @param r R parameter
     * @param s S parameter
     */
    function _validateERC1271(
        bytes32 digest,
        address targetSigner,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view returns (uint256 validationCode) {
        (bool success, bytes memory data) = targetSigner.staticcall(
            abi.encodeWithSelector(IERC1271.isValidSignature.selector, digest, abi.encodePacked(r, s, v))
        );

        if (!success) return MISSING_IS_VALID_SIGNATURE_FUNCTION_EIP1271;
        bytes4 magicValue = abi.decode(data, (bytes4));

        if (magicValue != MAGIC_VALUE_EIP1271) return SIGNATURE_INVALID_EIP1271;
    }
}
