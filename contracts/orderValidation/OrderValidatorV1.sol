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
import {ITransferSelectorNFTExtended, IRoyaltyFeeManagerExtended} from "./ExtendedInterfaces.sol";

// LooksRareExchange
import {LooksRareExchange} from "../LooksRareExchange.sol";

/**
 * @title OrderValidatorV1
 */
contract OrderValidatorV1 {
    using OrderTypes for OrderTypes.MakerOrder;

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
    bytes32 public immutable _DOMAIN_SEPARATOR;

    // Currency Manager
    ICurrencyManager public immutable currencyManager;

    // Execution Manager
    IExecutionManager public immutable executionManager;

    // LooksRare Exchange
    LooksRareExchange public immutable looksRareExchange;

    // Transfer Selector
    ITransferSelectorNFTExtended public immutable transferSelectorNFT;

    // Royalty Fee Registry
    IRoyaltyFeeRegistry public immutable royaltyFeeRegistry;

    /**
     * @notice Constructor
     * @param _looksRareExchange address of the LooksRare exchange (v1)
     */
    constructor(address _looksRareExchange) {
        looksRareExchange = LooksRareExchange(_looksRareExchange);
        _DOMAIN_SEPARATOR = LooksRareExchange(_looksRareExchange).DOMAIN_SEPARATOR();

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
        IRoyaltyFeeManagerExtended royaltyFeeManager = IRoyaltyFeeManagerExtended(
            address(LooksRareExchange(_looksRareExchange).royaltyFeeManager())
        );
        royaltyFeeRegistry = royaltyFeeManager.royaltyFeeRegistry();
    }

    /**
     * @notice Check the validities for an array of maker orders
     * @param makerOrders array of maker order structs
     * @return validationCodes array of validation codes for the array of maker orders
     */
    function checkMultipleOrderValidities(OrderTypes.MakerOrder[] calldata makerOrders)
        public
        view
        returns (uint256[] memory validationCodes)
    {
        validationCodes = new uint256[](makerOrders.length);

        for (uint256 i; i < makerOrders.length; ) {
            validationCodes[i] = checkOrderValidity(makerOrders[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Check the validity of a maker order
     * @param makerOrder maker order struct
     * @return validationCode validation code for the order
     */
    function checkOrderValidity(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        uint256 response = checkValidityNonces(makerOrder);
        if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        response = checkValidityAmounts(makerOrder);
        if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        response = checkValiditySignature(makerOrder);
        if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        response = checkValidityWhitelists(makerOrder);
        if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        response = checkValidityMinPercentageToAsk(makerOrder);
        if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        response = checkValidityTimestamps(makerOrder);
        if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        return checkValidityApprovalsAndBalances(makerOrder);
    }

    /**
     * @notice Check validity of nonces
     * @param makerOrder maker order struct
     * @return validationCode validation code
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
     * @notice Check validity of amounts
     * @param makerOrder maker order struct
     * @return validationCode validation code
     */
    function checkValidityAmounts(OrderTypes.MakerOrder calldata makerOrder)
        public
        pure
        returns (uint256 validationCode)
    {
        if (makerOrder.amount == 0) return ORDER_AMOUNT_CANNOT_BE_ZERO;
    }

    /**
     * @notice Check validity of a signature
     * @param makerOrder maker order struct
     * @return validationCode validation code
     */
    function checkValiditySignature(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        if (makerOrder.signer == address(0)) return MAKER_SIGNER_IS_NULL_SIGNER;

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, makerOrder.hash()));

        if (!Address.isContract(makerOrder.signer)) {
            return _validateEOA(digest, makerOrder.signer, makerOrder.v, makerOrder.r, makerOrder.s);
        } else {
            return _validateERC1271(digest, makerOrder.signer, makerOrder.v, makerOrder.r, makerOrder.s);
        }
    }

    /**
     * @notice Check validity of whitelists
     * @param makerOrder maker order struct
     * @return validationCode validation code
     */
    function checkValidityWhitelists(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        // Verify whether the currency is whitelisted
        if (!currencyManager.isCurrencyWhitelisted(makerOrder.currency)) return CURRENCY_NOT_WHITELISTED;

        // Verify whether strategy can be executed
        if (!executionManager.isStrategyWhitelisted(makerOrder.strategy)) return STRATEGY_NOT_WHITELISTED;
    }

    /**
     * @notice Check validity of min percentage to ask
     * @param makerOrder maker order struct
     * @return validationCode validation code
     */
    function checkValidityMinPercentageToAsk(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        // Return if order is bid since there is no protection for minPercentageToAsk
        if (!makerOrder.isOrderAsk) return ORDER_EXPECTED_TO_BE_VALID;

        uint256 finalSellerAmount = makerOrder.price;
        uint256 protocolFee = (makerOrder.price * IExecutionStrategy(makerOrder.strategy).viewProtocolFee()) / 10000;
        finalSellerAmount -= protocolFee;

        if ((finalSellerAmount * 10000) < (makerOrder.minPercentageToAsk * makerOrder.price))
            return MIN_NET_RATIO_ABOVE_PROTOCOL_FEE;

        (address receiver, uint256 royaltyAmount) = royaltyFeeRegistry.royaltyInfo(
            makerOrder.collection,
            makerOrder.price
        );

        if (receiver != address(0) && royaltyAmount != 0) {
            // Royalty registry logic
            finalSellerAmount -= royaltyAmount;
            if ((finalSellerAmount * 10000) < (makerOrder.minPercentageToAsk * makerOrder.price))
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
                    (receiver, royaltyAmount) = abi.decode(data, (address, uint256));
                }

                if (receiver != address(0)) {
                    finalSellerAmount -= royaltyAmount;
                    if ((finalSellerAmount * 10000) < (makerOrder.minPercentageToAsk * makerOrder.price))
                        return MIN_NET_RATIO_ABOVE_ROYALTY_FEE_ERC2981_AND_PROTOCOL_FEE;
                }
            }
        }
    }

    /**
     * @notice Check validity of order timestamps
     * @param makerOrder maker order struct
     * @return validationCode validation code
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
     * @notice Check validity of approvals and balances
     * @param makerOrder maker order struct
     * @return validationCode validation code
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
     * @notice Check validity of NFT approvals and balances
     * @param collection address of the collection
     * @param user address of the user
     * @param tokenId tokenId
     * @param amount amount
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
     * @notice Check validity of ERC20 approvals and balances required to process the order
     * @param currency address of the currency
     * @param user address of the user
     * @param price price (defined by the maker order)
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
     * @notice Check validity of ERC721 approvals and balances required to process the order
     * @param collection address of the collection
     * @param user address of the user
     * @param transferManager address of the transfer manager
     * @param tokenId tokenId
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
     * @notice Check validity of ERC1155 approvals and balances required to process the order
     * @param collection address of the collection
     * @param user address of the user
     * @param transferManager address of the transfer manager
     * @param tokenId tokenId
     * @param amount amount
     */
    function _validateERC1155(
        address collection,
        address user,
        address transferManager,
        uint256 tokenId,
        uint256 amount
    ) internal view returns (uint256 validationCode) {
        // @dev ERC1155 balanceOf doesn't revert if tokenId doesn't exist
        if ((IERC1155(collection).balanceOf(user, tokenId)) < amount)
            return ERC1155_BALANCE_TOKEN_ID_INFERIOR_TO_AMOUNT;
        bool isApprovedAll = IERC1155(collection).isApprovedForAll(user, transferManager);
        if (!isApprovedAll) return ERC1155_NO_APPROVAL_FOR_ALL;
    }

    /**
     * @notice Check validity of EOA maker order
     * @param digest digest
     * @param targetSigner the signer address to confirm message validity
     * @param v parameter (27 or 28)
     * @param r parameter
     * @param s parameter
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
     * @notice Check validity of ERC-1271 maker order
     * @param digest digest
     * @param targetSigner the signer address to confirm message validity
     * @param v parameter (27 or 28)
     * @param r parameter
     * @param s parameter
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
