import assert from "node:assert/strict"
import { evaluateDevFridgePastaLocks } from "../lib/pasta-devfridge"
import { PASTA_SOLANA_TESTER_MINIMUM_RAW, PASTA_TOKEN_MINT } from "../lib/pasta-developer-policy"

const wallet = "GxPoKNX26GCisuH8Sdr8rtfZY98L5t5eegKtDzSA9P6W"
const now = 2_000_000_000
const days = (count: number) => count * 86_400
const payload = (activeLocks: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) => ({
  wallet,
  mint: PASTA_TOKEN_MINT,
  ts: now,
  activeLocks,
  ...overrides,
})
const lock = (amount: bigint, durationDays = 90, remainingDays = 80) => ({
  amount: amount.toString(),
  createdAt: now - days(durationDays - remainingDays),
  unlockAt: now + days(remainingDays),
  depositor: wallet,
  mint: PASTA_TOKEN_MINT,
})

const half = PASTA_SOLANA_TESTER_MINIMUM_RAW / BigInt(2)
const combined = evaluateDevFridgePastaLocks(payload([lock(half), lock(PASTA_SOLANA_TESTER_MINIMUM_RAW - half)]), wallet)
assert.equal(combined.eligible, true)
assert.equal(combined.lockedRaw, PASTA_SOLANA_TESTER_MINIMUM_RAW)
assert.equal(combined.qualifyingLockCount, 2)

assert.equal(evaluateDevFridgePastaLocks(payload([lock(PASTA_SOLANA_TESTER_MINIMUM_RAW, 59, 40)]), wallet).eligible, false)
assert.equal(evaluateDevFridgePastaLocks(payload([lock(PASTA_SOLANA_TESTER_MINIMUM_RAW - BigInt(1))]), wallet).eligible, false)
assert.equal(evaluateDevFridgePastaLocks(payload([lock(PASTA_SOLANA_TESTER_MINIMUM_RAW)], { wallet: "WrongWallet" }), wallet).eligible, false)
assert.equal(evaluateDevFridgePastaLocks(payload([lock(PASTA_SOLANA_TESTER_MINIMUM_RAW)], { mint: "WrongMint" }), wallet).eligible, false)
assert.equal(evaluateDevFridgePastaLocks(payload([{ ...lock(PASTA_SOLANA_TESTER_MINIMUM_RAW), depositor: "WrongWallet" }]), wallet).eligible, false)

const renewal = evaluateDevFridgePastaLocks(payload([lock(PASTA_SOLANA_TESTER_MINIMUM_RAW, 70, 20)]), wallet)
assert.equal(renewal.eligible, true)
assert.equal(renewal.needsRenewal, true)

console.log("DevFridge PASTA entitlement checks passed")
