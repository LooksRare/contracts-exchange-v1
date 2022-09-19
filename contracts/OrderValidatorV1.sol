// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// OZ dependencies
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165, IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

// LooksRare libraries
import "./libraries/ValidationCodeConstants.sol";
import {OrderTypes} from "./libraries/OrderTypes.sol";

// LooksRare interfaces
import {ICurrencyManager} from "./interfaces/ICurrencyManager.sol";
import {IExecutionManager} from "./interfaces/IExecutionManager.sol";
import {IExecutionStrategy} from "./interfaces/IExecutionStrategy.sol";
import {IRoyaltyFeeRegistry} from "./interfaces/IRoyaltyFeeRegistry.sol";
import {IRoyaltyFeeManager} from "./interfaces/IRoyaltyFeeManager.sol";
import {ITransferManagerNFT} from "./interfaces/ITransferManagerNFT.sol";
import {ITransferSelectorNFT} from "./interfaces/ITransferSelectorNFT.sol";

// LooksRareExchange
import {LooksRareExchange} from "./LooksRareExchange.sol";

interface IRoyaltyFeeManagerExtended is IRoyaltyFeeManager {
    function royaltyFeeRegistry() external view returns (IRoyaltyFeeRegistry);
}

interface ITransferSelectorNFTExtended is ITransferSelectorNFT {
    function transferManagerSelectorForCollection(address collection) external view returns (address);
}

/**
 * OrderValidatorV1
 */
contract OrderValidatorV1 {
    using OrderTypes for OrderTypes.MakerOrder;

    // TransferManager ERC721
    address public constant TRANSFER_MANAGER_ERC721 = 0xf42aa99F011A1fA7CDA90E5E98b277E306BcA83e;
    // TransferManager ERC1155
    address public constant TRANSFER_MANAGER_ERC1155 = 0xFED24eC7E22f573c2e08AEF55aA6797Ca2b3A051;
    // ERC721 interfaceID
    bytes4 public constant INTERFACE_ID_ERC721 = 0x80ac58cd;
    // ERC1155 interfaceID
    bytes4 public constant INTERFACE_ID_ERC1155 = 0xd9b67a26;

    // Domain separator from LooksRare Exchange
    bytes32 public immutable _DOMAIN_SEPARATOR;

    // LooksRare Exchange
    LooksRareExchange public immutable looksRareExchange;

    ICurrencyManager public currencyManager;
    IExecutionManager public executionManager;
    ITransferSelectorNFTExtended public transferSelectorNFT;
    IRoyaltyFeeRegistry public royaltyFeeRegistry;

    /**
     * @notice Constructor
     * @param _looksRareExchange address of the LooksRare exchange (v1)
     * @param _looksRareDomainSeparator domain separator for LooksRare exchange (v1)
     */
    constructor(address _looksRareExchange, bytes32 _looksRareDomainSeparator) {
        looksRareExchange = LooksRareExchange(_looksRareExchange);
        _DOMAIN_SEPARATOR = _looksRareDomainSeparator;
    }

    /**
     * @notice Update peripheral contract addresses
     */
    function updatePeripheralContractAddresses() external {
        currencyManager = looksRareExchange.currencyManager();
        executionManager = looksRareExchange.executionManager();
        transferSelectorNFT = ITransferSelectorNFTExtended(address(looksRareExchange.transferSelectorNFT()));
        IRoyaltyFeeManagerExtended royaltyFeeManager = IRoyaltyFeeManagerExtended(
            address(looksRareExchange.royaltyFeeManager())
        );
        royaltyFeeRegistry = royaltyFeeManager.royaltyFeeRegistry();
    }

    /**
     * @notice Verify the validity of the maker order
     * @param makerOrder maker order struct
     * @return validationCode validation code for the order
     */
    function validateOrder(OrderTypes.MakerOrder calldata makerOrder) external view returns (uint256 validationCode) {
        validationCode = validateNonces(makerOrder);
        validationCode = validateAmounts(makerOrder);
        validationCode = validateSignature(makerOrder);
        validationCode = validateWhitelists(makerOrder);
        validationCode = validateMinPercentageToAsk(makerOrder);
        validationCode = validateTimestamps(makerOrder);
        validationCode = validateApprovalsAndBalances(makerOrder);
    }

    function validateNonces(OrderTypes.MakerOrder calldata makerOrder) public view returns (uint256 validationCode) {
        if (looksRareExchange.isUserOrderNonceExecutedOrCancelled(makerOrder.signer, makerOrder.nonce))
            return NONCE_EXECUTED_OR_CANCELLED;
        if (makerOrder.nonce < looksRareExchange.userMinOrderNonce(makerOrder.signer))
            return NONCE_BELOW_MIN_ORDER_NONCE;
    }

    function validateAmounts(OrderTypes.MakerOrder calldata makerOrder) public pure returns (uint256 validationCode) {
        if (makerOrder.amount == 0) return ORDER_AMOUNT_CANNOT_BE_NULL;
    }

    function validateSignature(OrderTypes.MakerOrder calldata makerOrder) public view returns (uint256 validationCode) {
        if (makerOrder.signer == address(0)) return MAKER_SIGNER_IS_NULL_SIGNER;

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, makerOrder.hash()));

        if (Address.isContract(makerOrder.signer)) {
            uint256 response = _validateEOA(digest, makerOrder.signer, makerOrder.v, makerOrder.r, makerOrder.s);
            if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        } else {
            uint256 response = _validateERC1271(digest, makerOrder.signer, makerOrder.v, makerOrder.r, makerOrder.s);
            if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        }
    }

    function validateWhitelists(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        // Verify whether the currency is whitelisted
        if (!currencyManager.isCurrencyWhitelisted(makerOrder.currency)) return CURRENCY_NOT_WHITELISTED;

        // Verify whether strategy can be executed
        if (!executionManager.isStrategyWhitelisted(makerOrder.strategy)) return STRATEGY_NOT_WHITELISTED;
    }

    function validateMinPercentageToAsk(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        // Return if order is bid since there is no protection for minPercentageToAsk
        if (!makerOrder.isOrderAsk) return validationCode;

        uint256 finalSellerAmount = makerOrder.price;
        uint256 protocolFee = makerOrder.price * IExecutionStrategy(makerOrder.strategy).viewProtocolFee();
        finalSellerAmount -= protocolFee;

        if ((finalSellerAmount * 10000) < (makerOrder.minPercentageToAsk * makerOrder.price))
            return MIN_NET_RATIO_ABOVE_PROTOCOL_FEE;

        (address receiver, uint256 royaltyAmount) = royaltyFeeRegistry.royaltyInfo(
            makerOrder.collection,
            makerOrder.price
        );

        if ((receiver != address(0)) && (royaltyAmount != 0)) {
            // Royalty registry logic
            finalSellerAmount -= royaltyAmount;
            if ((finalSellerAmount * 10000) < (makerOrder.minPercentageToAsk * makerOrder.price))
                return MIN_NET_RATIO_ABOVE_ROYALTY_FEE_REGISTRY_AND_PROTOCOL_FEE;
        } else {
            // ERC2981 logic
            if (IERC165(makerOrder.collection).supportsInterface(0x2a55205a)) {
                (receiver, royaltyAmount) = IERC2981(makerOrder.collection).royaltyInfo(
                    makerOrder.tokenId,
                    makerOrder.price
                );

                if (receiver != address(0)) {
                    finalSellerAmount -= royaltyAmount;
                    if ((finalSellerAmount * 10000) < (makerOrder.minPercentageToAsk * makerOrder.price))
                        return MIN_NET_RATIO_ABOVE_ROYALTY_FEE_EIP2981_AND_PROTOCOL_FEE;
                }
            }
        }
    }

    function validateTimestamps(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        if (makerOrder.startTime > block.timestamp) return TOO_EARLY_TO_EXECUTE_ORDER;
        if (makerOrder.endTime < block.timestamp) return TOO_LATE_TO_EXECUTE_ORDER;
    }

    function validateApprovalsAndBalances(OrderTypes.MakerOrder calldata makerOrder)
        public
        view
        returns (uint256 validationCode)
    {
        if (makerOrder.isOrderAsk) {
            uint256 response = _validateNFTApprovals(
                makerOrder.collection,
                makerOrder.signer,
                makerOrder.tokenId,
                makerOrder.amount
            );
            if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        } else {
            uint256 response = _validateERC20(makerOrder.currency, makerOrder.signer, makerOrder.price);
            if (response != ORDER_EXPECTED_TO_BE_VALID) return response;
        }
    }

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
            _validateERC721AndEquivalents(collection, user, transferManager, tokenId);
        } else if (transferManager == TRANSFER_MANAGER_ERC1155) {
            _validateERC1155(collection, user, transferManager, tokenId, amount);
        } else {
            return NO_TRANSFER_MANAGER_AVAILABLE_FOR_COLLECTION;
        }
    }

    function _validateERC20(
        address currency,
        address user,
        uint256 price
    ) internal view returns (uint256 validationCode) {
        if ((IERC20(currency).allowance(user, address(looksRareExchange))) < price)
            return ERC20_APPROVAL_INFERIOR_TO_AMOUNT;
        if ((IERC20(currency).balanceOf(user)) < price) return ERC20_BALANCE_INFERIOR_TO_AMOUNT;
    }

    function _validateERC721AndEquivalents(
        address collection,
        address user,
        address transferManager,
        uint256 tokenId
    ) internal view returns (uint256 validationCode) {
        bool isApprovedSingle = IERC721(collection).getApproved(tokenId) == transferManager;
        bool isApprovedAll = IERC721(collection).isApprovedForAll(user, transferManager);

        if (!isApprovedAll && !isApprovedSingle) return ERC721_NO_APPROVAL_FOR_ALL_OR_TOKEN_ID;
        if ((IERC721(collection).ownerOf(tokenId)) != user) return ERC721_TOKEN_ID_NOT_IN_BALANCE;
    }

    function _validateERC1155(
        address collection,
        address user,
        address transferManager,
        uint256 tokenId,
        uint256 amount
    ) internal view returns (uint256 validationCode) {
        bool isApprovedAll = IERC1155(collection).isApprovedForAll(user, transferManager);
        if (!isApprovedAll) return ERC1155_NO_APPROVAL_FOR_ALL;
        if ((IERC1155(collection).balanceOf(user, tokenId)) < amount)
            return ERC1155_BALANCE_TOKEN_ID_INFERIOR_TO_AMOUNT;
    }

    /**
     * @notice Validate EOA maker order
     * @param digest digest
     * @param targetSigner the signer address to confirm message validity
     * @param v parameter (27 or 28). This prevents maleability since the public key recovery equation has two possible solutions.
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
     * @notice Validate ERC-1271 maker order
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
        // 0x1626ba7e is the interfaceId for signature contracts (see IERC1271)
        if (IERC1271(targetSigner).isValidSignature(digest, abi.encodePacked(r, s, v)) == 0x1626ba7e)
            return SIGNATURE_INVALID_ERC_1271;
    }
}
