// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DappIdentityRegistry
/// @notice Append-only Base registry for verifiable Dappster release bundles.
/// @dev A release is accepted only when the live Base runtime bytecode matches runtimeCodeHash.
contract DappIdentityRegistry {
    struct ReleaseInput {
        address contractAddress;
        bytes32 creationCodeHash;
        bytes32 runtimeCodeHash;
        bytes32 sourceHash;
        bytes32 frontendCidHash;
        bytes32 auditReportHash;
        bytes32 manifestHash;
        uint16 auditScore;
        uint64 deploymentBlock;
        string manifestCid;
    }

    struct Release {
        address publisher;
        address contractAddress;
        bytes32 creationCodeHash;
        bytes32 runtimeCodeHash;
        bytes32 sourceHash;
        bytes32 frontendCidHash;
        bytes32 auditReportHash;
        bytes32 manifestHash;
        uint64 version;
        uint64 deploymentBlock;
        uint64 registeredBlock;
        uint16 auditScore;
        string manifestCid;
    }

    error ContractNotDeployed(address contractAddress);
    error RuntimeCodeHashMismatch(bytes32 expected, bytes32 actual);
    error ContractOwnershipNotProven(address publisher);
    error EmptyProofField();
    error InvalidAuditScore(uint16 score);
    error ManifestAlreadyRegistered(bytes32 manifestHash);
    error ManifestCidTooLong();
    error ReleaseNotFound(bytes32 dappId, uint64 version);

    event ReleaseRegistered(
        bytes32 indexed releaseId,
        bytes32 indexed dappId,
        address indexed publisher,
        address contractAddress,
        uint64 version,
        bytes32 manifestHash,
        bytes32 runtimeCodeHash,
        bytes32 frontendCidHash,
        bytes32 auditReportHash,
        uint16 auditScore,
        string manifestCid
    );

    mapping(bytes32 dappId => uint64 version) public latestVersion;
    mapping(bytes32 dappId => mapping(uint64 version => Release release)) private releases;
    mapping(bytes32 manifestHash => bool registered) public manifestRegistered;

    function registerRelease(ReleaseInput calldata input)
        external
        returns (bytes32 releaseId, bytes32 dappId, uint64 version)
    {
        if (input.contractAddress.code.length == 0) revert ContractNotDeployed(input.contractAddress);
        if (
            input.creationCodeHash == bytes32(0) || input.runtimeCodeHash == bytes32(0)
                || input.sourceHash == bytes32(0) || input.frontendCidHash == bytes32(0)
                || input.auditReportHash == bytes32(0) || input.manifestHash == bytes32(0)
        ) revert EmptyProofField();
        if (input.auditScore > 100) revert InvalidAuditScore(input.auditScore);
        if (bytes(input.manifestCid).length == 0 || bytes(input.manifestCid).length > 128) revert ManifestCidTooLong();
        if (manifestRegistered[input.manifestHash]) revert ManifestAlreadyRegistered(input.manifestHash);

        (bool ownerCallOk, bytes memory ownerResult) = input.contractAddress.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("owner()")))
        );
        if (!ownerCallOk || ownerResult.length != 32 || abi.decode(ownerResult, (address)) != msg.sender) {
            revert ContractOwnershipNotProven(msg.sender);
        }

        bytes32 actualRuntimeCodeHash;
        address deployed = input.contractAddress;
        assembly ("memory-safe") {
            actualRuntimeCodeHash := extcodehash(deployed)
        }
        if (actualRuntimeCodeHash != input.runtimeCodeHash) {
            revert RuntimeCodeHashMismatch(input.runtimeCodeHash, actualRuntimeCodeHash);
        }

        dappId = keccak256(abi.encode("DAPPSTER_DAPP_V1", block.chainid, input.contractAddress));
        version = latestVersion[dappId] + 1;
        releaseId = keccak256(abi.encode("DAPPSTER_RELEASE_V1", dappId, version, msg.sender, input.manifestHash));

        latestVersion[dappId] = version;
        manifestRegistered[input.manifestHash] = true;
        releases[dappId][version] = Release({
            publisher: msg.sender,
            contractAddress: input.contractAddress,
            creationCodeHash: input.creationCodeHash,
            runtimeCodeHash: input.runtimeCodeHash,
            sourceHash: input.sourceHash,
            frontendCidHash: input.frontendCidHash,
            auditReportHash: input.auditReportHash,
            manifestHash: input.manifestHash,
            version: version,
            deploymentBlock: input.deploymentBlock,
            registeredBlock: uint64(block.number),
            auditScore: input.auditScore,
            manifestCid: input.manifestCid
        });

        _emitReleaseRegistered(releaseId, dappId, releases[dappId][version]);
    }

    function getRelease(bytes32 dappId, uint64 version) external view returns (Release memory release) {
        release = releases[dappId][version];
        if (release.publisher == address(0)) revert ReleaseNotFound(dappId, version);
    }

    function _emitReleaseRegistered(bytes32 releaseId, bytes32 dappId, Release storage release) private {
        emit ReleaseRegistered(
            releaseId,
            dappId,
            release.publisher,
            release.contractAddress,
            release.version,
            release.manifestHash,
            release.runtimeCodeHash,
            release.frontendCidHash,
            release.auditReportHash,
            release.auditScore,
            release.manifestCid
        );
    }
}
