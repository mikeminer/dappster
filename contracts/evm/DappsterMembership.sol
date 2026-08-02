// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Monthly Dappster membership and non-transferable on-chain credits.
/// @dev USDC is sent directly to treasury. Credits are ERC-1155 units and are
///      burned by an explicitly authorized Dappster consumer when a service is used.
contract DappsterMembership is ERC1155, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CREDIT_TOKEN_ID = 1;
    uint256 public constant MEMBERSHIP_TOKEN_ID = 2;
    uint256 public constant MEMBERSHIP_DURATION = 30 days;

    IERC20 public immutable usdc;
    address public immutable treasury;
    address public consumer;
    uint256 public membershipPrice;

    struct CreditPackage {
        uint128 price;
        uint128 credits;
        bool enabled;
    }

    mapping(uint256 packageId => CreditPackage) public creditPackages;
    mapping(address account => uint256 expiresAt) public membershipExpiresAt;
    mapping(bytes32 usageId => bool consumed) public processedUsageIds;

    event CreditsPurchased(
        address indexed buyer,
        uint256 indexed packageId,
        uint256 credits,
        uint256 usdcPaid
    );
    event MembershipPurchased(address indexed buyer, uint256 expiresAt, uint256 usdcPaid);
    event CreditsConsumed(address indexed account, uint256 credits, bytes32 indexed usageId);
    event ConsumerUpdated(address indexed consumer);
    event CreditPackageUpdated(uint256 indexed packageId, uint256 price, uint256 credits, bool enabled);
    event MembershipPriceUpdated(uint256 price);

    error Soulbound();
    error InvalidAddress();
    error InvalidPackage();
    error InvalidAmount();
    error NotConsumer();
    error UsageAlreadyProcessed();

    constructor(
        address initialOwner,
        address usdcAddress,
        address treasuryAddress,
        address initialConsumer,
        string memory metadataUri
    ) ERC1155(metadataUri) Ownable(initialOwner) {
        if (
            initialOwner == address(0) ||
            usdcAddress == address(0) ||
            treasuryAddress == address(0)
        ) revert InvalidAddress();
        usdc = IERC20(usdcAddress);
        treasury = treasuryAddress;
        consumer = initialConsumer;
        membershipPrice = 39_000_000;

        creditPackages[1] = CreditPackage(5_000_000, 50, true);
        creditPackages[2] = CreditPackage(25_000_000, 300, true);
        creditPackages[3] = CreditPackage(55_000_000, 800, true);
    }

    function buyCredits(uint256 packageId) external nonReentrant {
        CreditPackage memory selected = creditPackages[packageId];
        if (!selected.enabled || selected.price == 0 || selected.credits == 0) revert InvalidPackage();

        usdc.safeTransferFrom(msg.sender, treasury, selected.price);
        _mint(msg.sender, CREDIT_TOKEN_ID, selected.credits, "");
        emit CreditsPurchased(msg.sender, packageId, selected.credits, selected.price);
    }

    function buyMembership() external nonReentrant {
        usdc.safeTransferFrom(msg.sender, treasury, membershipPrice);
        uint256 start = membershipExpiresAt[msg.sender] > block.timestamp
            ? membershipExpiresAt[msg.sender]
            : block.timestamp;
        uint256 expiry = start + MEMBERSHIP_DURATION;
        membershipExpiresAt[msg.sender] = expiry;

        if (balanceOf(msg.sender, MEMBERSHIP_TOKEN_ID) == 0) {
            _mint(msg.sender, MEMBERSHIP_TOKEN_ID, 1, "");
        }
        emit MembershipPurchased(msg.sender, expiry, membershipPrice);
    }

    function hasActiveMembership(address account) external view returns (bool) {
        return membershipExpiresAt[account] > block.timestamp;
    }

    /// @notice Lets a user explicitly burn their own credits.
    function burnOwnCredits(uint256 amount, bytes32 usageId) external {
        _consume(msg.sender, amount, usageId);
    }

    /// @notice Burns credits for an API action. The owner appoints only the Dappster relayer.
    function consumeCredits(address account, uint256 amount, bytes32 usageId) external {
        if (msg.sender != consumer) revert NotConsumer();
        _consume(account, amount, usageId);
    }

    function setConsumer(address nextConsumer) external onlyOwner {
        if (nextConsumer == address(0)) revert InvalidAddress();
        consumer = nextConsumer;
        emit ConsumerUpdated(nextConsumer);
    }

    function setCreditPackage(
        uint256 packageId,
        uint128 price,
        uint128 credits,
        bool enabled
    ) external onlyOwner {
        if (packageId == 0 || price == 0 || credits == 0) revert InvalidAmount();
        creditPackages[packageId] = CreditPackage(price, credits, enabled);
        emit CreditPackageUpdated(packageId, price, credits, enabled);
    }

    function setMembershipPrice(uint256 nextPrice) external onlyOwner {
        if (nextPrice == 0) revert InvalidAmount();
        membershipPrice = nextPrice;
        emit MembershipPriceUpdated(nextPrice);
    }

    function _consume(address account, uint256 amount, bytes32 usageId) internal {
        if (amount == 0) revert InvalidAmount();
        if (processedUsageIds[usageId]) revert UsageAlreadyProcessed();
        processedUsageIds[usageId] = true;
        _burn(account, CREDIT_TOKEN_ID, amount);
        emit CreditsConsumed(account, amount, usageId);
    }

    /// @dev Membership and credits cannot be sold or transferred.
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }
}
