export const PASTA_TOKEN_MINT = "39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump"
export const PASTA_TOKEN_DECIMALS = 6
export const PASTA_SOLANA_TESTER_MINIMUM = 10_000_000
export const PASTA_TOKEN_BASE_UNITS = BigInt("1000000")
export const PASTA_SOLANA_TESTER_MINIMUM_RAW = BigInt(PASTA_SOLANA_TESTER_MINIMUM) * PASTA_TOKEN_BASE_UNITS
export const PASTA_DEVFRIDGE_MIN_LOCK_DAYS = 60
export const PASTA_DEVFRIDGE_RENEWAL_THRESHOLD_DAYS = 29
export const DEVFRIDGE_URL = "https://devfridge.cool"
export const DEVFRIDGE_SCANNER_URL = "https://scan.devfridge.cool"
export const PASTA_DEVFRIDGE_LOCK_URL = `${DEVFRIDGE_URL}?mint=${PASTA_TOKEN_MINT}&days=${PASTA_DEVFRIDGE_MIN_LOCK_DAYS}`
export const PASTA_DEVFRIDGE_SCAN_URL = `${DEVFRIDGE_SCANNER_URL}/t/${PASTA_TOKEN_MINT}`
export const PASTA_DEVFRIDGE_BADGE_URL = `${DEVFRIDGE_SCANNER_URL}/api/badge?mint=${PASTA_TOKEN_MINT}&theme=dark&style=compact`

export function qualifiesForSolanaTesterTier(balanceRaw: bigint) {
  return balanceRaw >= PASTA_SOLANA_TESTER_MINIMUM_RAW
}

export function isSolanaTesterAction(action: string) {
  const normalized = action.trim().toLowerCase()
  return normalized === "solana dapp generation"
    || normalized === "solana ipfs frontend deployment"
    || normalized.startsWith("solana ") && (normalized.includes("security audit") || normalized.includes("deployed-contract audit"))
}
