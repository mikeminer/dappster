import assert from "node:assert/strict"
import { normalizeGenerationWarnings } from "../lib/generation-output.ts"

assert.deepEqual(normalizeGenerationWarnings(null), [])
assert.deepEqual(normalizeGenerationWarnings(undefined), [])
assert.deepEqual(normalizeGenerationWarnings("  Review token authority  "), ["Review token authority"])
assert.deepEqual(
  normalizeGenerationWarnings([
    "Review token authority",
    { message: "Confirm the mint decimals" },
    { warning: "Confirm the mint decimals" },
    null,
    42,
  ]),
  ["Review token authority", "Confirm the mint decimals"],
)
assert.deepEqual(
  normalizeGenerationWarnings({ residual: ["Operational risk"], ignoredNumber: 7 }),
  ["Operational risk"],
)

console.log("Generation warning normalization checks passed")
