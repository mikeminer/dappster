// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Deploys Dappster-generated contracts through a normal contract call.
/// @dev Generated contracts must use the standard Ownable owner()/transferOwnership(address) interface.
contract DappsterDeploymentFactory {
    uint256 public constant DEPLOYMENT_FEE = 0.001 ether;

    error DeploymentInProgress();
    error EmptyCreationCode();
    error IncorrectDeploymentFee(uint256 received);
    error ContractCreationFailed();
    error UnsupportedOwnershipInterface();
    error UnexpectedInitialOwner(address owner);
    error OwnershipTransferFailed();
    error OwnershipTransferNotConfirmed(address owner);

    event DappsterContractDeployed(
        address indexed deployer,
        address indexed contractAddress,
        bytes32 indexed creationCodeHash
    );

    bool private deploying;

    function deploy(bytes calldata creationCode) external payable returns (address deployed) {
        if (deploying) revert DeploymentInProgress();
        if (msg.value != DEPLOYMENT_FEE) revert IncorrectDeploymentFee(msg.value);
        if (creationCode.length == 0) revert EmptyCreationCode();

        deploying = true;
        bytes memory initCode = creationCode;
        assembly ("memory-safe") {
            deployed := create(callvalue(), add(initCode, 0x20), mload(initCode))
        }
        if (deployed == address(0)) revert ContractCreationFailed();

        address initialOwner = _readOwner(deployed);
        if (initialOwner != address(this)) revert UnexpectedInitialOwner(initialOwner);

        (bool transferred,) = deployed.call(
            abi.encodeWithSelector(bytes4(keccak256("transferOwnership(address)")), msg.sender)
        );
        if (!transferred) revert OwnershipTransferFailed();

        address finalOwner = _readOwner(deployed);
        if (finalOwner != msg.sender) revert OwnershipTransferNotConfirmed(finalOwner);

        deploying = false;
        emit DappsterContractDeployed(msg.sender, deployed, keccak256(creationCode));
    }

    function _readOwner(address deployed) private view returns (address contractOwner) {
        (bool ok, bytes memory result) = deployed.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("owner()")))
        );
        if (!ok || result.length != 32) revert UnsupportedOwnershipInterface();
        contractOwner = abi.decode(result, (address));
    }
}
