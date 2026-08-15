import { isAddress, parseAbi } from "viem"

export const DAPPSTER_IDENTITY_REGISTRY_ABI = parseAbi([
  "error ContractNotDeployed(address contractAddress)",
  "error RuntimeCodeHashMismatch(bytes32 expected,bytes32 actual)",
  "error ContractOwnershipNotProven(address publisher)",
  "error EmptyProofField()",
  "error InvalidAuditScore(uint16 score)",
  "error ManifestAlreadyRegistered(bytes32 manifestHash)",
  "error ManifestCidTooLong()",
  "error ReleaseNotFound(bytes32 dappId,uint64 version)",
  "function registerRelease((address contractAddress,bytes32 creationCodeHash,bytes32 runtimeCodeHash,bytes32 sourceHash,bytes32 frontendCidHash,bytes32 auditReportHash,bytes32 manifestHash,uint16 auditScore,uint64 deploymentBlock,string manifestCid) input) returns (bytes32 releaseId,bytes32 dappId,uint64 version)",
  "function latestVersion(bytes32 dappId) view returns (uint64)",
  "function manifestRegistered(bytes32 manifestHash) view returns (bool)",
  "function getRelease(bytes32 dappId,uint64 version) view returns ((address publisher,address contractAddress,bytes32 creationCodeHash,bytes32 runtimeCodeHash,bytes32 sourceHash,bytes32 frontendCidHash,bytes32 auditReportHash,bytes32 manifestHash,uint64 version,uint64 deploymentBlock,uint64 registeredBlock,uint16 auditScore,string manifestCid))",
  "event ReleaseRegistered(bytes32 indexed releaseId,bytes32 indexed dappId,address indexed publisher,address contractAddress,uint64 version,bytes32 manifestHash,bytes32 runtimeCodeHash,bytes32 frontendCidHash,bytes32 auditReportHash,uint16 auditScore,string manifestCid)",
])

export function getIdentityRegistryAddress() {
  const value = process.env.NEXT_PUBLIC_DAPPSTER_IDENTITY_REGISTRY_ADDRESS
  return value && isAddress(value) ? value : null
}

export type PreparedRelease = {
  preparedId: string
  registryAddress: `0x${string}`
  input: {
    contractAddress: `0x${string}`
    creationCodeHash: `0x${string}`
    runtimeCodeHash: `0x${string}`
    sourceHash: `0x${string}`
    frontendCidHash: `0x${string}`
    auditReportHash: `0x${string}`
    manifestHash: `0x${string}`
    auditScore: number
    deploymentBlock: string
    manifestCid: string
  }
}
