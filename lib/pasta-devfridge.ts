import {
  DEVFRIDGE_SCANNER_URL,
  PASTA_DEVFRIDGE_MIN_LOCK_DAYS,
  PASTA_DEVFRIDGE_RENEWAL_THRESHOLD_DAYS,
  PASTA_SOLANA_TESTER_MINIMUM_RAW,
  PASTA_TOKEN_MINT,
} from "@/lib/pasta-developer-policy"

type DevFridgeLock = {
  amount?: unknown
  createdAt?: unknown
  unlockAt?: unknown
  depositor?: unknown
  wallet?: unknown
  mint?: unknown
}

export type DevFridgePastaStatus = {
  eligible: boolean
  lockedRaw: bigint
  qualifyingLockCount: number
  daysRemaining: number
  needsRenewal: boolean
}

function integer(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function rawAmount(value: unknown) {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value)
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  return null
}

export function evaluateDevFridgePastaLocks(payload: unknown, expectedWallet: string): DevFridgePastaStatus {
  const empty = { eligible: false, lockedRaw: BigInt(0), qualifyingLockCount: 0, daysRemaining: 0, needsRenewal: false }
  if (!payload || typeof payload !== "object") return empty
  const data = payload as Record<string, unknown>
  if (data.wallet !== expectedWallet || data.mint !== PASTA_TOKEN_MINT || !Array.isArray(data.activeLocks)) return empty
  const checkedAt = integer(data.ts)
  if (checkedAt === null) return empty

  let lockedRaw = BigInt(0)
  let qualifyingLockCount = 0
  let bestUnlockAt = 0
  for (const candidate of data.activeLocks as DevFridgeLock[]) {
    const createdAt = integer(candidate.createdAt)
    const unlockAt = integer(candidate.unlockAt)
    const amount = rawAmount(candidate.amount)
    if (createdAt === null || unlockAt === null || amount === null || unlockAt <= checkedAt) continue
    if (typeof candidate.mint === "string" && candidate.mint !== PASTA_TOKEN_MINT) continue
    const lockWallet = typeof candidate.depositor === "string" ? candidate.depositor : candidate.wallet
    if (typeof lockWallet === "string" && lockWallet !== expectedWallet) continue
    const durationDays = Math.floor((unlockAt - createdAt) / 86_400)
    if (durationDays < PASTA_DEVFRIDGE_MIN_LOCK_DAYS) continue
    lockedRaw += amount
    qualifyingLockCount += 1
    bestUnlockAt = Math.max(bestUnlockAt, unlockAt)
  }

  const daysRemaining = bestUnlockAt ? Math.max(0, Math.floor((bestUnlockAt - checkedAt) / 86_400)) : 0
  const eligible = lockedRaw >= PASTA_SOLANA_TESTER_MINIMUM_RAW && daysRemaining > 0
  return {
    eligible,
    lockedRaw,
    qualifyingLockCount,
    daysRemaining,
    needsRenewal: eligible && daysRemaining <= PASTA_DEVFRIDGE_RENEWAL_THRESHOLD_DAYS,
  }
}

export async function readDevFridgePastaStatus(walletAddress: string) {
  const endpoint = `${DEVFRIDGE_SCANNER_URL}/api/sdk/check?wallet=${encodeURIComponent(walletAddress)}&mint=${encodeURIComponent(PASTA_TOKEN_MINT)}`
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`DevFridge API error: ${response.status}`)
  return evaluateDevFridgePastaLocks(await response.json(), walletAddress)
}
