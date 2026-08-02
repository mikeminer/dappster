// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Atomic USDC revenue splitting for Dappster creator-content purchases.
contract DappsterMarketplace is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    IERC20 public immutable usdc;
    address public platformTreasury;
    uint16 public platformFeeBps = 1_000;
    mapping(bytes32 purchaseId => bool processed) public processedPurchases;

    event ContentPurchased(bytes32 indexed purchaseId, bytes32 indexed dappId, uint8 indexed assetType, address buyer, address creator, uint256 total, uint256 creatorAmount, uint256 platformAmount);
    event PlatformSettingsUpdated(address treasury, uint16 feeBps);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidAsset();
    error PurchaseAlreadyProcessed();

    constructor(address initialOwner, address usdcAddress, address treasury) Ownable(initialOwner) {
        if (initialOwner == address(0) || usdcAddress == address(0) || treasury == address(0)) revert InvalidAddress();
        usdc = IERC20(usdcAddress);
        platformTreasury = treasury;
    }

    function purchase(bytes32 purchaseId, bytes32 dappId, uint8 assetType, address creator, uint256 amount) external nonReentrant {
        if (processedPurchases[purchaseId]) revert PurchaseAlreadyProcessed();
        if (creator == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (assetType > 2) revert InvalidAsset();
        processedPurchases[purchaseId] = true;
        uint256 platformAmount = amount * platformFeeBps / BPS;
        uint256 creatorAmount = amount - platformAmount;
        usdc.safeTransferFrom(msg.sender, creator, creatorAmount);
        usdc.safeTransferFrom(msg.sender, platformTreasury, platformAmount);
        emit ContentPurchased(purchaseId, dappId, assetType, msg.sender, creator, amount, creatorAmount, platformAmount);
    }

    function setPlatformSettings(address treasury, uint16 feeBps) external onlyOwner {
        if (treasury == address(0)) revert InvalidAddress();
        if (feeBps > 3_000) revert InvalidAmount();
        platformTreasury = treasury;
        platformFeeBps = feeBps;
        emit PlatformSettingsUpdated(treasury, feeBps);
    }
}
