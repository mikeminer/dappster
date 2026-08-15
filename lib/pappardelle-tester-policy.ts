export const PAPPARDELLE_BASE_TOKEN = "0x41859a1048fb4f8d668861b1249504bf52e6d3bd"
export const PAPPARDELLE_TOKEN_DECIMALS = 18
export const PAPPARDELLE_EVM_TESTER_MINIMUM = 50_000_000
export const PAPPARDELLE_TOKEN_BASE_UNITS = BigInt("1000000000000000000")
export const PAPPARDELLE_EVM_TESTER_MINIMUM_RAW = BigInt(PAPPARDELLE_EVM_TESTER_MINIMUM) * PAPPARDELLE_TOKEN_BASE_UNITS

export function qualifiesForEvmTesterTier(balanceRaw: bigint) {
  return balanceRaw >= PAPPARDELLE_EVM_TESTER_MINIMUM_RAW
}

export function isEvmTesterAction(action: string) {
  const normalized = action.trim().toLowerCase()
  return normalized === "evm dapp generation"
    || normalized === "evm ipfs frontend deployment"
    || normalized.startsWith("evm ") && (normalized.includes("security audit") || normalized.includes("deployed-contract audit"))
}
