export const PASTA_TOKEN_MINT = "39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump"
export const PASTA_TOKEN_DECIMALS = 6
export const PASTA_SOLANA_TESTER_MINIMUM = 10_000_000
export const PASTA_TOKEN_BASE_UNITS = BigInt("1000000")
export const PASTA_SOLANA_TESTER_MINIMUM_RAW = BigInt(PASTA_SOLANA_TESTER_MINIMUM) * PASTA_TOKEN_BASE_UNITS

export function qualifiesForSolanaTesterTier(balanceRaw: bigint) {
  return balanceRaw >= PASTA_SOLANA_TESTER_MINIMUM_RAW
}

export function isSolanaTesterAction(action: string) {
  const normalized = action.trim().toLowerCase()
  return normalized === "solana dapp generation"
    || normalized.startsWith("solana ") && (normalized.includes("security audit") || normalized.includes("deployed-contract audit"))
}
