import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const promptBuilder = await readFile(new URL("../components/PromptBuilder.tsx", import.meta.url), "utf8")

assert.match(
  promptBuilder,
  /SOLANA_WALLET_STANDARD_CHAIN[\s\S]*devnet: "solana:devnet"[\s\S]*"mainnet-beta": "solana:mainnet"/,
  "Wallet Standard requests must use the explicit chain identifier for each cluster.",
)
assert.match(
  promptBuilder,
  /feature\.signTransaction\(\{[\s\S]*account,[\s\S]*chain,[\s\S]*transaction:/,
  "Funding must use Wallet Standard signing with an explicit chain.",
)
assert.doesNotMatch(
  promptBuilder,
  /adapter\.sendTransaction\(fundingTransaction/,
  "The wallet must not choose or broadcast the funding network.",
)
assert.match(
  promptBuilder,
  /rpc\.sendRawTransaction\(signedFundingBytes/,
  "Dappster must broadcast signed funding bytes through the selected-cluster RPC.",
)
assert.match(
  promptBuilder,
  /connection\.getBalance\(adapter\.publicKey, "confirmed"\)/,
  "The selected-cluster balance must be checked before opening Phantom.",
)
assert.match(
  promptBuilder,
  /genesisHash !== SOLANA_GENESIS_HASH\[targetSolanaCluster\]/,
  "The selected RPC must still be verified by genesis hash before funding.",
)
assert.match(
  promptBuilder,
  /quote\.cluster !== targetSolanaCluster/,
  "The backend quote cluster must still match the UI selection.",
)
assert.match(
  promptBuilder,
  /targetSolanaCluster === "devnet" && adapter\.standard !== true/,
  "Devnet funding must reject legacy adapters that cannot communicate the requested chain.",
)

console.log("Solana cluster-aware funding checks passed")
