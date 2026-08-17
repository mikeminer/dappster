import assert from "node:assert/strict"
import {
  isRecoverableSolanaSandboxSessionError,
  withSolanaSandboxSessionRecovery,
} from "../lib/solana-sandbox-recovery.ts"

assert.equal(
  isRecoverableSolanaSandboxSessionError(new Error("Solana build sandbox unavailable: Sandbox stream was closed and is not accepting commands.")),
  true,
)
assert.equal(isRecoverableSolanaSandboxSessionError(new Error("Compilazione del programma Solana non riuscita")), false)

let attempts = 0
let recycled = 0
const recovered = await withSolanaSandboxSessionRecovery(
  async () => {
    attempts += 1
    if (attempts === 1) throw new Error("Sandbox stream was closed and is not accepting commands")
    return "compiled"
  },
  async () => {
    recycled += 1
  },
)
assert.equal(recovered, "compiled")
assert.equal(attempts, 2)
assert.equal(recycled, 1)

attempts = 0
await assert.rejects(
  withSolanaSandboxSessionRecovery(
    async () => {
      attempts += 1
      throw new Error("Anchor compiler error")
    },
    async () => {
      throw new Error("must not recycle")
    },
  ),
  /Anchor compiler error/,
)
assert.equal(attempts, 1)

console.log("Solana Sandbox session recovery checks passed")
