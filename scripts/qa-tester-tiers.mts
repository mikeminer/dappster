import assert from "node:assert/strict"
import {
  PASTA_SOLANA_TESTER_MINIMUM_RAW,
  isSolanaTesterAction,
  qualifiesForSolanaTesterTier,
} from "../lib/pasta-developer-policy.ts"
import {
  PAPPARDELLE_EVM_TESTER_MINIMUM_RAW,
  isEvmTesterAction,
  qualifiesForEvmTesterTier,
} from "../lib/pappardelle-tester-policy.ts"
import { optionalCreditBurnProofSchema } from "../lib/credit-burn-schema.ts"

assert.equal(PASTA_SOLANA_TESTER_MINIMUM_RAW, BigInt("10000000000000"))
assert.equal(qualifiesForSolanaTesterTier(PASTA_SOLANA_TESTER_MINIMUM_RAW - BigInt(1)), false)
assert.equal(qualifiesForSolanaTesterTier(PASTA_SOLANA_TESTER_MINIMUM_RAW), true)
assert.equal(PAPPARDELLE_EVM_TESTER_MINIMUM_RAW, BigInt("50000000000000000000000000"))
assert.equal(qualifiesForEvmTesterTier(PAPPARDELLE_EVM_TESTER_MINIMUM_RAW - BigInt(1)), false)
assert.equal(qualifiesForEvmTesterTier(PAPPARDELLE_EVM_TESTER_MINIMUM_RAW), true)

assert.equal(isSolanaTesterAction("solana dApp generation"), true)
assert.equal(isSolanaTesterAction("solana basic security audit"), true)
assert.equal(isSolanaTesterAction("SOLANA IPFS frontend deployment"), true)
assert.equal(isSolanaTesterAction("evm dApp generation"), false)
assert.equal(isEvmTesterAction("evm dApp generation"), true)
assert.equal(isEvmTesterAction("evm premium deployed-contract audit"), true)
assert.equal(isEvmTesterAction("EVM IPFS frontend deployment"), true)
assert.equal(isEvmTesterAction("solana dApp generation"), false)
assert.equal(isSolanaTesterAction("evm premium security audit"), false)
assert.equal(isEvmTesterAction("solana premium security audit"), false)
assert.equal(isSolanaTesterAction("IPFS frontend deployment"), false)
assert.equal(isEvmTesterAction("IPFS frontend deployment"), false)
assert.equal(isSolanaTesterAction("EVM IPFS frontend deployment"), false)
assert.equal(isEvmTesterAction("SOLANA IPFS frontend deployment"), false)

assert.equal(optionalCreditBurnProofSchema.parse(null), undefined)
assert.equal(optionalCreditBurnProofSchema.parse(undefined), undefined)
assert.deepEqual(optionalCreditBurnProofSchema.parse({
  txHash: `0x${"1".repeat(64)}`,
  usageId: `0x${"2".repeat(64)}`,
  payer: `0x${"3".repeat(40)}`,
}), {
  txHash: `0x${"1".repeat(64)}`,
  usageId: `0x${"2".repeat(64)}`,
  payer: `0x${"3".repeat(40)}`,
})
assert.throws(() => optionalCreditBurnProofSchema.parse({ payer: "0x1234" }))

console.log("Solana and EVM Tester tier policy checks passed")
